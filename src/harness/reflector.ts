import { collections } from "@/lib/db";
import { mastra } from "@/mastra";
import { PatchSchema, type Patch } from "@/mastra/agents/reflector-agent";
import type { Condition, Episode, HarnessVersion, Invoice } from "@/lib/types";
import { isNonTrivialCondition } from "./conditions";
import { nextVersionNumber } from "./store";

interface EpisodeBundle {
  episode: Episode;
  invoice: Omit<Invoice, "label" | "split" | "status">;
  po: unknown;
  receipts: unknown[];
  priorInvoices: { invoiceNumber: string; status?: string }[];
  vendor: { vendorId: string; name: string; tier: number; currency: string; bankChangedAt: string };
}

async function bundle(e: Episode): Promise<EpisodeBundle> {
  const c = await collections();
  const invoice = await c.invoices.findOne({ invoiceId: e.invoiceId }, { projection: { _id: 0 } });
  if (!invoice) throw new Error(`invoice ${e.invoiceId} missing`);
  const { label: _l, split: _s, status: _st, ...visible } = invoice;
  const [vendor, po, receipts, prior] = await Promise.all([
    c.vendors.findOne({ vendorId: invoice.vendorId }, { projection: { _id: 0, hiddenQuirk: 0 } }),
    invoice.poNumber ? c.purchaseOrders.findOne({ poNumber: invoice.poNumber }, { projection: { _id: 0 } }) : null,
    invoice.poNumber ? c.receipts.find({ poNumber: invoice.poNumber }, { projection: { _id: 0 } }).toArray() : [],
    c.invoices
      .find({ vendorId: invoice.vendorId, status: { $in: ["paid", "credited"] } }, { projection: { _id: 0, invoiceNumber: 1, status: 1 } })
      .limit(10)
      .toArray(),
  ]);
  return {
    episode: e,
    invoice: visible,
    po,
    receipts,
    priorInvoices: prior.map((p) => ({ invoiceNumber: p.invoiceNumber, status: p.status })),
    vendor: {
      vendorId: vendor!.vendorId,
      name: vendor!.name,
      tier: vendor!.tier,
      currency: vendor!.currency,
      bankChangedAt: vendor!.bankAccount.changedAt,
    },
  };
}

function describeEpisode(b: EpisodeBundle) {
  const e = b.episode;
  const decided = e.route ? `${e.decision}:${e.route}` : e.decision;
  const expected = e.expected.route ? `${e.expected.decision}:${e.expected.route}` : e.expected.decision;
  return {
    invoiceId: e.invoiceId,
    vendor: b.vendor,
    workerDecision: decided,
    workerReason: e.reason,
    humanExpected: expected,
    humanReason: e.expected.reason,
    viaFastPath: e.viaFastPath ?? null,
    guardrailOverride: e.guardrailOverride ?? null,
    toolsCalled: e.trace.map((t) => t.tool),
    invoice: b.invoice,
    purchaseOrder: b.po,
    receipts: b.receipts,
    priorInvoicesForVendor: b.priorInvoices,
  };
}

export async function proposePatch(current: HarnessVersion, failures: Episode[], successes: Episode[]): Promise<Patch> {
  const failureBundles = await Promise.all(failures.map(bundle));
  const successBundles = await Promise.all(successes.map(bundle));

  const prompt = [
    `## Current harness (version ${current.version})`,
    "```json",
    JSON.stringify(
      {
        rules: current.rules,
        guardrails: current.guardrails,
        fastPaths: current.fastPaths,
        contextPolicy: current.contextPolicy,
        tools: current.tools,
      },
      null,
      2,
    ),
    "```",
    ``,
    `## Failed episodes (${failureBundles.length})`,
    "```json",
    JSON.stringify(failureBundles.map(describeEpisode), null, 2),
    "```",
    ``,
    `## Successful episodes for contrast (${successBundles.length})`,
    "```json",
    JSON.stringify(successBundles.map(describeEpisode), null, 2),
    "```",
    ``,
    `Propose a patch.`,
  ].join("\n");

  const agent = mastra.getAgentById("reflector-agent");
  const result = await agent.generate(prompt, {
    maxSteps: 1,
    structuredOutput: { schema: PatchSchema, jsonPromptInjection: "auto" },
  });
  if (!result.object) throw new Error(`Reflector returned no structured patch: ${result.text.slice(0, 300)}`);
  return result.object;
}

