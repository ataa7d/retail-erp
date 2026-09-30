import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewStocktakeForm } from "../Inventory";

export default function NewStocktakePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/inventory", { replace: true, state: { fromTab: state?.fromTab ?? "adjustments" } });
  }

  return (
    <TransactionPage title="New Stocktake" onBack={back}>
      <NewStocktakeForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
