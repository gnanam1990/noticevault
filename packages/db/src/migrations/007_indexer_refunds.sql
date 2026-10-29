-- Prior worker rejected ClientRefunded; these are observed counters, not external balances.
CREATE TABLE indexed_refunds (
 stream_id text NOT NULL, agreement text NOT NULL, recipient text NOT NULL,
 client_refunded numeric(78,0) NOT NULL DEFAULT 0 CHECK(client_refunded>=0),
 PRIMARY KEY(stream_id,agreement),
 FOREIGN KEY(stream_id,agreement) REFERENCES indexed_agreements(stream_id,agreement) ON DELETE CASCADE
);
INSERT INTO indexed_refunds(stream_id,agreement,recipient)
 SELECT stream_id,agreement,terms->>'client' FROM indexed_agreements;
