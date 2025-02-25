import { afterEach, describe, expect, it, vi } from 'vitest'

import { RuleEngine } from '../src/index'
import type { Rule } from '../src/index'

interface Fact {
  card: string
  transactionTotal: number
  result?: unknown
  input?: boolean
  ruleName?: string
  ruleID?: string | number
  x?: boolean
  y?: boolean
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('Rules', () => {
  const consoleSpyInfo = vi.spyOn(console, 'info')

  afterEach(() => {
    consoleSpyInfo.mockReset()
  })

  describe('.run()', () => {
    it('should run action when condition matches', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 400,
      }

      const rule: Rule<Fact> = {
        id: 'rule1',
        weight: 1,
        condition: (fact: Fact) => {
          return fact.transactionTotal < 500
        },
        action: (fact: Fact) => {
          fact.transactionTotal = 500
        },
      }

      const engine = new RuleEngine(fact)
      engine.addRule(rule)
      await engine.run()

      expect(fact.transactionTotal).toBe(500)
    })

    it('should chain rules and find result', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 400,
      }

      const engine = new RuleEngine(fact)

      engine.addRule({
        id: 'rule1',
        weight: 2,
        condition: (fact: Fact) => {
          return fact.card === 'VISA'
        },
        action: (fact: Fact) => {
          fact.result = 'Custom Result'
        },
      })

      engine.addRule({
        id: 'rule2',
        weight: 1,
        condition: (fact: Fact) => {
          return fact.transactionTotal < 1000
        },
        action: () => {
          return
        },
      })

      await engine.run()

      expect(fact.result).toBe('Custom Result')
    })

    it('should provide access to rule definition properties via { rule }', async () => {
      const fact: Fact = {
        input: true,
        card: 'VISA',
        transactionTotal: 400,
      }

      const rule: Rule<Fact> = {
        id: 'rule1',
        name: 'Rule 1',
        weight: 1,
        condition: (fact) => {
          return fact.input === true
        },
        action: (fact, { rule }) => {
          fact.result = true
          fact.ruleName = rule.name
          fact.ruleID = rule.id
        },
      }

      const engine = new RuleEngine(fact)
      engine.addRule(rule)
      await engine.run()

      expect(fact.ruleName).toEqual(rule.name)
      expect(fact.ruleID).toEqual(rule.id)
    })

    it('last rule executed should be rule E', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 400,
        x: true,
        y: false,
      }

      const rules: Rule<Fact>[] = [
        {
          id: 'rule A',
          name: 'rule A',
          condition: (fact) => {
            return fact.x === true
          },
          action: (fact, { rule }) => {
            fact.ruleID = rule.id
          },
        },
        {
          id: 'rule B',
          name: 'rule B',
          condition: (fact) => {
            return fact.y === true
          },
          action: (fact, { rule }) => {
            fact.ruleID = rule.id
          },
        },
        {
          id: 'rule C',
          name: 'rule C',
          condition: (fact) => {
            return fact.x === true && fact.y === false
          },
          action: (fact, { rule }) => {
            fact.ruleID = rule.id
          },
        },
        {
          id: 'rule D',
          name: 'rule D',
          condition: (fact: Fact) => {
            return fact.x === false && fact.y === false
          },
          action: (fact, { rule }) => {
            fact.ruleID = rule.id
          },
        },
        {
          id: 'rule E',
          name: 'rule E',
          condition: (fact: Fact) => {
            return fact.x === true && fact.y === false
          },
          action: (fact, { rule }) => {
            fact.ruleID = rule.id
          },
        },
      ]
      const engine = new RuleEngine(fact, { ignoreFactChanges: false })
      engine.addRules(rules)
      await engine.run()

