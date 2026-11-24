/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Row } from "../components/patterns/Row";
import { RowList } from "../components/patterns/RowList";
import { Switch } from "../components/ui/switch";

describe("RowList", () => {
  test("three rows have two dividers, none before the first", () => {
    const html = renderToStaticMarkup(
      <RowList>
        <Row title="One" />
        <Row title="Two" />
        <Row title="Three" />
      </RowList>
    );
    expect(html.match(/data-slot="row-divider"/g)).toHaveLength(2);
    expect(html.match(/data-slot="row"/g)).toHaveLength(3);
    expect(html.indexOf("row-divider")).toBeGreaterThan(html.indexOf("One"));
  });

  test("a row with htmlFor labels the switch with the same id by its title", () => {
    const html = renderToStaticMarkup(
      <Row title="Daily digest" hint="Every morning" htmlFor="x">
        <Switch id="x" />
      </Row>
    );
    expect(/<label[^>]*for="x"[^>]*>Daily digest<\/label>/.test(html)).toBe(true);
    expect(/<button[^>]*id="x"[^>]*role="switch"|<button[^>]*role="switch"[^>]*id="x"/.test(html)).toBe(true);
    expect(html).toContain("Every morning");
  });

  test("a row without htmlFor has a plain title and no label", () => {
    const html = renderToStaticMarkup(<Row title="Plain" />);
    expect(html).toContain("<p");
    expect(html).not.toContain("<label");
  });
});
