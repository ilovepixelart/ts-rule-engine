# How to contribute

1. Start an issue. We will discuss the best approach.
2. Fork the repo and create a feature branch.
3. Make a pull request. I'll review it and comment until we are both
   confident about it.
4. I'll merge your PR and cut a release.

## Local setup

```bash
npm install
npx simple-git-hooks   # one-time — installs pre-commit / pre-push hooks
```

The `prepare: simple-git-hooks` lifecycle script was intentionally dropped
from `package.json` as part of supply-chain hardening (see `SECURITY.md`).
Run the command once by hand after your first `npm install` and the hooks
stay active from then on.

## Pre-PR checklist

```bash
npm run biome          # lint / format
npm run type:check     # tsc --noEmit on src
npm run type:check:tests   # tsc --noEmit on tests
npm run test           # vitest with coverage
npm run build          # pkgroll --clean-dist
```

All five should be green before opening a PR. CI runs the same gates on
Node 20.x / 22.x (tests) and 24.x (biome + sonar + type:check:tests).

## Reporting security issues

Please do **not** open a public issue for vulnerabilities. See
`SECURITY.md` for the private reporting process.
