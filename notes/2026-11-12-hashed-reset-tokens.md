# Hashed reset tokens (F059)

- Better Auth now stores the reset token hashed (`verification.storeIdentifier: "hashed"`).
- A plain row made before the change still opens its link until it expires (24 h). Better Auth falls back to the plain identifier (read in `node_modules/better-auth/dist/db/internal-adapter.mjs`, not tested).
- Decision (coordinator, 2026-11-12): no cleanup migration. The window is 24 h and the pilot has one user. After the deploy, wait 24 h, or run `delete from auth_verifications where identifier like 'reset-password:%'` by hand.
