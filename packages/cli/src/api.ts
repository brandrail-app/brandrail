import type { BrandrailConfig, Report } from "@brandrail/engine";

/** The hosted Brandrail. Point BRANDRAIL_API_URL at http://localhost:3000 when running the web app locally. */
export const DEFAULT_API = "https://www.brandrail.com.au";

export function apiBase(): string {
  return (process.env.BRANDRAIL_API_URL ?? DEFAULT_API).replace(/\/$/, "");
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
export function fetchBrandKit(key: string, version?: string) {
  return call<{ org: string; config: BrandrailConfig; latestVersion?: string }>(`/api/v1/brand-kit${version ? `?version=${encodeURIComponent(version)}` : ""}`, { method: "GET", key });
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
