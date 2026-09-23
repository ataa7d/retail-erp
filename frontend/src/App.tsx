import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth, AuthProvider } from "./lib/auth";
import Layout from "./components/Layout";
import Login from "./pages/Login";
import CompanyPicker from "./pages/CompanyPicker";
import Dashboard from "./pages/Dashboard";
import Items from "./pages/Items";
import ComingSoon from "./pages/ComingSoon";

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
          <Route path="customers" element={<ComingSoon title="Customers" />} />
          <Route path="inventory" element={<ComingSoon title="Inventory" />} />
          <Route path="purchasing" element={<ComingSoon title="Purchasing" />} />
          <Route path="reports" element={<ComingSoon title="Reports" />} />
          <Route path="hr" element={<ComingSoon title="HR & Payroll" />} />
          <Route path="assets" element={<ComingSoon title="Fixed Assets" />} />
          <Route path="admin" element={<ComingSoon title="Administration" />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
