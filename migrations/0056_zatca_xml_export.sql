-- ZATCA Phase 2 XML export: the invoice-hash chain (PIH -- Previous Invoice
-- Hash) that links every posted sales invoice/credit note to the one
-- immediately before it in the company's submission sequence. Computed
-- once at posting time and frozen -- the XML can be re-exported any number
-- of times afterward without ever changing these values (re-hashing on
-- every export would break the chain for every document posted since).

ALTER TABLE sales_invoices
  ADD COLUMN xml_invoice_hash TEXT,
  ADD COLUMN xml_previous_invoice_hash TEXT;

ALTER TABLE credit_notes
  ADD COLUMN xml_invoice_hash TEXT,
  ADD COLUMN xml_previous_invoice_hash TEXT;
