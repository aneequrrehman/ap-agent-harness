import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { collections } from "@/lib/db";
import { embed, embeddingsEnabled, EPISODE_VECTOR_INDEX } from "@/lib/embeddings";
import type { HarnessVersion } from "@/lib/types";

/** Values the runner places in requestContext for every invoice run. */
export interface RunContext {
  harness: HarnessVersion;
  vendorId: string;
  invoiceId: string;
}

export const getPurchaseOrder = createTool({
  id: "get_purchase_order",
  description: "Fetch a purchase order by PO number, including its lines, currency, total and rush flag.",
  inputSchema: z.object({ poNumber: z.string() }),
  execute: async ({ poNumber }) => {
    const c = await collections();
    const po = await c.purchaseOrders.findOne({ poNumber: poNumber.trim().toUpperCase() }, { projection: { _id: 0 } });
    return po ?? { error: `No PO found with number ${poNumber}` };
  },
});

export const getReceipts = createTool({
  id: "get_receipts",
  description: "Fetch goods receipts recorded against a PO number. Empty list means nothing has been received yet.",
  inputSchema: z.object({ poNumber: z.string() }),
  execute: async ({ poNumber }) => {
    const c = await collections();
    return c.receipts.find({ poNumber: poNumber.trim().toUpperCase() }, { projection: { _id: 0 } }).toArray();
  },
});

export const getVendor = createTool({
  id: "get_vendor",
  description: "Fetch the vendor master record: tier, category, payment terms, currency, and bank account on file with the date it last changed.",
  inputSchema: z.object({ vendorId: z.string() }),
  execute: async ({ vendorId }) => {
    const c = await collections();
    const v = await c.vendors.findOne({ vendorId }, { projection: { _id: 0, hiddenQuirk: 0 } });
    return v ?? { error: `No vendor ${vendorId}` };
  },
});

export const findPriorInvoices = createTool({
  id: "find_prior_invoices",
  description: "List previously recorded invoices for a vendor (paid or credited), for duplicate checks. Optionally filter by a substring of the invoice number.",
  inputSchema: z.object({ vendorId: z.string(), invoiceNumberContains: z.string().optional() }),
  execute: async ({ vendorId, invoiceNumberContains }) => {
    const c = await collections();
    const filter: Record<string, unknown> = { vendorId, status: { $in: ["paid", "credited"] } };
    if (invoiceNumberContains) filter.invoiceNumber = { $regex: escapeRegex(invoiceNumberContains), $options: "i" };
    const rows = await c.invoices
      .find(filter, { projection: { _id: 0, invoiceNumber: 1, poNumber: 1, total: 1, invoiceDate: 1, status: 1, "label.reason": 1 } })
      .limit(20)
      .toArray();
    return rows.map((r) => ({
      invoiceNumber: r.invoiceNumber,
      poNumber: r.poNumber,
      total: r.total,
      invoiceDate: r.invoiceDate,
      status: r.status === "paid" ? "paid" : "credited (cancelled by credit note)",
    }));
  },
});

export const getVendorHistory = createTool({
  id: "get_vendor_history",
  description: "Past AP decisions for this vendor and whether a human later confirmed or corrected them. Useful for learning how this vendor usually behaves.",
  inputSchema: z.object({ vendorId: z.string() }),
  execute: async ({ vendorId }, context) => {
    const ctx = context?.requestContext?.get("run") as RunContext | undefined;
    const limit = ctx?.harness.contextPolicy.vendorHistoryLimit ?? 0;
    if (limit <= 0) return { note: "Vendor history is disabled by the current context policy." };
    const c = await collections();
    const rows = await c.episodes
      .find({ vendorId, phase: "train" }, { sort: { createdAt: -1 }, limit, projection: { _id: 0 } })
      .toArray();
    return rows.map((e) => ({
      invoiceId: e.invoiceId,
      decided: e.route ? `${e.decision}:${e.route}` : e.decision,
      reason: e.reason,
      humanOutcome: e.correct
        ? "confirmed"
        : `corrected to ${e.expected.route ? `${e.expected.decision}:${e.expected.route}` : e.expected.decision} (${e.expected.reason})`,
    }));
  },
});

export const searchSimilarExceptions = createTool({
  id: "search_similar_exceptions",
  description: "Semantic search over past AP cases across all vendors (Atlas Vector Search). Describe the situation in plain words, e.g. 'extra surcharge line not on PO' or 'invoice in a different currency than the PO'. Returns similar past cases with how a human resolved them.",
  inputSchema: z.object({ situation: z.string() }),
  execute: async ({ situation }, context) => {
    const ctx = context?.requestContext?.get("run") as RunContext | undefined;
    if (!ctx?.harness.contextPolicy.includeSimilarExceptions) return { note: "Similar-exception search is disabled by the current context policy." };
    if (!embeddingsEnabled()) return { note: "Embeddings are not configured." };
    const [queryVector] = await embed([situation], "query");
    const c = await collections();
    const rows = await c.episodes
      .aggregate<{ summary: string; score: number; invoiceId: string; vendorId: string }>([
        {
          $vectorSearch: {
            index: EPISODE_VECTOR_INDEX,
            path: "embedding",
            queryVector,
            numCandidates: 100,
            limit: 5,
            filter: { phase: "train", invoiceId: { $ne: ctx.invoiceId } },
          },
        },
        { $project: { _id: 0, summary: 1, invoiceId: 1, vendorId: 1, score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    return rows.map((r) => ({ similarity: Number(r.score.toFixed(3)), case: r.summary }));
  },
});

export const AP_TOOLS = {
  get_purchase_order: getPurchaseOrder,
  get_receipts: getReceipts,
  get_vendor: getVendor,
  find_prior_invoices: findPriorInvoices,
  get_vendor_history: getVendorHistory,
  search_similar_exceptions: searchSimilarExceptions,
};

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