function cleanCondition(c: Record<string, unknown> | null | undefined): Condition | null {
  if (!c) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(c)) if (v !== null && v !== undefined) out[k] = v;
  return isNonTrivialCondition(out as Condition) ? (out as Condition) : null;
}

/** Apply a patch to produce a candidate version. Enforces harness invariants. */
export async function applyPatch(current: HarnessVersion, patch: Patch): Promise<{ candidate: HarnessVersion; rejectedItems: string[] }> {
  const version = await nextVersionNumber();
  const rejectedItems: string[] = [];
  let seq = 0;
  const id = (prefix: string) => `${prefix}-v${version}-${++seq}`;

  const removeRules = new Set(patch.removeRuleIds);
  const edits = new Map(patch.editRules.map((e) => [e.id, e.text]));
  const rules = current.rules
    .filter((r) => !removeRules.has(r.id))
    .map((r) => (edits.has(r.id) ? { ...r, text: edits.get(r.id)! } : r));
  for (const r of patch.addRules) {
    rules.push({ id: id("r"), text: r.text, scope: r.scope ?? null, source: "reflector", createdInVersion: version });
  }

  // Hard guardrails are append-only. Never removed, never edited.
  const guardrails = [...current.guardrails];
  for (const g of patch.addGuardrails) {
    if (g.hard) {
      const when = cleanCondition(g.when as Record<string, unknown> | null);
      if (!when || !g.action) {
        rejectedItems.push(`hard guardrail without a usable condition/action: ${g.text}`);
        continue;
      }
      guardrails.push({ id: id("g"), text: g.text, hard: true, when, action: { ...g.action, route: g.action.route ?? undefined }, source: "reflector", createdInVersion: version });
    } else {
      guardrails.push({ id: id("g"), text: g.text, hard: false, source: "reflector", createdInVersion: version });
    }
  }

  const removeFp = new Set(patch.removeFastPathIds);
  const fastPaths = current.fastPaths.filter((f) => !removeFp.has(f.id));
  for (const f of patch.addFastPaths) {
    const when = cleanCondition(f.when as Record<string, unknown>);
    if (!when) {
      rejectedItems.push(`fast path ${f.name} has an empty condition`);
      continue;
    }
    if ((f.action.decision as string) === "approve") {
      rejectedItems.push(`fast path ${f.name} tried to auto-approve`);
      continue;
    }
    fastPaths.push({
      id: id("fp"),
      name: f.name,
      when,
      action: { ...f.action, route: f.action.route ?? undefined },
      source: "reflector",
      createdInVersion: version,
      hits: 0,
    });
  }

  const contextPolicy = { ...current.contextPolicy };
  if (patch.contextPolicy.vendorHistoryLimit != null) contextPolicy.vendorHistoryLimit = Math.min(20, Math.max(0, patch.contextPolicy.vendorHistoryLimit));
  if (patch.contextPolicy.includeSimilarExceptions != null) contextPolicy.includeSimilarExceptions = patch.contextPolicy.includeSimilarExceptions;
  if (patch.contextPolicy.maxGlobalRules != null) contextPolicy.maxGlobalRules = Math.min(60, Math.max(5, patch.contextPolicy.maxGlobalRules));

  const tools = { ...current.tools, priceTolerancePct: { ...current.tools.priceTolerancePct } };
  for (const t of patch.priceTolerancePct) {
    if (t.pct > 10) {
      rejectedItems.push(`price tolerance ${t.pct}% for ${t.vendorId} exceeds the 10% cap`);
      continue;
    }
    tools.priceTolerancePct[t.vendorId] = t.pct;
  }
  if (patch.defaultPriceTolerancePct != null) {
    if (patch.defaultPriceTolerancePct > current.tools.defaultPriceTolerancePct) {
      rejectedItems.push(`raising the default price tolerance is not allowed automatically`);
    } else {
      tools.defaultPriceTolerancePct = patch.defaultPriceTolerancePct;
    }
  }

  const candidate: HarnessVersion = {
    version,
    parentVersion: current.version,
    createdAt: new Date().toISOString(),
    createdBy: "reflector",
    status: "candidate",
    rules,
    guardrails,
    fastPaths,
    contextPolicy,
    tools,
    changelog: patch.changelog,
    rationale: patch.rationale,
  };
  return { candidate, rejectedItems };
}
