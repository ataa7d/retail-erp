-- Multi-currency import purchasing.
--
-- Model: every purchasing document keeps its amounts in its own
-- *transaction* currency (what the supplier actually quotes/invoices --
-- USD 1,000 is owed, not "SAR 3,750-ish"), plus a snapshot of the exchange
-- rate used on that document's date. The GL is always in the company's base
-- currency; each posting translates at its own document's rate:
--   goods receipt   -> inventory + GRNI at the receipt-date rate
--   supplier invoice-> AP at the invoice-date rate; the GRNI accrued at the
--                      receipt rate is cleared exactly, and the rate change
--                      between receipt and invoice is a realized FX
--                      difference (never mixed into purchase price variance)
--   supplier payment-> AP relieved at each invoice's own rate, bank credited
--                      at the payment-date rate, difference = realized FX
-- A base-currency document simply has exchange_rate = 1, so every existing
-- SAR flow is unchanged.

-- Rate = how many units of the company's base currency one unit of
-- `currency` buys on `rate_date` (e.g. USD -> 3.75 for a SAR company).
CREATE TABLE exchange_rates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL REFERENCES companies(id),
  currency    TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  rate_date   DATE NOT NULL,
  rate        NUMERIC(18,8) NOT NULL CHECK (rate > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID REFERENCES users(id),
  UNIQUE (company_id, currency, rate_date)
);

CREATE INDEX idx_exchange_rates_lookup ON exchange_rates(company_id, currency, rate_date DESC);

CREATE OR REPLACE FUNCTION check_exchange_rate_not_base()
RETURNS TRIGGER AS $$
DECLARE
  v_base TEXT;
BEGIN
  SELECT base_currency INTO v_base FROM companies WHERE id = NEW.company_id;
  IF NEW.currency = v_base THEN
    RAISE EXCEPTION 'no exchange rate is needed for the base currency %', v_base;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_exchange_rates_check_not_base
  BEFORE INSERT OR UPDATE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION check_exchange_rate_not_base();

CREATE TRIGGER trg_exchange_rates_audit
  AFTER INSERT OR UPDATE OR DELETE ON exchange_rates
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

-- Supplier's default invoicing currency (pre-fills new POs).
ALTER TABLE suppliers ADD COLUMN currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE purchase_orders
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);

ALTER TABLE goods_receipts
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);

ALTER TABLE supplier_invoices
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  -- Base-currency amounts as actually booked to the GL, fixed at posting.
  ADD COLUMN base_net_amount NUMERIC(14,2),
  ADD COLUMN base_vat_amount NUMERIC(14,2),
  ADD COLUMN base_gross_amount NUMERIC(14,2);

ALTER TABLE supplier_payments
  ADD COLUMN currency TEXT NOT NULL DEFAULT 'SAR' CHECK (currency ~ '^[A-Z]{3}$'),
  ADD COLUMN exchange_rate NUMERIC(18,8) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),
  ADD COLUMN base_amount NUMERIC(14,2);

-- goods_receipt_lines.base_unit_cost stays in the receipt's transaction
-- currency (it's what the supplier invoice's price is matched against --
-- apples to apples). base_currency_unit_cost is that same merchandise cost
-- translated at the receipt rate; unit_cost (merchandise + landed cost) is
-- the inventory valuation and therefore always base currency.
ALTER TABLE goods_receipt_lines ADD COLUMN base_currency_unit_cost NUMERIC(14,4) CHECK (base_currency_unit_cost >= 0);

-- Backfill: everything before this migration was in the company's base
-- currency at rate 1. Immutability triggers would reject touching posted
-- rows, so bypass them for this one-time backfill only.
SET app.bypass_immutability = 'true';

UPDATE suppliers s SET currency = c.base_currency FROM companies c WHERE c.id = s.company_id;
UPDATE purchase_orders d SET currency = c.base_currency FROM companies c WHERE c.id = d.company_id;
UPDATE goods_receipts d SET currency = c.base_currency FROM companies c WHERE c.id = d.company_id;
UPDATE supplier_invoices d SET currency = c.base_currency FROM companies c WHERE c.id = d.company_id;
UPDATE supplier_payments d SET currency = c.base_currency FROM companies c WHERE c.id = d.company_id;
-- check_goods_receipt_line re-validates received qty against the PO on any
-- UPDATE, and received_qty already includes these very lines -- it would
-- count them twice. Nothing about quantity changes here.
ALTER TABLE goods_receipt_lines DISABLE TRIGGER trg_goods_receipt_lines_check;
UPDATE goods_receipt_lines SET base_currency_unit_cost = base_unit_cost;
ALTER TABLE goods_receipt_lines ENABLE TRIGGER trg_goods_receipt_lines_check;
UPDATE supplier_invoices
  SET base_net_amount = net_amount, base_vat_amount = vat_amount, base_gross_amount = gross_amount
  WHERE document_status = 'posted';
UPDATE supplier_payments SET base_amount = amount WHERE document_status = 'posted';

RESET app.bypass_immutability;

-- A base-currency document must carry rate exactly 1; a foreign one must
-- be the same currency as the PO it belongs to (you can't receive or be
-- invoiced in euros against a dollar order).
CREATE OR REPLACE FUNCTION check_purchasing_document_currency()
RETURNS TRIGGER AS $$
DECLARE
  v_base TEXT;
  v_po_currency TEXT;
