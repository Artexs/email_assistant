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
  test("a CSS url() of a font or a data URI is not an image source", () => {
    expect(
      cssImageSources(
        `@font-face{src:url(/f.woff2)} a{background:url(data:image/png;base64,AAA)} b{background:url("/x.png?v=1")}`
      )
    ).toEqual(["/x.png?v=1"]);
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
  test("Starlight assets, favicon.svg, public/brand, data URIs and the demo media files pass", () => {
    put(
      "index.html",
      html(
        `<img src="/email_assistant/_astro/logo.abc.svg"><img src="/email_assistant/brand/mark.png"><img src="data:image/png;base64,AAA">` +
          `<video><source src="/email_assistant/demo/demo.mp4"><track src="/email_assistant/demo/demo.en.vtt"></video>`,
        `<link rel="icon" href="/email_assistant/favicon.svg">`
      )
    );
    expect(checkImages(dir).checked).toBe(5);
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
  test("a path that climbs out of the shots folder, another origin and a base-less path fail", () => {
    for (const src of ["/email_assistant/shots/../x.png", "https://example.com/shots/x.png", "/shots/x.png", "x.png"]) {
      put("index.html", html(`<img src="${src}">`));
      expect(() => checkImages(dir)).toThrow("image_outside");
    }
  });
});
