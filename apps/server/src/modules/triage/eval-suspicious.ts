import {
  assessSuspicious,
  freeMailDomains,
  registrableDomain,
  splitAddress,
  suspiciousReasons,
  type EvalCase,
  type Scenario,
  type SimPersonaGroup,
  type SuspiciousInput,
  type SuspiciousReason,
} from "@ea/core";

import { linkPairsOfHtml } from "../mail";

// The sim stand-in for the known senders of production (the known-sender rule). It is not the production rule: production
// also counts frequent senders (3 clean mails in 90 days), and the sim has no such history for a mail's sender.
const KNOWN_GROUPS: readonly SimPersonaGroup[] = ["team", "delegate", "client", "vendor", "boss", "partner"];

const MIME_OF_EXTENSION: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  txt: "text/plain",
  csv: "text/csv",
  zip: "application/zip",
  ics: "text/calendar",
};

export function typeOfName(name: string): string {
  const dot = name.lastIndexOf(".");
  const extension = dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
  return MIME_OF_EXTENSION[extension] ?? "application/octet-stream";
}

function headerOf(headers: Readonly<Record<string, string>>, name: string): string | null {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers).find((entry) => entry.toLowerCase() === wanted);
  return key === undefined ? null : (headers[key] ?? null);
}

interface KnownSet {
  addresses: ReadonlySet<string>;
  // Domains that make every sender on them known: the company, the delegates, domain rules; never a free-mail domain.
  senderDomains: ReadonlySet<string>;
  // The registrable domains of the known addresses and rules only, as in production.
  knownDomains: string[];
  protectedNames: string[];
}

function isFreeMail(domain: string): boolean {
  return freeMailDomains.includes(domain);
}

function knownSetOf(scenario: Scenario, senderRules: EvalCase["senderRules"]): KnownSet {
  const personaOf = (key: string) => scenario.personas.find((persona) => persona.key === key);
  const delegates = scenario.delegates.flatMap((entry) => personaOf(entry.persona) ?? []);
  const vips = scenario.urgency.vip.flatMap((key) => personaOf(key) ?? []);
  const groupMembers = scenario.personas.filter((persona) => KNOWN_GROUPS.includes(persona.group));

  const addresses = new Set<string>();
  const senderDomains = new Set<string>([registrableDomain(scenario.company.domain)]);
  const knownDomains = new Set<string>([registrableDomain(scenario.company.domain)]);

  for (const persona of [...groupMembers, ...delegates, ...vips]) {
    addresses.add(persona.address.toLowerCase());
    knownDomains.add(registrableDomain(persona.address.split("@")[1] ?? ""));
  }
  for (const persona of delegates) {
    const domain = registrableDomain(persona.address.split("@")[1] ?? "");
    if (!isFreeMail(domain)) senderDomains.add(domain);
  }
  for (const rule of senderRules) {
    if (rule.kind === "blocklist") continue;
    const pattern = rule.pattern.trim().toLowerCase();
    if (pattern.startsWith("@")) {
      const domain = registrableDomain(pattern.slice(1));
      if (isFreeMail(domain)) continue;
      senderDomains.add(domain);
      knownDomains.add(domain);
    } else {
      addresses.add(pattern);
      knownDomains.add(registrableDomain(pattern.split("@")[1] ?? ""));
    }
  }
  return {
    addresses,
    senderDomains,
    knownDomains: [...knownDomains].sort(),
    protectedNames: [...delegates, ...vips].map((persona) => persona.displayName),
  };
}

/**
 * The `assessSuspicious` input of one sim case. `html` is the HTML part of the case, when the corpus text has
 * one: the eval case holds only the body text.
 */
export function suspiciousInputOfCase(evalCase: EvalCase, scenario: Scenario, html?: string | null): SuspiciousInput {
  const from = splitAddress(evalCase.from);
  const headers = evalCase.sim?.headers ?? {};
  const known = knownSetOf(scenario, evalCase.senderRules);
  const address = from.address.toLowerCase();
  const domain = registrableDomain(address.split("@")[1] ?? "");
  const replyTo = headerOf(headers, "Reply-To");
  return {
    fromAddress: from.address,
    fromName: from.name,
    replyTo: replyTo === null ? [] : replyTo.split(",").map((value) => splitAddress(value).address.toLowerCase()),
    authResults: headerOf(headers, "Authentication-Results"),
    trustedAuthservIds: [],
    links: html === undefined || html === null ? [] : linkPairsOfHtml(html),
    attachments: (evalCase.sim?.attachments ?? []).map((item) => ({ name: item.name, type: typeOfName(item.name) })),
    isList: headerOf(headers, "List-Id") !== null || headerOf(headers, "List-Unsubscribe") !== null,
    senderKnown: known.addresses.has(address) || known.senderDomains.has(domain),
    knownDomains: known.knownDomains,
    protectedNames: known.protectedNames,
  };
}

