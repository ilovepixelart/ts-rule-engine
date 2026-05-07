# Security Policy

## Supported Versions

Security fixes are issued only for the latest `1.x` release line.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security problems.**

Report vulnerabilities privately via GitHub's
[private vulnerability reporting](https://github.com/ilovepixelart/ts-rule-engine/security/advisories/new)
form. This routes the report directly to the maintainer through a private
advisory and keeps the details out of the public issue tracker until a fix
is available.

When reporting, please include:

- The affected version(s) of `ts-rule-engine`
- A minimal reproduction (fact shape, rule definitions, observed vs expected
  behavior)
- The impact you believe the issue has (logic bypass, prototype pollution,
  denial of service, unbounded recursion, etc.)

## Response Expectations

- **Acknowledgement:** within 7 days of the report.
- **Triage and fix window:** targeted within 30 days for confirmed issues,
  depending on severity and complexity.
- **Disclosure:** coordinated via the GitHub advisory. A CVE will be
  requested where applicable, and a patched release will be published to
  npm with provenance attestations before the advisory is made public.

## Scope

In scope:

- The `ts-rule-engine` source in this repository.
- The published tarball on npm (`ts-rule-engine`).
- Rule evaluation, fact mutation tracking, iteration bounds, and the
  infinite-loop guard.

Out of scope:

- Vulnerabilities in development-only dependencies listed under
  `devDependencies` — those do not ship in the published package.
- Runtime behaviour caused by user-supplied `condition` or `action`
  callbacks that themselves contain insecure code — the engine executes
  those functions as provided and cannot sandbox them.

## Supply Chain

This section explains how `ts-rule-engine` defends against supply-chain
attacks of the kind that hit widely-used packages in 2025 (notably the
`axios` compromise, where a maintainer token was abused to publish
versions that pulled in a malicious transitive dependency running
obfuscated code via a `postinstall` lifecycle hook). Each defence below
maps to a concrete step in that attack chain.

### Minimal dependency surface

- **Zero runtime dependencies.** `ts-rule-engine` has no `dependencies`
  field: deep cloning uses `structuredClone` (a Node built-in from 17+),
  and deep equality uses an in-repo implementation. Consumers audit a
  dependency surface of one: `ts-rule-engine` itself.
- **No peer dependencies.** The library runs standalone and does not
  pull anything into the consumer's install tree at peer resolution
  time.

### Zero install-time lifecycle scripts

- **`package.json` has no `postinstall`, `preinstall`, or `prepare`
  script** in the published manifest. The `prepare: simple-git-hooks`
  entry was dropped in favour of a one-time `npx simple-git-hooks`
  command documented in `CONTRIBUTING.md`. Consumer `npm install`
  cannot execute any of our lifecycle code, and attackers who smuggle
  in a malicious transitive dep still cannot run `postinstall` code
  from *this* package.
- **`files: ["dist"]`** ships only the `dist/` directory. No `src`,
  no `tests`, no `tsconfig.json`, no `vite.config.mts` — the
  attack surface inside the tarball is strictly the pre-built JS
  bundle, not arbitrary TypeScript that could be re-executed.

### OIDC trusted publishing

- **Releases are published via npm trusted publishing**, not a
  long-lived npm token. The `publish.yaml` workflow uses
  `id-token: write` and lets npm verify the publish was triggered by
  a specific GitHub Actions workflow run on this repository via OIDC.
  There is no `NPM_TOKEN` secret that can be exfiltrated from the
  repo or a maintainer account.
- **The publish pipeline is split into two jobs** so the tarball
  that gets attested is the exact same one that gets published:
  `build` runs full CI, `npm pack`s the tarball, signs it via
  [`actions/attest@v4`](https://github.com/actions/attest) (Sigstore
  keyless OIDC → SLSA v1 build provenance attestation
  [predicate type `https://slsa.dev/provenance/v1`] uploaded to
  GitHub's native attestation store), then uploads the tarball as a
  workflow artifact; `publish` downloads that artifact and runs
  `npm publish` — npm-registry provenance is emitted automatically
  via `publishConfig.provenance: true`. **Every action in every
  workflow is SHA-pinned** — there are no tag-pin exceptions.

### Release verifiability

[SLSA v1.2's distributing-provenance guidance](https://slsa.dev/spec/v1.2/distributing-provenance)
states that producers **MUST** publish attestations in at least one
place and **SHOULD** publish in more than one — the rationale being
that independent channels give consumers more than one way to
verify and remove any single point of failure. This project
publishes the same SLSA v1 build provenance in **three independent
channels** on every release (with the third channel carrying two
separate artifacts that target different verification tools, giving
four attestation files in total across the three channels):

1. **npm registry provenance** — emitted automatically by
   `npm publish` because `publishConfig.provenance: true` is set in
   `package.json`. Verifiable with
   [`npm audit signatures`](https://docs.npmjs.com/generating-provenance-statements).
2. **GitHub native attestation store** — produced by
   [`actions/attest@v4`](https://github.com/actions/attest) in the
   `build` job. Stored at
   [github.com/ilovepixelart/ts-rule-engine/attestations](https://github.com/ilovepixelart/ts-rule-engine/attestations)
   and verifiable through `gh attestation verify` — no extra tooling
   install required by consumers who already have the `gh` CLI.
3. **GitHub Release assets** — two sidecar files attached to the
   GitHub Release, carrying the same DSSE envelope at the innermost
   layer but in different outer containers for different verification
   flows:
   - **`<tarball>.sigstore.json`** — a straight copy of
     `actions/attest`'s output, a full Sigstore bundle
     ([`application/vnd.dev.sigstore.bundle.v0.3+json`](https://github.com/sigstore/protobuf-specs/blob/main/protos/sigstore_bundle.proto)).
     Carries the Fulcio certificate and the Rekor inclusion proof
     inline, so consumers can verify offline without querying Rekor.
     Parsed by `gh attestation verify --bundle` and other
     Sigstore-native tooling.
   - **`<tarball>.intoto.jsonl`** — a spec-compliant
     [in-toto attestation v1 bundle](https://github.com/in-toto/attestation/blob/main/spec/v1/bundle.md):
     JSON Lines of DSSE envelopes, one envelope per line. Extracted
     from the Sigstore bundle via `jq -c '.dsseEnvelope'` — this is
     a genuine in-toto bundle, not a renamed Sigstore bundle.
     Parsed by `slsa-verifier verify-artifact`, which queries Rekor
     for the certificate and inclusion proof via the signature hash.

   The two files are **not** duplicate signing material — they are
   the same cryptographic signature presented in two different
   container formats that different verification tools understand.

**Status:** the hardened pipeline lands with the first release after
this change. Earlier releases predate the new `publish.yaml` entirely
— no provenance in any channel. Starting with the first release under
the hardened pipeline, every published tarball will ship with npm
provenance, GitHub attestation-store provenance, and both
release-asset sidecars.

### Dev-environment isolation

- **Dependabot is configured for `github-actions` only**, not `npm`
  (see `.github/dependabot.yml`). Every runtime or dev-dep bump
  requires a manual, reviewed PR — the lib never auto-merges a new
  version of anything that reaches consumer installs. GitHub Actions
  SHA pins do get auto-bumped weekly because those pins are meant to
  rot fast and auto-bumping keeps Scorecard's Pinned-Dependencies at
  maximum.
- **CI action dependencies are SHA-pinned with trailing version
  comments**, so a compromised upstream action's new tag cannot
  silently run with our privileges.
- **Maintainer npm account uses 2FA / WebAuthn.** This is the single
  defence that cannot be enforced from the repository — it is a
  maintainer-side responsibility. A reviewer auditing this project's
  supply-chain posture should treat it as a documented commitment:
  if 2FA were disabled, the OIDC trusted-publishing defence above
  would not fully protect against a session hijack.

### Consumer verification steps

Anyone integrating `ts-rule-engine` into a production pipeline
has four verification paths available, each exercising one of the
distribution channels documented above. Pick the one that matches
the tooling you already trust and the environment you're deploying
to — the trust model is identical (all four resolve to the same
Fulcio-issued certificate binding the signature to the exact
GitHub Actions workflow run). For releases earlier than the
hardened pipeline, `npm audit signatures` only verifies npm
registry signatures without provenance.

**Primary check (no extra tooling):**

```bash
# Verifies npm provenance and registry signatures for all installed
# packages in one pass. Built into npm, no extra install required.
npm audit signatures

# Cross-checks the installed version against npm dist-tags.
npm view ts-rule-engine dist-tags
```

**Advanced check (independent of npm):**

```bash
# Pull the tarball from the npm registry (or GitHub Release) first:
npm pack ts-rule-engine@X.Y.Z

# Verify against the attestation stored on GitHub:
gh attestation verify ts-rule-engine-X.Y.Z.tgz \
  --repo ilovepixelart/ts-rule-engine \
  --signer-workflow ilovepixelart/ts-rule-engine/.github/workflows/publish.yaml
```

The `--signer-workflow` flag pins the verification to the exact
workflow file that produced the attestation — a stronger claim than
just `--repo` alone, because it blocks any other workflow in the
same repository from producing attestations that would pass
verification.

**Offline check via Sigstore bundle:**

```bash
gh attestation verify ts-rule-engine-X.Y.Z.tgz \
  --bundle ts-rule-engine-X.Y.Z.tgz.sigstore.json \
  --repo ilovepixelart/ts-rule-engine \
  --signer-workflow ilovepixelart/ts-rule-engine/.github/workflows/publish.yaml
```

**Third-party check via in-toto attestation bundle:**

```bash
# Install once (needs Go toolchain):
go install github.com/slsa-framework/slsa-verifier/v2/cmd/slsa-verifier@latest

# Verify:
slsa-verifier verify-artifact ts-rule-engine-X.Y.Z.tgz \
  --provenance-path ts-rule-engine-X.Y.Z.tgz.intoto.jsonl \
  --source-uri github.com/ilovepixelart/ts-rule-engine \
  --source-tag vX.Y.Z
```

All four verification paths end up at the same Fulcio-issued
certificate binding the signature to the exact GitHub Actions
workflow file that produced it. The split is about which tool you
trust and which dependencies you have installed, not about which
path is more secure.

## OpenSSF Scorecard — Accepted Findings

The project runs [OpenSSF Scorecard](https://securityscorecards.dev/) on a
weekly schedule (see `.github/workflows/scorecard.yaml`). The following
checks intentionally stay below their maximum score; the rationale is
documented here so future reviewers understand why they are not bugs to
chase:

- **`Code-Review`** — Scorecard requires that recent commits be approved
  by a reviewer distinct from the author. `ts-rule-engine` has a single
  active maintainer, so every change is inherently self-merged.
  Requiring approvals would either block all work or force self-approvals
  from a second account — neither offers real review value. We rely on
  automated gates (CI status checks, Scorecard, SonarCloud, Biome, type
  checks) to catch issues instead of human review.

- **`Contributors`** — Scorecard wants contributors from 3+ distinct
  organizations in the last 30 commits. As a personal project this is
  structurally unattainable; the score will move organically if external
  contributors join.

- **`CII-Best-Practices`** — tracked at
  [bestpractices.dev/projects/12515](https://www.bestpractices.dev/en/projects/12515).
  The project targets the "passing" tier; "silver" and "gold" require
  multiple reviewers and documented security-review processes that are
  out of reach for a single-maintainer project.
