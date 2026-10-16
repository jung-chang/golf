# Agent guidelines

## Secrets: never commit them

Never commit or push anything sensitive or private to this repository. That
includes API keys, tokens, passwords, VAPID private keys, Cloudflare account
or Access secrets, `.dev.vars` contents, personal data, and private exports.

- Local secrets live in `.dev.vars` (git-ignored). Production secrets go in
  with `pnpm wrangler secret put <NAME>`, never in `wrangler.jsonc`, code,
  tests, docs or commit messages.
- Before every commit, check what's staged (`git diff --cached`) for keys or
  personal data. If a secret was committed, stop and tell the user: rotate the
  key first, then remove it from history. Deleting it in a later commit isn't
  enough.
- Use obvious placeholders in examples (`<your-key>`), never real values.
