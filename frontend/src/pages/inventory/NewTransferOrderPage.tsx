import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewInventoryTransferForm } from "../Inventory";

export default function NewTransferOrderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/inventory", { replace: true, state: { fromTab: state?.fromTab ?? "transfer-orders" } });
  }

  return (
    <TransactionPage title="New Inventory Transfer" onBack={back}>
      <NewInventoryTransferForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
