import { randomUUID } from "node:crypto";
import { collections } from "@/lib/db";
import type { Episode, EvalScore, HarnessVersion, Invoice } from "@/lib/types";
import { processMany } from "./runner";
import { setEvalScore } from "./store";

export function scoreEpisodes(episodes: Episode[], invoices: Invoice[]): EvalScore {
  const byInvoice = new Map(invoices.map((i) => [i.invoiceId, i]));
  const total = episodes.length;
  const correct = episodes.filter((e) => e.correct).length;
  const stp = episodes.filter((e) => e.correct && e.decision === "approve").length;
  const shouldApprove = invoices.filter((i) => i.label.decision === "approve").length;
  const falseApprovals = episodes.filter((e) => e.falseApproval).length;
  const fastPathHits = episodes.filter((e) => e.viaFastPath).length;

  const quirkResults = new Map<string, boolean>();
  for (const e of episodes) {
    const q = byInvoice.get(e.invoiceId)?.label.quirkId;
    if (!q) continue;
    quirkResults.set(q, (quirkResults.get(q) ?? true) && e.correct);
  }
  const quirksSolved = [...quirkResults.entries()].filter(([, ok]) => ok).map(([q]) => q).sort();

  return {
    accuracy: total ? correct / total : 0,
    straightThrough: shouldApprove ? stp / shouldApprove : 0,
    falseApprovals,
    total,
    modelCalls: total - fastPathHits,
    fastPathHits,
    quirksSolved,
    quirksTotal: quirkResults.size,
  };
}

export async function runEval(harness: HarnessVersion, onProgress?: (done: number, total: number, e: Episode) => void): Promise<EvalScore> {
  const c = await collections();
  const invoices = await c.invoices.find({ split: "eval", status: "pending" }).toArray();
  let done = 0;
  const episodes = await processMany(invoices, harness, "eval", 5, (e) => onProgress?.(++done, invoices.length, e));
  const score = scoreEpisodes(episodes, invoices);
  await c.evalRuns.insertOne({ runId: randomUUID(), version: harness.version, score, accepted: null, createdAt: new Date().toISOString() });
  await setEvalScore(harness.version, score);
  return score;
}

/** Candidate must not regress on accuracy or false approvals. Ties are accepted only if they save model calls. */
export function isImprovement(candidate: EvalScore, current: EvalScore | undefined): boolean {
  if (!current) return true;
  if (candidate.falseApprovals > current.falseApprovals) return false;
  if (candidate.accuracy > current.accuracy) return true;
  if (candidate.accuracy === current.accuracy) {
    return candidate.falseApprovals < current.falseApprovals || candidate.modelCalls < current.modelCalls;
  }
  return false;
}

export function fmtScore(s: EvalScore) {
  return `acc ${(s.accuracy * 100).toFixed(0)}%  stp ${(s.straightThrough * 100).toFixed(0)}%  falseApprovals ${s.falseApprovals}  quirks ${s.quirksSolved.length}/${s.quirksTotal}  modelCalls ${s.modelCalls}/${s.total}`;
}
