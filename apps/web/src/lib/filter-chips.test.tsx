/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { FilterChips } from "../components/patterns/FilterChips";

const options = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
  { value: "c", label: "Gamma" },
];

type Props = Parameters<typeof FilterChips<string>>[0];

// FilterChips holds no state, so calling it returns its element tree; the click of one chip is the `onClick` of its button.
function click(props: Props, label: string): void {
  const buttons: { children: unknown; onClick: () => void }[] = [];
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (typeof node !== "object" || node === null) return;
    const element = node as ReactElement<{ children?: unknown; onClick?: () => void }>;
    if (element.type === "button" && element.props.onClick !== undefined)
      buttons.push({ children: element.props.children, onClick: element.props.onClick });
    walk(element.props.children);
  };
  walk(FilterChips(props));
  const button = buttons.find((entry) => entry.children === label);
  if (button === undefined) throw new Error(`no chip named ${label}`);
  button.onClick();
}

function run(props: Omit<Props, "onChange" | "label" | "options">, label: string): string[][] {
  const calls: string[][] = [];
  click({ label: "L", options, onChange: (next) => calls.push(next), ...props }, label);
  return calls;
}

describe("FilterChips", () => {
  test("is a group named by the label, with aria-pressed on each chip", () => {
    const html = renderToStaticMarkup(
      <FilterChips label="Filter by kind" options={options} value={["b"]} onChange={() => undefined} />
    );
    expect(html).toContain('role="group" aria-label="Filter by kind"');
    expect(html.match(/aria-pressed="(true|false)"/g)).toEqual([
      'aria-pressed="false"',
      'aria-pressed="true"',
      'aria-pressed="false"',
    ]);
  });

  test("single: a click on another chip gives only that value; a click on the pressed chip gives nothing", () => {
    expect(run({ value: ["a"], single: true }, "Beta")).toEqual([["b"]]);
    expect(run({ value: ["a"], single: true }, "Alpha")).toEqual([]);
  });

  test("without single: a click adds the value in option order, and a second click removes it", () => {
    expect(run({ value: ["c"] }, "Alpha")).toEqual([["a", "c"]]);
    expect(run({ value: ["a", "b"] }, "Alpha")).toEqual([["b"]]);
  });
});
