-- Immutable provenance is separate from replaceable canonical membership.
CREATE TABLE indexer_block_history (
 stream_id text NOT NULL REFERENCES indexer_streams(stream_id),
 block_hash text NOT NULL, block_number numeric(78,0) NOT NULL CHECK(block_number>=0),
 content_hash text NOT NULL, PRIMARY KEY(stream_id,block_hash)
);
CREATE TABLE indexer_event_history (
 stream_id text NOT NULL, block_hash text NOT NULL, transaction_hash text NOT NULL,
 log_index numeric(10,0) NOT NULL CHECK(log_index>=0), payload jsonb NOT NULL,
 PRIMARY KEY(stream_id,block_hash,transaction_hash,log_index),
 UNIQUE(stream_id,block_hash,log_index),
 FOREIGN KEY(stream_id,block_hash) REFERENCES indexer_block_history(stream_id,block_hash)
);
INSERT INTO indexer_block_history SELECT stream_id,block_hash,block_number,content_hash FROM indexer_blocks;
INSERT INTO indexer_event_history
 SELECT e.stream_id,b.block_hash,e.transaction_hash,e.log_index,e.payload
 FROM indexer_events e JOIN indexer_blocks b USING(stream_id,block_number);
