-- migrate:up
-- What the DKIM-Signature headers of a mail say they cover. Expand only: one new nullable column. The code of the previous
-- release never writes or reads it, so it runs on this schema (no default, no constraint on old rows: NULL passes the CHECK).
--
-- One-click unsubscribe (RFC 8058) needs a signature that covers `List-Unsubscribe` and `List-Unsubscribe-Post`. The trusted
-- receiving server verified the signature; our code reads only the signing domain `d=` and the signed header names `h=` of
-- each `DKIM-Signature` header. The signature value (`b=`) and the body hash (`bh=`) are never stored.
--
-- Shape: a JSON array of `{ "d": "<domain>", "h": ["<header name>", ...] }`, at most 8 entries. NULL: the mail was stored
-- before this column existed, so there is no proof and the sender is link-only until a newer mail arrives. `[]`: the mail
-- has no usable proof (no signature, more than 8, or one that does not parse; the capture fails closed). Retention clears
-- it with the other captured header texts (to NULL).
ALTER TABLE email_headers
  ADD COLUMN dkim_signatures jsonb
  CONSTRAINT email_headers_dkim_signatures_check CHECK (
    dkim_signatures IS NULL
    OR (CASE WHEN jsonb_typeof(dkim_signatures) = 'array'
             THEN jsonb_array_length(dkim_signatures) <= 8 AND octet_length(dkim_signatures::text) <= 32768
             ELSE false END)
  );

-- migrate:down
-- The column holds only data that this migration made. After a new migrate old mail has NULL and is not one-click.
ALTER TABLE email_headers DROP COLUMN dkim_signatures;
