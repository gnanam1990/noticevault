-- No backfill: previous versions rejected NoticeStarted.
CREATE TABLE indexed_notice (
 stream_id text NOT NULL, agreement text NOT NULL,
 notice_start numeric(20,0) NOT NULL CHECK(notice_start>=0),
 notice_end numeric(20,0) NOT NULL CHECK(notice_end>=notice_start AND notice_end<=9223372036854775807),
 reason smallint NOT NULL CHECK(reason IN (1,2)),
 PRIMARY KEY(stream_id,agreement),
 FOREIGN KEY(stream_id,agreement) REFERENCES indexed_agreements(stream_id,agreement) ON DELETE CASCADE
);
