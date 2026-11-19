-- migrate:up
-- Telegram detail level per member (phone channel). Expand only: two new columns with a default and one CHECK list that
-- only grows. No old column or constraint is removed or narrowed, so the code of the previous release runs on this schema:
-- it never reads the two columns, and it writes `outbox.detail = 'full'` (the default), which the wider list still accepts.
-- The code of this release reads the level at send time, behind the flag `telegram_minimal` (default off): with the flag
-- off every Telegram message is `full`, as before. This migration changes no message by itself.
--
-- `memberships.telegram_detail`: `full` (today's messages) or `minimal` (counts and panel links, no mail text, no buttons).
-- A new member, and a member who links a chat later, gets `minimal`. The pilot keeps `full`: every member who has a chat
-- link now gets `full` here, so the switch-on of the flag changes nothing for them until they or their owner choose.
-- The data step runs once, right after the column add, and a second run of the file (down, then up) makes the same state
-- from the same links, so it is safe on the shared dev database and on production.
ALTER TABLE memberships
  ADD COLUMN telegram_detail text NOT NULL DEFAULT 'minimal'
    CONSTRAINT memberships_telegram_detail_check CHECK (telegram_detail IN ('full', 'minimal'));

UPDATE memberships m
   SET telegram_detail = 'full'
 WHERE EXISTS (SELECT 1 FROM chat_links cl WHERE cl.org_id = m.org_id AND cl.user_id = m.user_id);

-- The owner of an organization can lock `minimal` for all members (the member values stay for the unlock).
ALTER TABLE organizations ADD COLUMN telegram_minimal_locked boolean NOT NULL DEFAULT false;

-- The level at which a message went out: the sender writes it with the sent text. The list only grows (replace, not narrow).
ALTER TABLE outbox DROP CONSTRAINT outbox_detail_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_detail_check CHECK (detail IN ('full', 'minimal'));

-- migrate:down
-- Rollback note. The old list refuses `minimal`: the label of every `minimal` row becomes `full` first. A `sent` row keeps its
-- text; a pending row has no text yet, so after a rollback the old code renders it `full` (a rollback gives every member `full`
-- again). The member levels and the organization locks are lost with their columns; a later up sets the pilot members to
-- `full` and the others to `minimal` again. A release rolls back by code (`deploy/rollback.sh`); this part is for the dev database.
UPDATE outbox SET detail = 'full' WHERE detail = 'minimal';
ALTER TABLE outbox DROP CONSTRAINT outbox_detail_check;
ALTER TABLE outbox ADD CONSTRAINT outbox_detail_check CHECK (detail IN ('full'));
ALTER TABLE organizations DROP COLUMN telegram_minimal_locked;
ALTER TABLE memberships DROP COLUMN telegram_detail;
