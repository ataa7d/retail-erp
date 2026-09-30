import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { CreditNoteDetailModal } from "../Sales";

export default function SalesCreditNoteDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/sales", { replace: true, state: { fromTab: state?.fromTab ?? "credits" } });
  }

  return (
    <TransactionPage title="Credit Note" onBack={back}>
      <CreditNoteDetailModal creditNoteId={id!} />
    </TransactionPage>
  );
}
