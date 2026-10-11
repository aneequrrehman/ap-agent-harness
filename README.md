# AP Harness

A self-evolving accounts payable agent. The agent matches invoices against purchase orders and goods receipts and decides whether to approve, reject, or route them. The interesting part is not the agent. It is the harness around it, which rewrites itself.

Built for the Harness Engineering & Model Wrangling Hackathon, Statement One (recursive harnessing), with MongoDB Atlas as the data and memory layer and Mastra as the agent runtime.

> **Authorship.** The design was worked out in conversation between Aneeq ur Rehman and Claude (Claude Fable 5.1, via Claude Code). The code, the synthetic dataset and this README were written by Claude during the hackathon on 11 October 2026. The harness versions v1 onward were written by the harness itself, using gpt-6-luna as the reflector.

## What evolves

Everything the worker agent is given lives in Atlas as a versioned `harness_versions` document:

| Part | What it is | How it is used |
|---|---|---|
| rules | Policy lines, global or scoped to one vendor | Inlined into the worker's system prompt |
| guardrails | Soft (prompt text) or hard (structured condition plus action) | Hard guardrails are enforced in code after the model decides and can override an approve |
| fast paths | Structured condition plus action | Run in code before the model. Save a model call. May only route or reject, never approve |
| context policy | How much vendor history the worker sees, how many rules to inline | Controls what goes into the prompt and what tools return |
| tool config | Per-vendor price tolerances, enabled tools | Changes tool behaviour and the tool set |

After each batch of invoices a reflector agent reads the failures, proposes a patch, and the patch becomes a candidate version. The candidate is scored on a held-out eval set. It is promoted only if it does not regress on accuracy or false approvals.

Invariants the harness cannot break on its own:

- Hard guardrails are append-only. Nothing the reflector proposes can remove or weaken one.
- Fast paths can never auto-approve. Approvals always go through the model and the three-way match.
- The default price tolerance can only be lowered automatically. Per-vendor tolerances are capped at 10 percent.
- Every candidate must pass the eval gate before it becomes active.

## The dataset

Synthetic, generated deterministically in `src/data/generate.ts`. Twenty vendors, fifteen of which have a planted quirk the harness has to discover on its own: partial shipment invoicing, fuel surcharges, EUR billing against USD POs, reissues after credit notes, case-of-12 pricing, tons versus kilograms, rush fees that are only valid when the PO is flagged rush, PO numbers hidden in memos, recent bank detail changes, duplicates disguised with leading zeros, and so on. There are also plain vendors with ordinary exceptions and planted fraud cases, so a harness that learns "always approve vendor X" fails the eval.

Version 0 of the harness is a textbook AP policy that knows nothing about any vendor.

## Run it

```bash
cp .env.example .env   # fill in MONGODB_URI and OPENAI_API_KEY
pnpm install
pnpm seed              # loads the dataset and harness v0 into Atlas
pnpm evolve 8 10       # 8 generations, 10 training invoices per generation
pnpm dev               # dashboard on http://localhost:3000
```

`pnpm eval [version]` scores any version on the eval set.

## Demo pages

- `/` is the story: before and after numbers, the accuracy chart with rejected candidates shown hollow, the board of vendor quirks and which version learned each, and a timeline of every patch with the failures that triggered it, what the reflector wrote, and the eval verdict.
- `/try` runs one held-out invoice through harness v0 and the current version side by side, live. Nothing is persisted. The Oscorp "bank details changed" invoice is the best one to show: v0 approves it after four tool calls, the evolved harness routes it to fraud review in 0.2s via a fast path it wrote itself.
- `/versions/N` is the full harness at a version with a diff against its parent and every episode under it.

Suggested one-minute cut: story page hero (10s), scroll the quirk board (10s), one timeline step including a rejected one (20s), the `/try` Oscorp comparison (15s), the "not allowed to do to itself" list (5s).

## Results from the first session

Worker and reflector both ran on gpt-6-luna. Eval set is 48 held-out invoices covering all 17 planted quirk variants.

| Version | Accuracy | Straight-through | False approvals | Quirks found | Verdict |
|---|---|---|---|---|---|
| v0 (generic policy) | 48% | 36% | 4 | 3/17 | baseline |
| v1 | 65% | 57% | 3 | 8/17 | promoted |
| v2 | 65% | 57% | 4 | 8/17 | rejected (added a false approval) |
| v3 | 71% | 68% | 3 | 9/17 | promoted |
| v4 | 81% | 75% | 0 | 12/17 | promoted |
| v5 | 90% | 82% | 0 | 14/17 | promoted |
| v6 | 90% | 82% | 0 | 15/17 | rejected (tie, no model-call savings) |
| v7 | 96% | 93% | 0 | 16/17 | promoted, training set fully solved |

By v7 the harness had written 12 vendor-scoped rules, 3 fast paths and one per-vendor tolerance on its own. Seven of the 48 eval invoices are decided by fast paths without a model call. The one remaining miss is an Initech exchange-rate rule that was written too narrowly; the eval gate is what caught it. Total model spend for the run was about one dollar.

## Collections

- `vendors`, `purchase_orders`, `receipts`, `invoices`: the AP data. Invoices carry a `split` (train or eval) and a human label.
- `harness_versions`: every version, with parent pointer, status, changelog, reflector rationale and eval score.
- `episodes`: every decision with its tool trace, outcome, and whether it went via a fast path or was overridden by a guardrail.
- `eval_runs`: one row per eval with the accept or reject verdict.

## Layout

```
src/data/generate.ts         synthetic dataset with planted quirks
src/harness/seed-harness.ts  version 0
src/harness/conditions.ts    derived facts and the condition matcher
src/harness/runner.ts        fast paths -> model -> hard guardrails -> episode
src/harness/evaluator.ts     eval scoring and the promotion gate
src/harness/reflector.ts     patch proposal and application with invariants
src/mastra/agents/           worker and reflector agents
src/mastra/tools/            PO, receipts, vendor, prior invoices, vendor history
scripts/                     seed, evolve, eval
src/app/                     Next.js dashboard
```
