import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewSalesInvoiceForm } from "../Sales";

export default function NewSalesInvoicePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/sales", { replace: true, state: { fromTab: state?.fromTab ?? "invoices" } });
  }

  return (
    <TransactionPage title="New Sales Invoice" onBack={back}>
      <NewSalesInvoiceForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
