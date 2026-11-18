'use strict'

// Runs every scenario in order and records its observed value, or the error that escaped it.
const runAll = async (scenarios, lib) => {
  const report = {}
  for (const scenario of scenarios) {
    try {
      report[scenario.name] = { observed: await scenario.run(lib) }
    } catch (error) {
      report[scenario.name] = { escaped: `${error.name}: ${error.message}` }
    }
  }
  return report
}

module.exports = { runAll }
