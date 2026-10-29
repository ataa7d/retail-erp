-- Granularity cleanup, continuing the pattern from 0093-0096: found on
-- audit of the Accounting module. accounting.journal.post gates 5
-- unrelated document types: POST /journals (manual journal entries --
-- direct, unrestricted debit/credit to any GL account, bypassing every
-- document-driven control the rest of the system has), POST
-- /customer-receipts (routine AR cash application), POST
-- /supplier-payments (routine AP cash application), and the bank
-- reconciliation workflow (POST /bank-statement-lines, .../match, POST
-- /bank-reconciliations). A role that can record a customer receipt --
-- about as low-stakes as accounting gets -- could also post an
-- arbitrary manual journal entry to any account, the single most
-- powerful capability in the system.
--
-- Narrowing accounting.journal.post to just manual journal entries (its
-- name already matches that one action, same shape as 0094's .post
-- narrowing) and adding three new permissions for the others, each
-- mirroring the naming of the view permission Phase 3 already gave that
-- same area: accounting.receipt.create / accounting.payment.create /
-- accounting.bank_reconciliation.manage (the latter covers all three
-- steps of entering, matching, and sweeping a bank statement, since
-- those are one cohesive task, not three separable severities, unlike
-- the cross-document-type bundling this migration splits apart).
--
-- Backfilled to every role that already holds accounting.journal.post,
-- since that's the only permission that could have let them do any of
-- this before today.

INSERT INTO permissions (module, action, code, description) VALUES
  ('accounting', 'create_receipt', 'accounting.receipt.create', 'Record and post a customer receipt (AR settlement)'),
  ('accounting', 'create_payment', 'accounting.payment.create', 'Record and post a supplier payment (AP settlement)'),
  ('accounting', 'manage_bank_reconciliation', 'accounting.bank_reconciliation.manage', 'Enter bank statement lines, match them, and post bank reconciliations');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, p.id
FROM role_permissions rp
JOIN permissions old ON old.id = rp.permission_id AND old.code = 'accounting.journal.post'
CROSS JOIN (
  SELECT id FROM permissions WHERE code IN (
    'accounting.receipt.create', 'accounting.payment.create', 'accounting.bank_reconciliation.manage'
  )
) p
ON CONFLICT (role_id, permission_id) DO NOTHING;
