ALTER TABLE transaction_attempts ADD COLUMN discovery_checked_at timestamptz;
CREATE INDEX transaction_attempt_discovery_due ON transaction_attempts(discovery_checked_at,id) WHERE state IN ('unknown','submitted','reorged','conflicted');
