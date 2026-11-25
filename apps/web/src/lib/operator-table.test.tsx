/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrgTable } from "../components/operator/OrgTable";
import { Button } from "../components/ui/button";
import { orgList } from "../../e2e/tests/operator-fixtures";

const NOW = new Date("2026-11-24T10:00:00.000Z");

// Every element of a returned tree, depth first. The components inside are not run: only the props the table passes are read.
function elementsOf(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap((child: ReactNode) => elementsOf(child));
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elementsOf(node.props.children as ReactNode)];
}

describe("OrgTable", () => {
  test("it renders one body row per organization and marks the selected one", () => {
    const html = renderToStaticMarkup(
      <OrgTable orgs={orgList.orgs} selected={orgList.orgs[1]?.orgId ?? null} now={NOW} onSelect={() => undefined} />
    );
    const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
    expect(body.match(/<tr /g)?.length).toBe(3);
    expect(body.match(/data-state="selected"/g)?.length).toBe(1);
    const selectedRow = body.split("<tr ")[2] ?? "";
    expect(selectedRow).toContain('data-state="selected"');
    expect(selectedRow).toContain(orgList.orgs[1]?.orgId.slice(0, 8));
  });

  test("a click on the id button of row 2 selects that organization once", () => {
    const calls: string[] = [];
    let stopped = 0;
    const tree = OrgTable({ orgs: orgList.orgs, selected: null, now: NOW, onSelect: (orgId) => calls.push(orgId) });
    const buttons = elementsOf(tree).filter((element) => element.type === Button);
    expect(buttons).toHaveLength(3);
    const onClick = buttons[1]?.props.onClick as (event: { stopPropagation(): void }) => void;
    onClick({
      stopPropagation: () => {
        stopped += 1;
      },
    });
    expect({ calls, stopped }).toEqual({ calls: [orgList.orgs[1]?.orgId], stopped: 1 });
  });
});
