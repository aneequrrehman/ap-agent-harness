import { RequestContext } from "@mastra/core/request-context";
import { randomUUID } from "node:crypto";
import { collections } from "@/lib/db";
import { mastra } from "@/mastra";
import { DecisionSchema, type AgentDecision } from "@/mastra/agents/ap-agent";
import type { RunContext } from "@/mastra/tools/ap-tools";
import { deriveFacts, matchesCondition } from "./conditions";
import { embedOne } from "@/lib/embeddings";
import type { Episode, HarnessVersion, Invoice, TraceStep } from "@/lib/types";

/** Process one invoice under a harness version. Fast paths run first, then the model, then hard guardrails. */
export async function processInvoice(
  invoice: Invoice,
  harness: HarnessVersion,
  phase: "train" | "eval" | "demo",
  opts: { persist?: boolean } = {},
): Promise<Episode> {
  const persist = opts.persist ?? phase !== "demo";
  const started = Date.now();
  const c = await collections();

  const [vendor, po, receipts, priorInvoices] = await Promise.all([
    c.vendors.findOne({ vendorId: invoice.vendorId }),
    invoice.poNumber ? c.purchaseOrders.findOne({ poNumber: invoice.poNumber }) : Promise.resolve(null),
    invoice.poNumber ? c.receipts.find({ poNumber: invoice.poNumber }).toArray() : Promise.resolve([]),
    c.invoices.find({ vendorId: invoice.vendorId, status: { $in: ["paid", "credited"] } }).toArray(),
  ]);
  if (!vendor) throw new Error(`Vendor ${invoice.vendorId} missing`);

  const facts = deriveFacts({ invoice, vendor, po, receipts, priorInvoices });

  let decision: AgentDecision | null = null;
  let viaFastPath: string | undefined;
  let guardrailOverride: string | undefined;
  const trace: TraceStep[] = [];
  let usage: Episode["usage"];

  // 1. Deterministic fast paths. They can only route or reject, never approve.
  for (const fp of harness.fastPaths) {
    if (fp.action.decision !== "approve" && matchesCondition(fp.when, facts, invoice)) {
      decision = { decision: fp.action.decision, route: fp.action.route ?? null, reason: `[fast path ${fp.name}] ${fp.action.reason}` };
      viaFastPath = fp.id;
      trace.push({ tool: "fast_path", input: fp.when, output: fp.action });
      break;
    }
  }

  // 2. Model decision.
  if (!decision) {
    const run: RunContext = { harness, vendorId: invoice.vendorId, invoiceId: invoice.invoiceId };
    const requestContext = new RequestContext();
    requestContext.set("run", run);

    const { status: _s, split: _sp, label: _l, ...visibleInvoice } = invoice as Invoice & { _id?: unknown };
    delete (visibleInvoice as { _id?: unknown })._id;

    const agent = mastra.getAgentById("ap-agent");
    const result = await agent.generate(
      `Decide on this invoice. Vendor id is ${invoice.vendorId}.\n\n${JSON.stringify(visibleInvoice, null, 2)}`,
      {
        requestContext,
        maxSteps: 10,
        structuredOutput: { schema: DecisionSchema, jsonPromptInjection: "auto" },
      },
    );

    for (const step of result.steps ?? []) {
      const calls = step.toolCalls ?? [];
      const results = step.toolResults ?? [];
      for (const call of calls) {
        const r = results.find((x) => x.payload.toolCallId === call.payload.toolCallId);
        trace.push({ tool: call.payload.toolName, input: call.payload.args, output: truncate(r?.payload.result) });
      }
    }
    const u = result.usage as Record<string, number | undefined> | undefined;
    usage = {
      inputTokens: u?.inputTokens ?? u?.promptTokens ?? 0,
      outputTokens: u?.outputTokens ?? u?.completionTokens ?? 0,
    };
    decision = result.object ?? parseFallback(result.text);
  }

  // 3. Hard guardrails: structured conditions that override an approve.
  if (decision.decision === "approve") {
    for (const g of harness.guardrails) {
      if (g.hard && g.when && g.action && matchesCondition(g.when, facts, invoice)) {
        guardrailOverride = g.id;
        decision = { decision: g.action.decision, route: g.action.route ?? null, reason: `[guardrail ${g.id}] ${g.action.reason}` };
        trace.push({ tool: "hard_guardrail", input: g.when, output: g.action });
        break;
      }
    }
  }

  const expected = invoice.label;
  const correct =
    decision.decision === expected.decision && (decision.decision !== "route" || decision.route === expected.route);
  const falseApproval = decision.decision === "approve" && expected.decision !== "approve";

  const decided = decision.route ? `${decision.decision}:${decision.route}` : decision.decision;
  const expectedStr = expected.route ? `${expected.decision}:${expected.route}` : expected.decision;
  const summary = [
    `Vendor ${vendor.name} (${vendor.vendorId}, tier ${vendor.tier}).`,
    `Invoice ${invoice.invoiceNumber} for ${invoice.total} ${invoice.currency}, PO ${invoice.poNumber ?? "none"}, receipts ${receipts.length}.`,
    invoice.memo ? `Memo: ${invoice.memo}.` : "",
    `Lines: ${invoice.lines.map((l) => `${l.description} x${l.qty} @ ${l.unitPrice}`).join("; ")}.`,
    `Agent decided ${decided}: ${decision.reason}`,
    `Human outcome: ${correct ? "confirmed" : `corrected to ${expectedStr} because ${expected.reason}`}.`,
  ]
    .filter(Boolean)
    .join(" ");
  // Only training episodes become retrievable memory, so eval answers never leak into later evals.
  const embedding = phase === "train" ? await embedOne(summary, "document") : null;

  const episode: Episode = {
    episodeId: randomUUID(),
    invoiceId: invoice.invoiceId,
    vendorId: invoice.vendorId,
    version: harness.version,
    phase,
    decision: decision.decision,
    route: decision.route ?? undefined,
    reason: decision.reason,
    expected,
    correct,
    falseApproval,
    viaFastPath,
    guardrailOverride,
    trace,
    usage,
    durationMs: Date.now() - started,
    createdAt: new Date().toISOString(),
    summary,
    ...(embedding ? { embedding } : {}),
  };
  if (persist) await c.episodes.insertOne(episode);
  return episode;
}

