// The recursive loop: process a batch -> reflect on failures -> candidate version -> eval gate -> promote or reject.
// Usage: pnpm evolve [generations] [batchSize]

import { collections, closeDb } from "@/lib/db";
import { getActiveVersion, saveCandidate, promote, rejectCandidate } from "@/harness/store";
import { processMany } from "@/harness/runner";
import { runEval, isImprovement, fmtScore } from "@/harness/evaluator";
import { proposePatch, applyPatch } from "@/harness/reflector";
import type { Invoice } from "@/lib/types";

const generations = Number(process.argv[2] ?? 6);
const batchSize = Number(process.argv[3] ?? 10);

async function pickBatch(version: number, size: number): Promise<Invoice[]> {
  const c = await collections();
  // Prefer invoices not yet seen by this version, spread across vendors.
  const seen = new Set((await c.episodes.find({ version, phase: "train" }, { projection: { invoiceId: 1 } }).toArray()).map((e) => e.invoiceId));
  const all = await c.invoices.find({ split: "train", status: "pending" }).toArray();
  const unseen = all.filter((i) => !seen.has(i.invoiceId));
  // Invoices any earlier version got wrong are the most informative: re-test them under this version first.
  const everFailed = new Set((await c.episodes.find({ phase: "train", correct: false }, { projection: { invoiceId: 1 } }).toArray()).map((e) => e.invoiceId));
  const hard = unseen.filter((i) => everFailed.has(i.invoiceId));
  const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
  const easy = unseen.filter((i) => !everFailed.has(i.invoiceId));
  const pool = unseen.length >= size ? [...shuffle(hard), ...shuffle(easy)] : shuffle(all);
  // Round-robin by vendor for coverage, keeping the hard-first ordering within each vendor.
  const byVendor = new Map<string, Invoice[]>();
  for (const i of pool) byVendor.set(i.vendorId, [...(byVendor.get(i.vendorId) ?? []), i]);
  const out: Invoice[] = [];
  while (out.length < size && byVendor.size) {
    for (const [vid, list] of byVendor) {
      const next = list.shift();
      if (next) out.push(next);
      if (!list.length) byVendor.delete(vid);
      if (out.length >= size) break;
    }
  }
  return out;
}

async function main() {
  let active = await getActiveVersion();
  console.log(`Active harness: v${active.version} (${active.changelog})`);

  if (!active.evalScore) {
    console.log(`\nBaseline eval for v${active.version}...`);
    const score = await runEval(active, (d, t, e) => process.stdout.write(`\r  ${d}/${t} ${e.correct ? "✓" : "✗"} ${e.invoiceId}   `));
    console.log(`\n  v${active.version}: ${fmtScore(score)}`);
    active = await getActiveVersion();
  }

  let cleanStreak = 0;
  for (let g = 1; g <= generations; g++) {
    console.log(`\n=== Generation ${g} (harness v${active.version}) ===`);
    const batch = await pickBatch(active.version, batchSize);
    const episodes = await processMany(batch, active, "train", 5, (e) =>
      console.log(`  ${e.correct ? "✓" : "✗"} ${e.invoiceId} ${e.vendorId.padEnd(12)} got ${e.route ? `${e.decision}:${e.route}` : e.decision}${e.correct ? "" : `  expected ${e.expected.route ? `${e.expected.decision}:${e.expected.route}` : e.expected.decision}`}${e.viaFastPath ? "  (fast path)" : ""}`),
    );
    const failures = episodes.filter((e) => !e.correct);
    const successes = episodes.filter((e) => e.correct).slice(0, 4);
    console.log(`  batch: ${episodes.length - failures.length}/${episodes.length} correct`);

    if (!failures.length) {
      cleanStreak++;
      console.log(`  nothing to learn from this batch`);
      if (cleanStreak >= 2) {
        console.log(`  two clean batches in a row: training set is solved under v${active.version}, stopping early`);
        break;
      }
      continue;
    }
    cleanStreak = 0;

    console.log(`  reflecting on ${failures.length} failures...`);
    const patch = await proposePatch(active, failures.slice(0, 12), successes);
    const { candidate, rejectedItems } = await applyPatch(active, patch);
    candidate.triggerEpisodeIds = failures.map((e) => e.episodeId);
    console.log(`  candidate v${candidate.version}: ${candidate.changelog}`);
    console.log(`    +${patch.addRules.length} rules, ~${patch.editRules.length} edits, -${patch.removeRuleIds.length} rules, +${patch.addGuardrails.length} guardrails, +${patch.addFastPaths.length} fast paths`);
    for (const r of rejectedItems) console.log(`    rejected by invariant: ${r}`);
    await saveCandidate(candidate);

    console.log(`  evaluating candidate...`);
    const score = await runEval(candidate, (d, t, e) => process.stdout.write(`\r    ${d}/${t} ${e.correct ? "✓" : "✗"} ${e.invoiceId}   `));
    console.log(`\n    v${candidate.version}: ${fmtScore(score)}`);
    console.log(`    v${active.version}: ${fmtScore(active.evalScore!)}`);

    const c = await collections();
    if (isImprovement(score, active.evalScore)) {
      await promote(candidate.version);
      await c.evalRuns.updateOne({ version: candidate.version }, { $set: { accepted: true } });
      console.log(`  ✔ promoted v${candidate.version}`);
      active = await getActiveVersion();
    } else {
      await rejectCandidate(candidate.version);
      await c.evalRuns.updateOne({ version: candidate.version }, { $set: { accepted: false } });
      console.log(`  ✘ rejected v${candidate.version}, keeping v${active.version}`);
    }
  }

  console.log(`\nFinal active harness: v${active.version}: ${fmtScore(active.evalScore!)}`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
