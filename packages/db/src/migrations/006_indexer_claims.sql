CREATE TABLE indexed_claims (
 stream_id text NOT NULL, agreement text NOT NULL,recipient text NOT NULL,
 regular_paid numeric(78,0) NOT NULL DEFAULT 0 CHECK(regular_paid>=0),
 notice_paid numeric(78,0) NOT NULL DEFAULT 0 CHECK(notice_paid>=0),
 last_observed_at numeric(20,0) CHECK(last_observed_at>=0),
 PRIMARY KEY(stream_id,agreement),
 FOREIGN KEY(stream_id,agreement) REFERENCES indexed_agreements(stream_id,agreement) ON DELETE CASCADE
);
-- Prior worker rejected all claim events; zero payments are not inferred from a live balance.
INSERT INTO indexed_claims(stream_id,agreement,recipient,last_observed_at)
 SELECT a.stream_id,a.agreement,a.terms->>'provider',
 (SELECT max((e.payload->'raw'->>'blockTimestamp')::numeric) FROM indexer_events e
 WHERE e.stream_id=a.stream_id AND (e.payload->>'address'=a.agreement OR e.payload->'args'->>'agreement'=a.agreement))
 FROM indexed_agreements a;
