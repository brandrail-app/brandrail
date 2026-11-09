export type { BrandrailConfig, ComponentEntry, DtcgDoc, PropSpec, Report, RuleSetting, Severity, SourceFile, Violation } from "./types.ts";
export { resolveConfig, DEFAULT_IGNORE, DEFAULT_FORBIDDEN_IMPORTS, type ResolvedConfig } from "./config.ts";
export { check, checkSnippet, computeScore, isScannable, ENGINE_VERSION, type CheckOptions } from "./check.ts";
export { RULES, RULE_IDS, type Rule } from "./rules.ts";
export { formatPretty, formatMarkdown, formatGithubAnnotations, COMMENT_MARKER } from "./report.ts";
export { parseColor, contrastRatio, deltaE, rgbToLab, toHex } from "./color.ts";
export { fileKind, makeIgnore } from "./source.ts";
export { starterConfig } from "./defaults.ts";
export { starterFromFigmaDocument, type FigmaDocumentStarter } from "./figma-document.ts";
export { generateInstructions, upsertSection, RULES_START, RULES_END } from "./instructions.ts";
export { findComponents, findComponentByName, type ComponentMatch } from "./components.ts";
export type { TokenColor } from "./config.ts";
export { mcpClientConfigs, mcpLocalConfigs, RULE_FILES, type McpClientConfig } from "./mcp-config.ts";
export {
  importTokens,
  importTokenFiles,
  fromFigmaVariables,
  fromFigmaStyles,
  fromModeObject,
  flattenTokens,
  safeTokenValue,
  buildDtcg,
  diffTokens,
  mergeTokens,
  classify,
  slug,
  fontWeight,
  EXT as TOKEN_EXTENSION,
  type FlatToken,
  type TokenType,
  type ImportResult,
  type ImportFormat,
  type ImportOptions,
  type TokenFile,
  type TokenDiff,
  type FigmaVariablesMeta,
  type FigmaVariable,
  type FigmaCollection,
  type FigmaStyleNode,
} from "./tokens.ts";
export {
  checkRendered,
  collectRenderedNodes,
  isPrivateAddress,
  pagePath,
  ruleTitle,
  RENDERED_RULES,
  type RenderedNode,
  type RenderedPage,
  type RenderedCheckOptions,
} from "./rendered.ts";
export { generateTokensCss } from "./tokens-css.ts";
export { kitBridgeCss, pickColorRoles, type ColorRole } from "./kit-bridge.ts";
export { auditBrandKit, type KitIssue } from "./brand-kit-audit.ts";
export type { EventSpec, Framework, FrameworkUsage } from "./types.ts";
export {
  FRAMEWORKS,
  FRAMEWORK_LABEL,
  availableFrameworks,
  bindingHowTo,
  detectFramework,
  isFramework,
  markup,
  resolveUsage,
  validateFrameworks,
  type PackageJsonLike,
  type ResolvedUsage,
} from "./frameworks.ts";
export {
  CONFIG_FILE,
  changedLinesFromPatch,
  defaultTokensCssPath,
  mergeProjectConfig,
  projectFiles,
  ruleFileContent,
  tokensCssContent,
  type ProjectFile,
} from "./project.ts";
export {
  componentForConcept,
  findLegacyUsages,
  LIBRARY_LABEL,
  migrationMap,
  migrationMapMarkdown,
  type Concept,
  type LegacyUsage,
  type LibraryId,
  type MappingRow,
} from "./migrate.ts";
export { detectLibraries } from "./migrate.ts";
export { MIGRATE_AGENT_FILE, MIGRATE_SKILL_FILE, migrationAgent, migrationSkill } from "./migrate-skill.ts";
export { migrationStatus, type MigrationFile, type MigrationStatus } from "./migrate-status.ts";
export { formatHandoverHtml, type HandoverMeta } from "./report-html.ts";
export { PAGE_TEMPLATES, findTemplate, renderTemplate, templateCss, templateList, templateMarkdown, type PageTemplate, type RenderedTemplate } from "./templates.ts";
export { applyTokenDeprecations, bumpVersion, changelogMarkdown, changelogSummary, deprecationLine, kitChangelog, tokenDeprecations, type Bump, type Deprecation, type KitChangelog } from "./governance.ts";
export { EXPORT_FORMATS, exportTokens, isExportFormat, tokenIdentifier, type ExportFormat, type ExportOptions, type ExportedFile, type PlatformExport } from "./platforms.ts";
