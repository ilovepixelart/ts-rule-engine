// End-to-end check of the packed artifact. Packs the built package, installs the tarball and the latest
// published release into a fresh consumer project outside the repo, then:
//   1. runs every scenario through require() and import() and requires identical results,
//   2. compares each result with its hand-written expected value,
//   3. compiles typed consumers against the packed .d.ts under nodenext and bundler resolution,
//   4. runs the same scenarios against the published release and fails on any difference not in
//      e2e/allowlist.json.
// E2E_TARGET=<published version or tarball path> tests that package instead of packing the repo.
// E2E_BASELINE=<npm spec> overrides the published release used for the differential.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { isDeepStrictEqual } from 'node:util'

const require = createRequire(import.meta.url)
const here = import.meta.dirname
const repo = resolve(here, '..')
const { scenarios } = require('./scenarios.cjs')
const allowlist = JSON.parse(readFileSync(join(here, 'allowlist.json'), 'utf8'))
const repoPackage = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
const tsVersion = repoPackage.devDependencies.typescript
const baseline = process.env.E2E_BASELINE ?? `${repoPackage.name}@latest`
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const failures = []
const check = (label, ok, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`)
  if (!ok) failures.push(`${label}\n${detail}`)
}
const show = (value) => JSON.stringify(value, null, 2)

const sh = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 })

const work = mkdtempSync(join(tmpdir(), 'ts-rule-engine-e2e-'))
try {
  let target = process.env.E2E_TARGET
  if (!target) {
    // npm 10 and 11 print an array, npm 12 an object keyed by package name.
    const [packed] = Object.values(JSON.parse(sh(npm, ['pack', '--json', '--pack-destination', work], repo)))
    target = join(work, packed.filename)
  }
  console.log(`target: ${target}\nbaseline: ${baseline}`)

  const consumer = join(work, 'consumer')
  cpSync(join(here, 'consumer'), consumer, { recursive: true })
  cpSync(join(here, 'scenarios.cjs'), join(consumer, 'scenarios.cjs'))
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'e2e-consumer', private: true, type: 'module' }))
  sh(npm, ['install', '--no-audit', '--no-fund', '--ignore-scripts', `ts-rule-engine@${target}`, `published@npm:${baseline}`, `typescript@${tsVersion}`], consumer)

  const report = (entry, pkg) => {
    try {
      const result = JSON.parse(sh(process.execPath, [entry, pkg], consumer))
      check(`${entry} loads ${pkg}`, true)
      return result
    } catch (error) {
      check(`${entry} loads ${pkg}`, false, `${error.stderr ?? ''}${error.message}`)
      return {}
    }
  }
  const cjs = report('cjs.cjs', 'ts-rule-engine')
  const esm = report('esm.mjs', 'ts-rule-engine')

  for (const { name, expected } of scenarios) {
    check(`cjs and esm agree: ${name}`, isDeepStrictEqual(cjs[name], esm[name]), `cjs: ${show(cjs[name])}\nesm: ${show(esm[name])}`)
    check(`expected: ${name}`, isDeepStrictEqual(esm[name], { observed: expected }), `expected: ${show({ observed: expected })}\nactual:   ${show(esm[name])}`)
  }

  for (const mode of ['nodenext', 'bundler']) {
    let output = ''
    try {
      sh(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', `tsconfig.${mode}.json`], consumer)
    } catch (error) {
      output = `${error.stdout}${error.stderr}`
    }
    check(`types compile under ${mode} resolution`, output === '', output)
  }

  const published = report('esm.mjs', 'published')
  for (const { name } of scenarios) {
    const allowed = allowlist.some((entry) => entry.scenario === name)
    const same = isDeepStrictEqual(published[name], esm[name])
    check(`same as ${baseline}${allowed ? ' (allowlisted change)' : ''}: ${name}`, same || allowed, `published: ${show(published[name])}\ntarget:    ${show(esm[name])}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.error(`\n${failures.length} e2e check(s) failed:\n\n${failures.join('\n\n')}`)
  process.exit(1)
}
console.log(`\nAll e2e checks passed (${scenarios.length} scenarios).`)
