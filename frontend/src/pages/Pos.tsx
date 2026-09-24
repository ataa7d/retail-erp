import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Plus, Minus, Trash2, WifiOff, Wifi, RefreshCw, LogOut, X, ShoppingCart } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApiList } from "../lib/useApiList";
import { apiRequest } from "../lib/api";

interface PosDevice {
  id: string;
  store_id: string;
  device_code: string;
  device_name: string;
  series_prefix: string;
  status: string;
  last_synced_invoice_seq: string | number | null;
}

interface Store {
  id: string;
  store_code: string;
  name_en: string;
}

interface Customer {
  id: string;
  name_en: string;
}

interface FiscalPeriod {
  id: string;
  status: string;
}

interface ItemBarcode {
  barcode: string;
  unitOfMeasureId: string;
  isPrimary: boolean;
}

interface ItemVariant {
  id: string;
  variant_code: string;
  color: string | null;
  size: string | null;
  is_active: boolean;
  barcodes: ItemBarcode[] | null;
}

interface PosItem {
  name_en: string;
  is_active: boolean;
  variants: ItemVariant[];
}

interface PriceList {
  id: string;
  is_default: boolean;
}

interface PriceListItem {
  item_variant_id: string;
  price: string;
}

interface CartLine {
  itemVariantId: string;
  label: string;
  qty: number;
  unitPrice: number;
}

interface QueuedInvoicePayload {
  clientUuid: string;
  deviceSequenceNumber: number;
  storeId: string;
  zatcaInvoiceCategory: "simplified";
  invoiceDate: string;
  fiscalPeriodId: string;
  customerId: string | null;
  lines: Array<{
    itemVariantId: string;
    itemDescription: string;
    qty: number;
    unitPrice: number;
    discountAmount: number;
    vatRate: number;
    priceIncludesVat: boolean;
  }>;
  payments: Array<{ paymentMethod: "cash" | "card"; amount: number }>;
}

interface SyncResult {
  clientUuid: string;
  status: "synced" | "already_synced" | "error";
  id?: string;
  error?: string;
}

const VAT_RATE = 15;
const DEVICE_KEY = "pos_terminal_device_id";
const seqKey = (deviceId: string) => `pos_terminal_seq_${deviceId}`;
const queueKey = (deviceId: string) => `pos_terminal_queue_${deviceId}`;

function loadSeq(deviceId: string, fallback: number): number {
  const raw = localStorage.getItem(seqKey(deviceId));
  return raw ? Number(raw) : fallback;
}
function saveSeq(deviceId: string, seq: number) {
  localStorage.setItem(seqKey(deviceId), String(seq));
}
function loadQueue(deviceId: string): QueuedInvoicePayload[] {
  try {
    const raw = localStorage.getItem(queueKey(deviceId));
    return raw ? (JSON.parse(raw) as QueuedInvoicePayload[]) : [];
  } catch {
    return [];
  }
}
function saveQueue(deviceId: string, queue: QueuedInvoicePayload[]) {
  localStorage.setItem(queueKey(deviceId), JSON.stringify(queue));
}

function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);
  return online;
}

function DevicePicker({ onSelected }: { onSelected: (deviceId: string) => void }) {
  const navigate = useNavigate();
  const { data: devices, error } = useApiList<PosDevice>("/api/pos-devices");
  const { data: stores } = useApiList<Store>("/api/stores");
  const active = devices?.filter((d) => d.status === "active") ?? [];
  const storeLabel = (id: string) => stores?.find((s) => s.id === id)?.name_en ?? "?";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <h1 className="mb-1 text-lg font-semibold text-slate-900">Select This Terminal's Device</h1>
        <p className="mb-4 text-sm text-slate-500">Choose the registered POS device this terminal will act as. Devices are managed under Administration → POS Devices.</p>
        {error && <p className="mb-3 text-sm text-red-600">Failed to load devices.</p>}
        {devices && active.length === 0 && (
          <p className="mb-3 text-sm text-slate-500">No active POS devices registered yet.</p>
        )}
        <div className="space-y-2">
          {active.map((d) => (
            <button
              key={d.id}
              onClick={() => onSelected(d.id)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-start hover:border-brand-400 hover:bg-brand-50"
            >
              <div>
                <div className="font-medium text-slate-900">{d.device_name}</div>
                <div className="text-xs text-slate-500">
                  {storeLabel(d.store_id)} · {d.series_prefix}
                </div>
              </div>
              <span className="text-xs text-brand-600">Use this device →</span>
            </button>
          ))}
        </div>
        <button onClick={() => navigate("/admin")} className="mt-4 text-xs font-medium text-slate-400 hover:text-slate-600">
          ← Back to Administration
        </button>
      </div>
    </div>
  );
}

