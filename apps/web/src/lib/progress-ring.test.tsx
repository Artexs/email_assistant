/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ProgressRing } from "../components/patterns/ProgressRing";

// The share of the circle that the arc draws; no arc is a share of 0.
function share(html: string): number {
  const match = /stroke-dasharray="([\d.]+) ([\d.]+)"/.exec(html);
  return match === null ? 0 : Number(match[1]) / Number(match[2]);
}

const ring = (value: number, max: number) => renderToStaticMarkup(<ProgressRing value={value} max={max} label="L" />);

describe("ProgressRing", () => {
  test.each([
    [2, 10, 0.2],
    [0, 0, 0],
    [12, 10, 1],
    [-3, 10, 0],
  ])("value %d of max %d draws %d of the circle", (value, max, expected) => {
    expect(share(ring(value, max))).toBeCloseTo(expected, 10);
  });

  test.each([
    [0, 10],
    [0, 0],
    [-3, 10],
  ])("value %d of max %d draws no arc, so no dot shows at the top", (value, max) => {
    expect(ring(value, max)).not.toContain('data-part="arc"');
  });

  test("is an image named by the label and carries no inline style", () => {
    const html = renderToStaticMarkup(
      <ProgressRing value={1} max={2} label="1 of 2 answered">
        1/2
      </ProgressRing>
    );
    expect(html).toContain('role="img" aria-label="1 of 2 answered"');
    expect(html).toContain("1/2");
    expect(html).not.toContain("style=");
  });
});
