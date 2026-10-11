// Deterministic synthetic AP dataset with planted vendor quirks.
// The harness starts with generic AP rules and must discover these quirks on its own.

import type {
  Vendor,
  PurchaseOrder,
  Receipt,
  Invoice,
  InvoiceLine,
  InvoiceLabel,
  POLine,
} from "@/lib/types";

// ---------- deterministic RNG ----------
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261011);
const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];
const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
const round2 = (n: number) => Math.round(n * 100) / 100;

const BASE_DATE = new Date("2026-09-01T00:00:00Z");
const isoDaysAfter = (days: number) =>
  new Date(BASE_DATE.getTime() + days * 86400000).toISOString().slice(0, 10);

const CATALOG: Record<string, { sku: string; description: string; price: number; unit?: string }[]> = {
  logistics: [
    { sku: "FRT-STD", description: "Standard freight, per pallet", price: 85 },
    { sku: "FRT-EXP", description: "Express freight, per pallet", price: 140 },
  ],
  industrial: [
    { sku: "BRG-6204", description: "Ball bearing 6204", price: 4.2 },
    { sku: "VLV-2IN", description: "2in gate valve", price: 38.5 },
    { sku: "STL-ROD", description: "Steel rod 12mm", price: 11.75 },
  ],
  office: [
    { sku: "PPR-A4", description: "A4 copy paper, ream", price: 5.4 },
    { sku: "TNR-BLK", description: "Black toner cartridge", price: 62 },
    { sku: "CHR-ERG", description: "Ergonomic chair", price: 219 },
  ],
  chemicals: [
    { sku: "SOL-ACE", description: "Acetone, kg", price: 2.1, unit: "kg" },
    { sku: "SOL-IPA", description: "Isopropyl alcohol, kg", price: 2.6, unit: "kg" },
  ],
  it: [
    { sku: "LAP-14", description: "14in laptop", price: 1150 },
    { sku: "MON-27", description: "27in monitor", price: 310 },
  ],
  food: [
    { sku: "MEAL-STD", description: "Meal replacement, unit", price: 3.25 },
  ],
};

// ---------- vendors ----------
// quirk ids are referenced by invoice labels so we can measure quirk discovery.
export const VENDORS: Vendor[] = [
  v("V-ACME", "Acme Logistics", 2, "logistics", "USD", "Invoices per shipment; partial quantities against the PO are normal and should be approved."),
  v("V-UPS", "UPS", 2, "logistics", "USD", "Never has a PO. Always route to logistics, not the AP clerk."),
  v("V-FEDEX", "FedEx Freight", 2, "logistics", "USD", "Adds a fuel surcharge line (~8%) that is never on the PO. Approve if the rest matches."),
  v("V-GLOBEX", "Globex Corporation", 1, "industrial", "USD", "Contract allows price indexation up to 2% above PO. Approve within 2%, route above."),
  v("V-INITECH", "Initech GmbH", 2, "it", "EUR", "Invoices in EUR against USD POs at 0.92 EUR/USD. Approve if converted total is within 1%."),
  v("V-UMBRELLA", "Umbrella Supplies", 3, "office", "USD", "Reissues invoices with a -R suffix after a credit note. Not a duplicate."),
  v("V-STARK", "Stark Industries", 1, "industrial", "USD", "Invoices by the case of 12 while POs are per unit. Totals match."),
  v("V-WAYNE", "Wayne Enterprises", 1, "it", "USD", "Adds a separate Freight line. Approve if freight is $50 or less, route to procurement above that."),
  v("V-TYRELL", "Tyrell Corp", 2, "industrial", "USD", "Always invoices before goods arrive. Hold for receipt rather than bothering procurement."),
  v("V-VANDELAY", "Vandelay Imports", 2, "chemicals", "USD", "Invoices in tons while POs are in kg. Totals match."),
  v("V-DUNDER", "Dunder Mifflin", 3, "office", "USD", "Adds a $75 Rush fee line. Legit only when the PO is flagged rush."),
  v("V-SOYLENT", "Soylent Industrial", 3, "food", "USD", "Leaves the PO field empty and writes 'Ref: PO-xxxx' in the memo."),
  v("V-OSCORP", "Oscorp", 2, "chemicals", "USD", "Changed bank details recently. Must go to fraud review even on a perfect match."),
  v("V-PIED", "Pied Piper", 3, "it", "USD", "Resubmits paid invoices with leading zeros in the number. These are duplicates."),
  v("V-MASSIVE", "Massive Dynamic", 1, "industrial", "USD", "Adds a sales tax line at 8.25% not on the PO. Approve."),
  // Plain vendors, no quirks.
  v("V-NORTH", "Northwind Traders", 2, "office", "USD"),
  v("V-CONTOSO", "Contoso Ltd", 2, "industrial", "USD"),
  v("V-FABRIKAM", "Fabrikam Inc", 3, "it", "USD"),
  v("V-ADVENTURE", "Adventure Works", 3, "industrial", "USD"),
  v("V-TAILSPIN", "Tailspin Toys", 3, "office", "USD"),
];

