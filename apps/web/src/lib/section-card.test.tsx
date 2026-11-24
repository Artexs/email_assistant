/// <reference types="bun" />
import { Bell } from "lucide-react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SectionCard } from "../components/patterns/SectionCard";

const rootTag = (html: string) => html.slice(0, html.indexOf(">") + 1);
const classOf = (tag: string) => /class="([^"]*)"/.exec(tag)?.[1] ?? "";

describe("SectionCard", () => {
  test("passes id and data-card to its root and renders one h2", () => {
    const html = renderToStaticMarkup(
      <SectionCard icon={Bell} title="Digest" lead="Daily mail" id="digest" data-card="digest">
        <p>body</p>
      </SectionCard>
    );
    const root = rootTag(html);
    expect(root).toContain('id="digest"');
    expect(root).toContain('data-card="digest"');
    expect(html.match(/<h2[ >]/g)).toHaveLength(1);
    expect(html).toContain("Daily mail");
  });

  test("tone danger has the destructive edge and no shadow", () => {
    const danger = classOf(
      rootTag(
        renderToStaticMarkup(
          <SectionCard icon={Bell} title="Delete" tone="danger">
            x
          </SectionCard>
        )
      )
    ).split(" ");
    expect(danger).toContain("border-destructive");
    expect(danger).toContain("shadow-none");
    expect(danger.filter((name) => name.startsWith("shadow-") && name !== "shadow-none")).toEqual([]);
    const plain = classOf(
      rootTag(
        renderToStaticMarkup(
          <SectionCard icon={Bell} title="Digest">
            x
          </SectionCard>
        )
      )
    ).split(" ");
    expect(plain).not.toContain("border-destructive");
  });
});
