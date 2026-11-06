import { execFile, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { hostname, userInfo } from "node:os";
import { basename, join } from "node:path";
import { apiBase } from "./api.ts";
import { saveCredential } from "./credentials.ts";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";

/** Same format as keys made in the dashboard: br_live_ + 32 random characters. Only its sha256 is ever sent. */
export function generateKey(): { key: string; prefix: string; hash: string } {
  // Rejection sampling, so every character is equally likely (no modulo bias).
  const limit = 256 - (256 % ALPHABET.length);
  let body = "";
  while (body.length < 32) {
    for (const b of randomBytes(64)) {
      if (b < limit && body.length < 32) body += ALPHABET[b % ALPHABET.length];
    }
  }
  const key = `br_live_${body}`;
  return { key, prefix: key.slice(0, 12), hash: createHash("sha256").update(key, "utf8").digest("hex") };
}

function openBrowser(url: string): void {
  const [cmd, args] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url.replace(/&/g, "^&")]] : ["xdg-open", [url]];
  execFile(cmd, args, () => undefined);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function json<T>(res: Response): Promise<T & { error?: string }> {
  try {
    return (await res.json()) as T & { error?: string };
  } catch {
    return {} as T & { error?: string };
  }
}

export interface ConnectResult {
  key: string;
  org: string;
  slug?: string;
}

/**
 * Browser sign-in for the terminal: shows a code, opens the approval page, waits for a signed-in member to approve,
 * and saves the key outside the repo. The key is made here and never sent; the server only stores its hash.
 */
export async function connect(opts: { browser: boolean; log: (s?: string) => void }): Promise<ConnectResult> {
  const { key, prefix, hash } = generateKey();
  const client = `${userInfo().username}@${hostname().replace(/\.local$/, "")} · ${basename(process.cwd())}`.slice(0, 120);
  const res = await fetch(`${apiBase()}/api/v1/cli/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ keyHash: hash, keyPrefix: prefix, client }),
  });
  const s = await json<{ id: string; userCode: string; verificationUrl: string; expiresAt: string }>(res);
  if (!res.ok) throw new Error(`Couldn't start sign-in: ${s.error ?? res.status}`);

  opts.log("");
  opts.log(`  Your code:  ${s.userCode}`);
  opts.log("");
  opts.log(`  Approve it at ${s.verificationUrl}`);
  opts.log("  Check the browser shows the same code before you approve.");
  opts.log("");
  if (opts.browser) openBrowser(s.verificationUrl);

  const deadline = Date.parse(s.expiresAt) || Date.now() + 10 * 60_000;
  let wait = 2000;
  let dots = 0;
  while (Date.now() < deadline + 5000) {
    await sleep(wait);
    const r = await fetch(`${apiBase()}/api/v1/cli/sessions/${s.id}`, { headers: { authorization: `Bearer ${key}` } }).catch(() => null);
    if (!r) continue; // offline for a moment: keep waiting
    if (r.status === 429) {
      wait = Math.min(30_000, (Number(r.headers.get("retry-after")) || 10) * 1000);
      continue;
    }
    const st = await json<{ status: string; org?: string; slug?: string }>(r);
    if (!r.ok) throw new Error(`Sign-in failed: ${st.error ?? r.status}`);
    if (st.status === "approved") {
      saveCredential({ key, org: st.org ?? "", slug: st.slug, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 864e5).toISOString() });
      return { key, org: st.org ?? "", slug: st.slug };
    }
    if (st.status === "denied") throw new Error("Sign-in was denied in the browser.");
    if (st.status === "expired") break;
    wait = 2000;
    if (process.stderr.isTTY && ++dots % 5 === 0) process.stderr.write(".");
  }
  throw new Error("The code expired before it was approved. Run `npx brandrail connect` again.");
}

/** Adds the kit to the app when the registry uses it and it isn't installed yet. */
export function installKit(root: string, log: (s?: string) => void): void {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return;
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  if (pkg.dependencies?.["@brandrail/kit"] || pkg.devDependencies?.["@brandrail/kit"]) return;
  const pm = existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(root, "yarn.lock")) ? "yarn" : existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock")) ? "bun" : "npm";
  const args = pm === "npm" ? ["install", "@brandrail/kit"] : ["add", "@brandrail/kit"];
  log(`\n→ ${pm} ${args.join(" ")}`);
  const r = spawnSync(pm, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) log(`warning: couldn't install @brandrail/kit; run \`${pm} ${args.join(" ")}\` yourself.`);
}
