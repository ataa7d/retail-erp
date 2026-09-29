// Same @media print + visibility isolation technique as InvoicePrint.tsx
// and the barcode-label printer before it -- one consistent way this app
// prints anything, rather than a new one per document type.

export interface PayslipPrintProps {
  companyNameEn: string;
  companyNameAr: string;
  documentNumber: string;
  payPeriodStart: string;
  payPeriodEnd: string;
  employeeCode: string;
  employeeNameEn: string;
  employeeNameAr: string;
  basicSalary: number;
  housingAllowance: number;
  otherAllowances: number;
  grossPay: number;
  gosiEmployeeAmount: number;
  netPay: number;
}

export function PayslipPrintArea(props: PayslipPrintProps) {
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #payslip-print-area, #payslip-print-area * { visibility: visible; }
          #payslip-print-area { position: fixed; inset: 0; width: 100%; margin: 0; padding: 12mm; }
        }
      `}</style>
      <div id="payslip-print-area" className="hidden print:block">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <div className="text-base font-semibold">{props.companyNameEn}</div>
            <div className="text-base font-semibold" dir="rtl">
              {props.companyNameAr}
            </div>
          </div>
          <div className="text-end">
            <div className="text-sm font-semibold">Payslip / إيصال راتب</div>
            <div className="mt-1 font-mono text-xs">{props.documentNumber}</div>
            <div className="text-xs">
              {props.payPeriodStart} – {props.payPeriodEnd}
            </div>
          </div>
        </div>

        <div className="mb-4 border-y border-dashed border-black/30 py-2 text-xs">
          <div className="font-semibold">{props.employeeNameEn}</div>
          <div dir="rtl">{props.employeeNameAr}</div>
          <div>Employee Code: {props.employeeCode}</div>
        </div>

        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-start">
              <th className="py-1 text-start font-semibold">Earnings</th>
              <th className="py-1 text-end font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/10">
              <td className="py-1">Basic Salary</td>
              <td className="py-1 text-end tabular-nums">{props.basicSalary.toFixed(2)}</td>
            </tr>
            <tr className="border-b border-black/10">
              <td className="py-1">Housing Allowance</td>
              <td className="py-1 text-end tabular-nums">{props.housingAllowance.toFixed(2)}</td>
            </tr>
            <tr className="border-b border-black/10">
              <td className="py-1">Other Allowances</td>
              <td className="py-1 text-end tabular-nums">{props.otherAllowances.toFixed(2)}</td>
            </tr>
            <tr className="border-b border-black/30 font-semibold">
              <td className="py-1">Gross Pay</td>
              <td className="py-1 text-end tabular-nums">{props.grossPay.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <table className="mt-3 w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-black/30 text-start">
              <th className="py-1 text-start font-semibold">Deductions</th>
              <th className="py-1 text-end font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-black/10">
              <td className="py-1">GOSI (Employee Share)</td>
              <td className="py-1 text-end tabular-nums">{props.gosiEmployeeAmount.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <div className="ms-auto mt-3 w-48 space-y-0.5 text-xs">
          <div className="flex justify-between border-t border-black/30 pt-0.5 text-sm font-semibold">
            <span>Net Pay</span>
            <span className="tabular-nums">{props.netPay.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </>
  );
}
