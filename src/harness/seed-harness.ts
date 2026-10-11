import type { HarnessVersion } from "@/lib/types";

// Version 0: generic textbook AP policy. Deliberately knows nothing about any vendor.
export const SEED_HARNESS: HarnessVersion = {
  version: 0,
  parentVersion: null,
  createdAt: new Date().toISOString(),
  createdBy: "seed",
  status: "active",
  changelog: "Initial generic AP matching policy.",
  rules: [
    r("r-seed-1", "Approve only when invoice lines match the PO lines on quantity and unit price and goods have been received."),
    r("r-seed-2", "Invoice quantity must equal the PO quantity. Partial or over-quantity invoices route to procurement."),
    r("r-seed-3", "Invoice lines that do not appear on the PO route to procurement."),
    r("r-seed-4", "If the invoice has no PO number, route to the AP clerk for manual coding."),
    r("r-seed-5", "If goods have not been received, route to procurement."),
    r("r-seed-6", "An invoice whose number matches an already-paid invoice for the same vendor is a duplicate. Reject it."),
    r("r-seed-7", "If the invoice currency differs from the PO currency, route to the AP clerk."),
  ],
  guardrails: [
    {
      id: "g-seed-1",
      text: "Never auto-approve an invoice over $25,000 that has no PO.",
      hard: true,
      when: { hasPO: false, totalOver: 25000 },
      action: { decision: "route", route: "ap_manager", reason: "Hard guardrail: large invoice without PO" },
      source: "seed",
      createdInVersion: 0,
    },
    {
      id: "g-seed-2",
      text: "When unsure, route rather than approve. Approval moves money; routing does not.",
      hard: false,
      source: "seed",
      createdInVersion: 0,
    },
  ],
  fastPaths: [],
  contextPolicy: {
    vendorHistoryLimit: 0,
    includeSimilarExceptions: false,
    maxGlobalRules: 20,
  },
  tools: {
    enabled: ["get_purchase_order", "get_receipts", "get_vendor", "find_prior_invoices", "get_vendor_history", "search_similar_exceptions"],
    priceTolerancePct: {},
    defaultPriceTolerancePct: 0.5,
  },
};

function r(id: string, text: string) {
  return { id, text, scope: null, source: "seed" as const, createdInVersion: 0 };
}
