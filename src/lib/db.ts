import { MongoClient, type Db } from "mongodb";
import type {
  Vendor,
  PurchaseOrder,
  Receipt,
  Invoice,
  HarnessVersion,
  Episode,
} from "./types";

let client: MongoClient | null = null;

export function getDbName() {
  return process.env.MONGODB_DB_NAME ?? "ap_harness";
}

export async function getDb(): Promise<Db> {
  if (!client) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI is not set");
    client = new MongoClient(uri);
    await client.connect();
  }
  return client.db(getDbName());
}

export async function collections() {
  const db = await getDb();
  return {
    vendors: db.collection<Vendor>("vendors"),
    purchaseOrders: db.collection<PurchaseOrder>("purchase_orders"),
    receipts: db.collection<Receipt>("receipts"),
    invoices: db.collection<Invoice>("invoices"),
    harnessVersions: db.collection<HarnessVersion>("harness_versions"),
    episodes: db.collection<Episode>("episodes"),
    evalRuns: db.collection<{
      runId: string;
      version: number;
      score: HarnessVersion["evalScore"];
      accepted: boolean | null;
      createdAt: string;
    }>("eval_runs"),
  };
}

export async function closeDb() {
  if (client) {
    await client.close();
    client = null;
  }
}
