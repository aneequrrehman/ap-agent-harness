import Link from "next/link";
import { loadStory } from "@/lib/demo-data";
import { QUIRK_NAMES } from "@/data/quirks";
import { AutoRefresh } from "@/components/AutoRefresh";
import { ScoreChart } from "@/components/ScoreChart";

export const dynamic = "force-dynamic";

const pct = (n?: number) => (n === undefined ? "–" : `${Math.round(n * 100)}%`);
const pretty = (s: string) => s.replace(":", " → ").replace(/_/g, " ");

export default async function Home() {
  const d = await loadStory();
  const a = d.active;
  const b = d.baseline;
  const points = d.versions.filter((v) => v.evalScore).map((v) => ({ version: v.version, accuracy: v.evalScore!.accuracy, falseApprovals: v.evalScore!.falseApprovals, status: v.status, changelog: v.changelog }));
  const quirkIds = Object.keys(QUIRK_NAMES);
  const solved = quirkIds.filter((q) => d.quirkSolvedAt[q] !== null).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <AutoRefresh ms={8000} />

      {/* Hero */}
      <section>
        <div className="text-xs font-semibold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Recursive harness · MongoDB Atlas · Mastra</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">An AP agent that rewrites its own harness</h1>
        <p className="mt-2 max-w-3xl text-zinc-600 dark:text-zinc-400">
          It matches invoices to purchase orders and receipts. It started with a textbook policy and no knowledge of any vendor. After every batch it reflects on its mistakes, patches its own rules, guardrails, fast paths and context policy, and ships the patch only if a held-out eval says it got better. Every version lives in Atlas.
        </p>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <Link href="/try" className="rounded-md bg-emerald-600 px-4 py-2 font-medium text-white hover:bg-emerald-700">Try an invoice live →</Link>
          {a && <Link href={`/versions/${a.version}`} className="rounded-md border border-zinc-300 px-4 py-2 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-900">Read harness v{a.version}</Link>}
        </div>
      </section>

      {/* Before / after */}
      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <Card label={`Before · harness v0`} tone="muted">
          <Stat big={pct(b?.evalScore?.accuracy)} label="eval accuracy" />
          <Row k="False approvals" v={String(b?.evalScore?.falseApprovals ?? "–")} danger />
          <Row k="Vendor quirks handled" v={`${b?.evalScore?.quirksSolved.length ?? 0} / ${quirkIds.length}`} />
          <Row k="Vendor-specific rules" v={String(b?.rules.filter((r) => r.scope).length ?? 0)} />
          <Row k="Fast paths" v={String(b?.fastPaths.length ?? 0)} />
        </Card>
        <Card label={`After · harness v${a?.version ?? "–"}, ${d.steps.filter((s) => s.version.status !== "rejected").length} self-written patches`} tone="good">
          <Stat big={pct(a?.evalScore?.accuracy)} label="eval accuracy" />
          <Row k="False approvals" v={String(a?.evalScore?.falseApprovals ?? "–")} danger={(a?.evalScore?.falseApprovals ?? 0) > 0} />
          <Row k="Vendor quirks handled" v={`${a?.evalScore?.quirksSolved.length ?? 0} / ${quirkIds.length}`} />
          <Row k="Vendor-specific rules" v={String(a?.rules.filter((r) => r.scope).length ?? 0)} />
          <Row k="Fast paths" v={`${a?.fastPaths.length ?? 0} · saving ${a?.evalScore?.fastPathHits ?? 0} of ${a?.evalScore?.total ?? 0} model calls`} />
        </Card>
      </section>

      <section className="mt-8 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="mb-1 text-sm font-semibold">Eval accuracy by version</h2>
        <p className="mb-3 text-xs text-zinc-500">Filled points were promoted. Hollow points are candidates the eval gate rejected.</p>
        <ScoreChart points={points} />
      </section>

      {/* Quirk board */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">What it discovered on its own</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Fifteen vendors have a quirk a human AP clerk would know. None of it was in version 0. {solved} of {quirkIds.length} behaviours are now handled correctly on the held-out eval.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {quirkIds.map((q) => {
            const at = d.quirkSolvedAt[q];
            const info = QUIRK_NAMES[q];
            return (
              <div key={q} className={`rounded-md border p-3 text-sm ${at !== null ? "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs text-zinc-500">{info.vendor}</div>
                    <div className="font-medium">{info.title}</div>
                  </div>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${at !== null ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800"}`}>
                    {at === null ? "not yet" : at === 0 ? "handled from the start" : `learned in v${at}`}
                  </span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{info.hint}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Timeline */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold">How it got there</h2>
        <p className="mt-1 text-sm text-zinc-500">Each step: the failures that triggered it, what the reflector changed, and whether the eval gate let it through.</p>
        <ol className="mt-4 space-y-4">
          {d.steps.map((s) => {
            const v = s.version;
            const p = s.parent;
            const promoted = v.status === "active" || v.status === "superseded";
            return (
              <li key={v.version} className={`rounded-lg border p-4 ${promoted ? "border-zinc-200 dark:border-zinc-800" : "border-dashed border-zinc-300 opacity-80 dark:border-zinc-700"}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold">v{p?.version} → v{v.version}</span>
                    <Verdict status={v.status} />
                  </div>
                  <div className="text-sm">
                    {p?.evalScore && v.evalScore && (
                      <>
                        <span className="text-zinc-500">{pct(p.evalScore.accuracy)}</span> → <b>{pct(v.evalScore.accuracy)}</b>
                        <span className="ml-3 text-zinc-500">false approvals {p.evalScore.falseApprovals} → {v.evalScore.falseApprovals}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="mt-1 text-sm font-medium">{v.changelog}</div>

                <div className="mt-3 grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Triggered by</div>
                    <ul className="mt-1 space-y-1 text-sm">
                      {s.triggers.slice(0, 4).map((t) => (
                        <li key={t.invoiceId} className="text-zinc-700 dark:text-zinc-300">
                          <span className="font-medium">{d.vendorNames[t.vendorId] ?? t.vendorId}</span>: got <span className="text-rose-700 dark:text-rose-400">{pretty(t.got)}</span>, human wanted <span className="text-emerald-700 dark:text-emerald-400">{pretty(t.expected)}</span>
                          <div className="text-xs text-zinc-500">{t.humanReason}</div>
                        </li>
                      ))}
                      {s.triggers.length > 4 && <li className="text-xs text-zinc-500">and {s.triggers.length - 4} more</li>}
                      {!s.triggers.length && <li className="text-xs text-zinc-500">no trigger recorded</li>}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">What it wrote</div>
                    <ul className="mt-1 space-y-1 text-sm">
                      {s.added.fastPaths.map((f, i) => <li key={`f${i}`}><Tag>fast path</Tag> <span className="font-mono text-xs">{f}</span></li>)}
                      {s.added.guardrails.map((g, i) => <li key={`g${i}`}><Tag>guardrail</Tag> {g}</li>)}
                      {s.added.policy.map((x, i) => <li key={`p${i}`}><Tag>policy</Tag> {x}</li>)}
                      {[...s.added.rules].sort((x, y) => Number(y.scope !== null) - Number(x.scope !== null)).slice(0, 5).map((r, i) => <li key={`r${i}`}><Tag>{r.scope ? d.vendorNames[r.scope] ?? r.scope : "global rule"}</Tag> {r.text}</li>)}
                      {s.added.rules.length > 5 && <li className="text-xs text-zinc-500">and {s.added.rules.length - 5} more rule changes</li>}
                    </ul>
                  </div>
                </div>
                {v.rationale && <details className="mt-3 text-sm"><summary className="cursor-pointer text-xs text-zinc-500">Reflector rationale</summary><p className="mt-1 text-zinc-600 dark:text-zinc-400">{v.rationale}</p></details>}
                <div className="mt-2 text-xs"><Link href={`/versions/${v.version}`} className="text-zinc-500 hover:underline">Full diff and episodes →</Link></div>
              </li>
            );
          })}
          {!d.steps.length && <li className="text-sm text-zinc-500">No generations yet. Run <code>pnpm evolve</code>.</li>}
        </ol>
      </section>

      {/* Guarantees */}
      <section className="mt-10 rounded-lg border border-zinc-200 p-5 dark:border-zinc-800">
        <h2 className="text-lg font-semibold">What it is not allowed to do to itself</h2>
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          <li>• Hard guardrails are append-only. It can add them, never remove or weaken one.</li>
          <li>• Fast paths can route or reject without a model call, but can never approve.</li>
          <li>• The default price tolerance can only go down. Per-vendor tolerances cap at 10%.</li>
          <li>• No patch becomes active unless the held-out eval shows no regression on accuracy or false approvals.</li>
          <li>• Eval invoices are never embedded into memory, so the harness can&apos;t study for the test.</li>
          <li>• Every version, episode and eval is a document in Atlas. Rollback is one query.</li>
        </ul>
      </section>

      <footer className="mt-10 text-xs text-zinc-500">{d.totalEpisodes} episodes recorded · {d.versions.length} harness versions · worker and reflector on gpt-6-luna · embeddings on voyage-4-lite via the Atlas model API</footer>
    </main>
  );
}

function Card({ label, tone, children }: { label: string; tone: "muted" | "good"; children: React.ReactNode }) {
  return (
    <div className={`rounded-lg border p-5 ${tone === "good" ? "border-emerald-300 bg-emerald-50/40 dark:border-emerald-800 dark:bg-emerald-950/20" : "border-zinc-200 dark:border-zinc-800"}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      {children}
    </div>
  );
}
function Stat({ big, label }: { big: string; label: string }) {
  return <div className="mt-2"><span className="text-4xl font-semibold">{big}</span> <span className="ml-1 text-sm text-zinc-500">{label}</span></div>;
}
function Row({ k, v, danger }: { k: string; v: string; danger?: boolean }) {
  return <div className="mt-2 flex justify-between border-t border-zinc-100 pt-2 text-sm dark:border-zinc-800"><span className="text-zinc-500">{k}</span><span className={danger ? "font-semibold text-rose-600 dark:text-rose-400" : "font-medium"}>{v}</span></div>;
}
function Tag({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">{children}</span>;
}
function Verdict({ status }: { status: string }) {
  const cls = status === "rejected" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" : status === "candidate" ? "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
  const text = status === "rejected" ? "rejected by eval gate" : status === "candidate" ? "evaluating" : status === "active" ? "promoted · active" : "promoted";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{text}</span>;
}
