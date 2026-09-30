import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { SalesInvoiceDetailModal } from "../Sales";

export default function SalesInvoiceDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/sales", { replace: true, state: { fromTab: state?.fromTab ?? "invoices" } });
  }

  return (
    <TransactionPage title="Sales Invoice" onBack={back}>
      <SalesInvoiceDetailModal invoiceId={id!} onVoided={() => {}} />
    </TransactionPage>
  );
}
