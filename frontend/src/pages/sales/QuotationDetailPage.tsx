import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { QuotationDetailModal } from "../Sales";

export default function QuotationDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/sales", { replace: true, state: { fromTab: state?.fromTab ?? "quotations" } });
  }

  return (
    <TransactionPage title="Sales Quotation" onBack={back}>
      <QuotationDetailModal quotationId={id!} onChanged={() => {}} />
    </TransactionPage>
  );
}
