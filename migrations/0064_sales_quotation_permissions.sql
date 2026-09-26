-- Two new codes, mirroring the purchase-requisition split: one for the
-- salesperson (create/send/withdraw their own draft), one for whoever
-- records the customer's decision (accept/reject). Unlike the requisition
-- pair, this is NOT a conflict-of-interest split -- there is no data-layer
-- self-check here, since a salesperson recording their own customer's
-- verbal acceptance is the normal case, not something to guard against.
-- Kept as two codes anyway so a company that wants a dedicated "quotation
-- desk" role (create-only, no decide) can still configure one.
-- Converting an accepted quotation into an invoice reuses
-- sales.wholesale_invoice.create -- it genuinely is just creating a
-- wholesale invoice, pre-filled from the quotation.
INSERT INTO permissions (module, action, code, description) VALUES
  ('sales', 'create_quotation', 'sales.quotation.create', 'Create, send, and withdraw sales quotations'),
  ('sales', 'decide_quotation', 'sales.quotation.decide', 'Record customer acceptance or rejection of a sales quotation');
