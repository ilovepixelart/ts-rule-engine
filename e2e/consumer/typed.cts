// Typed CommonJS consumer of the packed declarations (resolves the require condition).
import { type Rule, RuleEngine } from 'ts-rule-engine'

const rule: Rule<{ n: number }> = { id: 'inc', condition: (f) => f.n < 1, action: (f) => void f.n++ }
const engine = new RuleEngine({ n: 0 })
engine.addRule(rule)
// @ts-expect-error the fact type flows into rules
engine.addRule({ id: 'bad', condition: (f) => f.s === '', action: () => {} })

export { engine }
