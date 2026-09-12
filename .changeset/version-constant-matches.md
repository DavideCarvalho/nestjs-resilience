---
"@dudousxd/nestjs-resilience": patch
---

Report the right version from `VERSION`

0.3.2 shipped with `export const VERSION = '0.3.1'` in its build. The release workflow
handed changesets/action only a `publish` command, so its version step was the default
`changeset version`, which bumps package.json and stops — while this repo's own `version`
script chains `scripts/sync-version.mjs` to rewrite the literal that tsc bakes into dist.

The workflow now runs that script, and `src/sanity.spec.ts` — which compares the two and
turned master red when they drifted — is green again.
