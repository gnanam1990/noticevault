-- Initial M05 persistence. Applied only to isolated synthetic DB in this milestone.
CREATE TABLE IF NOT EXISTS indexer_streams (
 stream_id text PRIMARY KEY, binding_hash text NOT NULL,
 source text NOT NULL CHECK(source='SYNTHETIC'),
 head_number numeric(78,0) NOT NULL CHECK(head_number>=0), head_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS indexer_blocks (
 stream_id text NOT NULL REFERENCES indexer_streams(stream_id),
 block_number numeric(78,0) NOT NULL CHECK(block_number>=0),
 block_hash text NOT NULL, content_hash text NOT NULL,
 PRIMARY KEY(stream_id,block_number)
);
CREATE TABLE IF NOT EXISTS indexer_events (
 stream_id text NOT NULL, block_number numeric(78,0) NOT NULL,
 transaction_hash text NOT NULL, log_index numeric(10,0) NOT NULL CHECK(log_index>=0),
 payload jsonb NOT NULL,
 PRIMARY KEY(stream_id,transaction_hash,log_index),
 UNIQUE(stream_id,block_number,log_index),
 FOREIGN KEY(stream_id,block_number) REFERENCES indexer_blocks(stream_id,block_number)
);
CREATE TABLE IF NOT EXISTS indexed_agreements (
 stream_id text NOT NULL REFERENCES indexer_streams(stream_id),
 agreement text NOT NULL, created_block numeric(78,0) NOT NULL, terms jsonb NOT NULL,
 PRIMARY KEY(stream_id,agreement),
 FOREIGN KEY(stream_id,created_block) REFERENCES indexer_blocks(stream_id,block_number)
);