function v(
  vendorId: string,
  name: string,
  tier: 1 | 2 | 3,
  category: string,
  currency: "USD" | "EUR",
  hiddenQuirk?: string,
): Vendor {
  const bankChangedDaysAgo = vendorId === "V-OSCORP" ? 12 : int(200, 900);
  return {
    vendorId,
    name,
    tier,
    category,
    currency,
    paymentTerms: pick(["NET30", "NET45", "NET60"]),
    bankAccount: {
      iban: `GB${int(10, 99)}BANK${String(int(100000, 999999))}${vendorId.slice(2, 5)}`,
      changedAt: isoDaysAfter(-bankChangedDaysAgo),
    },
    hiddenQuirk,
  };
}

// ---------- builders ----------
let poSeq = 1000;
let invSeq = 5000;
let rcptSeq = 100;

function makePO(vendor: Vendor, opts: { rush?: boolean; lines?: number; unitOverride?: string } = {}): PurchaseOrder {
  const items = CATALOG[vendor.category];
  const n = opts.lines ?? int(1, 2);
  const lines: POLine[] = [];
  for (let i = 0; i < n; i++) {
    const item = items[i % items.length];
    lines.push({
      lineNo: i + 1,
      sku: item.sku,
      description: item.description,
      qty: item.unit === "kg" ? int(2, 6) * 1000 : int(5, 60),
      unitPrice: item.price,
      unit: item.unit,
    });
  }
  const total = round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
  return {
    poNumber: `PO-${poSeq++}`,
    vendorId: vendor.vendorId,
    lines,
    total,
    currency: "USD",
    status: "open",
    rush: opts.rush,
    createdAt: isoDaysAfter(int(0, 10)),
  };
}

function makeReceipt(po: PurchaseOrder, fraction = 1): Receipt {
  return {
    receiptId: `RCPT-${rcptSeq++}`,
    poNumber: po.poNumber,
    lines: po.lines.map((l) => ({ lineNo: l.lineNo, qtyReceived: Math.round(l.qty * fraction) })),
    receivedAt: isoDaysAfter(int(11, 18)),
  };
}

function linesFromPO(po: PurchaseOrder, mutate?: (l: InvoiceLine, i: number) => InvoiceLine): InvoiceLine[] {
  return po.lines.map((l, i) => {
    const base: InvoiceLine = { description: l.description, qty: l.qty, unitPrice: l.unitPrice, sku: l.sku, unit: l.unit };
    return mutate ? mutate(base, i) : base;
  });
}

function totalOf(lines: InvoiceLine[]) {
  return round2(lines.reduce((s, l) => s + l.qty * l.unitPrice, 0));
}

interface Ctx {
  pos: PurchaseOrder[];
  receipts: Receipt[];
  invoices: Invoice[];
  history: Invoice[]; // already-paid invoices for duplicate checks
}

function pushInvoice(
  ctx: Ctx,
  vendor: Vendor,
  partial: Omit<Invoice, "invoiceId" | "invoiceNumber" | "vendorId" | "currency" | "invoiceDate" | "bankAccount" | "split" | "total"> & {
    invoiceNumber?: string;
    currency?: "USD" | "EUR";
    bankAccount?: string;
    total?: number;
    invoiceDate?: string;
  },
): Invoice {
  const inv: Invoice = {
    invoiceId: `INV-${invSeq}`,
    invoiceNumber: partial.invoiceNumber ?? `${vendor.vendorId.slice(2, 5)}-${invSeq}`,
    vendorId: vendor.vendorId,
    poNumber: partial.poNumber,
    memo: partial.memo,
    lines: partial.lines,
    total: partial.total ?? totalOf(partial.lines),
    currency: partial.currency ?? "USD",
    invoiceDate: partial.invoiceDate ?? isoDaysAfter(int(12, 25)),
    bankAccount: partial.bankAccount ?? vendor.bankAccount.iban,
    split: "train", // assigned later
    label: partial.label,
  };
  invSeq++;
  ctx.invoices.push(inv);
  return inv;
}

