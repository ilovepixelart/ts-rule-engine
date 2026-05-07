import { describe, expect, it } from 'vitest'

import fc from 'fast-check'
import { RuleEngine } from '../src/index'

import type { Rule } from '../src/index'

interface Fact {
  counter: number
  touched: string[]
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

const identityRule = (id: number | string, weight: number): Rule<Fact> => ({
  id,
  weight,
  condition: () => true,
  action: (fact, { rule }) => {
    fact.touched.push(String(rule.id))
  },
})

const incrementRule = (id: number | string, weight: number, delta: number): Rule<Fact> => ({
  id,
  weight,
  condition: () => true,
  action: (fact) => {
    fact.counter += delta
  },
})

describe('RuleEngine properties', () => {
  it('weight ordering — higher weight rules always fire first', () => {
    fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(fc.integer({ min: -10, max: 10 }), fc.integer({ min: 0, max: 100 })), { minLength: 1, maxLength: 15 }), async (weightSeeds) => {
        const fact: Fact = { counter: 0, touched: [] }
        const engine = new RuleEngine(fact, { ignoreFactChanges: true, logger: silentLogger })
        const rules = weightSeeds.map(([weight], i) => identityRule(i, weight))
        for (const rule of rules) {
          engine.addRule(rule)
        }
        await engine.run()

        const orderedByWeight = [...weightSeeds.map(([w], i) => ({ w, i }))].sort((a, b) => b.w - a.w)
        for (let i = 0; i < fact.touched.length; i++) {
          if (i > 0) {
            const prev = weightSeeds[Number(fact.touched[i - 1])]
            const curr = weightSeeds[Number(fact.touched[i])]
            if (prev && curr) {
              expect(prev[0] >= curr[0]).toBe(true)
            }
          }
        }
        expect(fact.touched.length).toBe(orderedByWeight.length)
      }),
      { numRuns: 50 },
    )
  })

  it('ignoreFactChanges — each rule fires exactly once regardless of fact mutation', () => {
    fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 1, maxLength: 20 }), async (deltas) => {
        const fact: Fact = { counter: 0, touched: [] }
        const engine = new RuleEngine(fact, { ignoreFactChanges: true, logger: silentLogger })
        for (const [i, delta] of deltas.entries()) {
          engine.addRule(incrementRule(i, 0, delta))
        }
        await engine.run()

        const expected = deltas.reduce((sum, d) => sum + d, 0)
        expect(fact.counter).toBe(expected)
      }),
      { numRuns: 50 },
    )
  })

  it('maxIterations bounds the number of action invocations', () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 20 }), async (maxIterations, ruleCount) => {
        const fact: Fact = { counter: 0, touched: [] }
        const engine = new RuleEngine(fact, { maxIterations, logger: silentLogger })
        for (let i = 0; i < ruleCount; i++) {
          engine.addRule(incrementRule(i, 0, 1))
        }
        await engine.run()

        expect(fact.counter).toBeLessThanOrEqual(maxIterations)
      }),
      { numRuns: 50 },
    )
  })

  it('stop() in first rule prevents any subsequent rules from firing', () => {
    fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 20 }), async (ruleCount) => {
        const fact: Fact = { counter: 0, touched: [] }
        const engine = new RuleEngine(fact, { logger: silentLogger })
        engine.addRule({
          id: 'stopper',
          weight: 100,
          condition: () => true,
          action: (fact, { stop }) => {
            fact.touched.push('stopper')
            stop()
          },
        })
        for (let i = 0; i < ruleCount; i++) {
          engine.addRule(identityRule(`later-${i}`, 0))
        }
        await engine.run()

        expect(fact.touched).toEqual(['stopper'])
      }),
      { numRuns: 50 },
    )
  })

  it('no rules — run() resolves without error and fact is unchanged', () => {
    fc.assert(
      fc.asyncProperty(fc.record({ counter: fc.integer(), touched: fc.array(fc.string()) }), async (input) => {
        const fact: Fact = { counter: input.counter, touched: [...input.touched] }
        const engine = new RuleEngine(fact, { logger: silentLogger })
        await engine.run()
        expect(fact.counter).toBe(input.counter)
        expect(fact.touched).toEqual(input.touched)
      }),
      { numRuns: 50 },
    )
  })

  it('removeRule — a removed rule never fires', () => {
    fc.assert(
      fc.asyncProperty(fc.array(fc.integer({ min: 0, max: 99 }), { minLength: 2, maxLength: 10 }), fc.integer({ min: 0, max: 9 }), async (ids, removeIndex) => {
        const uniqueIds = Array.from(new Set(ids))
        fc.pre(uniqueIds.length >= 2)
        const targetIndex = removeIndex % uniqueIds.length
        const targetId = uniqueIds[targetIndex]
        if (targetId === undefined) return
        const fact: Fact = { counter: 0, touched: [] }
        const engine = new RuleEngine(fact, { ignoreFactChanges: true, logger: silentLogger })
        for (const id of uniqueIds) {
          engine.addRule(identityRule(id, 0))
        }
        engine.removeRule(targetId)
        await engine.run()
        expect(fact.touched).not.toContain(String(targetId))
        expect(fact.touched.length).toBe(uniqueIds.length - 1)
      }),
      { numRuns: 50 },
    )
  })
})
