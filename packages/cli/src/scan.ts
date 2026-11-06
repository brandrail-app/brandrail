import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { checkRendered, collectRenderedNodes, type BrandrailConfig, type RenderedPage, type Report } from "@brandrail/engine";

type Playwright = typeof import("playwright-core");

/** Finds Playwright in the user's project first, then next to the CLI. */
function loadPlaywright(cwd: string): Playwright {
  for (const base of [join(cwd, "package.json"), import.meta.url]) {
    for (const name of ["playwright", "playwright-core"]) {
      try {
        return createRequire(base)(name) as Playwright;
      } catch {}
    }
  }
  throw new Error("`brandrail scan` needs Playwright: npm i -D playwright && npx playwright install chromium");
}

export interface CliScanOptions {
  pages: number;
  /** Playwright storage state (cookies + localStorage) for pages behind a login */
  storageState?: string;
  waitMs: number;
  width: number;
}

export async function scanPages(cwd: string, url: string, config: BrandrailConfig, opts: CliScanOptions, log: (s: string) => void): Promise<{ report: Report; pages: RenderedPage[] }> {
  const pw = loadPlaywright(cwd);
  const start = /^https?:\/\//i.test(url) ? url : `http://${url}`;
  const state = opts.storageState ? resolve(cwd, opts.storageState) : undefined;
  if (state && !existsSync(state)) throw new Error(`--storage-state file not found: ${state}`);

  const browser = await pw.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: opts.width, height: 900 }, storageState: state });
    const queue = [start];
    const seen = new Set<string>();
    const pages: RenderedPage[] = [];
    while (queue.length && pages.length < opts.pages) {
      const next = queue.shift()!;
      const key = next.replace(/\/$/, "");
      if (seen.has(key)) continue;
      seen.add(key);
      const page = await context.newPage();
      try {
        const res = await page.goto(next, { waitUntil: "domcontentloaded", timeout: 30_000 });
        if (res && res.status() >= 400) {
          log(`  skipped ${next} (${res.status()})`);
          if (pages.length === 0) throw new Error(`${next} answered ${res.status()}`);
          continue;
        }
        await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
        if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
        const data = await page.evaluate(collectRenderedNodes, 4000);
        pages.push({ url: page.url(), title: data.title, nodes: data.nodes });
        log(`  ✔ ${page.url()}  (${data.nodes.length} elements)`);
        if (pages.length === 1) queue.push(...data.links.filter((l) => l.startsWith(new URL(page.url()).origin)).sort((a, b) => a.length - b.length));
      } finally {
        await page.close().catch(() => {});
      }
    }
    return { report: checkRendered(pages, config), pages };
  } finally {
    await browser.close();
  }
}
