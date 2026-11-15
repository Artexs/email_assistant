# Changelog

All notable changes to the email assistant. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow SemVer in the `0.y.z` range. `bun run release:prepare <x.y.z>` moves the items under `[Unreleased]` to a new version heading (`docs/release-checklist.md`). Items are in product words.

<!--
The group "For users" is optional. It holds what a user of the web panel can see. The changelog page of the docs site
shows only this group, per release. Every other group is operator text and stays private.
One item is two lines: the English text, then the Polish text indented by two spaces. Example (indented, not a real heading):

    ### For users

    - en: Short sentence about what changed for the user.
      pl: Krótkie zdanie o tym, co zmieniło się dla użytkownika.

A heading is "## [x.y.z] - YYYY-MM-DD" (plain SemVer, newest first). "bun run release:prepare" keeps the group.
-->

## [Unreleased]

## [0.2.0] - 2026-11-15

### For users

- en: A public docs site with guides and this list of changes.
  pl: Publiczna strona z dokumentacją: poradniki i ta lista zmian.

## [0.1.0] - 2026-11-15

### Added

- Offline quality lab: one command measures per-category precision and recall of the classifier on a frozen set of made-up mails.
- Weekly report: every Monday the executive gets one Telegram message with the week's numbers, and the panel shows 8 weeks of them.
- Polish and English in the web panel, the Telegram bot and the auth mails, by the language of each user.
- Send limits per mailbox, an operator console and a security log in the Account card.
- Two-factor sign-in with an authenticator app and backup codes, a trusted device for 30 days, and one break-glass owner per organization.
- Company sign-in (OIDC) for organizations with their own identity provider, and an "SSO required" rule.
- Account data: an owner deletes the organization with all its data, and the operator exports it and answers a data request.
- Act from the panel: approve, reject and edit waiting drafts, and manage delegates and delegations, with a typed API behind every action.
- Read the Sent folder of a mailbox (off until the owner turns it on): the assistant knows what the executive sent.
- Sign in with Microsoft or Google to connect a mailbox (first stages).
- Operator alerts: one Telegram text when sync, urgent notices or the LLM break their service level, a repeat every 6 hours and one "resolved" text.
- Structured event logs with a search store on the tailnet, kept 30 days.
- Warning for suspicious mail, attachments in the notice, and a "not triaged yet" notice during an LLM pause.

### Changed

- The web panel runs on Astro 7.
- Each classifier change ships only when it wins on the dev set and holds on the holdout.
- Docker rotates the log of each service: at most 5 files of 10 MB.

### Fixed

- A copy of a mail below the sync position is stored.
- Turning two-factor sign-in off, or making new backup codes, needs a code from the authenticator app.
