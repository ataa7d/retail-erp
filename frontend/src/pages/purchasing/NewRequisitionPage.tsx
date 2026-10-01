import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewRequisitionForm, type RequisitionFormInitial } from "../Purchasing";

export default function NewRequisitionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string; initial?: RequisitionFormInitial } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "requisitions" } });
  }

  return (
    <TransactionPage title="New Purchase Requisition" onBack={back}>
      <NewRequisitionForm onClose={back} onCreated={back} initial={state?.initial} />
    </TransactionPage>
  );
}
