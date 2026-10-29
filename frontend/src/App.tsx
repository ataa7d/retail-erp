import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, AuthProvider } from "./lib/auth";
import Layout, { navItems } from "./components/Layout";
import Login from "./pages/Login";
import CompanyPicker from "./pages/CompanyPicker";
import Dashboard from "./pages/Dashboard";
import Sales from "./pages/Sales";
import NewSalesInvoicePage from "./pages/sales/NewSalesInvoicePage";
import NewCreditNotePage from "./pages/sales/NewCreditNotePage";
import NewQuotationPage from "./pages/sales/NewQuotationPage";
import SalesInvoiceDetailPage from "./pages/sales/SalesInvoiceDetailPage";
import SalesCreditNoteDetailPage from "./pages/sales/SalesCreditNoteDetailPage";
import QuotationDetailPage from "./pages/sales/QuotationDetailPage";
import Inventory from "./pages/Inventory";
import NewTransferPage from "./pages/inventory/NewTransferPage";
import NewTransferOrderPage from "./pages/inventory/NewTransferOrderPage";
import NewStocktakePage from "./pages/inventory/NewStocktakePage";
import InventoryTransferDetailPage from "./pages/inventory/InventoryTransferDetailPage";
import CountStocktakePage from "./pages/inventory/CountStocktakePage";
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
import BudgetDetailPage from "./pages/accounting/BudgetDetailPage";
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

// Reuses the same permission each module's sidebar entry already declares
// (navItems in Layout.tsx) so a screen's URL-level gate can never drift
// from what the sidebar already promises -- one definition, not two.
function RequirePermission({ navPath, children }: { navPath: string; children: React.ReactElement }) {
  const { hasPermission } = useAuth();
  const required = navItems.find((item) => item.to === navPath)?.permission ?? null;
  if (required) {
    const codes = Array.isArray(required) ? required : [required];
    if (!codes.some((code) => hasPermission(code))) return <Navigate to="/" replace />;
  }
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
          <Route path="items" element={<Navigate to="/inventory" state={{ fromTab: "items" }} replace />} />
          <Route
            path="sales"
            element={
              <RequirePermission navPath="/sales">
                <Sales />
              </RequirePermission>
            }
          />
          <Route
            path="sales/invoices/new"
            element={
              <RequirePermission navPath="/sales">
                <NewSalesInvoicePage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/credit-notes/new"
            element={
              <RequirePermission navPath="/sales">
                <NewCreditNotePage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/quotations/new"
            element={
              <RequirePermission navPath="/sales">
                <NewQuotationPage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/invoices/:id"
            element={
              <RequirePermission navPath="/sales">
                <SalesInvoiceDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/credit-notes/:id"
            element={
              <RequirePermission navPath="/sales">
                <SalesCreditNoteDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="sales/quotations/:id"
            element={
              <RequirePermission navPath="/sales">
                <QuotationDetailPage />
              </RequirePermission>
            }
          />
          <Route path="customers" element={<Navigate to="/accounting" state={{ fromTab: "customers" }} replace />} />
          <Route
            path="inventory"
            element={
              <RequirePermission navPath="/inventory">
                <Inventory />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/transfers/new"
            element={
              <RequirePermission navPath="/inventory">
                <NewTransferPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/transfer-orders/new"
            element={
              <RequirePermission navPath="/inventory">
                <NewTransferOrderPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/stocktakes/new"
            element={
              <RequirePermission navPath="/inventory">
                <NewStocktakePage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/transfer-orders/:id"
            element={
              <RequirePermission navPath="/inventory">
                <InventoryTransferDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="inventory/stocktakes/:id/count"
            element={
              <RequirePermission navPath="/inventory">
                <CountStocktakePage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing"
            element={
              <RequirePermission navPath="/purchasing">
                <Purchasing />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/orders/new"
            element={
              <RequirePermission navPath="/purchasing">
                <NewPurchaseOrderPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/requisitions/new"
            element={
              <RequirePermission navPath="/purchasing">
                <NewRequisitionPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/goods-receipts/new"
            element={
              <RequirePermission navPath="/purchasing">
                <NewGoodsReceiptPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/supplier-invoices/new"
            element={
              <RequirePermission navPath="/purchasing">
                <NewSupplierInvoicePage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/returns/new"
            element={
              <RequirePermission navPath="/purchasing">
                <NewPurchaseReturnPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/orders/:id"
            element={
              <RequirePermission navPath="/purchasing">
                <PoDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/requisitions/:id"
            element={
              <RequirePermission navPath="/purchasing">
                <RequisitionDetailPage />
              </RequirePermission>
            }
          />
          <Route
            path="purchasing/returns/:id"
            element={
              <RequirePermission navPath="/purchasing">
                <PurchaseReturnDetailPage />
              </RequirePermission>
            }
          />
          <Route path="reports" element={<Reports />} />
          <Route
            path="accounting"
            element={
              <RequirePermission navPath="/accounting">
                <Accounting />
              </RequirePermission>
            }
          />
          <Route
            path="accounting/journals/new"
            element={
              <RequirePermission navPath="/accounting">
                <NewJournalPage />
              </RequirePermission>
            }
          />
          <Route
            path="accounting/receipts/new"
            element={
              <RequirePermission navPath="/accounting">
                <NewReceiptPage />
              </RequirePermission>
            }
          />
          <Route
            path="accounting/payments/new"
            element={
              <RequirePermission navPath="/accounting">
                <NewPaymentPage />
              </RequirePermission>
            }
          />
          <Route
            path="accounting/budgets/:id"
            element={
              <RequirePermission navPath="/accounting">
                <BudgetDetailPage />
              </RequirePermission>
            }
          />
          <Route path="hr" element={<Hr />} />
          <Route path="assets" element={<Assets />} />
          <Route path="admin" element={<Admin />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
