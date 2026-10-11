import Link from "next/link";
import { collections } from "@/lib/db";
import { getActiveVersion } from "@/harness/store";
import { QUIRK_NAMES } from "@/data/quirks";
import { TryPanel, type TryOption } from "@/components/TryPanel";

export const dynamic = "force-dynamic";

export default async function TryPage() {
  const c = await collections();
  const active = await getActiveVersion();
  const invoices = await c.invoices.find({ split: "eval", status: "pending" }, { projection: { _id: 0, invoiceId: 1, invoiceNumber: 1, vendorId: 1, total: 1, currency: 1, label: 1 } }).toArray();
  const vendors = await c.vendors.find({}, { projection: { _id: 0, vendorId: 1, name: 1 } }).toArray();
  const vendorNames = Object.fromEntries(vendors.map((v) => [v.vendorId, v.name]));

  const options: TryOption[] = invoices
    .map((i) => ({
      invoiceId: i.invoiceId,
      label: `${vendorNames[i.vendorId] ?? i.vendorId} · ${i.invoiceNumber} · ${i.total.toLocaleString()} ${i.currency}`,
      quirk: i.label.quirkId ? `${QUIRK_NAMES[i.label.quirkId]?.title ?? i.label.quirkId}` : "ordinary case",
      vendorId: i.vendorId,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">← Story</Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Try one invoice</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Pick a held-out invoice. It runs through harness v0 and the current harness v{active.version} at the same time. Nothing is saved, so this never feeds back into training.
      </p>
      <TryPanel options={options} activeVersion={active.version} vendorNames={vendorNames} />
    </main>
  );
}
