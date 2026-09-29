-- The periodic VAT return every VAT-registered business files with ZATCA is
-- a different thing from per-invoice e-invoicing (already built: simplified/
-- standard XML, QR, hash) -- it's a summary of output VAT (sales) vs input
-- VAT (purchases) over a filing period. Nothing in this app produced that
-- summary; an accountant had to reconstruct it by hand from raw invoice
-- data.
--
-- Deliberately NOT a line-for-line replica of ZATCA's official return form
-- (which also separates GCC sales, exports, and customs-cleared imports --
-- none of which this schema currently distinguishes from a domestic sale/
-- purchase). This is an honest working summary grouped by VAT rate and
-- direction, built entirely from amounts already stored on posted
-- documents -- exactly the "reporting reads stored values" rule the other
-- report functions in this file follow (fn_trial_balance, fn_customer_statement,
-- fn_budget_vs_actual, ...).
--
-- Sales-side documents (sales_invoices, credit_notes) have no multi-currency
-- columns -- always base currency, so their line amounts are summed as-is.
-- Purchase-side documents can be foreign-currency (migration 0054); a line's
-- net/vat amount is in the invoice's OWN currency, converted here the same
-- way postSupplierInvoice already does when booking the GL (line x
-- exchange_rate) -- see purchasingService.ts:541-543. supplier_credit_notes
-- never got currency/exchange_rate columns (a separate, pre-existing scope
-- gap, not something this migration fixes), so those are already base
-- currency and summed as-is.
CREATE OR REPLACE FUNCTION fn_vat_summary(p_company_id UUID, p_start_date DATE, p_end_date DATE)
RETURNS TABLE(direction TEXT, vat_rate NUMERIC, net_amount NUMERIC, vat_amount NUMERIC)
AS $$
  WITH output_sales AS (
    SELECT 'output'::TEXT AS direction, sil.vat_rate,
           SUM(sil.net_amount) AS net_amount, SUM(sil.vat_amount) AS vat_amount
    FROM sales_invoice_lines sil
    JOIN sales_invoices si ON si.id = sil.invoice_id
    WHERE si.company_id = p_company_id AND si.document_status = 'posted'
      AND si.invoice_date BETWEEN p_start_date AND p_end_date
    GROUP BY sil.vat_rate
  ),
  output_credit_notes AS (
    SELECT 'output'::TEXT AS direction, cnl.vat_rate,
           -SUM(cnl.net_amount) AS net_amount, -SUM(cnl.vat_amount) AS vat_amount
    FROM credit_note_lines cnl
    JOIN credit_notes cn ON cn.id = cnl.credit_note_id
    WHERE cn.company_id = p_company_id AND cn.document_status = 'posted'
      AND cn.credit_note_date BETWEEN p_start_date AND p_end_date
    GROUP BY cnl.vat_rate
  ),
  input_purchases AS (
    SELECT 'input'::TEXT AS direction, sil.vat_rate,
           SUM(sil.net_amount * si.exchange_rate) AS net_amount,
           SUM(sil.vat_amount * si.exchange_rate) AS vat_amount
    FROM supplier_invoice_lines sil
    JOIN supplier_invoices si ON si.id = sil.supplier_invoice_id
    WHERE si.company_id = p_company_id AND si.document_status = 'posted'
      AND si.invoice_date BETWEEN p_start_date AND p_end_date
    GROUP BY sil.vat_rate
  ),
  input_credit_notes AS (
    SELECT 'input'::TEXT AS direction, scnl.vat_rate,
           -SUM(scnl.net_amount) AS net_amount, -SUM(scnl.vat_amount) AS vat_amount
    FROM supplier_credit_note_lines scnl
    JOIN supplier_credit_notes scn ON scn.id = scnl.supplier_credit_note_id
    WHERE scn.company_id = p_company_id AND scn.document_status = 'posted'
      AND scn.credit_note_date BETWEEN p_start_date AND p_end_date
    GROUP BY scnl.vat_rate
  ),
  combined AS (
    SELECT * FROM output_sales
    UNION ALL SELECT * FROM output_credit_notes
    UNION ALL SELECT * FROM input_purchases
    UNION ALL SELECT * FROM input_credit_notes
  )
  SELECT direction, vat_rate,
         SUM(net_amount)::NUMERIC(14,2) AS net_amount,
         SUM(vat_amount)::NUMERIC(14,2) AS vat_amount
  FROM combined
  GROUP BY direction, vat_rate
  ORDER BY direction, vat_rate DESC;
$$ LANGUAGE sql STABLE;
