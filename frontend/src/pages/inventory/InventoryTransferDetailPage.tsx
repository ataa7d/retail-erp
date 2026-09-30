import { useNavigate, useLocation, useParams } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { InventoryTransferDetailModal } from "../Inventory";

export default function InventoryTransferDetailPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams<{ id: string }>();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/inventory", { replace: true, state: { fromTab: state?.fromTab ?? "transfer-orders" } });
  }

  return (
    <TransactionPage title="Inventory Transfer" onBack={back}>
      <InventoryTransferDetailModal transferId={id!} onClose={() => {}} onPosted={back} />
    </TransactionPage>
  );
}
