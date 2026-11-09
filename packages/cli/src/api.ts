import type { BrandrailConfig, Report } from "@brandrail/engine";

/** The hosted Brandrail. Point BRANDRAIL_API_URL at http://localhost:3000 when running the web app locally. */
export const DEFAULT_API = "https://www.brandrail.com.au";

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/;
let warned = false;

/**
 * The Brandrail URL. BRANDRAIL_API_URL can point elsewhere (a local web app), but only over https, or http on
 * localhost, and the CLI says so on stderr every run so a repo's config can't quietly redirect it.
 */
export function apiBase(): string {
  const raw = process.env.BRANDRAIL_API_URL?.trim();
  if (!raw) return DEFAULT_API;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`BRANDRAIL_API_URL isn't a URL: ${raw.slice(0, 80)}`);
  }
  if (u.protocol !== "https:" && !(u.protocol === "http:" && LOOPBACK.test(u.hostname))) throw new Error("BRANDRAIL_API_URL must use https (http only for localhost).");
  if (u.username || u.password || u.search || u.hash) throw new Error("BRANDRAIL_API_URL can't include a username, password, query or #fragment.");
  const base = `${u.origin}${u.pathname}`.replace(/\/+$/, "");
  if (base !== DEFAULT_API && !warned) {
    warned = true;
    process.stderr.write(`brandrail: using ${base} instead of ${DEFAULT_API} (BRANDRAIL_API_URL)\n`);
  }
  return base;
}

/** BRANDRAIL_KEY from the environment is only ever sent to Brandrail itself or to localhost. */
export function envKeyAllowed(base = apiBase()): boolean {
  if (base === DEFAULT_API) return true;
  try {
    return LOOPBACK.test(new URL(base).hostname);
  } catch {
    return false;
  }
}

/** Only pages on the Brandrail URL itself are opened in the browser. */
export function sameOriginUrl(url: unknown, base = apiBase()): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const b = new URL(base);
    const site = (h: string) => h.replace(/^www\./, "");
    const same = u.protocol === b.protocol && u.port === b.port && site(u.hostname) === site(b.hostname);
    return same && (u.protocol === "https:" || LOOPBACK.test(u.hostname)) && !u.username && !u.password ? u.toString() : null;
  } catch {
    return null;
  }
}

async function call<T>(path: string, init: RequestInit & { key: string }): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${init.key}`, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  if (!res.ok) {
    const msg = (body as { error?: string } | null)?.error ?? `${res.status} ${res.statusText}`;
    throw new Error(`Brandrail API ${path}: ${msg}`);
  }
  return body as T;
}

/** The published Brand Kit: the latest, or the version a project pins with "brandKitVersion". */
export async function fetchBrandKit(key: string, version?: string) {
  const res = await call<{ org: string; config: BrandrailConfig; latestVersion?: string }>(`/api/v1/brand-kit${version ? `?version=${encodeURIComponent(version)}` : ""}`, { method: "GET", key });
  // Only Brand Kit data comes from the server. Local settings (tokensCss, ignore, rules…) stay the project's own.
  const c = (res?.config ?? {}) as Partial<BrandrailConfig>;
  const config: BrandrailConfig = {
    ...(typeof c.org === "string" ? { org: c.org } : {}),
    ...(typeof c.tokenVersion === "string" ? { tokenVersion: c.tokenVersion } : {}),
    tokens: c.tokens && typeof c.tokens === "object" ? c.tokens : {},
    ...(Array.isArray(c.components) ? { components: c.components } : {}),
  };
  return { org: String(res?.org ?? ""), config, latestVersion: typeof res?.latestVersion === "string" ? res.latestVersion : undefined };
}

export interface UploadPayload {
  source: "cli" | "ci" | "mcp" | "worker";
  target: { kind: "repo" | "url"; name: string; location: string };
  ref?: string;
  title?: string;
  threshold?: number;
  report: Report;
  uploadSnippets?: boolean;
}

export function uploadReport(key: string, payload: UploadPayload) {
  const report = payload.uploadSnippets
    ? payload.report
    : { ...payload.report, violations: payload.report.violations.map(({ snippet: _snippet, ...v }) => v) };
  return call<{ scanId: string; url?: string }>("/api/v1/scans", { method: "POST", key, body: JSON.stringify({ ...payload, report }) });
}