const approve = (reason: string, quirkId?: string): InvoiceLabel => ({ decision: "approve", reason, quirkId });
const route = (r: InvoiceLabel["route"], reason: string, quirkId?: string): InvoiceLabel => ({ decision: "route", route: r, reason, quirkId });
const reject = (reason: string, quirkId?: string): InvoiceLabel => ({ decision: "reject", reason, quirkId });

// ---------- generic cases every vendor can produce ----------
function cleanMatch(ctx: Ctx, vendor: Vendor) {
  const po = makePO(vendor);
  ctx.pos.push(po);
  ctx.receipts.push(makeReceipt(po));
  pushInvoice(ctx, vendor, { poNumber: po.poNumber, lines: linesFromPO(po), label: approve("Exact three-way match") });
}

function qtyOver(ctx: Ctx, vendor: Vendor) {
  const po = makePO(vendor);
  ctx.pos.push(po);
  ctx.receipts.push(makeReceipt(po));
  pushInvoice(ctx, vendor, {
    poNumber: po.poNumber,
    lines: linesFromPO(po, (l, i) => (i === 0 ? { ...l, qty: l.qty + int(3, 10) } : l)),
    label: route("procurement", "Invoice quantity exceeds PO quantity"),
  });
}

function priceOver(ctx: Ctx, vendor: Vendor, pct = 6) {
  const po = makePO(vendor);
  ctx.pos.push(po);
  ctx.receipts.push(makeReceipt(po));
  pushInvoice(ctx, vendor, {
    poNumber: po.poNumber,
    lines: linesFromPO(po, (l) => ({ ...l, unitPrice: round2(l.unitPrice * (1 + pct / 100)) })),
    label: route("procurement", `Unit price ${pct}% above PO`),
  });
}

function exactDuplicate(ctx: Ctx, vendor: Vendor) {
  const po = makePO(vendor);
  ctx.pos.push(po);
  ctx.receipts.push(makeReceipt(po));
  const num = `${vendor.vendorId.slice(2, 5)}-${invSeq}`;
  const lines = linesFromPO(po);
  ctx.history.push({
    invoiceId: `HIST-${invSeq}`,
    invoiceNumber: num,
    vendorId: vendor.vendorId,
    poNumber: po.poNumber,
    lines,
    total: totalOf(lines),
    currency: "USD",
    invoiceDate: isoDaysAfter(-int(20, 60)),
    bankAccount: vendor.bankAccount.iban,
    split: "train",
    label: approve("historical, paid"),
  });
  pushInvoice(ctx, vendor, { invoiceNumber: num, poNumber: po.poNumber, lines, label: reject("Duplicate of a paid invoice") });
}

function noPO(ctx: Ctx, vendor: Vendor) {
  const item = pick(CATALOG[vendor.category]);
  pushInvoice(ctx, vendor, {
    lines: [{ description: item.description, qty: int(2, 8), unitPrice: item.price, sku: item.sku }],
    label: route("ap_clerk", "No PO reference; needs manual coding"),
  });
}

function bankMismatch(ctx: Ctx, vendor: Vendor) {
  const po = makePO(vendor);
  ctx.pos.push(po);
  ctx.receipts.push(makeReceipt(po));
  pushInvoice(ctx, vendor, {
    poNumber: po.poNumber,
    lines: linesFromPO(po),
    bankAccount: `LT${int(10, 99)}FAKE${int(100000, 999999)}`,
    memo: "Please note our updated remittance details.",
    label: route("fraud_review", "Invoice bank account differs from vendor master"),
  });
}

