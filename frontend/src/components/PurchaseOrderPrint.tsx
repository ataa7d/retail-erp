// A printable purchase order, isolated from the rest of the page with the same
// @media print + visibility technique as InvoicePrint.tsx. Unlike a sales
// invoice it carries no ZATCA QR or simplified/standard split: a PO is a
// buyer-issued request to a supplier, so it shows the buyer's identity, the
// supplier, and the per-line net/VAT/gross breakdown the supplier quotes against.

export interface PurchaseOrderPrintLine {
  description: string;
  qty: number;
  unitPrice: number;
  net: number;
  vat: number;
  gross: number;
}

export interface PurchaseOrderPrintProps {
  documentNumber: string;
  orderDate: string;
  companyNameEn: string;
  companyNameAr: string;
  companyVatNumber: string | null;
  companyCrNumber: string | null;
  companyLogoUrl: string | null;
  supplierNameEn: string;
  supplierNameAr: string;
  lines: PurchaseOrderPrintLine[];
  netAmount: number;
  vatAmount: number;
  grossAmount: number;
}

export function PurchaseOrderPrintArea(props: PurchaseOrderPrintProps) {
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #po-print-area, #po-print-area * { visibility: visible; }
          #po-print-area { position: fixed; inset: 0; width: 100%; margin: 0; padding: 12mm; }
        }
      `}</style>
      <div id="po-print-area" className="hidden print:block">
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
            <div className="text-sm font-semibold">Purchase Order / أمر شراء</div>
            <div className="mt-1 font-mono text-xs">{props.documentNumber}</div>
            <div className="text-xs">{props.orderDate}</div>
          </div>
        </div>

        <div className="mb-4 border-y border-dashed border-black/30 py-2 text-xs">
          <div className="font-semibold">Supplier / المورد</div>
          <div>{props.supplierNameEn}</div>
          <div dir="rtl">{props.supplierNameAr}</div>
        </div>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-start">
              <th className="py-1 text-start font-semibold">Description</th>
              <th className="py-1 text-end font-semibold">Qty</th>
              <th className="py-1 text-end font-semibold">Unit Price</th>
              <th className="py-1 text-end font-semibold">Net</th>
              <th className="py-1 text-end font-semibold">VAT</th>
              <th className="py-1 text-end font-semibold">Total</th>
            </tr>
          </thead>
          <tbody>
            {props.lines.map((l, i) => (
              <tr key={i} className="border-b border-black/10">
                <td className="py-1">{l.description}</td>
                <td className="py-1 text-end tabular-nums">{l.qty}</td>
                <td className="py-1 text-end tabular-nums">{l.unitPrice.toFixed(2)}</td>
                <td className="py-1 text-end tabular-nums">{l.net.toFixed(2)}</td>
                <td className="py-1 text-end tabular-nums">{l.vat.toFixed(2)}</td>
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
      </div>
    </>
  );
}
