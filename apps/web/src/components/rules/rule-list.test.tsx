/// <reference types="bun" />
import type { MailboxView, RuleView } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { en } from "../../i18n/en";
import { RuleList } from "./RuleList";

const MAILBOX = "11111111-1111-4111-8111-111111111111";
const mailboxes = [{ id: MAILBOX, address: "anna@firma.pl" }] as MailboxView[];

function rule(n: number, mailboxId: string | null): RuleView {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    kind: "vip",
    pattern: `boss${n}@e2e.test`,
    mailboxId,
    createdAt: "2026-11-11T10:00:00.000Z",
  };
}

const render = (rules: RuleView[], kind: "vip" | "blocklist" = "vip") =>
  renderToStaticMarkup(
    <RuleList kind={kind} rules={rules} mailboxes={mailboxes} isOwner onChanged={() => undefined} />
  );

describe("RuleList", () => {
  test("a VIP card with two rules has the title, the count, two chips and the link target", () => {
    const html = render([rule(1, null), rule(2, MAILBOX)]);
    expect(html).toContain('id="rules-vip"');
    expect(html).toContain('data-kind="vip"');
    expect(html).toContain(`</span>${en.rule_kind_vip}</h2>`);
    expect(html).toMatch(/<span[^>]*data-slot="badge"[^>]*>2<\/span>/);
    expect(html.match(/<li /g)).toHaveLength(2);
  });

  test("a rule for one mailbox shows its address and a rule for all mailboxes shows no scope line", () => {
    const one = render([rule(1, MAILBOX)]);
    expect(one).toContain(">anna@firma.pl</p>");
    const all = render([rule(1, null)]);
    expect(all).not.toContain(en.rules_all_mailboxes);
    expect(all).toContain(">boss1@e2e.test</p>");
  });

  test("an empty list shows the empty state under an h3 and a count of 0", () => {
    const html = render([], "blocklist");
    expect(html).toContain(`<h3 class="text-xl font-bold">${en.rules_empty}</h3>`);
    expect(html).not.toContain('id="rules-vip"');
    expect(html).toMatch(/data-slot="badge"[^>]*>0<\/span>/);
  });
});
