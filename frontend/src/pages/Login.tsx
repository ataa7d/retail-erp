import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export default function Login() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      navigate("/select-company");
    } catch (err) {
      setError(err instanceof ApiError ? t("login.error") : t("common.error"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-shell-900 bg-[radial-gradient(circle_at_top,rgba(122,180,245,0.18),transparent_55%)]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold">RE</div>
          <span className="text-lg font-semibold tracking-tight">{t("app.title")}</span>
        </div>

        <form onSubmit={handleSubmit} className="rounded-xl border border-white/10 bg-white p-8 shadow-2xl">
          <h1 className="mb-6 text-lg font-semibold text-slate-900">{t("login.title")}</h1>

          <label className="mb-1 block text-sm font-medium text-slate-700">{t("login.email")}</label>
          <input
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />

          <label className="mb-1 block text-sm font-medium text-slate-700">{t("login.password")}</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
          />

          {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-brand-500 px-3 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-600 disabled:opacity-50"
          >
            <LogIn size={16} /> {t("login.submit")}
          </button>
        </form>
      </div>
    </div>
  );
}
