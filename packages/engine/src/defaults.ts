import type { BrandrailConfig } from "./types.ts";

/** Starter config written by `brandrail init` when no Brand Kit is fetched from the API. */
export const starterConfig: BrandrailConfig = {
  $schema: "https://brandrail.dev/schema/config.json",
  tokenVersion: "0.0.0-local",
  tokens: {
    color: {
      action: { primary: { $type: "color", $value: "#1f883d", $description: "One primary action per view" } },
      accent: { default: { $type: "color", $value: "#0969da", $description: "Links, focus, selection" } },
      fg: {
        default: { $type: "color", $value: "#1f2328", $description: "Body text" },
        muted: { $type: "color", $value: "#59636e", $description: "Secondary text" },
      },
      canvas: {
        default: { $type: "color", $value: "#ffffff", $description: "Page background" },
        subtle: { $type: "color", $value: "#f6f8fa", $description: "Headers, wells" },
      },
      border: { default: { $type: "color", $value: "#d1d9e0", $description: "Borders and dividers" } },
      danger: { default: { $type: "color", $value: "#cf222e", $description: "Destructive actions, errors" } },
      success: { default: { $type: "color", $value: "#1a7f37", $description: "Success messages, completed states" } },
      attention: { default: { $type: "color", $value: "#9a6700", $description: "Warnings, needs attention" } },
    },
    font: {
      family: { sans: { $type: "fontFamily", $value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif" } },
      size: { base: { $type: "dimension", $value: "14px" } },
    },
    radius: { md: { $type: "dimension", $value: "6px" } },
    space: { unit: { $type: "dimension", $value: "8px" } },
  },
  // The Brandrail kit on npm, so every suggestion is a real import. Angular, Vue and plain HTML use the same kit as
  // custom elements (<br-button>…), registered by one import of @brandrail/kit/elements.
  components: [
    {
      name: "Button",
      importPath: "@brandrail/kit",
      replaces: ["button", "input[type=submit]", "input[type=button]"],
      frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-button" } },
    },
    {
      name: "InputText",
      importPath: "@brandrail/kit",
      replaces: ["input"],
      aliases: ["TextInput", "TextField", "Input"],
      frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-input-text" } },
    },
    {
      name: "Dropdown",
      importPath: "@brandrail/kit",
      replaces: ["select"],
      aliases: ["Select"],
      frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-dropdown" } },
    },
    {
      name: "InputTextArea",
      importPath: "@brandrail/kit",
      replaces: ["textarea"],
      aliases: ["Textarea"],
      frameworks: { "web-components": { importPath: "@brandrail/kit/elements", tag: "br-input-text-area" } },
    },
  ],
  rules: {},
  ignore: [],
};
