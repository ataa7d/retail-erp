import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewPaymentForm } from "../Accounting";

export default function NewPaymentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/accounting", { replace: true, state: { fromTab: state?.fromTab ?? "payments" } });
  }

  return (
    <TransactionPage title="New Supplier Payment" onBack={back}>
      <NewPaymentForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
