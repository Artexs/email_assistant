import type { PushPayloadKind } from "../notices/push";
import type { UserLocale } from "../tenancy";

import { pluralCategory } from "./locale";

// The text of a push notification: a title and one body line from the kind and the count. No mail text: the payload has none. This
// file runs in the service worker too (no Node module). `{count}` in a form is replaced by the number.

export interface PushTexts {
  title(kind: PushPayloadKind): string;
  /** The `test` kind ignores the count. */
  body(kind: PushPayloadKind, count: number): string;
}

interface EnForms {
  one: string;
  other: string;
}
interface PlForms {
  one: string;
  few: string;
  many: string;
}

const enTitles: Record<PushPayloadKind, string> = {
  urgent: "Urgent mail",
  not_triaged: "Mail without a category",
  approval: "Draft to approve",
  approval_set: "Drafts to approve",
  replies_ready: "Replies are ready",
  send_result: "Send result",
  delegation_answered: "Delegation answered",
  send_held: "Send on hold",
  action_failed: "Action failed",
  auth_error: "Mailbox login error",
  host_blocked: "Server not allowed",
  sync_stale: "Mailbox not syncing",
  sync_ok: "Mailbox syncs again",
  sent_missing: "Sent folder missing",
  mailbox_removed: "Mailbox removed",
  test: "Test notice",
};

const enBodies: Record<Exclude<PushPayloadKind, "test">, EnForms> = {
  urgent: { one: "1 urgent mail", other: "{count} urgent mails" },
  not_triaged: { one: "1 mail without a category", other: "{count} mails without a category" },
  approval: { one: "1 draft waits for you", other: "{count} drafts wait for you" },
  approval_set: { one: "1 set of drafts waits for you", other: "{count} sets of drafts wait for you" },
  replies_ready: { one: "1 reply is ready", other: "{count} replies are ready" },
  send_result: { one: "1 send result", other: "{count} send results" },
  delegation_answered: { one: "1 answer to a delegation", other: "{count} answers to delegations" },
  send_held: { one: "1 send is on hold", other: "{count} sends are on hold" },
  action_failed: { one: "1 action failed", other: "{count} actions failed" },
  auth_error: { one: "1 mailbox has a login error", other: "{count} mailboxes have a login error" },
  host_blocked: { one: "1 mailbox server is not allowed", other: "{count} mailbox servers are not allowed" },
  sync_stale: { one: "1 mailbox is not syncing", other: "{count} mailboxes are not syncing" },
  sync_ok: { one: "1 mailbox syncs again", other: "{count} mailboxes sync again" },
  sent_missing: { one: "1 mailbox has no Sent folder", other: "{count} mailboxes have no Sent folder" },
  mailbox_removed: { one: "1 mailbox was removed", other: "{count} mailboxes were removed" },
};

const plTitles: Record<PushPayloadKind, string> = {
  urgent: "Pilna poczta",
  not_triaged: "Poczta bez kategorii",
  approval: "Szkic do akceptacji",
  approval_set: "Szkice do akceptacji",
  replies_ready: "Odpowiedzi są gotowe",
  send_result: "Wynik wysyłki",
  delegation_answered: "Odpowiedź na delegację",
  send_held: "Wysyłka wstrzymana",
  action_failed: "Akcja się nie udała",
  auth_error: "Błąd logowania do skrzynki",
  host_blocked: "Serwer niedozwolony",
  sync_stale: "Skrzynka się nie synchronizuje",
  sync_ok: "Skrzynka znów się synchronizuje",
  sent_missing: "Brak folderu Wysłane",
  mailbox_removed: "Skrzynka usunięta",
  test: "Powiadomienie testowe",
};

const plBodies: Record<Exclude<PushPayloadKind, "test">, PlForms> = {
  urgent: { one: "1 pilna wiadomość", few: "{count} pilne wiadomości", many: "{count} pilnych wiadomości" },
  not_triaged: {
    one: "1 wiadomość bez kategorii",
    few: "{count} wiadomości bez kategorii",
    many: "{count} wiadomości bez kategorii",
  },
  approval: { one: "1 szkic czeka na Ciebie", few: "{count} szkice czekają", many: "{count} szkiców czeka" },
  approval_set: {
    one: "1 zestaw szkiców czeka na Ciebie",
    few: "{count} zestawy szkiców czekają",
    many: "{count} zestawów szkiców czeka",
  },
  replies_ready: {
    one: "1 odpowiedź jest gotowa",
    few: "{count} odpowiedzi są gotowe",
    many: "{count} odpowiedzi jest gotowych",
  },
  send_result: { one: "1 wynik wysyłki", few: "{count} wyniki wysyłki", many: "{count} wyników wysyłki" },
  delegation_answered: {
    one: "1 odpowiedź na delegację",
    few: "{count} odpowiedzi na delegacje",
    many: "{count} odpowiedzi na delegacje",
  },
  send_held: {
    one: "1 wysyłka jest wstrzymana",
    few: "{count} wysyłki są wstrzymane",
    many: "{count} wysyłek jest wstrzymanych",
  },
  action_failed: {
    one: "1 akcja się nie udała",
    few: "{count} akcje się nie udały",
    many: "{count} akcji się nie udało",
  },
  auth_error: {
    one: "1 skrzynka ma błąd logowania",
    few: "{count} skrzynki mają błąd logowania",
    many: "{count} skrzynek ma błąd logowania",
  },
  host_blocked: {
    one: "1 serwer skrzynki jest niedozwolony",
    few: "{count} serwery skrzynek są niedozwolone",
    many: "{count} serwerów skrzynek jest niedozwolonych",
  },
  sync_stale: {
    one: "1 skrzynka się nie synchronizuje",
    few: "{count} skrzynki się nie synchronizują",
    many: "{count} skrzynek się nie synchronizuje",
  },
  sync_ok: {
    one: "1 skrzynka znów się synchronizuje",
    few: "{count} skrzynki znów się synchronizują",
    many: "{count} skrzynek znów się synchronizuje",
  },
  sent_missing: {
    one: "1 skrzynka nie ma folderu Wysłane",
    few: "{count} skrzynki nie mają folderu Wysłane",
    many: "{count} skrzynek nie ma folderu Wysłane",
  },
  mailbox_removed: {
    one: "1 skrzynka została usunięta",
    few: "{count} skrzynki zostały usunięte",
    many: "{count} skrzynek zostało usuniętych",
  },
};

const fill = (form: string, count: number): string => form.replace("{count}", String(count));

export const pushTextTables = {
  en: {
    title: (kind) => enTitles[kind],
    body: (kind, count) => {
      if (kind === "test") return "Notices work on this device.";
      const forms = enBodies[kind];
      return fill(pluralCategory("en", count) === "one" ? forms.one : forms.other, count);
    },
  },
  pl: {
    title: (kind) => plTitles[kind],
    body: (kind, count) => {
      if (kind === "test") return "Powiadomienia działają na tym urządzeniu.";
      const forms = plBodies[kind];
      const category = pluralCategory("pl", count);
      return fill(category === "one" ? forms.one : category === "few" ? forms.few : forms.many, count);
    },
  },
} satisfies Record<UserLocale, PushTexts>;

export function pushTexts(lang: UserLocale): PushTexts {
  return pushTextTables[lang];
}
