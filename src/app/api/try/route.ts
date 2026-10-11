import { NextResponse } from "next/server";
import { collections } from "@/lib/db";
import { getActiveVersion, getVersion } from "@/harness/store";
import { processInvoice } from "@/harness/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Run one invoice under harness v0 and the active version, side by side. Nothing is persisted. */
export async function POST(req: Request) {
  const { invoiceId } = (await req.json()) as { invoiceId: string };
  const c = await collections();
  const invoice = await c.invoices.findOne({ invoiceId });
  if (!invoice) return NextResponse.json({ error: "invoice not found" }, { status: 404 });
  const [v0, active] = await Promise.all([getVersion(0), getActiveVersion()]);
  if (!v0) return NextResponse.json({ error: "no v0" }, { status: 500 });

  const [before, after] = await Promise.all([
    processInvoice(invoice, v0, "demo"),
    processInvoice(invoice, active, "demo"),
  ]);
  const strip = (e: typeof before) => ({
    version: e.version,
    decision: e.decision,
    route: e.route ?? null,
    reason: e.reason,
    correct: e.correct,
    falseApproval: e.falseApproval,
    viaFastPath: e.viaFastPath ?? null,
    guardrailOverride: e.guardrailOverride ?? null,
    tools: e.trace.map((t) => t.tool),
    durationMs: e.durationMs,
  });
  return NextResponse.json({
    invoice: { invoiceId: invoice.invoiceId, invoiceNumber: invoice.invoiceNumber, vendorId: invoice.vendorId, poNumber: invoice.poNumber ?? null, memo: invoice.memo ?? null, total: invoice.total, currency: invoice.currency, lines: invoice.lines },
    expected: invoice.label,
    before: strip(before),
    after: strip(after),
  });
}
