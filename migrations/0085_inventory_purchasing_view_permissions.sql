-- Phase 1 of read-access permissions: until now almost every GET route had
-- no permission check at all (any authenticated user with company access
-- could read everything), and no mechanism existed to hide a sensitive
-- field like item cost from an unauthorized viewer. This adds view
-- permissions for Inventory and Purchasing's screens, plus one field-mask
-- permission for cost figures specifically.
--
-- Every new permission is granted to every currently-active role: today
-- everyone can already read this data and already sees cost figures (no
-- gate/mask existed), so deploying this migration must not silently hide
-- something someone could see yesterday. An admin deliberately narrows
-- each role afterward via Administration > Roles.

INSERT INTO permissions (module, action, code, description) VALUES
  ('inventory', 'view_items', 'inventory.items.view', 'View items, variants, and reference data (brands/categories/seasons/groups/units)'),
  ('inventory', 'view_items_cost', 'inventory.items.view_cost', 'View item/variant cost figures (standard cost, average cost, landed cost)'),
  ('inventory', 'view_stock', 'inventory.stock.view', 'View stock balances by item and store'),
  ('inventory', 'view_transfers', 'inventory.transfer.view', 'View stock transfers and transfer orders'),
  ('inventory', 'view_stocktakes', 'inventory.stocktake.view', 'View stock adjustments / stocktakes'),
  ('purchasing', 'view_supplier', 'purchasing.supplier.view', 'View suppliers and their quoted item prices'),
  ('purchasing', 'view_requisition', 'purchasing.requisition.view', 'View purchase requisitions'),
  ('purchasing', 'view_po', 'purchasing.po.view', 'View purchase orders and reorder suggestions'),
  ('purchasing', 'view_goods_receipt', 'purchasing.goods_receipt.view', 'View goods receipts'),
  ('purchasing', 'view_supplier_invoice', 'purchasing.supplier_invoice.view', 'View supplier invoices'),
  ('purchasing', 'view_return', 'purchasing.return.view', 'View purchase returns / supplier credit notes');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE p.code IN (
  'inventory.items.view', 'inventory.items.view_cost', 'inventory.stock.view',
  'inventory.transfer.view', 'inventory.stocktake.view',
  'purchasing.supplier.view', 'purchasing.requisition.view', 'purchasing.po.view',
  'purchasing.goods_receipt.view', 'purchasing.supplier_invoice.view', 'purchasing.return.view'
)
ON CONFLICT (role_id, permission_id) DO NOTHING;