function parseFallback(text: string): AgentDecision {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      return DecisionSchema.parse(JSON.parse(m[0]));
    } catch {
      /* fall through */
    }
  }
  return { decision: "route", route: "ap_clerk", reason: `Could not parse model output: ${text.slice(0, 200)}` };
}

function truncate(v: unknown) {
  const s = JSON.stringify(v);
  if (s && s.length > 1500) return s.slice(0, 1500) + "…";
  return v;
}

/** Run a list of invoices with bounded concurrency. */
export async function processMany(
  invoices: Invoice[],
  harness: HarnessVersion,
  phase: "train" | "eval",
  concurrency = 5,
  onDone?: (e: Episode, i: number) => void,
): Promise<Episode[]> {
  const out: Episode[] = new Array(invoices.length);
  let next = 0;
  async function worker() {
    while (next < invoices.length) {
      const i = next++;
      try {
        out[i] = await processInvoice(invoices[i], harness, phase);
      } catch (err) {
        console.error(`  ! ${invoices[i].invoiceId} failed:`, (err as Error).message);
        out[i] = errorEpisode(invoices[i], harness, phase, err as Error);
      }
      onDone?.(out[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, invoices.length) }, worker));
  return out;
}

function errorEpisode(invoice: Invoice, harness: HarnessVersion, phase: "train" | "eval", err: Error): Episode {
  return {
    episodeId: randomUUID(),
    invoiceId: invoice.invoiceId,
    vendorId: invoice.vendorId,
    version: harness.version,
    phase,
    decision: "route",
    route: "ap_clerk",
    reason: `error: ${err.message.slice(0, 200)}`,
    expected: invoice.label,
    correct: false,
    falseApproval: false,
    trace: [],
    durationMs: 0,
    createdAt: new Date().toISOString(),
  };
}
