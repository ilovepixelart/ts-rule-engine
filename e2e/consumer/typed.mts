// Typed ESM consumer of the packed declarations. Compiled with tsc under nodenext and bundler resolution.
import { type Data, type Logger, type Rule, RuleEngine, type RuleEngineOptions } from 'ts-rule-engine'

interface Fact {
  balance: number
  broke?: boolean
}

const logger: Logger = { info: () => {}, warn: () => {}, error: () => {} }
const options: RuleEngineOptions = { ignoreFactChanges: false, maxIterations: 10, logger }

const rule: Rule<Fact> = {
  id: 1,
  name: 'Rule 1',
  weight: 1,
  condition: async (fact, data: Data<Fact>) => {
    data.logger.info(data.rule.id)
    return fact.balance < 5
  },
  action: (fact, { stop }) => {
    fact.broke = true
    stop()
  },
}

const engine = new RuleEngine<Fact>({ balance: 1 }, options)
engine.addRule(rule)
engine.addRules([{ ...rule, id: 'two' }])
const updated: boolean = engine.updateRule('two', rule)
engine.removeRule(1)
engine.sort()
engine.stop()
const done: Promise<void> = engine.run()

// @ts-expect-error a condition must return boolean or Promise<boolean>
const badCondition: Rule<Fact> = { id: 'x', condition: () => 'yes', action: () => {} }
// @ts-expect-error the fact type flows into rules
const badFact: Rule<Fact> = { id: 'y', condition: (fact) => fact.missing === 1, action: () => {} }
// @ts-expect-error id is string or number
const badId: Rule<Fact> = { id: true, condition: () => true, action: () => {} }
// @ts-expect-error unknown option
const badOptions: RuleEngineOptions = { maxIteration: 1 }

export { badCondition, badFact, badId, badOptions, done, updated }
