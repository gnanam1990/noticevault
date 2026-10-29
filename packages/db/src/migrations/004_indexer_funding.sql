-- Partial event projection only: no spendable balance, claims or settlement inferred.
CREATE TABLE indexed_funding (
 stream_id text NOT NULL, agreement text NOT NULL,
 regular_funded numeric(78,0) NOT NULL CHECK(regular_funded>0),
 funded_through numeric(20,0) NOT NULL CHECK(funded_through>=0 AND funded_through<=9223372036854775807),
 PRIMARY KEY(stream_id,agreement),
 FOREIGN KEY(stream_id,agreement) REFERENCES indexed_agreements(stream_id,agreement) ON DELETE CASCADE
);
-- Prior worker accepted only creation events; initial regular funding is exactly A.
INSERT INTO indexed_funding SELECT stream_id,agreement,(terms->>'amountPerPeriod')::numeric,
 (terms->>'startAt')::numeric+(terms->>'periodSeconds')::numeric FROM indexed_agreements;
