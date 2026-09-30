import { useNavigate, useLocation } from "react-router-dom";
import TransactionPage from "../../components/TransactionPage";
import { NewQuotationForm } from "../Sales";

export default function NewQuotationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = location.state as { fromTab?: string } | null;

  function back() {
    navigate("/sales", { replace: true, state: { fromTab: state?.fromTab ?? "quotations" } });
  }

  return (
    <TransactionPage title="New Sales Quotation" onBack={back}>
      <NewQuotationForm onClose={back} onCreated={back} />
    </TransactionPage>
  );
}