export interface SuspiciousRow {
  id: string;
  category: EvalCase["expected"]["category"];
  phishingTags: string[];
  whitelisted: boolean;
  // The sender is a persona of the group `phishing`. A case from it has no `phishing_*` tag unless a hard-case rule gave one.
  phishingSender: boolean;
  reasons: SuspiciousReason[];
}

function isWhitelisted(evalCase: EvalCase): boolean {
  const address = splitAddress(evalCase.from).address.toLowerCase();
  const domain = address.split("@")[1] ?? "";
  return evalCase.senderRules.some((rule) => {
    if (rule.kind !== "whitelist" && rule.kind !== "vip") return false;
    const pattern = rule.pattern.trim().toLowerCase();
    return pattern.startsWith("@")
      ? registrableDomain(pattern.slice(1)) === registrableDomain(domain)
      : pattern === address;
  });
}

export function suspiciousRows(
  cases: readonly EvalCase[],
  scenario: Scenario,
  htmlById: ReadonlyMap<string, string>
): SuspiciousRow[] {
  const phishingAddresses = new Set(
    scenario.personas.filter((persona) => persona.group === "phishing").map((persona) => persona.address.toLowerCase())
  );
  return cases.map((evalCase) => ({
    id: evalCase.id,
    category: evalCase.expected.category,
    phishingTags: (evalCase.sim?.hardCases ?? []).filter((tag) => tag.startsWith("phishing_")),
    whitelisted: isWhitelisted(evalCase),
    phishingSender: phishingAddresses.has(splitAddress(evalCase.from).address.toLowerCase()),
    reasons: assessSuspicious(suspiciousInputOfCase(evalCase, scenario, htmlById.get(evalCase.id))),
  }));
}

// Targets (default; the owner confirms). They apply to the holdout; the other parts print them as a guide.
export const TARGETS = { recall: 0.9, whitelistedFlagged: 0, otherFlagRate: 0.02 } as const;

const pct = (part: number, total: number): string => (total === 0 ? "n/a" : `${((part / total) * 100).toFixed(1)}%`);

export interface SuspiciousReportInput {
  rows: readonly SuspiciousRow[];
  corpus: { scenario: string; version: string; part: string; manifestSha: string | null; audit: string };
  date: string;
  // Dev only: the report lists case ids. The holdout and week reports hold counts only.
  listIds: boolean;
}

