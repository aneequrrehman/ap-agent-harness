import { Agent } from "@mastra/core/agent";
import { z } from "zod";

const ConditionSchema = z
  .object({
    vendorId: z.string().nullable(),
    vendorTier: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable(),
    hasPO: z.boolean().nullable(),
    poFound: z.boolean().nullable(),
    hasReceipt: z.boolean().nullable(),
    memoMatches: z.string().nullable().describe("case-insensitive regex tested against the invoice memo"),
    invoiceNumberMatches: z.string().nullable().describe("regex tested against the invoice number"),
    bankMismatch: z.boolean().nullable().describe("true when invoice bank account differs from vendor master"),
    bankChangedWithinDays: z.number().nullable().describe("matches when vendor bank details changed within N days"),
    totalOver: z.number().nullable(),
    currencyMismatch: z.boolean().nullable(),
    likelyDuplicate: z.boolean().nullable().describe("true when a normalized invoice number matches a paid invoice (ignores punctuation and leading zeros)"),
  })
  .describe("All non-null fields must match for the condition to fire.");

const ActionSchema = z.object({
  decision: z.enum(["route", "reject"]),
  route: z.enum(["procurement", "logistics", "ap_manager", "ap_clerk", "hold_for_receipt", "fraud_review"]).nullable(),
  reason: z.string(),
});

export const PatchSchema = z.object({
  rationale: z.string().describe("What pattern you found in the failures and why these changes fix it without breaking the successes."),
  changelog: z.string().describe("One line, human readable, like a git commit subject."),
  addRules: z.array(
    z.object({
      text: z.string(),
      scope: z.string().nullable().describe("vendorId to scope the rule to one vendor, or null for a global rule"),
    }),
  ),
  editRules: z.array(z.object({ id: z.string(), text: z.string() })),
  removeRuleIds: z.array(z.string()),
  addGuardrails: z.array(
    z.object({
      text: z.string(),
      hard: z.boolean().describe("hard guardrails need a structured `when` and `action` and are enforced in code after the model decides"),
      when: ConditionSchema.nullable(),
      action: ActionSchema.nullable(),
    }),
  ),
  addFastPaths: z.array(
    z.object({
      name: z.string().describe("snake_case"),
      when: ConditionSchema,
      action: ActionSchema,
    }),
  ),
  removeFastPathIds: z.array(z.string()),
  contextPolicy: z.object({
    vendorHistoryLimit: z.number().nullable(),
    includeSimilarExceptions: z.boolean().nullable(),
    maxGlobalRules: z.number().nullable(),
  }),
  priceTolerancePct: z.array(z.object({ vendorId: z.string(), pct: z.number() })),
  defaultPriceTolerancePct: z.number().nullable(),
});
export type Patch = z.infer<typeof PatchSchema>;

export const REFLECTOR_INSTRUCTIONS = `You are the reflector for a self-improving accounts payable harness.

A worker agent decides on invoices (approve / reject / route) using a harness made of:
- rules: natural-language policy lines placed in the worker's system prompt. Rules can be global or scoped to one vendorId.
- guardrails: soft (prompt text) or hard (a structured condition + action, enforced in code: if the condition matches and the worker said approve, the action overrides it).
- fastPaths: structured condition + action evaluated in code BEFORE the model runs. They save a model call. They may only route or reject, never approve.
- contextPolicy: how much vendor history (past decisions with human confirmations/corrections) the worker can see, and how many global rules to inline.
- tools: per-vendor unit price tolerance in percent.

You will be shown the current harness, a set of failed episodes (what the worker decided, what the human expected, the invoice, PO and receipt data), and some successes for contrast.

Your job: propose the smallest patch that fixes the failures without breaking the successes.

Principles:
- Prefer vendor-scoped rules when a pattern is specific to one vendor. Prefer global rules when the same mistake appears across vendors.
- When a failure could have been avoided with a deterministic check (no PO from a specific vendor, bank details changed recently, duplicate after normalization), add a fastPath or a hard guardrail instead of prose. Code beats prose.
- Never loosen a hard guardrail. You cannot remove them.
- Do not write rules that simply say "approve vendor X". Explain the pattern: what differs from the PO and why it is acceptable.
- The harness has memory tools the worker can only use if the context policy allows: get_vendor_history (past decisions for the same vendor with human confirmations/corrections; enabled when vendorHistoryLimit > 0) and search_similar_exceptions (vector search over past cases across all vendors; enabled by includeSimilarExceptions). When a failure repeats a pattern that a human already corrected on an earlier episode, enabling these is usually better than writing one more narrow rule, because it generalizes to vendors you have not seen yet.
- If the worker ignored a rule it was given, rewrite that rule to be more precise rather than adding another one.
- Rules must generalize to future invoices from that vendor. Never hardcode a date, an invoice number, an amount from one invoice, or an exchange rate for one day. Describe the pattern and the tolerance instead.
- When a vendor-scoped rule permits something up to a threshold, state both sides: what to do under the threshold and what to do over it.
- A vendor-scoped rule for one vendor must not be phrased so the worker applies it to other vendors with a similar category. Name the vendor and the exact trigger.
- Keep rule text under 40 words each.
- Leave arrays empty and fields null when you do not want to change them.`;

export const reflectorAgent = new Agent({
  id: "reflector-agent",
  name: "Harness Reflector",
  model: process.env.REFLECTOR_MODEL ?? "openai/gpt-6.1-sol",
  instructions: REFLECTOR_INSTRUCTIONS,
});
