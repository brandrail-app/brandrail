import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { apiBase, envKeyAllowed } from "./api.ts";

/**
 * API keys from `brandrail connect` live outside every repo, readable only by you:
 *   macOS / Linux: ~/.config/brandrail/credentials.json (mode 600)    Windows: %APPDATA%\brandrail\credentials.json
 * One entry per Brandrail URL. BRANDRAIL_KEY, when set, always wins (CI, GitHub Actions).
 */
export interface Credential {
  key: string;
  org: string;
  slug?: string;
  createdAt: string;
  expiresAt: string;
}

type File = { version: 1; profiles: Record<string, Credential> };

export function credentialsPath(): string {
  if (process.env.BRANDRAIL_CONFIG_DIR) return join(process.env.BRANDRAIL_CONFIG_DIR, "credentials.json");
  if (process.platform === "win32" && process.env.APPDATA) return join(process.env.APPDATA, "brandrail", "credentials.json");
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "brandrail", "credentials.json");
}

function read(): File {
  const p = credentialsPath();
  if (!existsSync(p)) return { version: 1, profiles: {} };
  try {
    const f = JSON.parse(readFileSync(p, "utf8")) as File;
    return f && typeof f.profiles === "object" ? f : { version: 1, profiles: {} };
  } catch {
    return { version: 1, profiles: {} };
  }
}

function write(f: File): void {
  const p = credentialsPath();
  mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  writeFileSync(p, `${JSON.stringify(f, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(p, 0o600); // also when the file already existed with looser permissions
  } catch {
    /* Windows: ACLs of the user profile apply */
  }
}

export function saveCredential(c: Credential): void {
  const f = read();
  f.profiles[apiBase()] = c;
  write(f);
}

export function storedCredential(): Credential | undefined {
  return read().profiles[apiBase()];
}

export function removeCredential(): boolean {
  const f = read();
  if (!f.profiles[apiBase()]) return false;
  delete f.profiles[apiBase()];
  if (Object.keys(f.profiles).length) write(f);
  else rmSync(credentialsPath(), { force: true });
  return true;
}

/** BRANDRAIL_KEY, else the key saved by `brandrail connect` for this Brandrail URL. */
export function resolveKey(): string | undefined {
  if (process.env.BRANDRAIL_KEY) {
    if (!envKeyAllowed()) throw new Error(`BRANDRAIL_KEY is only sent to Brandrail (or localhost), not ${apiBase()}. Unset BRANDRAIL_API_URL, or sign in to that server with \`npx brandrail connect\`.`);
    return process.env.BRANDRAIL_KEY;
  }
  const c = storedCredential();
  if (c && Date.parse(c.expiresAt) > Date.now()) return c.key;
  return undefined;
}

export const NO_KEY = "Not connected. Run `npx brandrail connect` (or set BRANDRAIL_KEY to an API key from Dashboard → Connect).";
