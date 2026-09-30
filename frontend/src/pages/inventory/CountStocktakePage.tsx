import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { CountStocktakeForm } from "../Inventory";

export default function CountStocktakePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/inventory", { replace: true, state: { fromTab: state?.fromTab ?? "adjustments" } });
  }

  return (
    <TransactionPage title="Count & Post Stocktake" onBack={back}>
      <CountStocktakeForm stocktakeId={id!} onClose={back} onPosted={back} />
    </TransactionPage>
  );
}
