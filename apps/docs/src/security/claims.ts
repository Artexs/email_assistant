// The claims of the public security page (spec/features/active/F121-e10b-public-pages-and-demo). Each claim cites rows of the claims ledger
// (`docs/legal/claims.md`) and repo files that prove it. `claimProblems` is the check; the build runs it (`integrations/claim-check.ts`).
import { existsSync } from "node:fs";
import { isAbsolute, join, relative } from "node:path";
import type { Texts } from "@ea/core/web";
import { docsGitRef, REPO_URL } from "../in-place";

export interface PublicClaim {
  id: string;
  text: Texts;
  // Row ids of the ledger (`C018`).
  ledger: readonly string[];
  // Repo paths, relative to the repo root.
  proofs: readonly string[];
  // The condition under which the claim holds (the ledger's condition column); null when the cited rows have none.
  condition: Texts | null;
}

// The rows below keep to the wording of their ledger rows. A fact that only a `gap` or `unverified` row holds is not here:
// the buyer facts among them stand in the "does not promise" section of the page (`security.mdx`).
export const publicClaims: readonly PublicClaim[] = [
  {
    id: "never-sends-alone",
    text: {
      en: "The system sends a draft only after an owner approves it. The approval message shows the owner the full text of the draft.",
      pl: "System wysyła szkic dopiero po zatwierdzeniu go przez właściciela. Wiadomość z prośbą o zatwierdzenie pokazuje właścicielowi pełny tekst szkicu.",
    },
    ledger: ["C018", "C099"],
    proofs: ["docs/capabilities/drafts-and-send.md", "apps/server/test/integration/actions-approvals.test.ts"],
    condition: null,
  },
  {
    id: "mail-storage",
    text: {
      en: "The assistant stores the text, subject and addresses of the mail of the connected mailboxes, and header facts such as the sender name, Reply-To, authentication results, list data, attachment names and sizes, and link hosts. The hosting is one server.",
      pl: "Asystent przechowuje treść, temat i adresy wiadomości z podłączonych skrzynek oraz fakty z nagłówków, takie jak nazwa nadawcy, Reply-To, wyniki uwierzytelnienia, dane listy, nazwy i rozmiary załączników oraz hosty linków. Hosting to jeden serwer.",
    },
    ledger: ["C005", "C199"],
    proofs: ["docs/architecture.md", "docs/decisions/0017-web-access-tailscale-serve.md"],
    condition: {
      en: "This holds for the install on a home server only.",
      pl: "Dotyczy tylko instalacji na serwerze domowym.",
    },
  },
  {
    id: "ai-provider-receives",
    text: {
      en: "This install uses OpenAI as the AI model. For each mail that it classifies, the assistant sends the text, subject, sender, To and Cc addresses and date, whether the sender is on the whitelist or the VIP list or looks automatic, the delegates, and up to three earlier mails of the same thread as context. Each context mail carries its sender, subject, date and up to 500 characters of its body, and it can be older than 7 days. The assistant does not classify a mail that is older than 7 days, unless the operator loads old mail once or the optional history check runs. That check, off by default, classifies up to 500 mails of the last 30 days when it is turned on, when a mailbox is connected, on request and after a change of the AI model. The operator of the install can also start that check by hand, and it then runs when the feature is off.",
      pl: "Ta instalacja używa OpenAI jako modelu AI. Dla każdej klasyfikowanej wiadomości asystent wysyła treść, temat, nadawcę, adresy Do i DW oraz datę, informację, czy nadawca jest na białej liście lub liście VIP albo wygląda na automatyczny, wykonawców oraz do trzech wcześniejszych wiadomości z tego samego wątku jako kontekst. Każda wiadomość kontekstowa zawiera nadawcę, temat, datę i do 500 znaków treści, a może być starsza niż 7 dni. Asystent nie klasyfikuje wiadomości starszej niż 7 dni, chyba że operator jednorazowo załaduje starszą pocztę albo działa opcjonalna kontrola historii. Ta kontrola, domyślnie wyłączona, klasyfikuje do 500 wiadomości z ostatnich 30 dni po jej włączeniu, po podłączeniu skrzynki, na żądanie i po zmianie modelu AI. Operator instalacji może też uruchomić tę kontrolę ręcznie, a wtedy działa ona także przy wyłączonej funkcji.",
    },
    ledger: ["C030", "C031", "C032", "C261", "C262"],
    proofs: [
      "docs/capabilities/triage.md",
      "docs/capabilities/sync.md",
      "apps/server/src/modules/mail/repo/lookup.ts",
      "docs/capabilities/trust.md",
      "docs/decisions/0015-llm-provider-switch.md",
      "docs/architecture.md",
    ],
    condition: {
      en: "The install uses the OpenAI provider.",
      pl: "Instalacja używa dostawcy OpenAI.",
    },
  },
  {
    id: "ai-provider-keeps",
    text: {
      en: "The assistant asks OpenAI not to store the data. OpenAI keeps abuse logs for up to 30 days (its data-controls page, read 2026-11-17).",
      pl: "Asystent prosi OpenAI, aby nie przechowywało danych. OpenAI przechowuje logi nadużyć do 30 dni (jego strona o kontroli danych, stan na 2026-11-17).",
    },
    ledger: ["C034", "C035"],
    proofs: [
      "apps/server/src/platform/llm/providers/openai.ts",
      "apps/server/src/platform/llm/providers/openai.test.ts",
      "docs/decisions/0015-llm-provider-switch.md",
    ],
    condition: {
      en: "The OpenAI terms stay as they were on 2026-11-17.",
      pl: "Warunki OpenAI pozostają takie, jak 2026-11-17.",
    },
  },
  {
    id: "telegram",
    text: {
      en: "Telegram gets only the items that the consent text names, and no raw mail body. Chats with a bot are not end-to-end encrypted. Telegram keeps the messages until the member deletes them in the chat.",
      pl: "Telegram dostaje tylko pozycje wymienione w tekście zgody i żadnej surowej treści wiadomości. Czaty z botem nie są szyfrowane end-to-end. Telegram przechowuje wiadomości, dopóki członek organizacji nie usunie ich w czacie.",
    },
    ledger: ["C204", "C041", "C028"],
    proofs: ["docs/architecture.md", "packages/core/src/legal/subprocessors.ts", "apps/web/src/i18n/en.ts"],
    condition: null,
  },
  {
    id: "backups",
    text: {
      en: "Each night the server makes a backup of the whole database. The backup is encrypted with age before it leaves the server, and the key that decrypts it is not on the server. A backup holds the data as it was, also texts that the retention job cleared later and data that a delete removed later.",
      pl: "Co noc serwer robi kopię zapasową całej bazy danych. Kopia jest szyfrowana narzędziem age, zanim opuści serwer, a klucz do jej odszyfrowania nie leży na serwerze. Kopia zawiera dane takie, jakie były, także teksty wyczyszczone później i dane usunięte później.",
    },
    ledger: ["C024", "C044"],
    proofs: ["docs/capabilities/backups.md", "deploy/backup.sh"],
    condition: {
      en: "This holds for the install on a home server, where the host runs the backup.",
      pl: "Dotyczy instalacji na serwerze domowym, gdzie host wykonuje kopię zapasową.",
    },
  },
  {
    id: "logs",
    text: {
      en: "Server logs hold ids, counts, codes and times, and no mail text, address or password.",
      pl: "Logi serwera zawierają identyfikatory, liczby, kody i czasy, a nie zawierają treści wiadomości, adresów ani haseł.",
    },
    ledger: ["C014", "C203"],
    proofs: [
      "docs/capabilities/logs.md",
      "apps/server/test/integration/log-canary.test.ts",
      "docs/decisions/0024-structured-logs-and-operator-alerts.md",
    ],
    condition: null,
  },
  {
    id: "healthchecks",
    text: {
      en: "The alert service Healthchecks.io gets a timing ping and no personal data. It alerts when the server stops.",
      pl: "Usługa alarmowa Healthchecks.io dostaje ping czasowy i żadnych danych osobowych. Alarmuje, gdy serwer przestaje działać.",
    },
    ledger: ["C152"],
    proofs: ["apps/server/src/platform/heartbeat.ts", "deploy/README.md"],
    condition: {
      en: "The operator sets up the alert service.",
      pl: "Operator konfiguruje usługę alarmową.",
    },
  },
  {
    id: "retention",
    text: {
      en: "A job runs once a day. It clears the mail body after 30 days by default (the organization sets the period) and the subject, addresses, AI texts and notices after 90 days. The rows stay.",
      pl: "Raz dziennie działa zadanie. Czyści treść wiadomości po 30 dniach domyślnie (okres ustawia organizacja) oraz temat, adresy, teksty AI i powiadomienia po 90 dniach. Wiersze zostają.",
    },
    ledger: ["C202", "C168", "C023"],
    proofs: ["docs/capabilities/retention.md", "apps/server/test/integration/retention-job.test.ts"],
    condition: null,
  },
  {
    id: "export-and-delete",
    text: {
      en: "The operator makes an encrypted export of the data of an organization; it holds no password hash, mailbox secret, token or session. A delete removes the mailboxes, mail, results, rules, Telegram links, audit log and accounts of the members at once. On the written instruction of the organization, the operator can find the data of one person and erase it. Backups keep the rows of a deleted organization until they expire.",
      pl: "Operator robi zaszyfrowany eksport danych organizacji; nie zawiera on skrótów haseł, sekretów skrzynek, tokenów ani sesji. Usunięcie kasuje od razu skrzynki, pocztę, wyniki, reguły, powiązania z Telegramem, dziennik audytu i konta członków. Na pisemne polecenie organizacji operator może znaleźć dane jednej osoby i je usunąć. Kopie zapasowe przechowują wiersze usuniętej organizacji do czasu ich wygaśnięcia.",
    },
    ledger: ["C055", "C057", "C060", "C058"],
    proofs: [
      "docs/capabilities/account-data.md",
      "apps/server/test/integration/privacy-export-map.test.ts",
      "apps/server/test/integration/account-data-delete.test.ts",
      "apps/server/test/integration/privacy-dsr-erase-scrub.test.ts",
      "apps/server/test/integration/privacy-dsr-erase-guards.test.ts",
      "apps/server/test/integration/privacy-dsr-erase-locks.test.ts",
      "apps/server/test/integration/privacy-dsr-erase-cli.test.ts",
      "docs/capabilities/backups.md",
    ],
    condition: null,
  },
  {
    id: "undo",
    text: {
      en: "Each sorting decision has a reason code in the audit log. The member can reverse an automatic move with Undo for 7 days, in Telegram or in the panel.",
      pl: "Każda decyzja o sortowaniu ma kod powodu w dzienniku audytu. Członek organizacji może cofnąć automatyczne przeniesienie przyciskiem Cofnij przez 7 dni, w Telegramie lub w panelu.",
    },
    ledger: ["C052", "C053"],
    proofs: [
      "apps/server/src/modules/triage/service.ts",
      "docs/capabilities/actions-and-undo.md",
      "apps/server/test/integration/actions-undo.test.ts",
    ],
    condition: null,
  },
  {
    id: "shadow-first",
    text: {
      en: "A new mailbox starts in shadow mode: nothing changes in the mailbox. In assist mode a move happens only for a category that the owner set to run by itself and that passed the quality gate. Mail the assistant is unsure about moves only with a separate switch.",
      pl: "Nowa skrzynka zaczyna w trybie cienia: nic się w niej nie zmienia. W trybie asysty przeniesienie następuje tylko dla kategorii, którą właściciel ustawił do automatycznej obsługi i która przeszła bramkę jakości. Wiadomości, co do których asystent ma wątpliwości, są przenoszone tylko przy osobnym przełączniku.",
    },
    ledger: ["C050", "C051"],
    proofs: [
      "docs/architecture.md",
      "docs/capabilities/actions-and-undo.md",
      "apps/server/test/integration/triage-gate.test.ts",
    ],
    condition: null,
  },
  {
    id: "private-panel",
    text: {
      en: "The panel is reachable only through Tailscale, by members of the private network, and has no public address.",
      pl: "Panel jest dostępny tylko przez Tailscale, dla członków sieci prywatnej, i nie ma publicznego adresu.",
    },
    ledger: ["C066"],
    proofs: ["docs/decisions/0017-web-access-tailscale-serve.md", "docs/architecture.md"],
    condition: {
      en: "This holds for the install on a home server. A public address for the panel would change it.",
      pl: "Dotyczy instalacji na serwerze domowym. Publiczny adres panelu by to zmienił.",
    },
  },
];

