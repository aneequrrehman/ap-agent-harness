import { collections } from "@/lib/db";
import type { HarnessVersion } from "@/lib/types";

export async function getActiveVersion(): Promise<HarnessVersion> {
  const c = await collections();
  const v = await c.harnessVersions.findOne({ status: "active" }, { sort: { version: -1 } });
  if (!v) throw new Error("No active harness version. Run pnpm seed.");
  return v;
}

export async function getVersion(version: number): Promise<HarnessVersion | null> {
  const c = await collections();
  return c.harnessVersions.findOne({ version });
}

export async function listVersions(): Promise<HarnessVersion[]> {
  const c = await collections();
  return c.harnessVersions.find({}).sort({ version: 1 }).toArray();
}

export async function nextVersionNumber(): Promise<number> {
  const c = await collections();
  const last = await c.harnessVersions.findOne({}, { sort: { version: -1 }, projection: { version: 1 } });
  return (last?.version ?? -1) + 1;
}

export async function saveCandidate(candidate: HarnessVersion) {
  const c = await collections();
  await c.harnessVersions.insertOne(candidate);
}

export async function promote(version: number) {
  const c = await collections();
  await c.harnessVersions.updateMany({ status: "active" }, { $set: { status: "superseded" } });
  await c.harnessVersions.updateOne({ version }, { $set: { status: "active" } });
}

export async function rejectCandidate(version: number) {
  const c = await collections();
  await c.harnessVersions.updateOne({ version }, { $set: { status: "rejected" } });
}

export async function setEvalScore(version: number, evalScore: HarnessVersion["evalScore"]) {
  const c = await collections();
  await c.harnessVersions.updateOne({ version }, { $set: { evalScore } });
}
