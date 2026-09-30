import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { RequisitionDetailModal } from "../Purchasing";

export default function RequisitionDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "requisitions" } });
  }

  return (
    <TransactionPage title="Purchase Requisition" onBack={back}>
      <RequisitionDetailModal requisitionId={id!} onChanged={() => {}} />
    </TransactionPage>
  );
}
