/// <reference types="bun" />
import type { DelegationItem } from "@ea/core/web";
import { describe, expect, test } from "bun:test";
import { Clock } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

import { DelegationColumn, type DelegationColumnProps } from "../components/delegation/DelegationColumn";

const item = (n: number): DelegationItem => ({
  kind: "delegation",
  id: `0190f5a0-0000-7000-8000-${String(n).padStart(12, "0")}`,
  status: "sent",
  delegate: { id: "0190f5a0-0000-7000-8000-0000000000d1", name: "Anna Nowak", email: "anna@example.com", active: true },
  task: `Task ${n}`,
  subject: null,
  dueAt: null,
  sentAt: null,
  answeredAt: null,
  remindersSent: 0,
  reminderWaiting: false,
  sendId: null,
});

const noop = () => undefined;
const column = (props: Partial<DelegationColumnProps>) =>
  renderToStaticMarkup(
    <DelegationColumn
      headingId="col-sent"
      title="Sent, waiting for an answer"
      icon={Clock}
      tone="text-cat-needs-reply"
      empty="Nothing here."
      items={[]}
      next={null}
      failed={false}
      loadingMore={false}
      hint={null}
      renderRow={(row) => <li key={row.id}>{row.task}</li>}
      onMore={noop}
      onRetry={noop}
      {...props}
    />
  );

describe("DelegationColumn", () => {
  test("two rows give a heading with the title and a list that the heading names, with two items", () => {
    const html = column({ items: [item(1), item(2)] });
    expect(html).toContain(
      '<h2 id="col-sent" class="text-base font-bold text-cat-needs-reply">Sent, waiting for an answer</h2>'
    );
    expect(html).toContain('<ul aria-labelledby="col-sent"');
    expect(html.match(/<li>/g)).toHaveLength(2);
    expect(html).not.toContain("Nothing here.");
    expect(html).not.toContain("Show more");
    expect(html).toContain(">2</span>");
  });

  test("no rows and an ended list show the empty line, no list and no Show more", () => {
    const html = column({});
    expect(html).toContain("Nothing here.");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("Show more");
    expect(html).toContain(">0</span>");
  });

  test("no rows and a cursor show Show more and not the empty line", () => {
    const html = column({ next: "c1" });
    expect(html).toContain("Show more");
    expect(html).not.toContain("Nothing here.");
    expect(html).toContain(">0+</span>");
  });

  test("a cursor gives the count with a plus, and Show more is aria-disabled, not disabled, while a page loads", () => {
    const html = column({ items: [item(1), item(2)], next: "c1", loadingMore: true });
    expect(html).toContain(">2+</span>");
    expect(html).toMatch(/<button[^>]* aria-disabled="true"[^>]*>Show more</);
    expect(html).not.toMatch(/ disabled=""/);
    expect(column({ items: [item(1)], next: "c1" })).not.toContain(`aria-disabled="true"`);
  });

  test("a failed list shows the load error and Retry in place of the rows and the count", () => {
    const html = column({ failed: true, next: "c1" });
    expect(html).toContain("The delegations did not load.");
    expect(html).toContain(">Retry<");
    expect(html).not.toContain("Show more");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain("rounded-full bg-card");
  });

  test("a hint shows in a live line, and the line stays in the page without one", () => {
    expect(column({ hint: { text: "No new rows yet. Press Show more again.", error: false } })).toContain(
      'aria-live="polite" class="px-1.5 text-sm empty:hidden text-muted-foreground">No new rows yet.'
    );
    expect(column({ hint: { text: "More delegations did not load.", error: true } })).toContain("text-destructive");
    expect(column({})).toContain('aria-live="polite"');
  });
});
