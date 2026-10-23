# Release Runbook

This repo uses [Changesets](https://github.com/changesets/changesets) for versioning and publishing. The `release.yml` workflow automates publishing to npm when changesets are merged to `master`.

## One-time setup (human steps required)

### a. Create the GitHub repository and push

```bash
git remote add origin https://github.com/<your-username>/nestjs-resilience.git
git push -u origin master
```

### b. Add the NPM_TOKEN secret

1. Generate a **granular automation token** on [npmjs.com](https://www.npmjs.com) with **publish** rights to the `@dudousxd` scope.
2. In your GitHub repo go to **Settings → Secrets and variables → Actions → New repository secret**.
3. Name: `NPM_TOKEN`, Value: paste the token.

> **WARNING: NEVER paste the npm token into code, commit messages, chat, or any file in the repo.** Treat it like a password.

### c. Ensure the npm scope exists

Make sure the `@dudousxd` org/scope exists on npm and your account has publish rights to it. Create it at [npmjs.com/org/create](https://www.npmjs.com/org/create) if needed.

## Publishing a release

### Normal flow (automated)

1. During development, run `pnpm changeset` and follow the prompts to describe your changes. Commit the generated `.changeset/*.md` file.
2. Push to `master` (or open a PR and merge it).
3. On that push the `release.yml` workflow consumes the pending changesets (`pnpm version-packages`: bumps versions, updates changelogs, syncs the `VERSION` consts), pushes that as a `chore: version packages` commit to `master`, and runs `changeset publish` in the same run. There is no "Version Packages" PR to merge.
4. Running the workflow manually publishes a throwaway beta snapshot (`0.0.0-beta-<timestamp>`) under the `beta` dist-tag, leaving changesets and git untouched.

### Pending changesets (initial releases)

There are **7 pending changesets** covering the initial `0.1.0` releases of all 6 packages:
- `@dudousxd/nestjs-resilience` (core)
- `@dudousxd/nestjs-resilience-store-redis`
- `@dudousxd/nestjs-resilience-store-drizzle`
- `@dudousxd/nestjs-resilience-store-typeorm`
- `@dudousxd/nestjs-resilience-store-mikro-orm`
- `@dudousxd/nestjs-resilience-store-prisma`

Plus a minor bump for the event-emitter integration. The first release run after they landed published all of these.

## Local changeset commands

```bash
# Create a new changeset describing your change
pnpm changeset

# Preview what versions would be bumped
npx changeset status

# Bump versions locally (done by CI automatically)
pnpm version

# Build and publish (done by CI automatically)
pnpm release
```
