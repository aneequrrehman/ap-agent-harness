// Score a harness version on the eval set. Usage: pnpm eval [version]
import { closeDb } from "@/lib/db";
import { getActiveVersion, getVersion } from "@/harness/store";
import { runEval, fmtScore } from "@/harness/evaluator";

async function main() {
  const arg = process.argv[2];
  const harness = arg ? await getVersion(Number(arg)) : await getActiveVersion();
  if (!harness) throw new Error(`No version ${arg}`);
  console.log(`Evaluating v${harness.version}: ${harness.changelog}`);
  const score = await runEval(harness, (d, t, e) => console.log(`  ${d}/${t} ${e.correct ? "✓" : "✗"} ${e.invoiceId} ${e.vendorId.padEnd(12)} ${e.route ? `${e.decision}:${e.route}` : e.decision}${e.correct ? "" : ` (expected ${e.expected.route ? `${e.expected.decision}:${e.expected.route}` : e.expected.decision})`}`));
  console.log(fmtScore(score));
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
