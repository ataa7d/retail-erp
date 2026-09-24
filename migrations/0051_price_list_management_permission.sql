-- No permission in the original catalog (0010) covers creating a price
-- list or setting its item prices -- inventory.items.manage is about item
-- master data, not pricing. Adding the one genuinely missing permission
-- rather than overloading an unrelated one (same reasoning as 0050).
INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'manage_price_lists', 'sales.price_list.manage', 'Create price lists and set item prices');
