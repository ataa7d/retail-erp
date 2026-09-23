# Retail ERP

Multi-company, multi-store retail ERP for Saudi Arabia (ZATCA e-invoicing,
15%/5% VAT, Arabic + English, offline-capable POS). Built incrementally,
phase by phase — see the top-level project plan for the full roadmap.

Stack: PostgreSQL 16, Node.js/TypeScript, Kysely (typed SQL, not a heavy
ORM), plain numbered SQL migrations.

## Phase 1 — Foundation (done)

Companies, branches, stores, users, roles/permissions, number sequences,
audit log, chart of accounts, fiscal periods.

## Phase 2 — Master data (done)

Units of measure, brands, categories, seasons, tax codes, items with
color/size variants and multi-unit barcodes, customers, suppliers, price
lists.

## Phase 3 — Money engine + posting engine + tests (current)

`src/money.ts`: pure net/vat/gross calculation (`calculateLineAmounts`) and
header-charge allocation (`allocateAmount`), the single place every module
computes money from raw inputs.

`fn_amounts_balance()`: the reusable CHECK predicate every Phase 4+
document-line table will use for rule A's `net + vat = gross` invariant.

`journals` / `journal_lines`: the one posting engine every subledger routes
through. Balance, period-open, and immutability are enforced by a trigger on
`journals`, not by a callable function that could be bypassed — see
migrations 0018-0020.

## Phase 4 — Sales: POS invoice, wholesale invoice, credit note (current)

`sales_invoices` / `sales_invoice_lines` / `sales_invoice_payments`: covers
both POS and wholesale sales in one table set (`invoice_channel`). Header
totals are structurally impossible to disagree with `SUM(lines)` — see
migration 0021. Posting requires the GL journal to already be posted in the
same transaction, and for POS sales, the payment breakdown to fully cover
the total.

`credit_notes` / `credit_note_lines`: Phase 4's sales-return/credit-note
document, always tied to an original invoice line via `source_line_id`,
always recalculated fresh from its own qty/price (never scaled from the
original), and blocked from returning more than was sold — checked at
posting time so two concurrently-drafted credit notes against the same line
race safely. No separate `sales_returns` table this phase — see the
design note in conversation history if you want to split the operational
return from the financial document later.

`src/sales/salesService.ts`: the TypeScript service that builds these
documents and their GL postings in one transaction. Not yet wired to an
HTTP API — no Fastify server exists yet in this repo.

## Phase 5 — Inventory: movements, valuation, transfers, adjustments,
stocktake (current)

Costing method: **weighted average**, chosen over FIFO for simplicity (no
cost-lot tracking needed).

`stock_movements`: the append-only ledger, signed qty (+in/-out). Current
stock is always `SUM(qty)`, never a counter. `stock_balances` is a
trigger-maintained cache (migration 0025) — outgoing movements are always
costed at the running average regardless of what the caller passes;
incoming movements keep an explicit cost when given (transfers, returns) or
default to the average (stocktake finds, opening balances).
`fn_rebuild_stock_balance()` independently replays the full ledger for
reconciliation.

`transferStock()`: two linked movements conserving total quantity, the
destination inheriting the exact cost the goods left the source at.

`stocktakes`/`stocktake_lines`: snapshot → count → `postStocktake()` posts
`stocktake_variance` movements and a shrinkage/found-stock journal entry
against Inventory Adjustments.

**Phase 4 integration**: `postSalesInvoice`/`postCreditNote` (in
`src/sales/salesService.ts`) now issue/return stock and book COGS in the
*same* journal as revenue/VAT — a sale wasn't matching COGS to revenue
before this phase existed, which would have misstated margin, so this
wasn't deferred to Phase 7.

All journals across every module share one numbering series
(`document_type = 'journal'`, prefix `GJ-`) — a single general-journal
voucher sequence, not one per source module.

## Phase 6 — Purchasing: PO → goods receipt → supplier invoice, 3-way
match, landed cost, purchase returns (current)

The accrual chain: `purchase_orders` (a commitment, never posts a GL
journal) → `goods_receipts` (accrues `Dr Inventory / Cr GRNI` at the PO
price plus any landed cost, creates `stock_movements`) → `supplier_invoices`
(clears GRNI, books `Purchase Price Variance` if the invoice price differs
from the GR's base cost within `companies.po_price_tolerance_percent`,
claims input VAT, credits `Accounts Payable`) → `supplier_credit_notes`
(reverses AP/inventory/VAT for a post-invoice return).

