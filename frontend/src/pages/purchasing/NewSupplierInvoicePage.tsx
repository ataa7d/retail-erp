import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewSupplierInvoiceForm } from "../Purchasing";

export default function NewSupplierInvoicePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "invoices" } });
  }

  return (
    <TransactionPage title="New Supplier Invoice" onBack={back}>
      <NewSupplierInvoiceForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
