import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewSupplierCreditNoteForm } from "../Purchasing";

export default function NewPurchaseReturnPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "returns" } });
  }

  return (
    <TransactionPage title="New Purchase Return" onBack={back}>
      <NewSupplierCreditNoteForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
