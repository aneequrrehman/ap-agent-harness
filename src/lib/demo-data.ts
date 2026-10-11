import { collections } from "./db";
import type { Episode, HarnessVersion } from "./types";
import { QUIRK_NAMES } from "@/data/quirks";

export interface TriggerFailure {
  invoiceId: string;
  vendorId: string;
  got: string;
  expected: string;
  humanReason: string;
}

export interface StoryStep {
  version: HarnessVersion;
  parent: HarnessVersion | null;
  triggers: TriggerFailure[];
  added: { rules: { scope: string | null; text: string }[]; fastPaths: string[]; guardrails: string[]; policy: string[] };
}

const fmt = (d: string, r?: string) => (r ? `${d}:${r}` : d);

export async function loadStory() {
  const c = await collections();
  const versions = (await c.harnessVersions.find({}, { projection: { _id: 0 } }).sort({ version: 1 }).toArray()) as HarnessVersion[];
  const byVersion = new Map(versions.map((v) => [v.version, v]));
  const vendors = await c.vendors.find({}, { projection: { _id: 0, vendorId: 1, name: 1 } }).toArray();
  const vendorNames = Object.fromEntries(vendors.map((v) => [v.vendorId, v.name])) as Record<string, string>;

  const steps: StoryStep[] = [];
  for (const v of versions) {
    if (v.parentVersion === null) continue;
    const parent = byVersion.get(v.parentVersion) ?? null;
    let triggers: Episode[] = [];
    if (v.triggerEpisodeIds?.length) {
      triggers = (await c.episodes.find({ episodeId: { $in: v.triggerEpisodeIds } }, { projection: { _id: 0, trace: 0, embedding: 0 } }).toArray()) as Episode[];
    } else if (parent) {
      // Fallback for versions created before trigger ids were recorded: the parent's training failures
      // between the previous candidate and this one.
      const prev = versions.filter((x) => x.createdAt < v.createdAt && x.version !== v.version).map((x) => x.createdAt).sort().pop() ?? parent.createdAt;
      triggers = (await c.episodes
        .find({ version: parent.version, phase: "train", correct: false, createdAt: { $gt: prev, $lte: v.createdAt } }, { projection: { _id: 0, trace: 0, embedding: 0 } })
        .toArray()) as Episode[];
    }
    const parentRuleIds = new Set(parent?.rules.map((r) => r.id) ?? []);
    const parentRuleText = new Map(parent?.rules.map((r) => [r.id, r.text]) ?? []);
    const parentFp = new Set(parent?.fastPaths.map((f) => f.id) ?? []);
    const parentG = new Set(parent?.guardrails.map((g) => g.id) ?? []);
    const policy: string[] = [];
    if (parent) {
      for (const k of Object.keys(v.contextPolicy) as (keyof HarnessVersion["contextPolicy"])[]) {
        if (parent.contextPolicy[k] !== v.contextPolicy[k]) policy.push(`${k}: ${String(parent.contextPolicy[k])} → ${String(v.contextPolicy[k])}`);
      }
      for (const [vid, pct] of Object.entries(v.tools.priceTolerancePct)) {
        if (parent.tools.priceTolerancePct[vid] !== pct) policy.push(`${vendorNames[vid] ?? vid} price tolerance → ${pct}%`);
      }
    }
    steps.push({
      version: v,
      parent,
      triggers: triggers.map((e) => ({
        invoiceId: e.invoiceId,
        vendorId: e.vendorId,
        got: fmt(e.decision, e.route),
        expected: fmt(e.expected.decision, e.expected.route),
        humanReason: e.expected.reason,
      })),
      added: {
        rules: v.rules.filter((r) => !parentRuleIds.has(r.id) || parentRuleText.get(r.id) !== r.text).map((r) => ({ scope: r.scope, text: r.text })),
        fastPaths: v.fastPaths.filter((f) => !parentFp.has(f.id)).map((f) => `${f.name}: when ${JSON.stringify(f.when)} → ${fmt(f.action.decision, f.action.route)}`),
        guardrails: v.guardrails.filter((g) => !parentG.has(g.id)).map((g) => `${g.hard ? "hard: " : ""}${g.text}`),
        policy,
      },
    });
  }

  // Which version first solved each quirk (among promoted versions).
  const promoted = versions.filter((v) => v.status === "active" || v.status === "superseded");
  const quirkSolvedAt: Record<string, number | null> = {};
  for (const q of Object.keys(QUIRK_NAMES)) {
    const first = promoted.find((v) => v.evalScore?.quirksSolved.includes(q));
    quirkSolvedAt[q] = first ? first.version : null;
  }

  const active = versions.find((v) => v.status === "active") ?? null;
  const baseline = versions[0] ?? null;
  const totalEpisodes = await c.episodes.countDocuments();
  return { versions, steps, active, baseline, quirkSolvedAt, vendorNames, totalEpisodes };
}