// ---------- quirk cases ----------
const WAYNE_FREIGHTS = [25, 120, 48, 35, 180, 50, 30, 150, 45];
let wayneSeq = 0;
const QUIRKS: Record<string, (ctx: Ctx, vendor: Vendor) => void> = {
  "V-ACME": (ctx, vendor) => {
    const po = makePO(vendor, { lines: 1 });
    po.lines[0].qty = int(20, 40);
    po.total = round2(po.lines[0].qty * po.lines[0].unitPrice);
    ctx.pos.push(po);
    const fraction = pick([0.25, 0.5]);
    ctx.receipts.push(makeReceipt(po, fraction));
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      memo: "Shipment 1 of 2",
      lines: linesFromPO(po, (l) => ({ ...l, qty: Math.round(l.qty * fraction) })),
      label: approve("Acme invoices per shipment; partial qty matches receipt", "acme_partial"),
    });
  },
  "V-UPS": (ctx, vendor) => {
    pushInvoice(ctx, vendor, {
      lines: [{ description: "Parcel services, weekly account", qty: 1, unitPrice: round2(int(300, 900) + rand()) }],
      memo: "Account 7X23 weekly billing",
      label: route("logistics", "UPS account billing never has a PO; logistics owns it", "ups_no_po"),
    });
  },
  "V-FEDEX": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const lines = linesFromPO(po);
    lines.push({ description: "Fuel surcharge", qty: 1, unitPrice: round2(totalOf(lines) * 0.08) });
    pushInvoice(ctx, vendor, { poNumber: po.poNumber, lines, label: approve("FedEx fuel surcharge is standard and not on PO", "fedex_fuel") });
  },
  "V-GLOBEX": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const pct = pick([1.0, 1.5, 1.9]);
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines: linesFromPO(po, (l) => ({ ...l, unitPrice: round2(l.unitPrice * (1 + pct / 100)) })),
      memo: "Indexed per contract clause 4.2",
      label: approve(`Globex contract allows up to 2% indexation (${pct}%)`, "globex_2pct"),
    });
  },
  "V-INITECH": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const rate = 0.92 * (1 + (rand() - 0.5) * 0.008);
    const lines = linesFromPO(po, (l) => ({ ...l, unitPrice: round2(l.unitPrice * rate) }));
    pushInvoice(ctx, vendor, { poNumber: po.poNumber, lines, currency: "EUR", label: approve("Initech bills in EUR; converted total within 1%", "initech_eur") });
  },
  "V-UMBRELLA": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const base = `UMB-${invSeq}`;
    const lines = linesFromPO(po);
    ctx.history.push({
      invoiceId: `HIST-${invSeq}`,
      invoiceNumber: base,
      vendorId: vendor.vendorId,
      poNumber: po.poNumber,
      lines,
      total: totalOf(lines),
      currency: "USD",
      invoiceDate: isoDaysAfter(-int(5, 15)),
      bankAccount: vendor.bankAccount.iban,
      split: "train",
      label: { decision: "reject", reason: "historical, credited via CN" },
    });
    pushInvoice(ctx, vendor, {
      invoiceNumber: `${base}-R`,
      poNumber: po.poNumber,
      memo: `Reissue of ${base} after credit note CN-${int(100, 999)}`,
      lines,
      label: approve("Umbrella reissue after credit note is not a duplicate", "umbrella_reissue"),
    });
  },
  "V-STARK": (ctx, vendor) => {
    const po = makePO(vendor, { lines: 1 });
    po.lines[0].qty = 12 * int(2, 8);
    po.total = round2(po.lines[0].qty * po.lines[0].unitPrice);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines: linesFromPO(po, (l) => ({ ...l, description: `${l.description} (case of 12)`, qty: l.qty / 12, unitPrice: round2(l.unitPrice * 12), unit: "case" })),
      label: approve("Stark bills per case of 12; totals match", "stark_case12"),
    });
  },
  "V-WAYNE": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const lines = linesFromPO(po);
    const freight = WAYNE_FREIGHTS[wayneSeq++ % WAYNE_FREIGHTS.length];
    lines.push({ description: "Freight", qty: 1, unitPrice: freight });
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines,
      label: freight <= 50
        ? approve(`Wayne freight line $${freight} is within the $50 allowance`, "wayne_freight")
        : route("procurement", `Wayne freight $${freight} exceeds the $50 allowance`, "wayne_freight_over"),
    });
  },
  "V-TYRELL": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po); // no receipt
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines: linesFromPO(po),
      invoiceDate: isoDaysAfter(int(2, 6)),
      label: route("hold_for_receipt", "Tyrell always invoices before delivery; hold for receipt", "tyrell_hold"),
    });
  },
  "V-VANDELAY": (ctx, vendor) => {
    const po = makePO(vendor, { lines: 1 });
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines: linesFromPO(po, (l) => ({ ...l, description: l.description.replace(", kg", ", t"), qty: l.qty / 1000, unitPrice: round2(l.unitPrice * 1000), unit: "t" })),
      label: approve("Vandelay bills in tons; totals match", "vandelay_tons"),
    });
  },
  "V-DUNDER": (ctx, vendor) => {
    const rush = rand() < 0.5;
    const po = makePO(vendor, { rush });
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const lines = linesFromPO(po);
    lines.push({ description: "Rush fee", qty: 1, unitPrice: 75 });
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines,
      label: rush
        ? approve("Dunder rush fee is valid because the PO is flagged rush", "dunder_rush_ok")
        : route("procurement", "Dunder rush fee on a PO that was not flagged rush", "dunder_rush_bad"),
    });
  },
  "V-SOYLENT": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    pushInvoice(ctx, vendor, {
      memo: `Ref: ${po.poNumber}. Thank you for your business.`,
      lines: linesFromPO(po),
      label: approve("Soylent puts the PO number in the memo; full match", "soylent_memo_po"),
    });
  },
  "V-OSCORP": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    pushInvoice(ctx, vendor, {
      poNumber: po.poNumber,
      lines: linesFromPO(po),
      label: route("fraud_review", "Vendor bank details changed in the last 30 days", "oscorp_bank_change"),
    });
  },
  "V-PIED": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const n = int(1000, 9999);
    const lines = linesFromPO(po);
    ctx.history.push({
      invoiceId: `HIST-${invSeq}`,
      invoiceNumber: `PP-${n}`,
      vendorId: vendor.vendorId,
      poNumber: po.poNumber,
      lines,
      total: totalOf(lines),
      currency: "USD",
      invoiceDate: isoDaysAfter(-int(20, 60)),
      bankAccount: vendor.bankAccount.iban,
      split: "train",
      label: approve("historical, paid"),
    });
    pushInvoice(ctx, vendor, {
      invoiceNumber: `PP-000${n}`,
      poNumber: po.poNumber,
      lines,
      label: reject("Duplicate: same invoice number with leading zeros", "pied_leading_zeros"),
    });
  },
  "V-MASSIVE": (ctx, vendor) => {
    const po = makePO(vendor);
    ctx.pos.push(po);
    ctx.receipts.push(makeReceipt(po));
    const lines = linesFromPO(po);
    lines.push({ description: "Sales tax 8.25%", qty: 1, unitPrice: round2(totalOf(lines) * 0.0825) });
    pushInvoice(ctx, vendor, { poNumber: po.poNumber, lines, label: approve("Massive Dynamic adds 8.25% sales tax; standard", "massive_tax") });
  },
};

