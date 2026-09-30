import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { CreditNoteDetailModal } from "../Purchasing";

export default function PurchaseReturnDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "returns" } });
  }

  return (
    <TransactionPage title="Purchase Return" onBack={back}>
      <CreditNoteDetailModal creditNoteId={id!} />
    </TransactionPage>
  );
}
