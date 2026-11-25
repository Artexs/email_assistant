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

  test.each([
    [true, 2],
    [false, 0],
  ])("leadingAbove %p puts the leading element on its own line below lg: %d wrap classes", (above, count) => {
    const html = renderToStaticMarkup(
      <Row title="Move out of INBOX" leading={<span>Spam</span>} leadingAbove={above} />
    );
    expect(html.match(/max-lg:(flex-wrap|basis-full)/g)?.length ?? 0).toBe(count);
  });

  test("controlBelow puts the control under the text below lg: the text takes the whole line", () => {
    const html = renderToStaticMarkup(
      <Row title="news@example.com" controlBelow>
        <button type="button">Open unsubscribe page</button>
      </Row>
    );
    expect(html.match(/max-lg:(flex-wrap|basis-full)/g)).toEqual(["max-lg:flex-wrap", "max-lg:basis-full"]);
  });
});
