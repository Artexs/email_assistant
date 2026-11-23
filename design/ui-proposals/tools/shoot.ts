// Screenshots of each proposal for the gallery: proposals/<dir>/shots/<screen>-<device>-<scheme>.png.
// Usage (from the repo root): bun design/ui-proposals/tools/shoot.ts [proposal-dir ...]
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const NAMES: Record<string, string> = {
  today: "00-today", login: "01-login", approvals: "02-approvals", review: "03-review", rules: "04a-rules",
  mailboxes: "04b-mailboxes", settings: "04c-settings", activity: "05-activity", stats: "06a-stats",
  report: "06b-report", onboarding: "07-onboarding", delegations: "08-delegations", empty: "10-empty",
};
const wanted = process.argv.slice(2);
const dirs = readdirSync(`${root}/proposals`).filter((d) => existsSync(`${root}/proposals/${d}/meta.json`) && (!wanted.length || wanted.includes(d)));
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium" });
for (const dir of dirs) {
  const meta = JSON.parse(readFileSync(`${root}/proposals/${dir}/meta.json`, "utf8")) as { screens?: string[] };
  const screens = meta.screens ?? ["login", "approvals", "review", "rules", "mailboxes", "activity", "stats"];
  mkdirSync(`${root}/proposals/${dir}/shots`, { recursive: true });
  for (const device of ["desktop", "phone"] as const) for (const scheme of ["light", "dark"] as const) {
    const ctx = await browser.newContext(device === "desktop"
      ? { viewport: { width: 1280, height: 800 }, colorScheme: scheme }
      : { viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: scheme });
    const page = await ctx.newPage();
    for (const s of screens) {
      await page.goto(`file://${root}/proposals/${dir}/index.html?shot=1#${s}`);
      await page.waitForTimeout(150);
      // Phone: one screen high, so fixed bars stay in place. Desktop: the full page.
      await page.screenshot({ path: `${root}/proposals/${dir}/shots/${NAMES[s] ?? s}-${device}-${scheme}.png`, fullPage: device === "desktop" });
    }
    await ctx.close();
  }
  console.log(`${dir}: ${screens.length * 4} shots`);
}
await browser.close();
