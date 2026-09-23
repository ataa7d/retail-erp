-- AR/AP ageing as views over already-stored amounts (rule: reporting reads
-- stored values, no arithmetic beyond SUM/subtraction of sums — the
-- minimum needed for "amount still open").
--
-- A POS invoice is only AR-exposed for whatever portion was paid by
-- payment_method = 'credit' (cash/card/points/gift_card settle at the
-- till, per sales_invoice_payments from Phase 4) — a wholesale invoice is
-- AR-exposed for its full gross_amount. Both then net down by whatever has
-- been allocated from posted customer_receipts.

CREATE VIEW ar_open_items AS
SELECT
  si.id AS sales_invoice_id,
  si.company_id,
  si.customer_id,
  si.document_number,
  si.invoice_date,
  CASE
    WHEN si.invoice_channel = 'wholesale' THEN si.gross_amount
    ELSE COALESCE((
      SELECT SUM(sip.amount) FROM sales_invoice_payments sip
      WHERE sip.invoice_id = si.id AND sip.payment_method = 'credit'
    ), 0)
  END AS ar_original_amount,
  COALESCE((
    SELECT SUM(cra.allocated_amount) FROM customer_receipt_allocations cra
    JOIN customer_receipts cr ON cr.id = cra.customer_receipt_id
    WHERE cra.sales_invoice_id = si.id AND cr.document_status = 'posted'
  ), 0) AS allocated_amount
FROM sales_invoices si
WHERE si.document_status = 'posted';

CREATE VIEW ar_ageing AS
SELECT
  oi.sales_invoice_id,
  oi.company_id,
  oi.customer_id,
  oi.document_number,
  oi.invoice_date,
  c.payment_terms_days,
  (oi.invoice_date + (c.payment_terms_days || ' days')::interval)::date AS due_date,
  (oi.ar_original_amount - oi.allocated_amount) AS open_amount,
  GREATEST(0, CURRENT_DATE - (oi.invoice_date + (c.payment_terms_days || ' days')::interval)::date) AS days_overdue,
  CASE
    WHEN CURRENT_DATE <= (oi.invoice_date + (c.payment_terms_days || ' days')::interval)::date THEN 'current'
    WHEN CURRENT_DATE - (oi.invoice_date + (c.payment_terms_days || ' days')::interval)::date <= 30 THEN '1-30'
    WHEN CURRENT_DATE - (oi.invoice_date + (c.payment_terms_days || ' days')::interval)::date <= 60 THEN '31-60'
    WHEN CURRENT_DATE - (oi.invoice_date + (c.payment_terms_days || ' days')::interval)::date <= 90 THEN '61-90'
    ELSE '90+'
  END AS ageing_bucket
FROM ar_open_items oi
JOIN customers c ON c.id = oi.customer_id
WHERE (oi.ar_original_amount - oi.allocated_amount) > 0;

CREATE VIEW ap_open_items AS
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
  ), 0) AS allocated_amount
FROM supplier_invoices si
WHERE si.document_status = 'posted';

CREATE VIEW ap_ageing AS
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
  END AS ageing_bucket
FROM ap_open_items oi
JOIN suppliers s ON s.id = oi.supplier_id
WHERE (oi.ap_original_amount - oi.allocated_amount) > 0;
