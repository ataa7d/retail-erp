-- Granularity cleanup, continuing the pattern from 0093-0097: found on
-- audit of the Purchasing module. purchasing.goods_receipt.post gates 9
-- routes across 3 unrelated document types under a name that only
-- describes one of them: goods receipts (POST /goods-receipts,
-- .../:id/post, .../bulk-post), supplier invoices (the 3-way-match AP
-- document -- POST /supplier-invoices, .../:id/post, .../bulk-post), and
-- supplier credit notes (POST /supplier-credit-notes, .../:id/post,
-- .../bulk-post). A warehouse role that only needs to receive goods
-- against a PO also gets the power to post supplier invoices (creates
-- an AP liability) and issue supplier credit notes (reduces AP, affects
-- inventory/COGS via returns) -- different job functions (receiving vs.
-- accounts payable), the same mismatch 0097 found in Accounting.
--
-- Mirrors the view-side split Phase 1 already gave this exact area
-- (purchasing.goods_receipt.view / purchasing.supplier_invoice.view /
-- purchasing.return.view already exist as three separate permissions):
-- purchasing.goods_receipt.post keeps gating goods receipts only; new
-- purchasing.supplier_invoice.post and purchasing.return.post take over
-- supplier invoices and supplier credit notes respectively. Backfilled
-- to every role that already held purchasing.goods_receipt.post, since
-- that was the only permission that could have let them do any of this
-- before.

INSERT INTO permissions (module, action, code, description) VALUES
  ('purchasing', 'post_supplier_invoice', 'purchasing.supplier_invoice.post', 'Create and post supplier invoices (3-way match)'),
  ('purchasing', 'post_return', 'purchasing.return.post', 'Create and post supplier credit notes (purchase returns)');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'purchasing.goods_receipt.post'
CROSS JOIN (
  SELECT id FROM permissions WHERE code IN ('purchasing.supplier_invoice.post', 'purchasing.return.post')
) p
ON CONFLICT (role_id, permission_id) DO NOTHING;
