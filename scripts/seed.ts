// Seeds Atlas with the synthetic AP dataset and harness version 0.
// Usage: pnpm seed

import { collections, closeDb } from "@/lib/db";
import { generateDataset } from "@/data/generate";
import { SEED_HARNESS } from "@/harness/seed-harness";
import { EMBEDDING_DIMS, EPISODE_VECTOR_INDEX } from "@/lib/embeddings";

async function main() {
  const c = await collections();
  const data = generateDataset();

  await Promise.all([
    c.vendors.deleteMany({}),
    c.purchaseOrders.deleteMany({}),
    c.receipts.deleteMany({}),
    c.invoices.deleteMany({}),
    c.harnessVersions.deleteMany({}),
    c.episodes.deleteMany({}),
    c.evalRuns.deleteMany({}),
  ]);

  await c.vendors.insertMany(data.vendors);
  await c.purchaseOrders.insertMany(data.purchaseOrders);
  await c.receipts.insertMany(data.receipts);
  // History rows are already-paid or credited invoices, used for duplicate checks.
  await c.invoices.insertMany([
    ...data.history.map((h) => ({ ...h, status: "paid" as const })),
    ...data.invoices.map((i) => ({ ...i, status: "pending" as const })),
  ]);
  await c.harnessVersions.insertOne(SEED_HARNESS);

  await Promise.all([
    c.invoices.createIndex({ vendorId: 1, invoiceNumber: 1 }),
    c.invoices.createIndex({ split: 1, status: 1 }),
    c.purchaseOrders.createIndex({ poNumber: 1 }, { unique: true }),
    c.receipts.createIndex({ poNumber: 1 }),
    c.episodes.createIndex({ version: 1, phase: 1 }),
    c.episodes.createIndex({ vendorId: 1, createdAt: -1 }),
    c.harnessVersions.createIndex({ version: 1 }, { unique: true }),
  ]);

  // Atlas Vector Search index over episode embeddings (semantic memory of past cases).
  try {
    const existing = await c.episodes.listSearchIndexes().toArray();
    if (!existing.some((i) => i.name === EPISODE_VECTOR_INDEX)) {
      await c.episodes.createSearchIndex({
        name: EPISODE_VECTOR_INDEX,
        type: "vectorSearch",
        definition: {
          fields: [
            { type: "vector", path: "embedding", numDimensions: EMBEDDING_DIMS, similarity: "cosine" },
            { type: "filter", path: "phase" },
            { type: "filter", path: "vendorId" },
            { type: "filter", path: "invoiceId" },
          ],
        },
      });
      console.log(`Vector search index ${EPISODE_VECTOR_INDEX} requested (builds asynchronously).`);
    }
  } catch (err) {
    console.warn(`Could not create vector index (is this an Atlas cluster?): ${(err as Error).message}`);
  }

  const train = data.invoices.filter((i) => i.split === "train").length;
  const evalN = data.invoices.filter((i) => i.split === "eval").length;
  const quirks = new Set(data.invoices.map((i) => i.label.quirkId).filter(Boolean)).size;
  console.log(`Seeded ${data.vendors.length} vendors, ${data.purchaseOrders.length} POs, ${data.receipts.length} receipts`);
  console.log(`Invoices: ${train} train, ${evalN} eval, ${data.history.length} history. ${quirks} distinct planted quirks.`);
  console.log(`Harness version 0 written.`);
  await closeDb();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
