"use client";

import { useState } from "react";

export interface TryOption {
  invoiceId: string;
  label: string;
  quirk: string;
  vendorId: string;
}

interface Side {
  version: number;
  decision: string;
  route: string | null;
  reason: string;
  correct: boolean;
  falseApproval: boolean;
  viaFastPath: string | null;
  guardrailOverride: string | null;
  tools: string[];
  durationMs: number;
}

interface Result {
  invoice: { invoiceId: string; invoiceNumber: string; vendorId: string; poNumber: string | null; memo: string | null; total: number; currency: string; lines: { description: string; qty: number; unitPrice: number }[] };
  expected: { decision: string; route?: string; reason: string };
  before: Side;
  after: Side;
}

const fmt = (d: string, r?: string | null) => (r ? `${d} → ${r.replace("_", " ")}` : d);

export function TryPanel({ options, activeVersion, vendorNames }: { options: TryOption[]; activeVersion: number; vendorNames: Record<string, string> }) {
  const [invoiceId, setInvoiceId] = useState(options[0]?.invoiceId ?? "");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/try", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ invoiceId }) });
      if (!res.ok) throw new Error(await res.text());
      setResult((await res.json()) as Result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const selected = options.find((o) => o.invoiceId === invoiceId);

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
          <span className="text-xs text-zinc-500">Invoice</span>
          <select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)} className="rounded-md border border-zinc-300 bg-white px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900">
            {options.map((o) => (
              <option key={o.invoiceId} value={o.invoiceId}>{o.label} — {o.quirk}</option>
            ))}
          </select>
        </label>
        <button onClick={run} disabled={loading || !invoiceId} className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
          {loading ? "Running both harnesses…" : "Run"}
        </button>
      </div>
      {selected && <p className="mt-2 text-xs text-zinc-500">Planted behaviour: {selected.quirk}</p>}
      {error && <pre className="mt-4 whitespace-pre-wrap rounded-md border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}</pre>}

      {result && (
        <div className="mt-6 space-y-6">
          <div className="rounded-lg border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap justify-between gap-2">
              <div><span className="font-semibold">{vendorNames[result.invoice.vendorId] ?? result.invoice.vendorId}</span> · {result.invoice.invoiceNumber} · PO {result.invoice.poNumber ?? "none"}</div>
              <div className="text-zinc-500">{result.invoice.total.toLocaleString()} {result.invoice.currency}</div>
            </div>
            {result.invoice.memo && <div className="mt-1 text-zinc-500">Memo: {result.invoice.memo}</div>}
            <ul className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
              {result.invoice.lines.map((l, i) => <li key={i}>{l.description} × {l.qty} @ {l.unitPrice}</li>)}
            </ul>
            <div className="mt-3 border-t border-zinc-100 pt-2 text-xs dark:border-zinc-800">
              <span className="text-zinc-500">A human would:</span> <b>{fmt(result.expected.decision, result.expected.route)}</b> <span className="text-zinc-500">· {result.expected.reason}</span>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <SideCard title="Harness v0 (generic policy)" s={result.before} />
            <SideCard title={`Harness v${activeVersion} (self-evolved)`} s={result.after} />
          </div>
        </div>
      )}
    </div>
  );
}

function SideCard({ title, s }: { title: string; s: Side }) {
  const tone = s.correct ? "border-emerald-300 dark:border-emerald-800" : s.falseApproval ? "border-rose-400 dark:border-rose-700" : "border-amber-300 dark:border-amber-800";
  return (
    <div className={`rounded-lg border-2 p-4 text-sm ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</div>
      <div className="mt-1 text-xl font-semibold">
        {s.correct ? "✓" : "✗"} {fmt(s.decision, s.route)}
        {s.falseApproval && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-medium text-rose-800 dark:bg-rose-900/40 dark:text-rose-300">false approval</span>}
      </div>
      <p className="mt-2 text-zinc-700 dark:text-zinc-300">{s.reason}</p>
      <div className="mt-3 text-xs text-zinc-500">
        {s.viaFastPath ? "Decided by a fast path, no model call." : s.guardrailOverride ? "Model approved, hard guardrail overrode it." : `Model called tools: ${s.tools.join(" → ") || "none"}`}
        <span className="ml-2">· {(s.durationMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  );
}
