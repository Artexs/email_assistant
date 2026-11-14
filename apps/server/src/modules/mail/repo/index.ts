export {
  changeMailboxStatus,
  countMailboxesOfOrg,
  findMailboxIdByAddress,
  getMailbox,
  getMailboxSummary,
  insertMailbox,
  listMailboxes,
  lockMailbox,
  lockMailboxLimit,
  mailboxHasUidplus,
  markSynced,
  setFolderMapEntry,
  setMailboxStatus,
  type MailboxRow,
  type MailboxStatus,
  type MailboxSummary,
} from "./mailboxes";
export {
  forceRescan,
  getJunkFolderPath,
  getSyncFolder,
  insertInboxFolder,
  insertSyncFolders,
  listSyncFolders,
  lockSyncFolder,
  lockSyncFolderByKey,
  updateCursor,
  updateFolderCursor,
  updateSyncFolderEnabled,
  type Cursor,
  type SyncFolderRow,
} from "./folders";
export { getCredentials, insertCredentials, updateCredentials } from "./credentials";
export { findCopies, listFolderUids, listRecentlyMoved, type MovedRow } from "./copies";
export {
  clearReturned,
  getEmailMailbox,
  getEmailMeta,
  insertEmail,
  listReturned,
  mailKindFilter,
  markEmailRelocated,
  markEmailReturned,
  setUndoPending,
  updateEmailLocation,
  updateEmailUid,
  type EmailMeta,
  type MailKind,
  type NewEmail,
} from "./emails";
export { countSyncTargets, listAuthErrorMailboxesBefore, listMailboxTargets, listSyncTargets } from "./targets";
export { claimEmails, countWaiting, finishEmail, releaseEmail, requeueTooOld, type ClaimedEmail } from "./claims";
export { listEmailsByMessageIds, listFolderEmailKeys, listThreadContext } from "./lookup";
export { PENDING_BODY_DAYS, clearMailBodies, clearMailHeaders } from "./retention";
