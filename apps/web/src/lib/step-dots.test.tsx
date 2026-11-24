/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { StepDots } from "../components/patterns/StepDots";

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("StepDots", () => {
  test("5 steps draw 5 dots, the first two done, and no bar", () => {
    const html = renderToStaticMarkup(<StepDots current={2} total={5} label="Draft 2 of 5" />);
    expect(count(html, "<i ")).toBe(5);
    expect(count(html, 'data-step="done"')).toBe(2);
    expect(html).not.toContain('data-part="bar"');
    expect(html).toContain('aria-label="Draft 2 of 5"');
  });

  test("12 steps draw one bar and no dot, a quarter full at step 3", () => {
    const html = renderToStaticMarkup(<StepDots current={3} total={12} label="Draft 3 of 12" />);
    expect(count(html, "<i ")).toBe(0);
    expect(html).toContain('data-part="bar" width="40"');
  });

  test("8 steps still draw dots and 9 draw a bar", () => {
    expect(count(renderToStaticMarkup(<StepDots current={1} total={8} label="x" />), "<i ")).toBe(8);
    expect(renderToStaticMarkup(<StepDots current={1} total={9} label="x" />)).toContain('data-part="bar"');
  });
});
