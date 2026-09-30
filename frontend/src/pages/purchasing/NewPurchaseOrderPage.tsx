import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewPurchaseOrderForm, type PoFormInitial } from "../Purchasing";

export default function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string; initial?: PoFormInitial } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "pos" } });
  }

  return (
    <TransactionPage title="New Purchase Order" onBack={back}>
      <NewPurchaseOrderForm initial={state?.initial} onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
