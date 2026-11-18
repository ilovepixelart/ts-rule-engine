'use strict'

// CommonJS consumer: loads the package named on the command line with require().
const { scenarios } = require('./scenarios.cjs')
const { runAll } = require('./report.cjs')

runAll(scenarios, require(process.argv[2])).then((report) => process.stdout.write(JSON.stringify(report)))
