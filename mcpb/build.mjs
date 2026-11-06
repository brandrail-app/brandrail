// Builds brandrail.mcpb (for Smithery and desktop apps) from the CLI bundle.
// Run from the repo root after `pnpm build`:  pnpm mcpb
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(here, "build");
const cli = join(root, "packages/cli/dist/brandrail.mjs");

if (!existsSync(cli)) {
  console.error("Missing packages/cli/dist/brandrail.mjs. Run `pnpm build` first.");
  process.exit(1);
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "server"), { recursive: true });
copyFileSync(cli, join(out, "server/brandrail.mjs"));
copyFileSync(join(root, "LICENSE"), join(out, "LICENSE"));

const manifest = JSON.parse(readFileSync(join(here, "manifest.json"), "utf8"));
const version = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;
manifest.version = version;
if (existsSync(join(here, "icon.png"))) copyFileSync(join(here, "icon.png"), join(out, "icon.png"));
else {
  delete manifest.icon;
  console.warn("No mcpb/icon.png yet: building without an icon.");
}
writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

const mcpb = ["-y", "@anthropic-ai/mcpb"];
execFileSync("npx", [...mcpb, "validate", join(out, "manifest.json")], { stdio: "inherit" });
execFileSync("npx", [...mcpb, "pack", out, join(root, `brandrail-${version}.mcpb`)], { stdio: "inherit" });
console.log(`\nBuilt brandrail-${version}.mcpb. Publish with:\n  npx smithery mcp publish ./brandrail-${version}.mcpb -n brandrail/brandrail`);
