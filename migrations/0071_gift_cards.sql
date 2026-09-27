-- Gift cards: the 'gift_card' payment method has been a valid POS tender
-- type since migration 0022, but nothing ever backed it -- a cashier could
-- accept "gift card" with no card actually existing and no balance check.
-- This adds real issuance and redemption, with its own GL liability account
-- (a gift card sale is not revenue until redeemed).

CREATE TABLE gift_cards (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     UUID NOT NULL REFERENCES companies(id),
  store_id       UUID NOT NULL REFERENCES stores(id),
  card_number    TEXT NOT NULL,
  initial_value  NUMERIC(14,2) NOT NULL CHECK (initial_value > 0),
  balance        NUMERIC(14,2) NOT NULL CHECK (balance >= 0),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'redeemed', 'cancelled')),
  customer_id    UUID REFERENCES customers(id),
  expires_at     DATE,
  journal_id     UUID REFERENCES journals(id),
  issued_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  issued_by      UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id, card_number),
  CHECK (balance <= initial_value)
);

CREATE INDEX idx_gift_cards_company ON gift_cards(company_id);
CREATE INDEX idx_gift_cards_customer ON gift_cards(customer_id);

CREATE TABLE gift_card_transactions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES companies(id),
  gift_card_id      UUID NOT NULL REFERENCES gift_cards(id),
  transaction_type  TEXT NOT NULL CHECK (transaction_type IN ('issue', 'redeem', 'cancel')),
  amount            NUMERIC(14,2) NOT NULL, -- signed: +issue, -redeem, +cancel (refunds remaining balance to nothing -- see check_gift_card_transaction_posting)
  balance_after     NUMERIC(14,2) NOT NULL CHECK (balance_after >= 0),
  sales_invoice_id  UUID REFERENCES sales_invoices(id), -- set only for 'redeem'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID REFERENCES users(id)
);

CREATE INDEX idx_gift_card_transactions_company ON gift_card_transactions(company_id);
CREATE INDEX idx_gift_card_transactions_card ON gift_card_transactions(gift_card_id);

CREATE OR REPLACE FUNCTION check_gift_card_refs_company()
RETURNS TRIGGER AS $$
DECLARE
  ref_company_id UUID;
BEGIN
  SELECT company_id INTO ref_company_id FROM stores WHERE id = NEW.store_id;
  IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'store % does not belong to company %', NEW.store_id, NEW.company_id;
  END IF;

  IF NEW.customer_id IS NOT NULL THEN
    SELECT company_id INTO ref_company_id FROM customers WHERE id = NEW.customer_id;
    IF ref_company_id IS DISTINCT FROM NEW.company_id THEN
      RAISE EXCEPTION 'customer % does not belong to company %', NEW.customer_id, NEW.company_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gift_cards_check_refs
  BEFORE INSERT OR UPDATE ON gift_cards
  FOR EACH ROW EXECUTE FUNCTION check_gift_card_refs_company();

CREATE OR REPLACE FUNCTION check_gift_card_transaction_refs()
RETURNS TRIGGER AS $$
DECLARE
  v_card_company_id UUID;
BEGIN
  SELECT company_id INTO v_card_company_id FROM gift_cards WHERE id = NEW.gift_card_id;
  IF v_card_company_id IS DISTINCT FROM NEW.company_id THEN
    RAISE EXCEPTION 'gift card % does not belong to company %', NEW.gift_card_id, NEW.company_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gift_card_transactions_check_refs
  BEFORE INSERT ON gift_card_transactions
  FOR EACH ROW EXECUTE FUNCTION check_gift_card_transaction_refs();

-- Append-only ledger, same reasoning as stock_movements: a transaction row
-- is a historical fact about what happened to the card's balance at a
-- point in time, not a value to edit after the fact.
CREATE OR REPLACE FUNCTION check_gift_card_transaction_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'gift card transactions are append-only and cannot be updated or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_gift_card_transactions_immutable
  BEFORE UPDATE OR DELETE ON gift_card_transactions
  FOR EACH ROW EXECUTE FUNCTION check_gift_card_transaction_immutable();

CREATE TRIGGER trg_gift_cards_audit
  AFTER INSERT OR UPDATE OR DELETE ON gift_cards
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

CREATE TRIGGER trg_gift_card_transactions_audit
  AFTER INSERT OR UPDATE OR DELETE ON gift_card_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_audit_trigger();

INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'issue_gift_card', 'sales.gift_card.issue', 'Issue new gift cards and cancel unused ones');
