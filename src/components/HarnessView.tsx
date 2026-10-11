import type { HarnessVersion } from "@/lib/types";

function isNew(h: HarnessVersion, createdInVersion: number) {
  return h.version > 0 && createdInVersion === h.version;
}

const badge = "ml-2 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide";

export function HarnessView({ h, vendorNames }: { h: HarnessVersion; vendorNames: Record<string, string> }) {
  const globalRules = h.rules.filter((r) => r.scope === null);
  const vendorRules = h.rules.filter((r) => r.scope !== null);
  const byVendor = new Map<string, typeof vendorRules>();
  for (const r of vendorRules) byVendor.set(r.scope!, [...(byVendor.get(r.scope!) ?? []), r]);

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Section title={`Global rules (${globalRules.length})`}>
        {globalRules.map((r) => (
          <li key={r.id} className="py-1.5">
            <span className="font-mono text-[11px] text-zinc-400">{r.id}</span> {r.text}
            {isNew(h, r.createdInVersion) && <span className={`${badge} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`}>new</span>}
          </li>
        ))}
      </Section>

      <Section title={`Vendor rules (${vendorRules.length})`}>
        {[...byVendor.entries()].map(([vid, rules]) => (
          <li key={vid} className="py-1.5">
            <div className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">{vendorNames[vid] ?? vid}</div>
            <ul>
              {rules.map((r) => (
                <li key={r.id} className="py-1 pl-3">
                  {r.text}
                  {isNew(h, r.createdInVersion) && <span className={`${badge} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`}>new</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {!vendorRules.length && <li className="py-1.5 text-zinc-500">None yet. The harness has not learned any vendor-specific behaviour.</li>}
      </Section>

      <Section title={`Guardrails (${h.guardrails.length})`}>
        {h.guardrails.map((g) => (
          <li key={g.id} className="py-1.5">
            <span className={`${badge} ml-0 mr-2 ${g.hard ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300" : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300"}`}>{g.hard ? "hard" : "soft"}</span>
            {g.text}
            {isNew(h, g.createdInVersion) && <span className={`${badge} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`}>new</span>}
            {g.hard && g.when && (
              <div className="mt-1 font-mono text-[11px] text-zinc-500">
                when {JSON.stringify(g.when)} → {g.action?.decision}{g.action?.route ? `:${g.action.route}` : ""}
              </div>
            )}
          </li>
        ))}
      </Section>

      <Section title={`Fast paths (${h.fastPaths.length})`} hint="Deterministic checks promoted from learned patterns. They run before the model and can only route or reject.">
        {h.fastPaths.map((f) => (
          <li key={f.id} className="py-1.5">
            <span className="font-medium">{f.name}</span>
            {isNew(h, f.createdInVersion) && <span className={`${badge} bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300`}>new</span>}
            <div className="mt-1 font-mono text-[11px] text-zinc-500">
              when {JSON.stringify(f.when)} → {f.action.decision}{f.action.route ? `:${f.action.route}` : ""}
            </div>
          </li>
        ))}
        {!h.fastPaths.length && <li className="py-1.5 text-zinc-500">None yet. Every invoice goes to the model.</li>}
      </Section>

      <Section title="Context policy">
        <li className="py-1">Vendor history shown to the worker: <b>{h.contextPolicy.vendorHistoryLimit}</b> past decisions</li>
        <li className="py-1">Max global rules inlined: <b>{h.contextPolicy.maxGlobalRules}</b></li>
        <li className="py-1">Similar exceptions from other vendors: <b>{h.contextPolicy.includeSimilarExceptions ? "on" : "off"}</b></li>
      </Section>

      <Section title="Tool config">
        <li className="py-1">Default price tolerance: <b>{h.tools.defaultPriceTolerancePct}%</b></li>
        {Object.entries(h.tools.priceTolerancePct).map(([vid, pct]) => (
          <li key={vid} className="py-1">{vendorNames[vid] ?? vid}: <b>{pct}%</b></li>
        ))}
        <li className="py-1 text-zinc-500">Enabled tools: {h.tools.enabled.join(", ")}</li>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      <ul className="mt-2 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">{children}</ul>
    </div>
  );
}
