// A printable tax invoice, isolated from the rest of the page via the same
// @media print + visibility technique the barcode-label printer already
// uses (Items.tsx). Two layouts share this one component, switched by
// `category`, matching the ZATCA distinction the app already carries on
// every sales invoice (zatca_invoice_category):
//   - "simplified": what POS issues -- no buyer details required, the QR
//     code is the primary compliance element.
//   - "standard": what a wholesale invoice issues -- adds a "Bill To" block
//     (buyer name + VAT number, mandatory for a standard tax invoice) and
//     an itemized net/VAT/total breakdown per line, not just a total.
// The company's registered address isn't captured anywhere in this app yet
// (chart_of_accounts-adjacent, out of scope here) so it's omitted rather
// than faked -- name, VAT number and CR number are what's actually on file.

interface InvoicePrintLine {
  description: string;
  qty: number;
  unitPrice: number;
  net: number;
  vat: number;
  gross: number;
}

export interface InvoicePrintProps {
  category: "simplified" | "standard";
  documentNumber: string;
  invoiceDate: string;
  companyNameEn: string;
  companyNameAr: string;
  companyVatNumber: string | null;
  companyCrNumber?: string | null;
  companyLogoUrl?: string | null;
  customerNameEn?: string | null;
  customerNameAr?: string | null;
  customerVatNumber?: string | null;
  lines: InvoicePrintLine[];
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
  qr?: string | null;
}

export function InvoicePrintArea(props: InvoicePrintProps) {
  const isStandard = props.category === "standard";
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #invoice-print-area, #invoice-print-area * { visibility: visible; }
          #invoice-print-area { position: fixed; inset: 0; width: 100%; margin: 0; padding: 12mm; }
        }
      `}</style>
      <div id="invoice-print-area" className="hidden print:block">
        <div className="mb-4 flex items-start justify-between">
          <div className="flex items-start gap-3">
            {props.companyLogoUrl && <img src={props.companyLogoUrl} alt="" className="h-12 w-12 object-contain" />}
            <div>
              <div className="text-base font-semibold">{props.companyNameEn}</div>
              <div className="text-base font-semibold" dir="rtl">
                {props.companyNameAr}
              </div>
              {props.companyVatNumber && <div className="mt-1 text-xs">VAT No: {props.companyVatNumber}</div>}
              {props.companyCrNumber && <div className="text-xs">CR No: {props.companyCrNumber}</div>}
            </div>
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold">{isStandard ? "Tax Invoice / فاتورة ضريبية" : "Simplified Tax Invoice / فاتورة ضريبية مبسطة"}</div>
            <div className="mt-1 font-mono text-xs">{props.documentNumber}</div>
            <div className="text-xs">{props.invoiceDate}</div>
          </div>
        </div>

        {isStandard && (props.customerNameEn || props.customerVatNumber) && (
          <div className="mb-4 border-y border-dashed border-black/30 py-2 text-xs">
            <div className="font-semibold">Bill To / إلى</div>
            {props.customerNameEn && <div>{props.customerNameEn}</div>}
            {props.customerVatNumber && <div>VAT No: {props.customerVatNumber}</div>}
          </div>
        )}

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-start">
              <th className="py-1 text-start font-semibold">Description</th>
              <th className="py-1 text-end font-semibold">Qty</th>
              <th className="py-1 text-end font-semibold">Unit Price</th>
              {isStandard && <th className="py-1 text-end font-semibold">Net</th>}
              {isStandard && <th className="py-1 text-end font-semibold">VAT</th>}
              <th className="py-1 text-end font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((l, i) => (
              <tr key={i} className="border-b border-black/10">
                <td className="py-1">{l.description}</td>
                <td className="py-1 text-end tabular-nums">{l.qty}</td>
                <td className="py-1 text-end tabular-nums">{l.unitPrice.toFixed(2)}</td>
                {isStandard && <td className="py-1 text-end tabular-nums">{l.net.toFixed(2)}</td>}
                {isStandard && <td className="py-1 text-end tabular-nums">{l.vat.toFixed(2)}</td>}
                <td className="py-1 text-end tabular-nums">{l.gross.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="ms-auto mt-3 w-48 space-y-0.5 text-xs">
          <div className="flex justify-between">
            <span>Net</span>
            <span className="tabular-nums">{props.netAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>VAT</span>
            <span className="tabular-nums">{props.vatAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between border-t border-black/30 pt-0.5 text-sm font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{props.grossAmount.toFixed(2)}</span>
          </div>
        </div>

        {props.qr && (
          <div className="mt-4 flex flex-col items-center">
            <img src={props.qr} alt="ZATCA QR code" width={110} height={110} />
          </div>
        )}
      </div>
    </>
  );
}
