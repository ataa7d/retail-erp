import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewGoodsReceiptForm } from "../Purchasing";

export default function NewGoodsReceiptPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/purchasing", { replace: true, state: { fromTab: state?.fromTab ?? "receipts" } });
  }

  return (
    <TransactionPage title="New Goods Receipt" onBack={back}>
      <NewGoodsReceiptForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
