import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { BudgetDetailModal } from "../Accounting";

export default function BudgetDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/accounting", { replace: true, state: { fromTab: state?.fromTab ?? "budgets" } });
  }

  return (
    <TransactionPage title="Budget" onBack={back}>
      <BudgetDetailModal budgetId={id!} onChanged={() => {}} />
    </TransactionPage>
  );
}