export default function Pos() {
  const { token, companyId, logout } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();

  const [deviceId, setDeviceId] = useState<string | null>(() => localStorage.getItem(DEVICE_KEY));
  const { data: devices } = useApiList<PosDevice>("/api/pos-devices");
  const { data: customers } = useApiList<Customer>("/api/customers");
  const { data: periods } = useApiList<FiscalPeriod>("/api/fiscal-periods");
  const { data: items } = useApiList<PosItem>("/api/items");
  const { data: priceLists } = useApiList<PriceList>("/api/price-lists");
  const defaultPriceListId = priceLists?.find((p) => p.is_default)?.id ?? null;
  const { data: priceListItems } = useApiList<PriceListItem>(defaultPriceListId ? `/api/price-lists/${defaultPriceListId}/items` : null);

  const device = devices?.find((d) => d.id === deviceId) ?? null;
  const openPeriodId = periods?.find((p) => p.status === "open")?.id ?? "";

  const [search, setSearch] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card">("cash");
  const [tendered, setTendered] = useState("");
  const [charging, setCharging] = useState(false);
  const [chargeError, setChargeError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<{
    documentNumber: string;
    lines: CartLine[];
    total: number;
    change: number;
    offline: boolean;
  } | null>(null);
  const [queue, setQueue] = useState<QueuedInvoicePayload[]>(() => (deviceId ? loadQueue(deviceId) : []));
  const [syncing, setSyncing] = useState(false);

  const priceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const pli of priceListItems ?? []) m.set(pli.item_variant_id, Number(pli.price));
    return m;
  }, [priceListItems]);

  interface GridEntry {
    variantId: string;
    label: string;
    price: number;
    barcodes: string[];
  }
  const grid = useMemo<GridEntry[]>(() => {
    const out: GridEntry[] = [];
    for (const item of items ?? []) {
      if (!item.is_active) continue;
      for (const v of item.variants) {
        if (!v.is_active) continue;
        const detail = [v.color, v.size].filter(Boolean).join(" / ");
        out.push({
          variantId: v.id,
          label: `${item.name_en}${detail ? ` (${detail})` : ""}`,
          price: priceMap.get(v.id) ?? 0,
          barcodes: (v.barcodes ?? []).map((b) => b.barcode),
        });
      }
    }
    return out;
  }, [items, priceMap]);

  const barcodeMap = useMemo(() => {
    const m = new Map<string, GridEntry>();
    for (const g of grid) for (const b of g.barcodes) m.set(b, g);
    return m;
  }, [grid]);

  const filteredGrid = search.trim()
    ? grid.filter((g) => g.label.toLowerCase().includes(search.trim().toLowerCase()) || g.barcodes.some((b) => b.includes(search.trim())))
    : grid;

  function selectDevice(id: string) {
    localStorage.setItem(DEVICE_KEY, id);
    setDeviceId(id);
    setQueue(loadQueue(id));
  }

  function changeDevice() {
    localStorage.removeItem(DEVICE_KEY);
    setDeviceId(null);
    setCart([]);
  }

  function addToCart(entry: GridEntry) {
    setCart((prev) => {
      const existing = prev.find((l) => l.itemVariantId === entry.variantId);
      if (existing) {
        return prev.map((l) => (l.itemVariantId === entry.variantId ? { ...l, qty: l.qty + 1 } : l));
      }
      return [...prev, { itemVariantId: entry.variantId, label: entry.label, qty: 1, unitPrice: entry.price }];
    });
  }

  function updateQty(variantId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((l) => l.itemVariantId !== variantId));
      return;
    }
    setCart((prev) => prev.map((l) => (l.itemVariantId === variantId ? { ...l, qty } : l)));
  }

  function updatePrice(variantId: string, unitPrice: number) {
    setCart((prev) => prev.map((l) => (l.itemVariantId === variantId ? { ...l, unitPrice } : l)));
  }

  function removeLine(variantId: string) {
    setCart((prev) => prev.filter((l) => l.itemVariantId !== variantId));
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const trimmed = search.trim();
    if (!trimmed) return;
    const byBarcode = barcodeMap.get(trimmed);
    if (byBarcode) {
      addToCart(byBarcode);
      setSearch("");
      return;
    }
    if (filteredGrid.length === 1) {
      addToCart(filteredGrid[0]!);
      setSearch("");
    }
  }

  const total = cart.reduce((sum, l) => sum + l.qty * l.unitPrice, 0);
  const net = total / (1 + VAT_RATE / 100);
  const vat = total - net;
  const change = paymentMethod === "cash" ? Math.max(0, Number(tendered || 0) - total) : 0;

  async function flushQueue(currentQueue?: QueuedInvoicePayload[]) {
    if (!device) return;
    const q = currentQueue ?? queue;
    if (q.length === 0) return;
    setSyncing(true);
    try {
      const res = await apiRequest<{ results: SyncResult[] }>("/api/sync/push/invoices", {
        method: "POST",
        token,
        companyId,
        body: { deviceId: device.id, invoices: q },
      });
      const remaining = q.filter((inv) => {
        const result = res.results.find((r) => r.clientUuid === inv.clientUuid);
        return result ? result.status === "error" : true;
      });
      setQueue(remaining);
      saveQueue(device.id, remaining);
    } catch {
      // still offline or server unreachable; leave queue untouched
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    if (online && device) flushQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, device?.id]);

  async function charge() {
    if (!device || cart.length === 0 || !openPeriodId) return;
    setCharging(true);
    setChargeError(null);
    try {
      const nextSeq = loadSeq(device.id, Number(device.last_synced_invoice_seq ?? 0) + 1);
      const payload: QueuedInvoicePayload = {
        clientUuid: crypto.randomUUID(),
        deviceSequenceNumber: nextSeq,
        storeId: device.store_id,
        zatcaInvoiceCategory: "simplified",
        invoiceDate: new Date().toISOString().slice(0, 10),
        fiscalPeriodId: openPeriodId,
        customerId: customerId || null,
        lines: cart.map((l) => ({
          itemVariantId: l.itemVariantId,
          itemDescription: l.label,
          qty: l.qty,
          unitPrice: l.unitPrice,
          discountAmount: 0,
          vatRate: VAT_RATE,
          priceIncludesVat: true,
        })),
        payments: [{ paymentMethod, amount: paymentMethod === "cash" ? total : total }],
      };
      saveSeq(device.id, nextSeq + 1);

      if (online) {
        try {
          const res = await apiRequest<{ results: SyncResult[] }>("/api/sync/push/invoices", {
            method: "POST",
            token,
            companyId,
            body: { deviceId: device.id, invoices: [payload] },
          });
          const result = res.results[0]!;
          if (result.status === "error") {
            setChargeError(result.error ?? "Sale failed");
            return;
          }
          const detail = await apiRequest<{ document_number: string }>(`/api/sales-invoices/${result.id}`, { token, companyId });
          setReceipt({ documentNumber: detail.document_number, lines: cart, total, change, offline: false });
          setCart([]);
          setTendered("");
          return;
        } catch {
          // fall through to offline queue on network failure
        }
      }

      const newQueue = [...queue, payload];
      setQueue(newQueue);
      saveQueue(device.id, newQueue);
      setReceipt({
        documentNumber: `${device.series_prefix}INV-${String(nextSeq).padStart(6, "0")} (pending)`,
        lines: cart,
        total,
        change,
        offline: true,
      });
      setCart([]);
      setTendered("");
    } finally {
      setCharging(false);
    }
  }

  if (!deviceId) return <DevicePicker onSelected={selectDevice} />;
  if (!device) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-white">Loading device...</div>;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100">
      <header className="flex h-14 shrink-0 items-center gap-4 bg-slate-900 px-4 text-white">
        <div className="font-semibold">{device.device_name}</div>
        <div className="text-xs text-white/60">{device.series_prefix}</div>
        <div className="flex items-center gap-1.5 text-xs">
          {online ? <Wifi size={14} className="text-green-400" /> : <WifiOff size={14} className="text-red-400" />}
          {online ? "Online" : "Offline"}
        </div>
        {queue.length > 0 && (
          <button
            onClick={() => flushQueue()}
            disabled={syncing || !online}
            className="flex items-center gap-1 rounded-full bg-amber-500/20 px-2.5 py-1 text-xs font-medium text-amber-300 hover:bg-amber-500/30 disabled:opacity-50"
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} /> {queue.length} pending sync
          </button>
        )}
        <div className="ms-auto flex items-center gap-3">
          <button onClick={changeDevice} className="text-xs text-white/60 hover:text-white">
            Change Device
          </button>
          <button onClick={() => navigate("/")} className="text-xs text-white/60 hover:text-white">
            Back Office
          </button>
          <button onClick={() => logout()} className="flex items-center gap-1 text-xs text-white/60 hover:text-white">
            <LogOut size={13} /> Log out
          </button>
        </div>
      </header>

      {!openPeriodId && (
        <div className="bg-red-600 px-4 py-1.5 text-center text-xs font-medium text-white">
          No open fiscal period — sales cannot be posted right now.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* Product grid */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="mb-3 flex items-center rounded-lg border border-slate-300 bg-white px-3 py-2">
            <Search size={16} className="me-2 text-slate-400" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search item or scan barcode, then Enter..."
              className="w-full bg-transparent text-sm focus:outline-none"
            />
          </div>
          <div className="grid flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pb-4 sm:grid-cols-3 lg:grid-cols-4">
            {filteredGrid.map((g) => (
              <button
                key={g.variantId}
                onClick={() => addToCart(g)}
                className="flex flex-col items-start justify-between rounded-lg border border-slate-200 bg-white p-3 text-start shadow-sm hover:border-brand-400 hover:shadow-md"
              >
                <span className="text-sm font-medium text-slate-900">{g.label}</span>
                <span className="mt-2 text-sm font-semibold text-brand-600">{g.price.toFixed(2)}</span>
              </button>
            ))}
            {items && filteredGrid.length === 0 && (
              <div className="col-span-full flex flex-col items-center gap-2 p-12 text-slate-400">
                <ShoppingCart size={28} strokeWidth={1.5} />
                <p className="text-sm">No matching items.</p>
              </div>
            )}
          </div>
        </div>

        {/* Cart / checkout panel */}
        <div className="flex w-96 shrink-0 flex-col border-s border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-3">
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
            >
              <option value="">Walk-in Customer</option>
              {customers?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name_en}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {cart.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-slate-300">
                <ShoppingCart size={36} strokeWidth={1.5} />
                <p className="text-sm">Cart is empty</p>
              </div>
            ) : (
              <div className="space-y-2">
                {cart.map((l) => (
                  <div key={l.itemVariantId} className="rounded-md border border-slate-100 p-2.5">
                    <div className="mb-1.5 flex items-start justify-between gap-2">
                      <span className="text-sm font-medium text-slate-900">{l.label}</span>
                      <button onClick={() => removeLine(l.itemVariantId)} className="shrink-0 text-slate-300 hover:text-red-500">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => updateQty(l.itemVariantId, l.qty - 1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                        >
                          <Minus size={12} />
                        </button>
                        <span className="w-6 text-center text-sm tabular-nums">{l.qty}</span>
                        <button
                          onClick={() => updateQty(l.itemVariantId, l.qty + 1)}
                          className="flex h-6 w-6 items-center justify-center rounded border border-slate-300 text-slate-600 hover:bg-slate-50"
                        >
                          <Plus size={12} />
                        </button>
                      </div>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.unitPrice}
                        onChange={(e) => updatePrice(l.itemVariantId, Number(e.target.value))}
                        className="w-16 rounded border border-slate-200 px-1.5 py-0.5 text-end text-xs tabular-nums focus:border-brand-500 focus:outline-none"
                      />
                      <span className="w-16 text-end text-sm font-medium tabular-nums text-slate-900">{(l.qty * l.unitPrice).toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-200 p-3">
            <div className="mb-2 space-y-1 text-sm">
              <div className="flex justify-between text-slate-500">
                <span>Net</span>
                <span className="tabular-nums">{net.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-slate-500">
                <span>VAT ({VAT_RATE}%)</span>
                <span className="tabular-nums">{vat.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-base font-semibold text-slate-900">
                <span>Total</span>
                <span className="tabular-nums">{total.toFixed(2)}</span>
              </div>
            </div>

            <div className="mb-2 grid grid-cols-2 gap-1.5">
              <button
                onClick={() => setPaymentMethod("cash")}
                className={`rounded-md border px-2 py-1.5 text-sm font-medium ${
                  paymentMethod === "cash" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                }`}
              >
                Cash
              </button>
              <button
                onClick={() => setPaymentMethod("card")}
                className={`rounded-md border px-2 py-1.5 text-sm font-medium ${
                  paymentMethod === "card" ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                }`}
              >
                Card
              </button>
            </div>

            {paymentMethod === "cash" && (
              <div className="mb-2">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={tendered}
                  onChange={(e) => setTendered(e.target.value)}
                  placeholder="Amount tendered"
                  className="w-full rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none"
                />
                {Number(tendered || 0) > 0 && <p className="mt-1 text-xs text-slate-500">Change due: {change.toFixed(2)}</p>}
              </div>
            )}

            {chargeError && <p className="mb-2 text-xs text-red-600">{chargeError}</p>}

            <button
              onClick={charge}
              disabled={cart.length === 0 || charging || !openPeriodId || (paymentMethod === "cash" && Number(tendered || 0) < total)}
              className="w-full rounded-md bg-brand-500 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {charging ? "Charging..." : `Charge ${total.toFixed(2)}`}
            </button>
          </div>
        </div>
      </div>

      {receipt && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Receipt</h2>
              <button onClick={() => setReceipt(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>
            {receipt.offline && (
              <p className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">
                Saved offline — will sync automatically once this terminal is back online.
              </p>
            )}
            <p className="mb-2 font-mono text-xs text-slate-500">{receipt.documentNumber}</p>
            <div className="mb-3 space-y-1 border-y border-dashed border-slate-200 py-2 text-sm">
              {receipt.lines.map((l) => (
                <div key={l.itemVariantId} className="flex justify-between">
                  <span className="text-slate-600">
                    {l.label} × {l.qty}
                  </span>
                  <span className="tabular-nums">{(l.qty * l.unitPrice).toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="mb-4 flex justify-between text-base font-semibold text-slate-900">
              <span>Total</span>
              <span className="tabular-nums">{receipt.total.toFixed(2)}</span>
            </div>
            {receipt.change > 0 && (
              <div className="mb-4 flex justify-between text-sm text-slate-500">
                <span>Change</span>
                <span className="tabular-nums">{receipt.change.toFixed(2)}</span>
              </div>
            )}
            <button
              onClick={() => setReceipt(null)}
              className="w-full rounded-md bg-brand-500 py-2 text-sm font-medium text-white hover:bg-brand-600"
            >
              New Sale
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
