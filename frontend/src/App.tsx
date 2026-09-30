import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, AuthProvider } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import CompanyPicker from "./pages/CompanyPicker";
import Dashboard from "./pages/Dashboard";
import Items from "./pages/Items";
import Sales from "./pages/Sales";
import NewSalesInvoicePage from "./pages/sales/NewSalesInvoicePage";
import NewCreditNotePage from "./pages/sales/NewCreditNotePage";
import NewQuotationPage from "./pages/sales/NewQuotationPage";
import Customers from "./pages/Customers";
import Inventory from "./pages/Inventory";
import NewTransferPage from "./pages/inventory/NewTransferPage";
import NewTransferOrderPage from "./pages/inventory/NewTransferOrderPage";
import NewStocktakePage from "./pages/inventory/NewStocktakePage";
import Purchasing from "./pages/Purchasing";
import NewPurchaseOrderPage from "./pages/purchasing/NewPurchaseOrderPage";
import NewRequisitionPage from "./pages/purchasing/NewRequisitionPage";
import NewGoodsReceiptPage from "./pages/purchasing/NewGoodsReceiptPage";
import NewSupplierInvoicePage from "./pages/purchasing/NewSupplierInvoicePage";
import NewPurchaseReturnPage from "./pages/purchasing/NewPurchaseReturnPage";
import PoDetailPage from "./pages/purchasing/PoDetailPage";
import RequisitionDetailPage from "./pages/purchasing/RequisitionDetailPage";
import PurchaseReturnDetailPage from "./pages/purchasing/PurchaseReturnDetailPage";
import Reports from "./pages/Reports";
import Accounting from "./pages/Accounting";
import NewJournalPage from "./pages/accounting/NewJournalPage";
import NewReceiptPage from "./pages/accounting/NewReceiptPage";
import NewPaymentPage from "./pages/accounting/NewPaymentPage";
import Hr from "./pages/Hr";
import Assets from "./pages/Assets";
import Admin from "./pages/Admin";
import Pos from "./pages/Pos";

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { token, loading } = useAuth();
  const { t } = useTranslation();
  const location = useLocation();

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">{t("common.loading")}</div>;
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function RequireCompany({ children }: { children: React.ReactElement }) {
  const { me, loading } = useAuth();
  const { t } = useTranslation();

  if (loading) return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">{t("common.loading")}</div>;
  if (!me) return <Navigate to="/select-company" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/select-company"
          element={
            <RequireAuth>
              <CompanyPicker />
            </RequireAuth>
          }
        />
        <Route
          path="/pos"
          element={
            <RequireAuth>
              <RequireCompany>
                <Pos />
              </RequireCompany>
            </RequireAuth>
          }
        />
        <Route
          path="/"
          element={
            <RequireAuth>
              <RequireCompany>
                <Layout />
              </RequireCompany>
            </RequireAuth>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="items" element={<Items />} />
          <Route path="sales" element={<Sales />} />
          <Route path="sales/invoices/new" element={<NewSalesInvoicePage />} />
          <Route path="sales/credit-notes/new" element={<NewCreditNotePage />} />
          <Route path="sales/quotations/new" element={<NewQuotationPage />} />
          <Route path="customers" element={<Customers />} />
          <Route path="inventory" element={<Inventory />} />
          <Route path="inventory/transfers/new" element={<NewTransferPage />} />
          <Route path="inventory/transfer-orders/new" element={<NewTransferOrderPage />} />
          <Route path="inventory/stocktakes/new" element={<NewStocktakePage />} />
          <Route path="purchasing" element={<Purchasing />} />
          <Route path="purchasing/orders/new" element={<NewPurchaseOrderPage />} />
          <Route path="purchasing/requisitions/new" element={<NewRequisitionPage />} />
          <Route path="purchasing/goods-receipts/new" element={<NewGoodsReceiptPage />} />
          <Route path="purchasing/supplier-invoices/new" element={<NewSupplierInvoicePage />} />
          <Route path="purchasing/returns/new" element={<NewPurchaseReturnPage />} />
          <Route path="purchasing/orders/:id" element={<PoDetailPage />} />
          <Route path="purchasing/requisitions/:id" element={<RequisitionDetailPage />} />
          <Route path="purchasing/returns/:id" element={<PurchaseReturnDetailPage />} />
          <Route path="reports" element={<Reports />} />
          <Route path="accounting" element={<Accounting />} />
          <Route path="accounting/journals/new" element={<NewJournalPage />} />
          <Route path="accounting/receipts/new" element={<NewReceiptPage />} />
          <Route path="accounting/payments/new" element={<NewPaymentPage />} />
          <Route path="hr" element={<Hr />} />
          <Route path="assets" element={<Assets />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