**Landed cost** (freight/customs/COC) is entered as charge rows on the
goods receipt *before* it posts and allocated across lines by value or
weight (`allocateAmount()`), folded into `unit_cost` before the stock
movement is created — never applied retroactively to stock that might
already have sold.

**Three-way match tolerances** (`po_qty_tolerance_percent`,
`po_price_tolerance_percent`) are company-level settings, checked at the
moment of receiving (quantity) and invoicing (price) — the authoritative
check lives on the posting transition, same pattern as journal balance and
credit-note quantity elsewhere in this schema.

New accounts: `1140` VAT Input Receivable, `2120` GRNI, `2130` Accounts
Payable, `2140` Landed Cost Accrual, `5120` Purchase Price Variance.

`supplier_item_prices` (per-supplier cost/lead-time/MOQ) and
`import_documents` (COC/certificate-of-origin/customs declaration against a
shipment) round out the module.

**Two bugs caught and fixed during this phase, both from the same root
cause** — `purchase_order_lines.received_qty` is system-maintained and
legitimately needs to update *after* the PO is posted/approved (that's the
point of receiving), but the line-immutability and header-touch triggers
both assumed "posted PO = fully frozen." Fixed by exempting `received_qty`
specifically from line immutability, and by skipping the header recompute
touch when only `received_qty` changed (it never affects header money
totals). See migrations 0034-0035.

## Phase 7 — GL, AR/AP, payments, bank reconciliation, period close (current)

`customer_receipts`/`supplier_payments` (+ `*_allocations`): documents like
any other — draft → posted with a GL journal (`Dr Bank/Cash, Cr AR` or
`Dr AP, Cr Bank/Cash`), immutable once posted. Allocation to a specific
invoice is tracked separately from the GL posting — a receipt can post
fully unallocated (unapplied cash) since the AR/AP account balance is
correct either way.

`ar_ageing`/`ap_ageing` views compute "amount still open" from stored
invoice/allocation amounts only (a POS invoice is only AR-exposed for
whatever portion was paid `payment_method = 'credit'`; a wholesale invoice
for its full gross).

`bank_accounts` each map to their own GL leaf account (not shared) so
reconciliation is meaningful. `bank_reconciliations` posting validates that
the running total of every reconciled statement line up to the statement
date ties to the declared ending balance — a documented simplification,
not full outstanding-items reconciliation theory.

