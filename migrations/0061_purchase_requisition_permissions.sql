-- Two new codes: one for the requester (create/submit their own draft),
-- one for the reviewer (approve/reject someone else's). Kept separate
-- rather than reusing purchasing.po.create, since letting the same
-- permission cover both would let a requester approve their own
-- requisition -- the trigger in 0060 also blocks self-approval at the
-- data layer, but the permission split is the first line of defense.
-- Converting an approved requisition into a PO reuses purchasing.po.create
-- (it genuinely is just creating a PO, pre-filled from the requisition).
INSERT INTO permissions (module, action, code, description) VALUES
  ('purchasing', 'create_requisition', 'purchasing.requisition.create', 'Create and submit purchase requisitions'),
  ('purchasing', 'approve_requisition', 'purchasing.requisition.approve', 'Approve or reject purchase requisitions');
