/// <reference types="bun" />
import { Lightbulb } from "lucide-react";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { FactBox } from "../components/patterns/FactBox";

describe("FactBox", () => {
  test("has no role attribute, with or without an icon", () => {
    const withIcon = renderToStaticMarkup(<FactBox icon={Lightbulb}>Why</FactBox>);
    const plain = renderToStaticMarkup(<FactBox>Why</FactBox>);
    expect(withIcon).not.toContain("role=");
    expect(plain).not.toContain("role=");
    expect(withIcon).toContain("<svg");
    expect(plain).not.toContain("<svg");
  });
});
