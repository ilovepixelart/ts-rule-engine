// ES module consumer: loads the package named on the command line with import().
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { scenarios } = require('./scenarios.cjs')
const { runAll } = require('./report.cjs')

const lib = await import(process.argv[2])
process.stdout.write(JSON.stringify(await runAll(scenarios, lib)))
