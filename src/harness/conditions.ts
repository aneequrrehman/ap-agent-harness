import type { Condition, Invoice, InvoiceFacts, PurchaseOrder, Receipt, Vendor } from "@/lib/types";

/** Normalize an invoice number for duplicate detection: strip non-alphanumerics and leading zeros per numeric run. */
export function normalizeInvoiceNumber(n: string) {
  return n
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .replace(/0+(\d)/g, "$1");
}

export function deriveFacts(args: {
  invoice: Invoice;
  vendor: Vendor;
  po: PurchaseOrder | null;
  receipts: Receipt[];
  priorInvoices: Invoice[];
  now?: Date;
}): InvoiceFacts {
  const { invoice, vendor, po, receipts, priorInvoices } = args;
  const now = args.now ?? new Date("2026-10-01T00:00:00Z");
  const changed = new Date(vendor.bankAccount.changedAt).getTime();
  const bankChangedDaysAgo = Math.floor((now.getTime() - changed) / 86400000);
  const norm = normalizeInvoiceNumber(invoice.invoiceNumber);
  const likelyDuplicate = priorInvoices.some(
    (p) => p.status === "paid" && normalizeInvoiceNumber(p.invoiceNumber) === norm,
  );
  return {
    vendorId: vendor.vendorId,
    vendorTier: vendor.tier,
    hasPO: Boolean(invoice.poNumber),
    poFound: Boolean(po),
    hasReceipt: receipts.length > 0,
    bankMismatch: invoice.bankAccount !== vendor.bankAccount.iban,
    bankChangedDaysAgo,
    total: invoice.total,
    currencyMismatch: po ? invoice.currency !== po.currency : false,
    likelyDuplicate,
  };
}

export function matchesCondition(cond: Condition, facts: InvoiceFacts, invoice: Invoice): boolean {
  if (cond.vendorId !== undefined && cond.vendorId !== facts.vendorId) return false;
  if (cond.vendorTier !== undefined && cond.vendorTier !== facts.vendorTier) return false;
  if (cond.hasPO !== undefined && cond.hasPO !== facts.hasPO) return false;
  if (cond.poFound !== undefined && cond.poFound !== facts.poFound) return false;
  if (cond.hasReceipt !== undefined && cond.hasReceipt !== facts.hasReceipt) return false;
  if (cond.bankMismatch !== undefined && cond.bankMismatch !== facts.bankMismatch) return false;
  if (cond.currencyMismatch !== undefined && cond.currencyMismatch !== facts.currencyMismatch) return false;
  if (cond.likelyDuplicate !== undefined && cond.likelyDuplicate !== facts.likelyDuplicate) return false;
  if (cond.bankChangedWithinDays !== undefined && !(facts.bankChangedDaysAgo <= cond.bankChangedWithinDays)) return false;
  if (cond.totalOver !== undefined && !(facts.total > cond.totalOver)) return false;
  if (cond.memoMatches !== undefined) {
    if (!invoice.memo) return false;
    if (!safeRegex(cond.memoMatches).test(invoice.memo)) return false;
  }
  if (cond.invoiceNumberMatches !== undefined) {
    if (!safeRegex(cond.invoiceNumberMatches).test(invoice.invoiceNumber)) return false;
  }
  return true;
}

function safeRegex(src: string) {
  try {
    return new RegExp(src, "i");
  } catch {
    return /$^/; // never matches
  }
}

/** A condition with no fields set would match everything. Refuse those. */
export function isNonTrivialCondition(cond: Condition) {
  return Object.values(cond).some((v) => v !== undefined && v !== null);
}