export interface LedgerRow {
  id: string;
  source: string;
  condition: string;
}

const LEDGER_ROW = /^\|\s*(C\d{3})\s*\|/;
const WEAK = /\b(?:gap|unverified)\b/i;
const NO_CONDITION = "—";

// The rows of the ledger table: `| C018 | claim | source | condition |`. A line of another shape is no row.
export function parseLedger(ledgerText: string): Map<string, LedgerRow> {
  const rows = new Map<string, LedgerRow>();
  for (const line of ledgerText.split("\n")) {
    const id = LEDGER_ROW.exec(line)?.[1];
    if (id === undefined) continue;
    const cells = line
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((cell) => cell.trim());
    if (cells.length < 4) continue;
    rows.set(id, { id, source: cells[2] ?? "", condition: cells[3] ?? "" });
  }
  return rows;
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Does the source cell name the path, its file name, or `ADR NNNN` for `docs/decisions/NNNN-*.md`?
function sourceNames(source: string, path: string): boolean {
  const names = [path, path.slice(path.lastIndexOf("/") + 1)];
  const adr = /^docs\/decisions\/(\d{4})-[^/]+\.md$/.exec(path)?.[1];
  const patterns = names.map((name) => `(?<![\\w./-])${escapeRegExp(name)}(?![\\w-]|\\.\\w)`);
  if (adr !== undefined) patterns.push(`\\bADR\\s+${adr}\\b`);
  return new RegExp(patterns.join("|")).test(source);
}

// A repo path that stays inside the root: not absolute, no `..`, no URL.
function isRepoPath(path: string): boolean {
  if (path === "" || isAbsolute(path) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(path)) return false;
  return !path.split("/").includes("..");
}

/** Each problem reads `claim <id> <reason>`. An empty list means every claim is proven. */
export function claimProblems(claims: readonly PublicClaim[], root: string, ledgerText: string): string[] {
  const ledger = parseLedger(ledgerText);
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const claim of claims) {
    const problem = (reason: string) => problems.push(`claim ${claim.id} ${reason}`);
    if (seen.has(claim.id)) problem("duplicate_id");
    seen.add(claim.id);

    if (claim.ledger.length === 0) problem("no_ledger");
    const cited: LedgerRow[] = [];
    for (const rowId of claim.ledger) {
      const row = ledger.get(rowId);
      if (row === undefined) {
        problem(`ledger_missing ${rowId}`);
        continue;
      }
      if (WEAK.test(row.source)) problem(`ledger_weak ${rowId}`);
      cited.push(row);
    }

    if (claim.proofs.length === 0) problem("no_proof");
    for (const path of claim.proofs) {
      const inside = isRepoPath(path) && !relative(root, join(root, path)).startsWith("..");
      if (!inside || !existsSync(join(root, path))) {
        problem(`proof_missing ${path}`);
        continue;
      }
      if (!cited.some((row) => sourceNames(row.source, path))) problem(`proof_not_in_ledger ${path}`);
    }

    if (claim.condition === null && cited.some((row) => row.condition !== NO_CONDITION && row.condition !== "")) {
      problem("condition_missing");
    }
  }
  return problems;
}

/** The GitHub link of a proof file at `ref` (the tag of a deploy, else `master`). */
export function proofUrl(path: string, ref: string = docsGitRef()): string {
  return `${REPO_URL}/blob/${ref}/${path}`;
}
