-- migrate:up
-- Expand step: the old organization signature (`organizations.style_text`) moves into every mailbox that has no signature
-- of its own, then the column is emptied. The column stays; a later release drops it. The code of this release neither
-- reads nor writes it, so the code of the previous release still runs on this schema (it reads null: the fallback applies).
-- A signature that is set stays as it is. The column has no length check (the old form allowed 500 characters); `left`
-- keeps the copy inside the 1000 characters of the profile check. Each statement matches only rows that it still has to
-- change, so a second run changes nothing. Blank means white space only, as the old code read it.

-- A profile row with a blank signature takes the organization text.
UPDATE mailbox_profiles p
SET signature = left(regexp_replace(o.style_text, '^\s+|\s+$', '', 'g'), 1000), updated_at = now()
FROM mailboxes m
JOIN organizations o ON o.id = m.org_id
WHERE p.mailbox_id = m.id
  AND o.style_text !~ '^\s*$'
  AND (p.signature IS NULL OR p.signature ~ '^\s*$');

-- A mailbox with no profile row gets one. `updated_by` stays null: no user wrote it. `ON CONFLICT` covers an owner who
-- saves a first profile while this runs: that row stays as the owner wrote it.
INSERT INTO mailbox_profiles (mailbox_id, org_id, signature, updated_at, updated_by)
SELECT m.id, m.org_id, left(regexp_replace(o.style_text, '^\s+|\s+$', '', 'g'), 1000), now(), NULL
FROM mailboxes m
JOIN organizations o ON o.id = m.org_id
WHERE o.style_text !~ '^\s*$'
  AND NOT EXISTS (SELECT 1 FROM mailbox_profiles p WHERE p.mailbox_id = m.id)
ON CONFLICT (mailbox_id) DO NOTHING;

-- An organization with text and no mailbox loses the text: no mailbox signs with it.
UPDATE organizations SET style_text = NULL WHERE style_text IS NOT NULL;

-- migrate:down
-- Forward only. The organization texts are gone and the copied signatures are now user data of the profiles: a rollback
-- of the schema cannot tell them from the signatures that users typed. Nothing to undo here.