      expect(fact.ruleID).toBe('rule E')
    })

    it('should work with async condition and async action, ignoreFactChanges: true', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rule: Rule<Fact> = {
        id: 'rule 1',
        name: 'rule 1',
        weight: 1,
        condition: async (fact: Fact) => {
          await wait(200)
          return fact.transactionTotal < 500
        },
        action: async (fact: Fact) => {
          await wait(200)
          fact.result = false
        },
      }

      const engine = new RuleEngine(fact, { ignoreFactChanges: true })
      engine.addRule(rule)
      await engine.run()

      expect(fact.result).toBe(false)
    })

    it('should stop running rules when stop() is called in action after first rule', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rules: Rule<Fact>[] = [
        {
          id: 'rule 1',
          name: 'rule 1',
          weight: 2,
          condition: async (fact) => {
            await wait(200)
            return fact.transactionTotal < 500
          },
          action: async (fact, { rule, stop }) => {
            await wait(200)
            fact.result = rule.id
            stop()
          },
        },
        {
          id: 'rule 2',
          name: 'rule 2',
          weight: 1,
          condition: async (fact) => {
            await wait(200)
            return fact.transactionTotal < 300
          },
          action: async (fact, { rule }) => {
            await wait(200)
            fact.result = rule.id
          },
        },
      ]

      const engine = new RuleEngine(fact)
      engine.addRules(rules)
      await engine.run()
      expect(consoleSpyInfo).toHaveBeenCalledTimes(2)
      expect(consoleSpyInfo).toHaveBeenCalledWith('Termination condition met based on action.')

      expect(fact.result).toBe('rule 1')
    })

    it('should stop running rules when stop() is called in condition after first rule', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rules: Rule<Fact>[] = [
        {
          id: 'rule 1',
          name: 'rule 1',
          weight: 2,
          condition: async (fact, { stop }) => {
            await wait(200)
            stop()
            return fact.transactionTotal < 500
          },
          action: async (fact, { rule }) => {
            await wait(200)
            fact.result = rule.id
          },
        },
        {
          id: 'rule 2',
          name: 'rule 2',
          weight: 1,
          condition: async (fact) => {
            await wait(200)
            return fact.transactionTotal < 300
          },
          action: async (fact, { rule }) => {
            await wait(200)
            fact.result = rule.id
          },
        },
      ]

      const engine = new RuleEngine(fact)
      engine.addRules(rules)
      await engine.run()
      expect(consoleSpyInfo).toHaveBeenCalledTimes(2)
      expect(consoleSpyInfo).toHaveBeenCalledWith('Evaluating rule: rule 1 (condition met)')
      expect(consoleSpyInfo).toHaveBeenCalledWith('Termination condition met based on action.')
    })

    it('should throw error on evaluating the condition', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rule: Rule<Fact> = {
        id: 'rule 1',
        name: 'rule 1',
        weight: 1,
        condition: async () => {
          throw new Error('Error in condition')
        },
        action: async (fact) => {
          fact.result = false
        },
      }

      const engine = new RuleEngine(fact)
      engine.addRule(rule)
      await expect(engine.run()).rejects.toThrow('Error in condition')
    })

    it('should throw error on evaluating the action', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rule: Rule<Fact> = {
        id: 'rule 1',
        name: 'rule 1',
        weight: 1,
        condition: async () => {
          return true
        },
        action: async () => {
          throw new Error('Error in action')
        },
      }

      const engine = new RuleEngine(fact)
      engine.addRule(rule)
      await expect(engine.run()).rejects.toThrow('Error in action')
    })

    it('should stop running after first iteration when maxIterations=1', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rules: Rule<Fact>[] = [
        {
          id: 'rule 1',
          name: 'rule 1',
          weight: 2,
          condition: async (fact) => {
            await wait(200)
            return fact.transactionTotal < 500
          },
          action: async (fact, { rule }) => {
            await wait(200)
            fact.result = rule.id
          },
        },
        {
          id: 'rule 2',
          name: 'rule 2',
          weight: 1,
          condition: async (fact) => {
            await wait(200)
            return fact.transactionTotal < 300
          },
          action: async (fact, { rule }) => {
            await wait(200)
            fact.result = rule.id
          },
        },
      ]

      const engine = new RuleEngine(fact, { maxIterations: 1 })
      engine.addRules(rules)
      await engine.run()

      expect(fact.result).toBe('rule 1')
      expect(consoleSpyInfo).toHaveBeenCalledTimes(2)
      expect(consoleSpyInfo).toHaveBeenCalledWith('Evaluating rule: rule 1 (condition met)')
      expect(consoleSpyInfo).toHaveBeenCalledWith('Termination condition met. Maximum iterations reached.')
    })

    it('should update rule', async () => {
      const fact: Fact = {
        card: 'VISA',
        transactionTotal: 200,
      }

      const rule: Rule<Fact> = {
        id: 'rule 1',
        name: 'rule 1',
        weight: 1,
        condition: async (fact) => {
          return fact.transactionTotal < 500
        },
        action: async (fact) => {
          fact.result = false
        },
      }

      const engine = new RuleEngine(fact)
      engine.addRule(rule)
      await engine.run()

      expect(fact.result).toBe(false)

      const newRule: Rule<Fact> = {
        id: 'rule 1',
        name: 'rule 1',
        weight: 1,
        condition: async (fact) => {
          return fact.transactionTotal < 300
        },
        action: async (fact) => {
          fact.result = true
        },
      }

      engine.updateRule(rule.id, newRule)
      await engine.run()

      expect(fact.result).toBe(true)
    })
  })
})
