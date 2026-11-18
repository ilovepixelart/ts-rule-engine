# How to contribute

1. Start an issue. We will discuss the best approach.
2. Fork the repo and create a feature branch.
3. Make a pull request. I'll review it and comment until we are both
   confident about it.
4. I'll merge your PR and cut a release.

## Local setup

```bash
npm install
npx simple-git-hooks   # one-time: installs pre-commit / pre-push hooks
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
npm run test:e2e       # build, pack, and run the packed artifact in a fresh consumer
```

All six should be green before opening a PR. CI runs `type:check` and the
tests on Node 22.x and 24.x, and biome, `type:check:tests`, the tests and the
SonarCloud scan on 26.x.

### End-to-end tests

`npm run test:e2e` (`e2e/run.mjs`) builds and packs the package, installs the tarball
and the latest published release into a temporary consumer project outside the repo, and
fails when:

- a scenario in `e2e/scenarios.cjs` differs from its hand-written expected value,
- `require()` and `import()` give different results,
- the typed consumers in `e2e/consumer/` do not compile against the packed `.d.ts` under
  `nodenext` or `bundler` resolution,
- a result differs from the published release and the scenario is not listed in
  `e2e/allowlist.json` (entries: `{ "scenario": "<name>", "pr": <number>, "reason": "..." }`;
  keep it empty while main equals the latest release).

`E2E_TARGET=<published version or tarball path>` runs the same checks against that package
instead of the local build, for example `E2E_TARGET=1.5.2 node e2e/run.mjs`.
`E2E_BASELINE=<npm spec>` changes the release used for the comparison. CI runs the suite
in the `E2E (packed artifact)` job on Node 24.x.

## Reporting security issues

Please do **not** open a public issue for vulnerabilities. See
`SECURITY.md` for the private reporting process.