BEGIN
  SELECT base_currency INTO v_base FROM companies WHERE id = NEW.company_id;
  IF NEW.currency = v_base AND NEW.exchange_rate <> 1 THEN
    RAISE EXCEPTION '% is the base currency; its exchange rate must be 1, not %', v_base, NEW.exchange_rate;
  END IF;

  IF TG_TABLE_NAME IN ('goods_receipts', 'supplier_invoices') THEN
    SELECT currency INTO v_po_currency FROM purchase_orders WHERE id = NEW.purchase_order_id;
    IF NEW.currency IS DISTINCT FROM v_po_currency THEN
      RAISE EXCEPTION '% currency % does not match its purchase order currency %', TG_TABLE_NAME, NEW.currency, v_po_currency;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_purchase_orders_check_currency
  BEFORE INSERT OR UPDATE ON purchase_orders
  FOR EACH ROW EXECUTE FUNCTION check_purchasing_document_currency();

CREATE TRIGGER trg_goods_receipts_check_currency
  BEFORE INSERT OR UPDATE ON goods_receipts
  FOR EACH ROW EXECUTE FUNCTION check_purchasing_document_currency();

CREATE TRIGGER trg_supplier_invoices_check_currency
  BEFORE INSERT OR UPDATE ON supplier_invoices
  FOR EACH ROW EXECUTE FUNCTION check_purchasing_document_currency();

CREATE TRIGGER trg_supplier_payments_check_currency
  BEFORE INSERT OR UPDATE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION check_purchasing_document_currency();

-- Allocations are in the payment's currency, so the invoice must be too
-- (a USD invoice is settled with USD; a SAR bank transfer buying those
-- dollars is recorded as a USD payment at that day's rate).
CREATE OR REPLACE FUNCTION check_supplier_payment_allocation_currency()
RETURNS TRIGGER AS $$
DECLARE
  v_payment_currency TEXT;
  v_invoice_currency TEXT;
BEGIN
  SELECT currency INTO v_payment_currency FROM supplier_payments WHERE id = NEW.supplier_payment_id;
  SELECT currency INTO v_invoice_currency FROM supplier_invoices WHERE id = NEW.supplier_invoice_id;
  IF v_payment_currency IS DISTINCT FROM v_invoice_currency THEN
    RAISE EXCEPTION 'payment currency % cannot settle invoice in %', v_payment_currency, v_invoice_currency;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Named to sort (and so fire) before trg_supplier_payment_allocations_check:
-- a currency mismatch is the more fundamental error and should be the one
-- reported, not a misleading "exceeds open amount" in mismatched units.
CREATE TRIGGER trg_supplier_payment_allocations_a_currency
  BEFORE INSERT OR UPDATE ON supplier_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION check_supplier_payment_allocation_currency();

-- AP open items/ageing now carry the invoice currency: open_amount is in
-- that currency (what is actually still owed to the supplier). New columns
-- go at the end so CREATE OR REPLACE VIEW is allowed.
CREATE OR REPLACE VIEW ap_open_items AS
SELECT
  si.id AS supplier_invoice_id,
  si.company_id,
  si.supplier_id,
  si.document_number,
  si.invoice_date,
  si.gross_amount AS ap_original_amount,
  COALESCE((
    SELECT SUM(spa.allocated_amount) FROM supplier_payment_allocations spa
    JOIN supplier_payments sp ON sp.id = spa.supplier_payment_id
    WHERE spa.supplier_invoice_id = si.id AND sp.document_status = 'posted'
  ), 0) AS allocated_amount,
  si.currency,
  si.exchange_rate
FROM supplier_invoices si
WHERE si.document_status = 'posted';

CREATE OR REPLACE VIEW ap_ageing AS
SELECT
  oi.supplier_invoice_id,
  oi.company_id,
  oi.supplier_id,
  oi.document_number,
  oi.invoice_date,
  s.payment_terms_days,
  (oi.invoice_date + (s.payment_terms_days || ' days')::interval)::date AS due_date,
  (oi.ap_original_amount - oi.allocated_amount) AS open_amount,
  GREATEST(0, CURRENT_DATE - (oi.invoice_date + (s.payment_terms_days || ' days')::interval)::date) AS days_overdue,
  CASE
    WHEN CURRENT_DATE <= (oi.invoice_date + (s.payment_terms_days || ' days')::interval)::date THEN 'current'
    WHEN CURRENT_DATE - (oi.invoice_date + (s.payment_terms_days || ' days')::interval)::date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - (oi.invoice_date + (s.payment_terms_days || ' days')::interval)::date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - (oi.invoice_date + (s.payment_terms_days || ' days')::interval)::date <= 90 THEN '61-90'
    ELSE '90+'
  END AS ageing_bucket,
  oi.currency
FROM ap_open_items oi
JOIN suppliers s ON s.id = oi.supplier_id
WHERE (oi.ap_original_amount - oi.allocated_amount) > 0;

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'manage_exchange_rates', 'accounting.exchange_rate.manage', 'Maintain foreign-currency exchange rates');
