/**
 * Brandrail GitHub Action. Runs inside the customer's runner: source code is scanned locally and,
 * unless upload-snippets is on, only scores and violation metadata leave the runner.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  check,
  COMMENT_MARKER,
  formatGithubAnnotations,
  formatMarkdown,
  resolveConfig,
  type BrandrailConfig,
  type Report,
} from "@brandrail/engine";
import { fetchBrandKit, uploadReport } from "../../cli/src/api.ts";
import { collectFiles, readConfig } from "../../cli/src/files.ts";
import { parseChangedLines } from "../../cli/src/git.ts";

const env = (k: string) => (process.env[k] ?? "").trim();
const bool = (k: string, d: boolean) => (env(k) ? env(k).toLowerCase() === "true" : d);

function git(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return null;
  }
}

interface PullRequestEvent {
  pull_request?: { number: number; title: string; head: { sha: string; ref: string }; base: { ref: string; sha: string } };
}

function event(): PullRequestEvent {
  const p = env("GITHUB_EVENT_PATH");
  try {
    return p && existsSync(p) ? (JSON.parse(readFileSync(p, "utf8")) as PullRequestEvent) : {};
  } catch {
    return {};
  }
}

/** Lines changed by the PR. Works with the default shallow checkout of the PR merge commit. */
function prChangedLines(baseSha: string | undefined): Map<string, Set<number>> | null {
  let diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", "HEAD^1", "HEAD"]);
  if (diff === null) {
    git(["fetch", "--no-tags", "--depth=2", "origin", env("GITHUB_SHA") || "HEAD"]);
    diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", "HEAD^1", "HEAD"]);
  }
  if (diff === null && baseSha) {
    git(["fetch", "--no-tags", "--depth=1", "origin", baseSha]);
    diff = git(["diff", "-U0", "--no-color", "--diff-filter=AMR", baseSha, "HEAD"]);
  }
  return diff === null ? null : parseChangedLines(diff);
}

async function upsertComment(body: string, prNumber: number) {
  const token = env("BR_GITHUB_TOKEN");
  const repo = env("GITHUB_REPOSITORY");
  const api = env("GITHUB_API_URL") || "https://api.github.com";
  if (!token || !repo) return;
  const headers = { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json" };
  const list = await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments?per_page=100`, { headers });
  if (!list.ok) throw new Error(`list comments: ${list.status}`);
  // Our own earlier comment: posted by a bot (GITHUB_TOKEN) or by someone with write access (a personal token),
  // never one a pull request author pasted the marker into.
  const ours = (c: { user?: { type?: string } | null; author_association?: string }) =>
    c.user?.type === "Bot" || ["OWNER", "MEMBER", "COLLABORATOR"].includes(c.author_association ?? "");
  const existing = ((await list.json()) as Array<{ id: number; body?: string; user?: { type?: string } | null; author_association?: string }>).find(
    (c) => c.body?.includes(COMMENT_MARKER) && ours(c),
  );
  const res = existing
    ? await fetch(`${api}/repos/${repo}/issues/comments/${existing.id}`, { method: "PATCH", headers, body: JSON.stringify({ body }) })
    : await fetch(`${api}/repos/${repo}/issues/${prNumber}/comments`, { method: "POST", headers, body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`${existing ? "update" : "create"} comment: ${res.status} (does the job have pull-requests: write?)`);
}

function setOutput(name: string, value: string | number) {
  const f = env("GITHUB_OUTPUT");
  if (f) appendFileSync(f, `${name}=${value}\n`);
}

async function run(): Promise<number> {
  if (env("BR_API_URL")) process.env.BRANDRAIL_API_URL = env("BR_API_URL");
  const key = env("BR_API_KEY");
  const cwd = process.cwd();
  const configPath = resolve(cwd, env("BR_CONFIG") || "brandrail.config.json");

  let config: BrandrailConfig;
  if (existsSync(configPath)) config = readConfig(configPath);
  else if (key) config = (await fetchBrandKit(key)).config;
  else throw new Error(`No ${env("BR_CONFIG") || "brandrail.config.json"} and no api-key. Run \`npx brandrail init\` and commit the file, or set api-key.`);

  const resolved = resolveConfig(config);
  const files = collectFiles(cwd, [], resolved.ignore);
  const ev = event();
  const pr = ev.pull_request;
  const onlyLines = pr && bool("BR_CHANGED_ONLY", true) ? prChangedLines(pr.base.sha) ?? undefined : undefined;
  if (pr && bool("BR_CHANGED_ONLY", true) && !onlyLines) console.log("::warning::Brandrail couldn't read the PR diff; checking all files.");

  const report: Report = check(files, resolved, { onlyLines });
  const threshold = env("BR_FAIL_BELOW") ? Number(env("BR_FAIL_BELOW")) : undefined;

  console.log(formatGithubAnnotations(report));
  console.log(`Brand score ${report.score}/100 · ${report.counts.error} errors · ${report.counts.warning} warnings · ${report.counts.info} info · ${report.filesScanned} files`);
  setOutput("score", report.score);
  setOutput("errors", report.counts.error);

  const repo = env("GITHUB_REPOSITORY");
  const server = env("GITHUB_SERVER_URL") || "https://github.com";
  const sha = pr?.head.sha ?? env("GITHUB_SHA");
  let dashboardUrl: string | undefined;

  if (key) {
    try {
      const res = await uploadReport(key, {
        source: "ci",
        target: { kind: "repo", name: repo.split("/").pop() || repo, location: repo },
        ref: pr ? `#${pr.number}` : env("GITHUB_REF_NAME") || sha?.slice(0, 7),
        title: pr?.title ?? `Push to ${env("GITHUB_REF_NAME") || "branch"}`,
        threshold,
        report,
        uploadSnippets: bool("BR_UPLOAD_SNIPPETS", false),
      });
      dashboardUrl = res.url;
    } catch (e) {
      console.log(`::warning::Brandrail upload failed: ${(e as Error).message}`);
    }
  }

  const md = formatMarkdown(report, {
    threshold,
    dashboardUrl,
    fileUrl: (v) => (repo && sha ? `${server}/${repo}/blob/${sha}/${v.file}#L${v.line}` : undefined),
  });
  const summary = env("GITHUB_STEP_SUMMARY");
  if (summary) appendFileSync(summary, `${md}\n`);

  if (pr && bool("BR_COMMENT", true)) {
    try {
      await upsertComment(md, pr.number);
    } catch (e) {
      console.log(`::warning::Brandrail couldn't comment on the PR: ${(e as Error).message}`);
    }
  }

  if (threshold !== undefined && report.score < threshold) {
    console.log(`::error::Brand score ${report.score} is below the threshold of ${threshold}.`);
    return 1;
  }
  return 0;
}

run().then(
  (code) => process.exit(code),
  (err: Error) => {
    console.log(`::error::Brandrail: ${err.message}`);
    process.exit(2);
  },
);
