import { Agent } from "@mastra/core/agent";
import { z } from "zod";
import { AP_TOOLS, type RunContext } from "../tools/ap-tools";
import type { HarnessVersion } from "@/lib/types";

export const DecisionSchema = z.object({
  decision: z.enum(["approve", "reject", "route"]),
  route: z.enum(["procurement", "logistics", "ap_manager", "ap_clerk", "hold_for_receipt", "fraud_review"]).nullable(),
  reason: z.string().describe("One or two sentences a human AP reviewer would understand."),
});
export type AgentDecision = z.infer<typeof DecisionSchema>;

/** Build the system prompt from a harness version. This is the part the harness rewrites. */
export function buildInstructions(h: HarnessVersion, vendorId: string) {
  const vendorRules = h.rules.filter((r) => r.scope === vendorId);
  const globalRules = h.rules.filter((r) => r.scope === null).slice(0, h.contextPolicy.maxGlobalRules);
  const softGuardrails = h.guardrails.filter((g) => !g.hard);
  const hardGuardrails = h.guardrails.filter((g) => g.hard);
  const tol = h.tools.priceTolerancePct[vendorId] ?? h.tools.defaultPriceTolerancePct;

  return [
    `You are an accounts payable matching agent. You receive one invoice and decide: approve, reject, or route to a queue.`,
    `Investigate using the tools before deciding. Fetch the PO, receipts, and vendor record when relevant. Always check prior invoices for duplicates.`,
    h.contextPolicy.vendorHistoryLimit > 0 ? `Check get_vendor_history: past decisions for this vendor include whether a human confirmed or corrected them.` : ``,
    h.contextPolicy.includeSimilarExceptions ? `When something does not match the PO, call search_similar_exceptions with a plain description of the mismatch before deciding.` : ``,
    ``,
    `Routes: procurement (PO/price/quantity disputes), logistics (freight account billing), ap_manager (escalation), ap_clerk (manual coding), hold_for_receipt (goods not yet received, wait), fraud_review (bank or identity concerns).`,
    ``,
    `## Policy rules`,
    ...globalRules.map((r) => `- [${r.id}] ${r.text}`),
    vendorRules.length ? `\n## Rules specific to vendor ${vendorId}` : ``,
    ...vendorRules.map((r) => `- [${r.id}] ${r.text}`),
    ``,
    `## Guardrails`,
    ...softGuardrails.map((g) => `- ${g.text}`),
    ...hardGuardrails.map((g) => `- (enforced in code) ${g.text}`),
    ``,
    `## Tolerances`,
    `- Unit price variance tolerance for this vendor: ${tol}% above PO price.`,
    ``,
    `Output a JSON object with decision, route (null unless decision is route), and a short reason.`,
  ]
    .filter((line) => line !== ``)
    .join("\n");
}

export const apAgent = new Agent({
  id: "ap-agent",
  name: "AP Matching Agent",
  model: process.env.WORKER_MODEL ?? "openai/gpt-6-luna",
  instructions: ({ requestContext }) => {
    const run = requestContext.get("run") as RunContext | undefined;
    if (!run) throw new Error("ap-agent requires a run context");
    return buildInstructions(run.harness, run.vendorId);
  },
  tools: ({ requestContext }) => {
    const run = requestContext.get("run") as RunContext | undefined;
    const enabled = new Set(run?.harness.tools.enabled ?? Object.keys(AP_TOOLS));
    if (!run?.harness.contextPolicy.includeSimilarExceptions) enabled.delete("search_similar_exceptions");
    if ((run?.harness.contextPolicy.vendorHistoryLimit ?? 0) <= 0) enabled.delete("get_vendor_history");
    return Object.fromEntries(Object.entries(AP_TOOLS).filter(([id]) => enabled.has(id)));
  },
});
