import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewReceiptForm } from "../Accounting";

export default function NewReceiptPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/accounting", { replace: true, state: { fromTab: state?.fromTab ?? "receipts" } });
  }

  return (
    <TransactionPage title="New Customer Receipt" onBack={back}>
      <NewReceiptForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
