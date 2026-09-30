import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewCreditNoteForm } from "../Sales";

export default function NewCreditNotePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/sales", { replace: true, state: { fromTab: state?.fromTab ?? "credits" } });
  }

  return (
    <TransactionPage title="New Credit Note" onBack={back}>
      <NewCreditNoteForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
