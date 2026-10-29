-- Preserve synthetic streams; distinguish observed RPC data.
ALTER TABLE indexer_streams DROP CONSTRAINT indexer_streams_source_check;
ALTER TABLE indexer_streams ADD CONSTRAINT indexer_streams_source_check CHECK(source IN ('SYNTHETIC','RPC_OBSERVED'));
