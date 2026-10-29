-- Additive nullable progress; preserve every existing attempt and unknown journal.
ALTER TABLE transaction_attempts ADD COLUMN discovery jsonb CHECK (discovery IS NULL OR jsonb_typeof(discovery) = 'object');
