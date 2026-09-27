-- Bug fix: ar_open_items (0040) never netted a posted credit note against
-- its original invoice -- an invoice stayed at its full open amount in
-- ar_ageing forever, even after a credit note was posted against it,
-- unless a customer_receipt happened to be allocated too. A credit note
-- only relieves AR when the original sale was on credit in the first
-- place (postCreditNote in src/sales/salesService.ts already credits AR,
-- not cash, precisely when invoice_channel = 'wholesale' -- a POS return
-- refunds cash at the till instead, so it was never meant to touch AR).
-- CREATE OR REPLACE VIEW keeps the same output columns, so ar_ageing
-- (built on top of this view) picks up the fix automatically.
CREATE OR REPLACE VIEW ar_open_items AS
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
  ), 0)
  + CASE WHEN si.invoice_channel = 'wholesale' THEN COALESCE((
      SELECT SUM(cn.gross_amount) FROM credit_notes cn
      WHERE cn.original_invoice_id = si.id AND cn.document_status = 'posted'
    ), 0) ELSE 0 END AS allocated_amount
FROM sales_invoices si
WHERE si.document_status = 'posted';

-- Customer statement of account: every posted transaction that moves this
-- customer's AR balance, in date order, with a running total -- the same
-- three sources ar_ageing nets against (wholesale invoices in full, the
-- credit-paid portion of POS invoices, credit notes against wholesale
-- invoices, and posted receipts), so the statement's math can never drift
-- from what ar_ageing reports as currently open. Returns full history up
-- to p_to_date; the caller (reports.ts) derives the opening balance by
-- summing everything before its own from-date, the same way fn_balance_sheet
-- callers derive a period from two as-of snapshots.
CREATE OR REPLACE FUNCTION fn_customer_statement(p_company_id UUID, p_customer_id UUID, p_to_date DATE)
RETURNS TABLE(txn_date DATE, document_type TEXT, document_number TEXT, description TEXT, debit NUMERIC, credit NUMERIC, running_balance NUMERIC)
AS $$
  WITH txns AS (
    SELECT
      si.invoice_date AS txn_date,
      'invoice'::TEXT AS document_type,
      si.document_number,
      ('Sales invoice (' || si.invoice_channel || ')')::TEXT AS description,
      (CASE
        WHEN si.invoice_channel = 'wholesale' THEN si.gross_amount
        ELSE COALESCE((SELECT SUM(sip.amount) FROM sales_invoice_payments sip WHERE sip.invoice_id = si.id AND sip.payment_method = 'credit'), 0)
      END)::NUMERIC(14,2) AS debit,
      0::NUMERIC(14,2) AS credit
    FROM sales_invoices si
    WHERE si.company_id = p_company_id AND si.customer_id = p_customer_id AND si.document_status = 'posted'
      AND (
        si.invoice_channel = 'wholesale'
        OR EXISTS (SELECT 1 FROM sales_invoice_payments sip WHERE sip.invoice_id = si.id AND sip.payment_method = 'credit')
      )

    UNION ALL

    SELECT
      cn.credit_note_date,
      'credit_note'::TEXT,
      cn.document_number,
      ('Credit note: ' || cn.reason)::TEXT,
      0::NUMERIC(14,2),
      cn.gross_amount
    FROM credit_notes cn
    JOIN sales_invoices si ON si.id = cn.original_invoice_id
    WHERE cn.company_id = p_company_id AND si.customer_id = p_customer_id AND cn.document_status = 'posted'
      AND si.invoice_channel = 'wholesale'

    UNION ALL

    SELECT
      cr.receipt_date,
      'receipt'::TEXT,
      cr.document_number,
      ('Payment received (' || cr.payment_method || ')')::TEXT,
      0::NUMERIC(14,2),
      cr.amount
    FROM customer_receipts cr
    WHERE cr.company_id = p_company_id AND cr.customer_id = p_customer_id AND cr.document_status = 'posted'
  )
  SELECT
    t.txn_date, t.document_type, t.document_number, t.description, t.debit, t.credit,
    SUM(t.debit - t.credit) OVER (ORDER BY t.txn_date, t.document_type, t.document_number
                                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::NUMERIC(14,2) AS running_balance
  FROM txns t
  WHERE t.txn_date <= p_to_date
  ORDER BY t.txn_date, t.document_type, t.document_number;
$$ LANGUAGE sql STABLE;