// ---------- assemble ----------
export function generateDataset() {
  const ctx: Ctx = { pos: [], receipts: [], invoices: [], history: [] };

  for (const vendor of VENDORS) {
    const quirk = QUIRKS[vendor.vendorId];
    if (quirk) {
      // Quirk vendors: enough quirk instances to learn from, plus a few generic cases
      // so the harness can't just learn "always approve this vendor".
      const n = vendor.vendorId === "V-WAYNE" || vendor.vendorId === "V-DUNDER" ? 9 : 7;
      for (let i = 0; i < n; i++) quirk(ctx, vendor);
      if (vendor.vendorId !== "V-UPS" && vendor.vendorId !== "V-OSCORP") {
        cleanMatch(ctx, vendor);
        pick([qtyOver, priceOver])(ctx, vendor);
      }
      if (vendor.vendorId === "V-GLOBEX") priceOver(ctx, vendor, 5); // above the 2% allowance
    } else {
      for (let i = 0; i < 3; i++) cleanMatch(ctx, vendor);
      qtyOver(ctx, vendor);
      priceOver(ctx, vendor);
      exactDuplicate(ctx, vendor);
      noPO(ctx, vendor);
      if (vendor.vendorId === "V-CONTOSO" || vendor.vendorId === "V-FABRIKAM") bankMismatch(ctx, vendor);
    }
  }

  // Stratified split: ~30% eval per quirk (min 1), ~25% eval per generic outcome class.
  const groups = new Map<string, Invoice[]>();
  for (const inv of ctx.invoices) {
    const key = inv.label.quirkId ?? `generic:${inv.label.decision}:${inv.label.route ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), inv]);
  }
  for (const [key, group] of groups) {
    const shuffled = [...group].sort(() => rand() - 0.5);
    const isQuirk = !key.startsWith("generic:");
    const nEval = isQuirk ? Math.max(1, Math.round(shuffled.length * 0.3)) : Math.round(shuffled.length * 0.25);
    shuffled.forEach((inv, i) => (inv.split = i < nEval ? "eval" : "train"));
  }

  return { vendors: VENDORS, purchaseOrders: ctx.pos, receipts: ctx.receipts, invoices: ctx.invoices, history: ctx.history };
}
