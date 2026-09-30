import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewJournalForm } from "../Accounting";

export default function NewJournalPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/accounting", { replace: true, state: { fromTab: state?.fromTab ?? "journals" } });
  }

  return (
    <TransactionPage title="New Manual Journal Entry" onBack={back}>
      <NewJournalForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