**Period close** was mostly already enforced by Phase 3's posting trigger
(closed periods reject posting); this phase adds the formal close
operation itself: sequential closing (can't close March before February),
a guard against closing a period with draft journals still dated in it,
and who/when. **Fiscal year close** additionally generates closing entries
zeroing every revenue/expense account into a new `3100` Retained Earnings
account, posted into the year's last period while it's still open (avoids
needing a dedicated "period 13") — then that period and the year both
close.

Cost centres (`cost_centres`, tagged via `journal_lines.cost_center_id`)
round out the module as a reporting dimension with no change to posting
logic.

## HTTP API (built ahead of Phase 8)

A Fastify server (`src/api/`) sits in front of the service layer built in
Phases 4-7. This is infrastructure, not a phase — it exists because Phase 8
(offline POS + sync) needs a real server to sync against.

- **Auth**: `POST /api/auth/login` (bcrypt + JWT, 12h expiry). Every other
  route requires `Authorization: Bearer <token>` and an `X-Company-Id`
  header, checked against `user_company_access` — a valid token alone
  doesn't grant access to a company, and a company header alone without a
  token grants nothing.
- **Permissions**: routes that mutate data require a specific permission
  code from the Phase 1 catalog (`app.requirePermission('sales.pos_invoice.create')`),
  checked via `user_roles` → `role_permissions` → `permissions` for the
  authenticated user *in that company*.
- **One DB transaction per write request** (`withTransaction` in
  `src/api/db.ts`), which also sets `app.current_user_id` via
  `set_config()` so `fn_audit_trigger` attributes every change to the
  actual actor — not a literal `SET`, since `SET` doesn't accept bind
  parameters.
- **Master data reads** (`GET /api/items`, `/api/customers`,
  `/api/price-lists`) support `?updatedSince=` — what Phase 8's "master
  data syncs one way, down" will pull against.
- **Stock reads** (`GET /api/stock-balances`) return an explicit `asOf`
  timestamp — the "last known, clearly marked as such" stock view an
  offline client would cache.
- **Sales invoices and credit notes** get full create/fetch/post routes as
  the representative document flow; the same pattern (thin Zod-validated
  route → service function → one transaction) extends to inventory,
  purchasing, and accounting routes not yet wired up.
- Errors are mapped centrally: `HttpError` subclasses → their status code,
  Zod validation failures → 400 with details, Postgres SQLSTATEs from
  trigger-raised business-rule violations (`P0001`) → 400, unique/FK/check
  violations → 409/400/400, anything else → 500 (logged, not leaked).

**Security note**: `@fastify/jwt` was initially installed at a version
pulling in `fast-jwt` with several critical CVEs (JWT algorithm confusion,
auth bypass via empty HMAC secret, ReDoS). Caught by `npm audit` before any
auth code was written; pinned to `^10.2.2` instead. `npm audit --omit=dev`
is clean.

Run it: `npm run dev` (or `npm run migrate && npm run seed` first if the
database is fresh). Requires `JWT_SECRET` in `.env` — see `.env.example`.

## Phase 8 — Offline POS + sync engine

**The core design decision (the user's call, since it's a ZATCA-compliance
question, not just an engineering one):** each POS device gets its own
**permanent, non-resetting document series** — `ST01-POS1-INV-000001`,
`ST01-POS1-CN-000001`, ... — instead of drawing from the company-wide
`number_sequences` series everything else uses. This is what lets a device
assign a final, real invoice number while completely offline, with zero
round trip to the server: the number is permanent the instant it's
assigned, so there's never a "temp number becomes the real number" step
that could desync from what the customer was actually handed at sale time.
A device's series is registered once (`pos_devices.series_prefix`) and is
then immutable for that device for as long as it has issued anything —
see the trigger in `migrations/0043_pos_devices_and_sync.sql`.

Only `zatca_invoice_category = 'simplified'` invoices/credit notes may
carry a device's number — a standard tax invoice must be cleared before the
customer receives it, so it can never be issued offline (rule already noted
in the Phase 4 section above); this is enforced by a DB trigger, not just
client discipline.

**`src/sync/syncService.ts`** (`syncPosInvoice`, `syncPosCreditNote`) is
where an offline-created document becomes a real, posted one:

- **Idempotency**: every offline document carries a client-generated
  `clientUuid`. A sync retry (dropped connection, ambiguous response) is
  detected by that UUID and returns the already-created document instead of
  erroring or duplicating it.
- **Sequence integrity**: the device already assigned itself the number
  while offline; the server never generates one, only validates it. The
  claimed `deviceSequenceNumber` must be exactly
  `pos_device_sequences.last_synced_seq + 1` for that device — a gap or an
  out-of-order replay is rejected with a clear error, not silently
  absorbed. Because the claim and the document creation happen in the same
  transaction, a rejected sync (e.g. wrong zatca category) never advances
  the counter — the device's next real number stays syncable.
- This does mean a device must sync its own documents **in the order it
  created them**. A documented constraint, not an oversight.

**`POST /api/sync/push/invoices`** and **`POST /api/sync/push/credit-notes`**
take a batch (`{ deviceId, invoices: [...] }`); each item syncs in its
**own** transaction and gets its own result (`synced` / `already_synced` /
`error`) — one bad record in a batch never rolls back the others that
already synced cleanly.

**`GET /api/sync/pull?storeId=&since=`** is a single consolidated pull of
what a device needs to refresh its local cache: items (true `since` delta,
reusing the Phase 7 `updated_at` support), customers and price lists (full
pull each time — they don't carry `updated_at` yet, a documented limitation
not fixed in this phase), and a labeled stock-balance snapshot for the
store. All under one `serverTime` so the client knows what to pass as
`since` next time.

**`POST /api/pos-devices`** / **`GET /api/pos-devices`** /
**`POST /api/pos-devices/:id/retire`** manage device registration, gated
behind the new `sales.pos_device.manage` permission. Pushing offline
documents reuses the existing `sales.pos_invoice.create` /
`sales.return.create` permissions from the Phase 1 catalog — syncing an
offline sale is still "creating a sales invoice," just via a different
route.

## Phase 9 — Fixed assets, HR/payroll, reporting, administration

**Fixed assets** (`src/assets/fixedAssetService.ts`): straight-line
depreciation only. Acquisition assumes a direct cash purchase (`Dr Fixed
Asset / Cr Cash`) — capitalizing a supplier invoice line to an asset
account instead of expense/inventory would extend
`src/purchasing/purchasingService.ts` and isn't built here.
`depreciation_runs` is a document like any other (draft → posted, one GL
journal), one per fiscal period; posting computes each active asset's
monthly depreciation itself (capped so `accumulated_depreciation` never
exceeds `cost - salvage_value`) and aggregates the journal by
**asset_category**, not one line per asset, so the GL stays readable.
Disposal books the removal of cost and accumulated depreciation, cash
proceeds, and a gain/loss plug against `4200`/`5210`, then freezes the
asset permanently — a DB trigger blocks any further change once
`status = 'disposed'`.

One implementation bug worth noting because it's a real Postgres gotcha,
not a logic error: the first cut of `fn_balance_sheet` failed with
*"structure of query does not match function result type"* because
`chart_of_accounts.account_type` is a Postgres ENUM, and `plpgsql`'s
`RETURN QUERY` enforces exact column-type matches against the function's
`RETURNS TABLE` signature — unlike a plain `LANGUAGE sql` function, which
tolerates the implicit enum-to-text assignment cast. Fixed with an explicit
`::TEXT` cast in `migrations/0048_fix_reporting_account_type_cast.sql`
(migrations are immutable once applied, so this is a new forward migration
correcting 0047, not an edit to it).

**HR/payroll** (`src/hr/hrService.ts`, `src/hr/payrollService.ts`):
employees are master data (salary components + GOSI rates stored
per-employee, since Saudi-national vs. non-Saudi GOSI treatment differs and
rates change over time — a company-wide constant would be wrong sooner or
later). `payroll_runs` follows the same one-per-fiscal-period,
draft→posted, one-aggregated-journal pattern as depreciation runs
(`Dr Salaries Expense, Dr GOSI Expense (employer) / Cr GOSI Payable, Cr
Salaries Payable`). GOSI is computed on `basic_salary` only, a
simplification — real Saudi GOSI rules compute it on basic + housing for
Saudi nationals, which would need per-nationality logic not built here.
Disbursing the net salaries payable (and the depreciation/payroll
equivalent of a supplier payment) is out of scope for this phase.

**Reporting** (`migrations/0047_reporting.sql`,
`src/api/routes/reports.ts`): trial balance, income statement, and balance
sheet as parameterized SQL functions (`fn_trial_balance`,
`fn_income_statement`, `fn_balance_sheet`) built directly over
`journal_lines` — the same ledger every module posts through, so there's no
separate reporting datastore that could drift from GL truth. All three only
ever look at `document_status = 'posted'` journals. The balance sheet
includes a computed `CURRENT_EARNINGS` equity row for the still-open fiscal
year's net income — without it, assets = liabilities + equity would only
hold immediately after `closeFiscalYear` runs (Phase 7), not on any other
date, since revenue/expense accounts sit unclosed all year.

**Administration** (`src/api/routes/admin.ts`): read-only routes over what
Phase 1 already built — `GET /api/admin/users` (company-scoped, with
roles), `GET /api/admin/roles` (with their permission codes), `GET
/api/admin/audit-log` (filterable by table and since-timestamp). No new
schema; just wiring the existing `admin.*` permissions to HTTP.

New permissions: `assets.fixed_asset.manage`, `assets.depreciation.post`,
`hr.employee.manage`, `hr.payroll.post`, `accounting.reports.view`.

This completes the originally planned 9-phase build. Two design questions
raised during Phases 4 and 8 were never revisited and were treated as
decided by inaction: `credit_notes` stayed a single document rather than
splitting into separate operational/financial documents, and reporting was
built as real, always-current SQL functions now rather than deferred.

## Getting started

```bash
cd docker && docker compose up -d
cd ..
copy .env.example .env
npm install
npm run migrate
npm run seed
npm test
```

`npm run migrate:status` shows which migration files have been applied.
There is no `migrate:down` — corrections are new forward migrations, never
edits to an already-applied file (once a migration has run anywhere, it's
immutable, same principle as a posted document).

Demo login after `npm run seed`: `admin@demo.local` / `ChangeMe123!`
