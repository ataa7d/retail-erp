import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewTransferForm } from "../Inventory";

export default function NewTransferPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/inventory", { replace: true, state: { fromTab: state?.fromTab ?? "transfers" } });
  }

  return (
    <TransactionPage title="New Stock Transfer" onBack={back}>
      <NewTransferForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
