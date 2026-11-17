<p align="center">
  <a href="https://www.brandrail.com.au">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://www.brandrail.com.au/logo/brandrail-logo-on-dark.svg">
      <img alt="Brandrail" src="https://www.brandrail.com.au/logo/brandrail-logo-on-light.svg" height="48">
    </picture>
  </a>
</p>

# Brandrail GitHub Action

Scores every pull request against your design system, annotates violations inline and keeps one PR comment up to date with the fixes. The scan runs on your runner; by default only scores and violation metadata (file, line, rule) are uploaded.

```yaml
# .github/workflows/brandrail.yml
name: Brandrail
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  brand-check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: brandrail-app/brandrail/packages/github-action@main
        with:
          api-key: ${{ secrets.BRANDRAIL_KEY }}   # optional: uploads to your dashboard
          fail-below: 80                           # optional: omit for advisory mode
```

| Input | Default | |
| --- | --- | --- |
| `api-key` | — | Uploads results; uses the published Brand Kit when there's no config file |
| `config` | `brandrail.config.json` | Created by `npx brandrail init` |
| `working-directory` | `.` | Folder to scan (monorepos) |
| `fail-below` | — | Fail the job under this score |
| `changed-only` | `true` | On PRs, only report lines the PR touches |
| `comment` | `true` | Post / update one PR comment |
| `upload-snippets` | `false` | Include the offending source line in uploads |

Outputs: `score`, `errors`.

Rebuild after changing the engine: `pnpm --filter @brandrail/github-action build` and commit `dist/`.
