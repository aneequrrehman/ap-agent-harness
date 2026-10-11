"use client";

import { useState } from "react";

export interface ScorePoint {
  version: number;
  accuracy: number;
  falseApprovals: number;
  status: string;
  changelog: string;
}

/** Single-series line: eval accuracy per harness version. Rejected candidates are hollow markers off the line. */
export function ScoreChart({ points }: { points: ScorePoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 220;
  const pad = { l: 40, r: 16, t: 16, b: 28 };
  const xs = points.map((_, i) => i);
  const maxX = Math.max(1, xs.length - 1);
  const x = (i: number) => pad.l + (i / maxX) * (W - pad.l - pad.r);
  const y = (a: number) => pad.t + (1 - a) * (H - pad.t - pad.b);

  const accepted = points.filter((p) => p.status !== "rejected");
  const path = accepted
    .map((p) => `${x(points.indexOf(p)).toFixed(1)},${y(p.accuracy).toFixed(1)}`)
    .join(" L ");

  if (!points.length) return <div className="text-sm text-zinc-500">No evaluations yet.</div>;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Eval accuracy per harness version">
        {[0, 0.25, 0.5, 0.75, 1].map((g) => (
          <g key={g}>
            <line x1={pad.l} x2={W - pad.r} y1={y(g)} y2={y(g)} className="stroke-zinc-200 dark:stroke-zinc-800" strokeWidth={1} />
            <text x={pad.l - 6} y={y(g) + 4} textAnchor="end" className="fill-zinc-500 text-[11px]">
              {Math.round(g * 100)}%
            </text>
          </g>
        ))}
        {accepted.length > 1 && <path d={`M ${path}`} fill="none" className="stroke-emerald-600 dark:stroke-emerald-400" strokeWidth={2} strokeLinejoin="round" />}
        {points.map((p, i) => (
          <g key={p.version} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(i)} cy={y(p.accuracy)} r={14} fill="transparent" />
            <circle
              cx={x(i)}
              cy={y(p.accuracy)}
              r={p.status === "rejected" ? 4 : 5}
              className={
                p.status === "rejected"
                  ? "fill-white dark:fill-zinc-950 stroke-zinc-400"
                  : p.status === "active"
                    ? "fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-zinc-950"
                    : "fill-emerald-600 dark:fill-emerald-400 stroke-white dark:stroke-zinc-950"
              }
              strokeWidth={2}
            />
            <text x={x(i)} y={H - 8} textAnchor="middle" className="fill-zinc-500 text-[11px]">
              v{p.version}
            </text>
          </g>
        ))}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute left-0 top-0 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
          style={{ transform: `translate(${(x(hover) / W) * 100}%, 0)` }}>
          <div className="font-medium">v{points[hover].version} · {points[hover].status}</div>
          <div>accuracy {Math.round(points[hover].accuracy * 100)}% · false approvals {points[hover].falseApprovals}</div>
          <div className="max-w-64 text-zinc-500">{points[hover].changelog}</div>
        </div>
      )}
    </div>
  );
}
