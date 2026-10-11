import { collections } from "./db";
import type { Episode, HarnessVersion } from "./types";

export async function loadDashboard() {
  const c = await collections();
  const [versions, recentEpisodes, counts, vendors] = await Promise.all([
    c.harnessVersions.find({}, { projection: { _id: 0 } }).sort({ version: 1 }).toArray(),
    c.episodes.find({}, { projection: { _id: 0, trace: 0, embedding: 0 } }).sort({ createdAt: -1 }).limit(40).toArray(),
    c.invoices.aggregate<{ _id: string; n: number }>([{ $match: { status: "pending" } }, { $group: { _id: "$split", n: { $sum: 1 } } }]).toArray(),
    c.vendors.find({}, { projection: { _id: 0, vendorId: 1, name: 1 } }).toArray(),
  ]);
  const active = versions.find((v) => v.status === "active") ?? null;
  const totalEpisodes = await c.episodes.countDocuments();
  const quirksTotal = (await c.invoices.distinct("label.quirkId", { split: "eval", status: "pending" })).filter(Boolean).length;
  return {
    versions: versions as HarnessVersion[],
    active,
    recentEpisodes: recentEpisodes as Episode[],
    counts: Object.fromEntries(counts.map((x) => [x._id, x.n])) as Record<string, number>,
    totalEpisodes,
    quirksTotal,
    vendorNames: Object.fromEntries(vendors.map((v) => [v.vendorId, v.name])) as Record<string, string>,
  };
}

export async function loadVersionWithParent(version: number) {
  const c = await collections();
  const v = await c.harnessVersions.findOne({ version }, { projection: { _id: 0 } });
  if (!v) return null;
  const parent = v.parentVersion === null ? null : await c.harnessVersions.findOne({ version: v.parentVersion }, { projection: { _id: 0 } });
  const episodes = await c.episodes.find({ version }, { projection: { _id: 0, embedding: 0 } }).sort({ createdAt: -1 }).limit(100).toArray();
  return { version: v as HarnessVersion, parent: parent as HarnessVersion | null, episodes: episodes as Episode[] };
}
