-- Single reusable predicate for rule A's line-level invariant. Every
-- Phase 4+ document-line table (pos_invoice_lines, wholesale_invoice_lines,
-- purchase_order_lines, ...) adds:
--
--   net_amount    NUMERIC(14,2) NOT NULL,
--   vat_amount    NUMERIC(14,2) NOT NULL,
--   gross_amount  NUMERIC(14,2) NOT NULL,
--   CHECK (fn_amounts_balance(net_amount, vat_amount, gross_amount))
--
-- instead of writing the arithmetic out each time. NUMERIC addition is
-- exact (no float rounding), so equality here really does mean equality
-- to the cent, not "close enough".

CREATE OR REPLACE FUNCTION fn_amounts_balance(
  p_net NUMERIC, p_vat NUMERIC, p_gross NUMERIC
) RETURNS BOOLEAN AS $$
  SELECT p_net + p_vat = p_gross;
$$ LANGUAGE sql IMMUTABLE;
