/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { HelpLink, WhatsNewCard, WhatsNewSlot } from "../components/shell/WhatsNew";
import { setLocaleForTest, t } from "../i18n";
import { whatsNewKey } from "./whats-new";

// The card for the fixture releases [0.2.0, 0.1.0]. The click of Close runs in the browser spec.
const USER = "0190f5a0-0000-7000-8000-000000000001";
const RELEASES = [
  { version: "0.2.0", forUsers: [{ en: "Docs site is live.", pl: "Strona z dokumentacją działa." }] },
  { version: "0.1.0", forUsers: [{ en: "First release.", pl: "Pierwsze wydanie." }] },
];

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    reads: 0,
    getItem(key: string) {
      this.reads += 1;
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    data,
  };
}

const throwing = {
  getItem: (): string | null => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

function card(getStorage: () => Pick<Storage, "getItem" | "setItem"> | null, releases = RELEASES): string {
  return renderToStaticMarkup(<WhatsNewCard releases={releases} userId={USER} getStorage={getStorage} />);
}

describe("WhatsNewCard", () => {
  test("T2 empty storage: the card lists the newest release lines in the panel locale, with the link and the close button", () => {
    setLocaleForTest("en");
    const html = card(() => memoryStorage());
    expect(html).toContain(t("whats_new_title"));
    expect(html).toContain("Docs site is live.");
    expect(html).not.toContain("First release.");
    expect(html).toContain('href="https://artexs.github.io/email_assistant/changelog/"');
    expect(html).toContain(t("whats_new_all"));
    expect(html).toContain(`aria-label="${t("whats_new_dismiss")}"`);
    expect(html).toContain('rel="noopener noreferrer"');
    setLocaleForTest("pl");
    const pl = card(() => memoryStorage());
    expect(pl).toContain("Strona z dokumentacją działa.");
    expect(pl).toContain("Co nowego");
    expect(pl).toContain("Wszystkie zmiany dla użytkowników");
    // The changelog page is English only: its link keeps the English address in the Polish panel.
    expect(pl).toContain('href="https://artexs.github.io/email_assistant/changelog/"');
    setLocaleForTest("en");
  });

  test("T2 a stored older version shows every newer release; the stored newest shows no card", () => {
    setLocaleForTest("en");
    const older = card(() => memoryStorage({ [whatsNewKey(USER)]: "0.1.0" }));
    expect(older).toContain("Docs site is live.");
    expect(older).not.toContain("First release.");
    expect(card(() => memoryStorage({ [whatsNewKey(USER)]: "0.2.0" }))).toBe("");
    expect(whatsNewKey(USER)).toBe(`ea.whatsNewSeen:${USER}`);
  });

  test("T2 a storage that throws, or no storage, shows no card", () => {
    expect(card(() => throwing)).toBe("");
    expect(card(() => null)).toBe("");
  });

  test("T2 no release lines: no card", () => {
    expect(card(() => memoryStorage(), [])).toBe("");
  });
});

describe("WhatsNewSlot and HelpLink", () => {
  test("T5 the flag off: nothing, and the storage is not read", () => {
    const storage = memoryStorage();
    let asked = 0;
    const html = renderToStaticMarkup(
      <WhatsNewSlot
        features={["stats_page"]}
        releases={RELEASES}
        userId={USER}
        getStorage={() => {
          asked += 1;
          return storage;
        }}
      />
    );
    expect(html).toBe("");
    expect({ asked, reads: storage.reads }).toEqual({ asked: 0, reads: 0 });
  });

  test("T6 the flag on: the slot reads the storage and shows the card", () => {
    setLocaleForTest("en");
    const storage = memoryStorage();
    const html = renderToStaticMarkup(
      <WhatsNewSlot features={["docs_links"]} releases={RELEASES} userId={USER} getStorage={() => storage} />
    );
    expect(html).toContain("Docs site is live.");
    expect(storage.reads).toBe(1);
  });

  test("the Help link opens the site of the panel locale in a new tab with noopener", () => {
    setLocaleForTest("en");
    const en = renderToStaticMarkup(<HelpLink />);
    expect(en).toContain('href="https://artexs.github.io/email_assistant/"');
    expect(en).toContain('target="_blank"');
    expect(en).toContain('rel="noopener noreferrer"');
    expect(en).toContain(t("help_link"));
    setLocaleForTest("pl");
    expect(renderToStaticMarkup(<HelpLink />)).toContain('href="https://artexs.github.io/email_assistant/pl/"');
    setLocaleForTest("en");
  });
});

describe("WhatsNewCard frame", () => {
  test("the card root has no outer margin class", () => {
    setLocaleForTest("en");
    const root = /<[a-z]+ [^>]*aria-labelledby="whats-new-title"[^>]*>/.exec(card(() => memoryStorage()));
    expect(root).not.toBeNull();
    const classes = /class="([^"]*)"/.exec(root?.[0] ?? "")?.[1] ?? "";
    expect(
      classes.split(" ").filter((name) => /^(?:m[trblxy]?|-m[trblxy]?)-/.test(name) || name.includes(":m"))
    ).toEqual([]);
  });
});
