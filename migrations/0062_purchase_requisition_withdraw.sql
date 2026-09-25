-- Lets the requester pull back their own requisition while it's still
-- awaiting a decision, instead of making the reviewer reject it just to
-- get it out of their queue. 'withdrawn' is terminal, same as 'rejected'.

ALTER TABLE purchase_requisitions
  DROP CONSTRAINT purchase_requisitions_document_status_check;

ALTER TABLE purchase_requisitions
  ADD CONSTRAINT purchase_requisitions_document_status_check
  CHECK (document_status IN ('draft', 'pending_approval', 'approved', 'rejected', 'converted_to_po', 'withdrawn'));

CREATE OR REPLACE FUNCTION check_purchase_requisition_status_transition()
RETURNS TRIGGER AS $$
BEGIN
  IF current_setting('app.bypass_immutability', true) = 'true' THEN
    RETURN NEW;
  END IF;

  IF OLD.document_status IN ('rejected', 'converted_to_po', 'withdrawn') THEN
    RAISE EXCEPTION 'purchase requisition % is % and cannot be modified', OLD.id, OLD.document_status;
  END IF;

  IF NEW.document_status IS DISTINCT FROM OLD.document_status THEN
    IF OLD.document_status = 'draft' AND NEW.document_status = 'pending_approval' THEN
      IF NOT EXISTS (SELECT 1 FROM purchase_requisition_lines WHERE requisition_id = NEW.id) THEN
        RAISE EXCEPTION 'purchase requisition % has no lines and cannot be submitted', NEW.id;
      END IF;
      NEW.submitted_at := now();

    ELSIF OLD.document_status = 'pending_approval' AND NEW.document_status = 'approved' THEN
      IF NEW.decided_by IS NULL THEN
        RAISE EXCEPTION 'purchase requisition % cannot be approved without decided_by', NEW.id;
      END IF;
      IF NEW.decided_by = NEW.created_by THEN
        RAISE EXCEPTION 'purchase requisition % cannot be approved by its own requester', NEW.id;
      END IF;
      NEW.decided_at := now();

    ELSIF OLD.document_status = 'pending_approval' AND NEW.document_status = 'rejected' THEN
      IF NEW.decided_by IS NULL THEN
        RAISE EXCEPTION 'purchase requisition % cannot be rejected without decided_by', NEW.id;
      END IF;
      IF NEW.rejection_reason IS NULL OR btrim(NEW.rejection_reason) = '' THEN
        RAISE EXCEPTION 'purchase requisition % cannot be rejected without a reason', NEW.id;
      END IF;
      NEW.decided_at := now();

    ELSIF OLD.document_status = 'pending_approval' AND NEW.document_status = 'withdrawn' THEN
      NULL; -- the requester pulling their own request back; app layer checks who's calling

    ELSIF OLD.document_status = 'approved' AND NEW.document_status = 'converted_to_po' THEN
      NULL; -- driven by the app once the PO is created, no extra validation here

    ELSE
      RAISE EXCEPTION 'illegal purchase requisition status transition from % to %', OLD.document_status, NEW.document_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
