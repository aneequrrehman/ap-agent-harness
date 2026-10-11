import Link from "next/link";
import { notFound } from "next/navigation";
import { loadVersionWithParent } from "@/lib/dashboard-data";
import { collections } from "@/lib/db";
import { HarnessView } from "@/components/HarnessView";
import type { HarnessVersion } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function VersionPage({ params }: { params: Promise<{ v: string }> }) {
  const { v } = await params;
  const data = await loadVersionWithParent(Number(v));
  if (!data) notFound();
  const { version: h, parent, episodes } = data;
  const c = await collections();
  const vendors = await c.vendors.find({}, { projection: { _id: 0, vendorId: 1, name: 1 } }).toArray();
  const vendorNames = Object.fromEntries(vendors.map((x) => [x.vendorId, x.name]));
  const diff = parent ? diffVersions(parent, h) : null;
  const s = h.evalScore;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">← Story</Link>
      <h1 className="mt-2 text-2xl font-semibold">v{h.version} <span className="text-base font-normal text-zinc-500">{h.status} · {h.changelog}</span></h1>
      {h.rationale && (
        <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">Reflector rationale</div>
          {h.rationale}
        </div>
      )}
      {s && (
        <p className="mt-3 text-sm">
          Eval: <b>{Math.round(s.accuracy * 100)}%</b> accuracy · <b>{s.falseApprovals}</b> false approvals · quirks <b>{s.quirksSolved.length}/{s.quirksTotal}</b> · {s.fastPathHits} fast-path hits of {s.total}
          {s.quirksSolved.length > 0 && <span className="text-zinc-500"> · solved: {s.quirksSolved.join(", ")}</span>}
        </p>
      )}

      {diff && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold">Diff against v{parent!.version}</h2>
          <div className="rounded-lg border border-zinc-200 p-4 font-mono text-xs dark:border-zinc-800">
            {diff.length ? diff.map((line, i) => (
              <div key={i} className={line.startsWith("+") ? "text-emerald-700 dark:text-emerald-400" : line.startsWith("-") ? "text-rose-700 dark:text-rose-400" : "text-zinc-500"}>{line}</div>
            )) : <div className="text-zinc-500">No structural changes.</div>}
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Full harness</h2>
        <HarnessView h={h} vendorNames={vendorNames} />
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold">Episodes under this version ({episodes.length})</h2>
        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-xs text-zinc-500 dark:bg-zinc-900">
              <tr><th className="px-3 py-2">Phase</th><th className="px-3 py-2">Invoice</th><th className="px-3 py-2">Vendor</th><th className="px-3 py-2">Decided</th><th className="px-3 py-2">Expected</th><th className="px-3 py-2">Reason</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {episodes.map((e) => (
                <tr key={e.episodeId} className={e.correct ? "" : "bg-rose-50/60 dark:bg-rose-950/20"}>
                  <td className="px-3 py-1.5">{e.phase}</td>
                  <td className="px-3 py-1.5 font-mono">{e.invoiceId}</td>
                  <td className="px-3 py-1.5">{vendorNames[e.vendorId] ?? e.vendorId}</td>
                  <td className="px-3 py-1.5">{e.correct ? "✓ " : "✗ "}{e.route ? `${e.decision}:${e.route}` : e.decision}</td>
                  <td className="px-3 py-1.5 text-zinc-500">{e.expected.route ? `${e.expected.decision}:${e.expected.route}` : e.expected.decision}</td>
                  <td className="max-w-md px-3 py-1.5 text-xs text-zinc-500">{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function diffVersions(a: HarnessVersion, b: HarnessVersion): string[] {
  const out: string[] = [];
  const ra = new Map(a.rules.map((r) => [r.id, r]));
  const rb = new Map(b.rules.map((r) => [r.id, r]));
  for (const [id, r] of rb) {
    if (!ra.has(id)) out.push(`+ rule ${r.scope ? `[${r.scope}] ` : ""}${r.text}`);
    else if (ra.get(id)!.text !== r.text) { out.push(`- rule ${ra.get(id)!.text}`); out.push(`+ rule ${r.scope ? `[${r.scope}] ` : ""}${r.text}`); }
  }
  for (const [id, r] of ra) if (!rb.has(id)) out.push(`- rule ${r.text}`);
  const ga = new Set(a.guardrails.map((g) => g.id));
  for (const g of b.guardrails) if (!ga.has(g.id)) out.push(`+ ${g.hard ? "hard " : ""}guardrail ${g.text}${g.when ? ` when ${JSON.stringify(g.when)}` : ""}`);
  const fa = new Set(a.fastPaths.map((f) => f.id));
  const fb = new Set(b.fastPaths.map((f) => f.id));
  for (const f of b.fastPaths) if (!fa.has(f.id)) out.push(`+ fast path ${f.name} when ${JSON.stringify(f.when)} → ${f.action.decision}${f.action.route ? `:${f.action.route}` : ""}`);
  for (const f of a.fastPaths) if (!fb.has(f.id)) out.push(`- fast path ${f.name}`);
  for (const k of Object.keys(b.contextPolicy) as (keyof HarnessVersion["contextPolicy"])[]) {
    if (a.contextPolicy[k] !== b.contextPolicy[k]) out.push(`~ contextPolicy.${k}: ${String(a.contextPolicy[k])} → ${String(b.contextPolicy[k])}`);
  }
  if (a.tools.defaultPriceTolerancePct !== b.tools.defaultPriceTolerancePct) out.push(`~ defaultPriceTolerancePct: ${a.tools.defaultPriceTolerancePct} → ${b.tools.defaultPriceTolerancePct}`);
  for (const [vid, pct] of Object.entries(b.tools.priceTolerancePct)) {
    if (a.tools.priceTolerancePct[vid] !== pct) out.push(`~ priceTolerance[${vid}]: ${a.tools.priceTolerancePct[vid] ?? "default"} → ${pct}`);
  }
  return out;
}