export function renderSuspiciousReport(input: SuspiciousReportInput): string {
  const { rows, corpus } = input;
  const flagged = (row: SuspiciousRow) => row.reasons.length > 0;
  const phishing = rows.filter((row) => row.phishingTags.length > 0);
  const others = rows.filter((row) => row.phishingTags.length === 0);
  const whitelisted = rows.filter((row) => row.whitelisted);
  const phishingFlagged = phishing.filter(flagged);
  const whitelistedFlagged = whitelisted.filter(flagged);
  const othersFlagged = others.filter(flagged);
  const otherPersonas = others.filter((row) => !row.phishingSender);
  const otherPersonasFlagged = otherPersonas.filter(flagged);
  const fromPhishingPersona = othersFlagged.filter((row) => row.phishingSender);

  const tags = [...new Set(phishing.flatMap((row) => row.phishingTags))].sort();
  const categories = [...new Set(rows.map((row) => row.category))].sort();
  const manifest = corpus.manifestSha === null ? "not frozen" : `manifest ${corpus.manifestSha.slice(0, 12)}`;
  const recallOk = phishing.length > 0 && phishingFlagged.length / phishing.length >= TARGETS.recall;
  const whitelistOk = whitelistedFlagged.length <= TARGETS.whitelistedFlagged;
  const rateOk = others.length === 0 || othersFlagged.length / others.length <= TARGETS.otherFlagRate;

  const lines: string[] = [
    `# Suspicious-mail rules: sim ${corpus.scenario} ${corpus.part}`,
    "",
    `- date: ${input.date}`,
    "- rules: assessSuspicious (packages/core/src/triage/suspicious.ts); no LLM call, no spend",
    `- corpus: ${corpus.scenario} v${corpus.version} (${corpus.part}), ${manifest}, owner audit: ${corpus.audit}`,
    `- cases: ${rows.length}`,
    "- known senders (sim stand-in): the company domain, delegates, the case's VIP and whitelist rules, and personas of the groups team, delegate, client, vendor, boss, partner",
    "- trusted authserv-ids: none (lab-01 has no Authentication-Results header; `auth_fail` stays at 0)",
    `- ids listed: ${input.listIds ? "yes (dev)" : "no (counts only)"}`,
    "",
    "## Targets (default, owner to confirm)",
    "",
    "| target | limit | result | status |",
    "| --- | --- | --- | --- |",
    `| phishing recall | >= ${TARGETS.recall * 100}% | ${phishingFlagged.length} of ${phishing.length} (${pct(phishingFlagged.length, phishing.length)}) | ${recallOk ? "met" : "missed"} |`,
    `| whitelisted cases flagged | ${TARGETS.whitelistedFlagged} | ${whitelistedFlagged.length} of ${whitelisted.length} | ${whitelistOk ? "met" : "missed"} |`,
    `| non-phishing flag rate | <= ${TARGETS.otherFlagRate * 100}% | ${othersFlagged.length} of ${others.length} (${pct(othersFlagged.length, others.length)}) | ${rateOk ? "met" : "missed"} |`,
    "",
    "Secondary view (not a target): the cases flagged without a `phishing_*` tag may come from a phishing persona. The rules flag them for the right reason.",
    "",
    "| view | flagged | total |",
    "| --- | --- | --- |",
    `| non-phishing cases flagged, sender is a phishing persona | ${fromPhishingPersona.length} | ${others.filter((row) => row.phishingSender).length} |`,
    `| non-phishing cases flagged, sender is not a phishing persona (rate ${pct(otherPersonasFlagged.length, otherPersonas.length)}) | ${otherPersonasFlagged.length} | ${otherPersonas.length} |`,
    "",
    "## Phishing cases per tag",
    "",
    "| tag | flagged | total |",
    "| --- | --- | --- |",
    ...tags.map((tag) => {
      const tagged = phishing.filter((row) => row.phishingTags.includes(tag));
      return `| ${tag} | ${tagged.filter(flagged).length} | ${tagged.length} |`;
    }),
    `| all phishing cases | ${phishingFlagged.length} | ${phishing.length} |`,
    "",
    "## Non-phishing cases flagged, by truth category",
    "",
    "| truth category | flagged | total |",
    "| --- | --- | --- |",
    ...categories.map((category) => {
      const inCategory = others.filter((row) => row.category === category);
      return `| ${category} | ${inCategory.filter(flagged).length} | ${inCategory.length} |`;
    }),
    "",
    "## Reason codes",
    "",
    "| reason | cases (all) | phishing cases | other cases |",
    "| --- | --- | --- | --- |",
    ...suspiciousReasons.map((reason) => {
      const count = (list: readonly SuspiciousRow[]) => list.filter((row) => row.reasons.includes(reason)).length;
      return `| ${reason} | ${count(rows)} | ${count(phishing)} | ${count(others)} |`;
    }),
  ];

  if (input.listIds) {
    const entry = (row: SuspiciousRow) => `- ${row.id} (${row.category}): ${row.reasons.join(", ") || "no reason"}`;
    lines.push(
      "",
      "## Phishing cases not flagged (dev ids)",
      "",
      ...phishing.filter((row) => !flagged(row)).map(entry),
      ...(phishing.every(flagged) ? ["- none"] : []),
      "",
      "## Non-phishing cases flagged (dev ids)",
      "",
      ...othersFlagged.map(entry),
      ...(othersFlagged.length === 0 ? ["- none"] : []),
      "",
      "## Whitelisted cases flagged (dev ids)",
      "",
      ...whitelistedFlagged.map(entry),
      ...(whitelistedFlagged.length === 0 ? ["- none"] : [])
    );
  }
  lines.push(
    "",
    "## What these numbers show",
    "",
    "- All lab-01 phishing comes from one persona with one look-alike domain. The recall number tests mainly `lookalike_domain` on that domain. It says little about display-name, Reply-To, link or auth rules, and it does not show recall on other phishing.",
    "- The sim has no `Authentication-Results`, no `Reply-To` and no HTML links. Those rules stay at 0 here. The non-phishing flag rate does not cover marketing mail with tracking links.",
    "- Known senders differ from production. The sim uses persona groups. Production also counts frequent senders (3 clean mails in 90 days), and a phisher can reach that state.",
    ""
  );
  return lines.join("\n");
}
