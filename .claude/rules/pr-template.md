# Pull request descriptions

When creating a pull request, always use the repository's PR template at
`.github/PULL_REQUEST_TEMPLATE.md` as the body. GitHub only applies the
template to PRs opened through the web UI, so when opening a PR from a tool
(`gh`, MCP, API) you must read the template and fill it in yourself.

- Read `.github/PULL_REQUEST_TEMPLATE.md` before writing the PR body and keep
  its section structure: **Summary**, **Linked issue**, **Guardrails**,
  **Definition of done**.
- Fill in every section; do not delete sections or checklist items. Leave a
  checkbox unchecked (and explain why in the Summary) rather than removing it.
- Only tick a checklist item you have actually verified in this session (e.g.
  ran `pnpm typecheck && pnpm lint && pnpm test && pnpm i18n:check`).
- If no issue is linked, replace `Closes #` with a short note saying so —
  don't leave a dangling `Closes #`.
- Per the template's privacy notice: no real post text, author handles, or
  other personal data in the PR description or screenshots.
