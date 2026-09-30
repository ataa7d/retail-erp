import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewRequisitionForm } from "../Purchasing";

export default function NewRequisitionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "requisitions" } });
  }

  return (
    <TransactionPage title="New Purchase Requisition" onBack={back}>
      <NewRequisitionForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
