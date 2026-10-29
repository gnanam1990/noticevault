-- Preserve historical rows. New observed streams must store their reader/finality binding.
ALTER TABLE indexer_streams ADD COLUMN observation_policy text;
ALTER TABLE indexer_streams ADD CONSTRAINT observation_policy_format CHECK(observation_policy IS NULL OR observation_policy ~ '^[0-9a-f]{64}$');
