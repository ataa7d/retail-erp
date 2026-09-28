-- Customer deposits / advance payments: money received from a customer
-- before any invoice exists (a custom order, layaway, a B2B advance) --
-- genuinely absent before this. Unapplied customer_receipts (migration
-- 0038) technically leave a credit balance sitting in the AR control
-- account, but that's an incidental side effect of optional allocations,
-- not a real deposit mechanism: it's accounting-wrong (a customer credit
-- balance should sit in a dedicated liability, not comingled with debtor
-- balances) and there's no way to apply an old unapplied receipt to a
-- brand-new invoice.
--
-- Modeled to mirror gift_cards (0071) and loyalty_points (0072) exactly --
-- a customer deposit is issued (Dr Cash/Card, Cr Customer Deposits
-- Liability), then applied to a real invoice as a POS payment method
-- exactly like a gift card, debiting the liability instead of cash
-- because applying it isn't new cash in. The one structural difference
-- from a gift card: a deposit is tied to one specific customer (not a
-- bearer instrument), so applying it also checks the invoice's customer
-- matches.
--
-- ALTER TYPE ... ADD VALUE cannot be used in the same transaction as the
-- new value itself, so this migration only adds the enum value and new
-- schema -- nothing here inserts a 'deposit' row.
ALTER TYPE payment_method_type ADD VALUE 'deposit';

CREATE TABLE customer_deposits (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id),
  store_id       UUID NOT NULL REFERENCES stores(id),
  customer_id    UUID NOT NULL REFERENCES customers(id),
  document_number TEXT NOT NULL,
  reference      TEXT, -- free text, e.g. "custom order #123" -- not a bearer code like a gift card
  initial_value  NUMERIC(14,2) NOT NULL CHECK (initial_value > 0),
  balance        NUMERIC(14,2) NOT NULL CHECK (balance >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'consumed', 'refunded')),
  deposit_date   DATE NOT NULL,
  journal_id     UUID REFERENCES journals(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     UUID REFERENCES users(id),
  UNIQUE (company_id, document_number),
  CHECK (balance <= initial_value)
);

CREATE INDEX idx_customer_deposits_company ON customer_deposits(company_id);
CREATE INDEX idx_customer_deposits_customer ON customer_deposits(customer_id);

CREATE TABLE customer_deposit_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          UUID NOT NULL REFERENCES companies(id),
  customer_deposit_id UUID NOT NULL REFERENCES customer_deposits(id),
  transaction_type    TEXT NOT NULL CHECK (transaction_type IN ('deposit', 'apply')),
  amount              NUMERIC(14,2) NOT NULL, -- signed: +deposit, -apply
  balance_after       NUMERIC(14,2) NOT NULL CHECK (balance_after >= 0),
  sales_invoice_id    UUID REFERENCES sales_invoices(id), -- set only for 'apply'
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by          UUID REFERENCES users(id)
);

CREATE INDEX idx_customer_deposit_transactions_company ON customer_deposit_transactions(company_id);
CREATE INDEX idx_customer_deposit_transactions_deposit ON customer_deposit_transactions(customer_deposit_id);

CREATE OR REPLACE FUNCTION check_customer_deposit_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  SELECT company_id INTO ref_company_id FROM customers WHERE id = NEW.customer_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'customer % does not belong to company %', NEW.customer_id, NEW.company_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_deposits_check_refs
  BEFORE INSERT OR UPDATE ON customer_deposits
  FOR EACH ROW EXECUTE FUNCTION check_customer_deposit_refs_company();

CREATE OR REPLACE FUNCTION check_customer_deposit_transaction_refs()
RETURNS TRIGGER AS $$
DECLARE
  v_deposit_company_id UUID;
BEGIN
  SELECT company_id INTO v_deposit_company_id FROM customer_deposits WHERE id = NEW.customer_deposit_id;
  IF v_deposit_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'customer deposit % does not belong to company %', NEW.customer_deposit_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_deposit_transactions_check_refs
  BEFORE INSERT ON customer_deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION check_customer_deposit_transaction_refs();

-- Append-only ledger, same reasoning as gift_card_transactions/
-- loyalty_points_transactions.
CREATE OR REPLACE FUNCTION check_customer_deposit_transaction_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'customer deposit transactions are append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_customer_deposit_transactions_immutable
  BEFORE UPDATE OR DELETE ON customer_deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION check_customer_deposit_transaction_immutable();

CREATE TRIGGER trg_customer_deposits_audit
  AFTER INSERT OR UPDATE OR DELETE ON customer_deposits
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_customer_deposit_transactions_audit
  AFTER INSERT OR UPDATE OR DELETE ON customer_deposit_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'record_customer_deposit', 'sales.deposit.record', 'Record and refund customer deposits');
