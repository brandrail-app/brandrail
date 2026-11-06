import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBrandrailMcp } from "@brandrail/mcp";
import { detectFramework, isFramework, starterConfig, type BrandrailConfig, type Framework } from "@brandrail/engine";
import { apiBase, fetchBrandKit, uploadReport } from "./api.ts";
import { resolveKey } from "./credentials.ts";
import { findConfig, readConfig } from "./files.ts";
import { repoInfo } from "./git.ts";

const log = (s: string) => process.stderr.write(`[brandrail] ${s}\n`); // stdout carries the MCP protocol

function cachePath(key: string): string {
  const base = process.env.XDG_CACHE_HOME || (process.platform === "win32" && process.env.LOCALAPPDATA) || join(homedir(), ".cache");
  const id = createHash("sha256").update(`${apiBase()}|${key}`).digest("hex").slice(0, 16);
  return join(base, "brandrail", `brand-kit-${id}.json`);
}

/** The published Brand Kit, falling back to the last copy when offline. Only the Brand Kit is fetched: no code is sent. */
async function loadKit(key: string, version?: string): Promise<{ org: string; config: BrandrailConfig } | null> {
  const p = cachePath(`${key}${version ? `@${version}` : ""}`);
  try {
    const kit = await fetchBrandKit(key, version);
    mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
    writeFileSync(p, JSON.stringify({ fetchedAt: new Date().toISOString(), ...kit }), { mode: 0o600 });
    return kit;
  } catch (e) {
    if (existsSync(p)) {
      const cached = JSON.parse(readFileSync(p, "utf8")) as { fetchedAt: string; org: string; config: BrandrailConfig };
      log(`couldn't reach ${apiBase()} (${(e as Error).message}); using the Brand Kit from ${cached.fetchedAt}`);
      return cached;
    }
    log(`couldn't load the Brand Kit: ${(e as Error).message}`);
    return null;
  }
}

/**
 * `brandrail mcp`: the Brandrail MCP server on this machine (stdio). Same tools as the hosted one, but
 * validate_snippet runs here, so code never leaves the machine. Results are only uploaded with --report
 * (scores and rule ids, never code).
 */
export async function runLocalMcp(cwd: string, opts: { framework?: string; report: boolean }): Promise<number> {
  const configPath = findConfig(cwd);
  const local = configPath ? readConfig(configPath) : undefined;
  const key = resolveKey();
  const kit = key ? await loadKit(key, local?.brandKitVersion) : null;

  let config: BrandrailConfig;
  let org: string;
  let published: boolean;
  if (kit) {
    config = { ...kit.config, rules: { ...kit.config.rules, ...local?.rules }, ignore: local?.ignore, framework: local?.framework };
    org = kit.org;
    published = Boolean(kit.config.tokenVersion);
  } else if (local) {
    config = local;
    org = local.org ?? "this project";
    published = Boolean(local.tokenVersion);
    if (!key) log("not connected: using brandrail.config.json (run `npx brandrail connect` for the live Brand Kit)");
  } else {
    config = starterConfig;
    org = "Starter";
    published = false;
    log("not connected and no brandrail.config.json: using starter tokens. Run `npx brandrail connect`.");
  }

  let framework: Framework | undefined = isFramework(opts.framework) ? opts.framework : config.framework;
  if (!framework) {
    const pkg = join(cwd, "package.json");
    try {
      framework = existsSync(pkg) ? detectFramework(JSON.parse(readFileSync(pkg, "utf8"))) : undefined;
    } catch {
      framework = undefined;
    }
  }

  const server = createBrandrailMcp({
    org,
    config,
    published,
    framework,
    record:
      opts.report && key
        ? async (report, { filename, project }) => {
            const repo = repoInfo(cwd);
            await uploadReport(key, {
              source: "mcp",
              target: { kind: "repo", name: project || repo.slug.split("/").pop() || "AI tool sessions", location: project || repo.slug },
              title: `validate_snippet · ${filename}`,
              report,
            });
          }
        : undefined,
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log(`local MCP server ready · ${org}${framework ? ` · ${framework}` : ""}${opts.report ? " · reporting scores" : " · nothing leaves this machine"}`);
  return new Promise<number>((resolveExit) => {
    transport.onclose = () => resolveExit(0);
    process.stdin.on("end", () => resolveExit(0));
  });
}
