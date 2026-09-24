import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { apiRequest, ApiError } from "./api";

export interface Company {
  id: string;
  company_code: string;
  name_en: string;
  name_ar: string;
  base_currency: string;
}

export interface MeResponse {
  user: { id: string; email: string };
  companyId: string;
  roles: Array<{ id: string; name: string; store_id: string | null }>;
  permissions: string[];
}

interface AuthState {
  token: string | null;
  companyId: string | null;
  me: MeResponse | null;
  companies: Company[];
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  selectCompany: (companyId: string) => Promise<void>;
  logout: () => void;
  hasPermission: (code: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "retail_erp_token";
const COMPANY_KEY = "retail_erp_company_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [companyId, setCompanyId] = useState<string | null>(() => localStorage.getItem(COMPANY_KEY));
  const [me, setMe] = useState<MeResponse | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCompanies = useCallback(async (currentToken: string) => {
    const list = await apiRequest<Company[]>("/api/companies", { token: currentToken });
    setCompanies(list);
    return list;
  }, []);

  const loadMe = useCallback(async (currentToken: string, currentCompanyId: string) => {
    const response = await apiRequest<MeResponse>("/api/me", { token: currentToken, companyId: currentCompanyId });
    setMe(response);
    return response;
  }, []);

  // On mount, re-hydrate from whatever was persisted — a page refresh
  // shouldn't force a fresh login as long as the token is still valid.
  useEffect(() => {
    (async () => {
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        await loadCompanies(token);
        if (companyId) {
          await loadMe(token, companyId);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setToken(null);
          setCompanyId(null);
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(COMPANY_KEY);
        }
      } finally {
        setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    })();
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await apiRequest<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: { email, password },
      });
      localStorage.setItem(TOKEN_KEY, response.token);
      setToken(response.token);
      setMe(null);
      setCompanyId(null);
      localStorage.removeItem(COMPANY_KEY);
      await loadCompanies(response.token);
    },
    [loadCompanies],
  );

  const selectCompany = useCallback(
    async (newCompanyId: string) => {
      if (!token) throw new Error("not logged in");
      await loadMe(token, newCompanyId);
      localStorage.setItem(COMPANY_KEY, newCompanyId);
      setCompanyId(newCompanyId);
    },
    [token, loadMe],
  );

  const logout = useCallback(() => {
    setToken(null);
    setCompanyId(null);
    setMe(null);
    setCompanies([]);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(COMPANY_KEY);
  }, []);

  const hasPermission = useCallback((code: string) => me?.permissions.includes(code) ?? false, [me]);

  const value = useMemo(
    () => ({ token, companyId, me, companies, loading, login, selectCompany, logout, hasPermission }),
    [token, companyId, me, companies, loading, login, selectCompany, logout, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
