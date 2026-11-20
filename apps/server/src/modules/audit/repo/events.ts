// Ids, codes and numbers only, never mail text (modules §3.6): no nested objects.
export type AuditData = Record<string, string | number | boolean | null>;
export const auditEvents = {
  emailTriaged: "email.triaged",
  emailSkipped: "email.skipped",
  actionPlanned: "action.planned",
  llmCall: "llm.call",
  emailRequeued: "email.requeued",
  chatLinked: "chat.linked",
  chatUnlinked: "chat.unlinked",
  mailboxConnected: "mailbox.connected", // data: mailbox_id, via, sent_sync; OAuth: method, provider
  mailboxReconnected: "mailbox.reconnected", // data: mailbox_id, via, provider, reactivated
  mailboxPaused: "mailbox.paused",
  mailboxResumed: "mailbox.resumed",
  mailboxPasswordChanged: "mailbox.password_changed",
  mailboxRemoved: "mailbox.removed", // data: mailbox_id
  mailboxHostAllowed: "mailbox.host_allowed", // data: mailbox_id
  mailboxHostBlocked: "mailbox.host_blocked", // data: mailbox_id, source
  onboardingModeKept: "onboarding.mode_kept", // data: via
  actionApplied: "action.applied",
  actionFailed: "action.failed",
  actionUndone: "action.undone",
  actionUndoRequested: "action.undo_requested",
  actionExpired: "action.expired",
  actionApplying: "action.applying",
  actionSendLimited: "action.send_limited", // data: limit, until, mailbox_id; reason_code send_limit
  actionApproved: "action.approved",
  actionRejected: "action.rejected",
  actionSendAgain: "action.send_again",
  actionEdited: "action.edited", // data: previous_action_id, version, delegate_changed, via; never text
  actionWentOut: "action.went_out", // data: delegation_id, outgoing_message_id
  actionRejectReason: "action.reject_reason", // reason_code: the reason; data: via
  actionMistake: "action.mistake", // data: via
  actionSentCopyFailed: "action.sent_copy_failed",
  emailReturned: "email.returned",
  mailboxFolderCreated: "mailbox.folder_created",
  mailboxModeChanged: "mailbox.mode_changed",
  mailboxPolicyChanged: "mailbox.policy_changed",
  mailboxSwitchChanged: "mailbox.switch_changed",
  mailboxProfileChanged: "mailbox.profile_changed", // data: mailbox_id, fields (the names of the changed fields in one string, comma between), via; never the text
  mailboxStyleSuggested: "mailbox.style_suggested", // data: mailbox_id, count (samples sent), outcome (suggestion | checks | output | provider with a model call; too_few | sent_off | llm_off | llm_cap without), via; actor: the user; never a text
  replyRequested: "reply.requested", // data: via, trigger (tap | redraft | sample), reply_request_id; actor: the user; never the instruction
  mailboxSentSyncChanged: "mailbox.sent_sync_changed", // data: mailbox_id, enabled, count (sent rows deleted)
  settingsUrgencySet: "settings.urgency_set", // data: mailbox_id, topics, deadlines (counts), via
  settingsChanged: "settings.changed", // data: mailbox_id, field (loop_wait_days), from, to, via
  mailboxSyncFolderAdded: "mailbox.sync_folder_added", // data: mailbox_id, folder_key, role
  mailboxSyncFolderChanged: "mailbox.sync_folder_changed", // data: mailbox_id, folder_key, enabled
  ruleAdded: "rule.added", // data: rule_id, kind, scope, mailbox_id when scope is "mailbox"
  ruleRemoved: "rule.removed", // data: the same
  suggestionAccepted: "suggestion.accepted", // data: mailbox_id, kind, scope, via; never the pattern or the key
  suggestionDismissed: "suggestion.dismissed", // data: the same
  orgTimezoneChanged: "org.timezone_changed", // data: from, to
  orgStyleChanged: "org.style_changed", // data: set
  orgPlanChanged: "org.plan_changed", // data: from, to, max_from, max_to, trial_ends_at
  orgFlagChanged: "org.flag_changed", // data: flag, enabled
  orgBreakGlassSet: "org.break_glass_set", // data: user_id
  orgBreakGlassCleared: "org.break_glass_cleared", // data: user_id, reason ("cli" | "replaced" | "two_factor_reset")
  delegateAdded: "delegate.added", // data: delegate_id, via
  delegateChanged: "delegate.changed", // data: delegate_id, fields (the names of the changed fields in one string, comma between), active (when it changed), via; never a name or a tag
  delegationCreated: "delegation.created", // data: delegation_id, delegate_id, send_action_id, due, source (triage | button), via (button only: web | telegram | cli)
  delegationSent: "delegation.sent",
  delegationAnswered: "delegation.answered",
  delegationOverdue: "delegation.overdue",
  delegationCancelled: "delegation.cancelled",
  delegationDone: "delegation.done",
  delegationRemindRequested: "delegation.remind_requested", // data: delegation_id, reminder (1 or 2), via; the actor is the user
  delegationChaserRun: "delegation.chaser_run",
  // The loop part of the chaser ran for a mailbox. Flat; data: mailbox_id, follow_ups, stale, expired, forced (counts and ids only).
  loopsChaserRun: "loops.chaser_run",
  // Flat; ids and codes only, never the subject, the ask or an address of a loop. The actor is a user id or "system".
  loopOpened: "loop.opened", // data: loop_id, kind
  loopClosed: "loop.closed", // data: loop_id, kind, reason
  loopReopened: "loop.reopened", // data: loop_id, kind
  loopLater: "loop.later", // data: loop_id, kind, later_count
  loopRestarted: "loop.restarted", // data: loop_id, kind
  loopWouldDraft: "loop.would_draft", // data: loop_id, kind, via; shadow mode: a follow-up tap that planned nothing
  webLogin: "web.login",
  webPasswordSet: "web.password_set",
  webPasswordChanged: "web.password_changed",
  webLoginLocked: "web.login_locked", // data: via, locked_until
  webTermsAccepted: "web.terms_accepted", // data: via, version
  webTelegramConsent: "web.telegram_consent", // data: via, version
  webSessionsRevoked: "web.sessions_revoked", // data: via
  webOtherSessionsRevoked: "web.other_sessions_revoked", // data: via
  webTwoFactorEnabled: "web.two_factor_enabled", // data: via
  webTwoFactorDisabled: "web.two_factor_disabled", // data: via
  webBackupCodesGenerated: "web.backup_codes_generated", // data: via
  webBackupCodeUsed: "web.backup_code_used", // data: via
  webTwoFactorLocked: "web.two_factor_locked", // data: via, locked_until
  webTwoFactorRefused: "web.two_factor_refused", // data: via, action (disable | backup_codes), reason (missing | wrong | locked)
  webTwoFactorReset: "web.two_factor_reset", // data: via, sessions_ended
  operatorNotice: "operator.notice", // data: kind, key
  // Every key is flat (a string, number, boolean or null); never an address, a name or a hash of text.
  orgDeleteRefused: "org.delete_refused", // data: reason, via
  orgExported: "org.exported", // data: tables, rows
  dsrFind: "dsr.find", // data: address_hash, mails, mentions, listed_delegates, listed_sender_rules, open_actions
  dsrErase: "dsr.erase", // data: the keys of dsr.find, tombstones, chain_actions, chain_delegations, outbox_blanked, outbox_dropped
  // Flat; never the IdP e-mail or a token. The organization is the provider's.
  ssoLogin: "sso.login", // actor: the user; data: provider_id, first_link
  ssoRefused: "sso.refused", // actor: system; data: provider_id, code
  ssoProviderSet: "sso.provider_set", // actor: cli; data: provider_id, change, issuer_host, domain, links_removed, sessions_ended
  ssoProviderRemoved: "sso.provider_removed", // actor: cli; data: provider_id, issuer_host, domain, links_removed, sessions_ended
  ssoDomainVerified: "sso.domain_verified", // actor: cli; data: provider_id, domain (the DNS proof)
  ssoDomainAttested: "sso.domain_attested", // actor: cli; data: provider_id, domain (the attestation of a test organization)
  ssoRequiredChanged: "sso.required_changed", // actor: cli; data: from, to, sessions_ended
  ssoUnlinked: "sso.unlinked", // actor: cli; data: user_id, sessions_ended
  memberNotifyChanged: "member.notify_changed", // Actor: the user; data: via, keys (the changed keys in one string, comma between); never a value
  newsletterUnsubscribe: "newsletter.unsubscribe", // Actor: the user; data: mailbox_id, domain (the sender domain), status, code; never a URL
  orgMemberAdded: "org.member_added", // actor: cli; data: user_id, role
  pushSubscribed: "push.subscribed", // actor: the user; data: push_subscription_id, created, via; never an endpoint or a key
  pushRemoved: "push.removed", // actor: the user; data: push_subscription_id, via
  pushTestSent: "push.test_sent", // actor: the user; data: devices (the count of devices tried); the rate limit counts these rows
  memberTelegramDetailChanged: "member.telegram_detail_changed", // actor: the user; data: detail (full | minimal) only
  orgTelegramLockChanged: "org.telegram_lock_changed", // actor: the owner; data: locked (boolean) only
  webMemberSessionsEnded: "web.member_sessions_ended", // actor: cli; data: user_id, count, only_sso
} as const;
export interface AuditEvent {
  // null: the row of an action of a loop (a follow-up) has no mail.
  emailId?: string | null;
  actionId?: string;
  actor: "system" | string;
  event: string;
  reasonCode?: string;
  data?: AuditData;
  // Sets created_at; without it the DB default now().
  at?: Date;
}
