import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { checkImages, cssImageSources, imageSources } from "./image-check";

const html = (body: string, head = "") =>
  `<!doctype html><html><head><title>t</title>${head}</head><body>${body}</body></html>`;

describe("imageSources", () => {
  test("reads img src, every srcset entry, source, poster, icon links, image meta and CSS url() of images", () => {
    const page = html(
      `<picture><source media="(max-width: 600px)" srcset="/a.png 1x, /b.png 2x"><img src="/c.png" srcset="/d.png 480w"></picture>` +
        `<video poster="/p.jpg"><source src="/v.mp4"></video><div style="background:url('/s.png')"></div>`,
      `<link rel="icon" href="/f.svg"><link rel="stylesheet" href="/x.css"><meta property="og:image" content="/o.png"><style>a{background:url(/h.webp)}</style>`
    );
    expect(imageSources(page).sort()).toEqual(
      ["/a.png", "/b.png", "/c.png", "/d.png", "/p.jpg", "/v.mp4", "/s.png", "/f.svg", "/o.png", "/h.webp"].sort()
    );
  });
  test("a CSS url() of a font, a data URI or a fragment reference is not a source; any other value is, with or without an extension", () => {
    expect(
      cssImageSources(
        `@font-face{src:url(/f.woff2)} a{background:url(data:image/png;base64,AAA)} b{background:url("/x.png?v=1")}` +
          ` c{clip-path:url(#clip)} d{background:url(/email_assistant/img/photo)} e{cursor:url('/c.cur'), auto}`
      )
    ).toEqual(["/x.png?v=1", "/email_assistant/img/photo", "/c.cur"]);
  });
  test("reads inline SVG image href and xlink:href, object data, embed src and input type=image src", () => {
    const page = html(
      `<svg><image href="/a.png"/><image xlink:href="/b.png"/></svg><object data="/c.svg" type="image/svg+xml"></object>` +
        `<embed src="/d.svg"><input type="image" src="/e.png"><input type="text" src="/no.png"><input type=IMAGE src='/f.png'>`
    );
    expect(imageSources(page)).toEqual(["/a.png", "/b.png", "/c.svg", "/d.svg", "/e.png", "/f.png"]);
  });
});

describe("checkImages", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "image-check-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  test("T4 an image of the shots folder passes; one outside it throws image_outside", () => {
    put("index.html", html(`<img src="/email_assistant/shots/x.png">`));
    expect(checkImages(dir)).toEqual({ checked: 1 });
    put("index.html", html(`<img src="/email_assistant/other.png">`));
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/other.png in index.html");
  });
  test("favicon.svg, public/brand, data URIs and the demo media files pass", () => {
    put(
      "index.html",
      html(
        `<img src="/email_assistant/brand/mark.png"><img src="data:image/png;base64,AAA">` +
          `<video><source src="/email_assistant/demo/demo.mp4"><track src="/email_assistant/demo/demo.en.vtt"></video>`,
        `<link rel="icon" href="/email_assistant/favicon.svg">`
      )
    );
    expect(checkImages(dir).checked).toBe(4);
  });
  test("T5 the second srcset entry, a poster and a CSS url() outside the allowed places each fail", () => {
    put(
      "index.html",
      html(
        `<img srcset="/email_assistant/shots/a.png 1x, /email_assistant/x.png 2x" src="/email_assistant/shots/a.png">`
      )
    );
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/x.png");
    put("index.html", html(`<video poster="/email_assistant/x.jpg"></video>`));
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/x.jpg");
    put("index.html", html(`<p>ok</p>`));
    put("_astro/site.css", `a{background:url(/email_assistant/x.png)}`);
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/x.png in _astro/site.css");
  });
  test("the hashed header logo of the build passes, another svg of _astro with a different name fails", () => {
    put("index.html", html(`<img alt src="/email_assistant/_astro/mark.Ct04jRiB.svg">`));
    expect(checkImages(dir).checked).toBe(1);
    put("index.html", html(`<img src="/email_assistant/_astro/mark.Ct04jRiB.svg.png">`));
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/_astro/mark.Ct04jRiB.svg.png");
    put("index.html", html(`<img src="/email_assistant/x/_astro/mark.Ct04jRiB.svg">`));
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/x/_astro/mark.Ct04jRiB.svg");
  });
  test("an _astro image that comes from content fails: a webp in a page, an svg, a srcset entry and a CSS url() of the folder", () => {
    for (const body of [
      `<img src="/email_assistant/_astro/photo.AbC123.webp">`,
      `<img src="/email_assistant/_astro/logo.abc.svg">`,
      `<img src="/email_assistant/shots/a.png" srcset="/email_assistant/_astro/photo.AbC123_Z1.webp 2x">`,
    ]) {
      put("index.html", html(body));
      expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/_astro/");
    }
    put("index.html", html(`<p>ok</p>`));
    put("_astro/site.css", `a{background:url(/email_assistant/_astro/photo.AbC123.webp)}`);
    expect(() => checkImages(dir)).toThrow(
      "image_outside /email_assistant/_astro/photo.AbC123.webp in _astro/site.css"
    );
  });
  test("the new element sources and an extension-less CSS url() fail outside the allowed places and pass inside", () => {
    const outside = [
      `<svg><image href="/email_assistant/x.png"/></svg>`,
      `<svg><image xlink:href="/email_assistant/x.png"/></svg>`,
      `<object data="/email_assistant/x.svg"></object>`,
      `<embed src="/email_assistant/x.svg">`,
      `<input type="image" src="/email_assistant/x.png">`,
      `<div style="background:url(/email_assistant/photo)"></div>`,
    ];
    for (const body of outside) {
      put("index.html", html(body));
      expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/");
      put("index.html", html(body.replaceAll("/email_assistant/", "/email_assistant/shots/")));
      expect(checkImages(dir).checked).toBe(1);
    }
    put("index.html", html(`<p>ok</p>`));
    put("_astro/site.css", `a{background:url(/email_assistant/photo)}`);
    expect(() => checkImages(dir)).toThrow("image_outside /email_assistant/photo in _astro/site.css");
    put("_astro/site.css", `@font-face{src:url(/email_assistant/_astro/f.woff2)} a{clip-path:url(#c)}`);
    expect(checkImages(dir).checked).toBe(0);
  });
  test("a path that climbs out of the shots folder, another origin and a base-less path fail", () => {
    for (const src of ["/email_assistant/shots/../x.png", "https://example.com/shots/x.png", "/shots/x.png", "x.png"]) {
      put("index.html", html(`<img src="${src}">`));
      expect(() => checkImages(dir)).toThrow("image_outside");
    }
  });
});
