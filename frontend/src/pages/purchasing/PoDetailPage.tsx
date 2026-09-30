import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { PoDetailModal } from "../Purchasing";

export default function PoDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "pos" } });
  }

  return (
    <TransactionPage title="Purchase Order" onBack={back}>
      <PoDetailModal poId={id!} />
    </TransactionPage>
  );
}
