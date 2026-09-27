-- Loyalty points: 'points' has been a valid POS payment method since
-- migration 0022, and customers.is_loyalty_member/loyalty_card_number have
-- existed since migration 0015, but nothing ever connected them -- a
-- cashier could accept "points" as tender with no balance ever earned or
-- checked. This adds a real points ledger, mirroring the gift card build
-- (migration 0071) in shape: earn posts its own accrual journal, redeem
-- draws down the same liability account inside the invoice's own journal.
--
-- Earning is scoped to customers.is_loyalty_member = true -- not every POS
-- sale with a customer attached should accrue points, only ones for
-- customers actually enrolled in the program. This also means existing
-- test/demo customers (which default to not-a-member) never trigger
-- accrual, so the new GL accounts below are only ever required for a
-- company that actually has an enrolled member buying something.

ALTER TABLE customers ADD COLUMN loyalty_points_balance INTEGER NOT NULL DEFAULT 0 CHECK (loyalty_points_balance >= 0);

CREATE TABLE loyalty_points_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  customer_id       UUID NOT NULL REFERENCES customers(id),
  transaction_type  TEXT NOT NULL CHECK (transaction_type IN ('earn', 'redeem')),
  points            INTEGER NOT NULL CHECK (
    (transaction_type = 'earn' AND points > 0) OR (transaction_type = 'redeem' AND points < 0)
  ),
  balance_after     INTEGER NOT NULL CHECK (balance_after >= 0),
  sales_invoice_id  UUID REFERENCES sales_invoices(id),
  journal_id        UUID REFERENCES journals(id), -- set only for 'earn' (its own accrual journal); redeem rides the invoice's own journal
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id)
);

CREATE INDEX idx_loyalty_points_transactions_company ON loyalty_points_transactions(company_id);
CREATE INDEX idx_loyalty_points_transactions_customer ON loyalty_points_transactions(customer_id);

CREATE OR REPLACE FUNCTION check_loyalty_points_transaction_refs()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_company_id UUID;
BEGIN
  SELECT company_id INTO v_customer_company_id FROM customers WHERE id = NEW.customer_id;
  IF v_customer_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'customer % does not belong to company %', NEW.customer_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_loyalty_points_transactions_check_refs
  BEFORE INSERT ON loyalty_points_transactions
  FOR EACH ROW EXECUTE FUNCTION check_loyalty_points_transaction_refs();

-- Append-only ledger, same reasoning as gift_card_transactions.
CREATE OR REPLACE FUNCTION check_loyalty_points_transaction_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'loyalty points transactions are append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_loyalty_points_transactions_immutable
  BEFORE UPDATE OR DELETE ON loyalty_points_transactions
  FOR EACH ROW EXECUTE FUNCTION check_loyalty_points_transaction_immutable();

CREATE TRIGGER trg_loyalty_points_transactions_audit
  AFTER INSERT OR UPDATE OR DELETE ON loyalty_points_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();
