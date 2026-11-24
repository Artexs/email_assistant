/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { InitialsAvatar } from "../components/patterns/InitialsAvatar";

const render = (name: string) => renderToStaticMarkup(<InitialsAvatar name={name} />);
const letters = (html: string) => />([^<]*)<\/span>$/.exec(html)?.[1];
const fillOf = (html: string) => /bg-avatar-\d/.exec(html)?.[0];

describe("InitialsAvatar", () => {
  test.each([
    ["Tomasz Nowak", "TN"],
    ["anna", "A"],
    ["Jan Maria Rokita", "JM"],
    ["  Ola   Kot ", "OK"],
    ["Łukasz Żak", "ŁŻ"],
  ])("%s shows %s", (name, expected) => {
    expect(letters(render(name))).toBe(expected);
  });

  test("two renders of one name have the same fill, and the text colour is the avatar text token", () => {
    expect(fillOf(render("Tomasz Nowak"))).toBe(fillOf(render("Tomasz Nowak")));
    expect(render("Tomasz Nowak")).toContain("text-avatar-foreground");
  });

  test("50 different names use all five fills", () => {
    const fills = new Set(Array.from({ length: 50 }, (_, index) => fillOf(render(`Person Number${index}`))));
    expect([...fills].sort()).toEqual(["bg-avatar-1", "bg-avatar-2", "bg-avatar-3", "bg-avatar-4", "bg-avatar-5"]);
  });
});
