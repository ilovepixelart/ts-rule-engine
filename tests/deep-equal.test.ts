import { describe, expect, it } from 'vitest'

import { RuleEngine } from '../src/index'

import type { Rule } from '../src/index'

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

const countingRule = <T>(id: string, mutate: (fact: T) => void): { rule: Rule<T>; calls: { n: number } } => {
  const calls = { n: 0 }
  return {
    calls,
    rule: {
      id,
      condition: () => true,
      action: (fact) => {
        calls.n++
        mutate(fact)
      },
    },
  }
}

describe('deepEqual — regression guards via fact-change detection', () => {
  describe('Date equality', () => {
    it('equal Date fields — idempotent rule fires exactly twice (one main pass + one verify pass)', async () => {
      interface F {
        createdAt: Date
        hit: boolean
      }
      const fact: F = { createdAt: new Date('2026-01-01T00:00:00Z'), hit: false }
      const { rule, calls } = countingRule<F>('r1', (f) => {
        f.hit = true
      })
      const engine = new RuleEngine(fact, { logger: silentLogger })
      engine.addRule(rule)
      await engine.run()
      expect(calls.n).toBe(2)
      expect(fact.hit).toBe(true)
    })

    it('mutated Date field — engine detects change and re-runs', async () => {
      interface F {
        createdAt: Date
        iterations: number
      }
      const fact: F = { createdAt: new Date('2026-01-01T00:00:00Z'), iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.createdAt = new Date(f.createdAt.getTime() + 1000)
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })
  })

  describe('RegExp equality', () => {
    it('equal RegExp fields — idempotent rule fires exactly twice', async () => {
      interface F {
        pattern: RegExp
        hit: boolean
      }
      const fact: F = { pattern: /^abc$/i, hit: false }
      const { rule, calls } = countingRule<F>('r1', (f) => {
        f.hit = true
      })
      const engine = new RuleEngine(fact, { logger: silentLogger })
      engine.addRule(rule)
      await engine.run()
      expect(calls.n).toBe(2)
      expect(fact.hit).toBe(true)
    })

    it('mutated RegExp source — engine detects change and re-runs', async () => {
      interface F {
        pattern: RegExp
        iterations: number
      }
      const fact: F = { pattern: /^abc$/i, iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.pattern = new RegExp(`${f.pattern.source}x`, f.pattern.flags)
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })

    it('mutated RegExp flags — engine detects change and re-runs', async () => {
      interface F {
        pattern: RegExp
        iterations: number
      }
      const fact: F = { pattern: /^abc$/, iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.pattern = new RegExp(f.pattern.source, 'i')
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Nested structures', () => {
    it('nested array of objects — equal — idempotent rule fires exactly twice', async () => {
      interface F {
        items: { sku: string; qty: number }[]
        processed: boolean
      }
      const fact: F = {
        items: [
          { sku: 'A', qty: 1 },
          { sku: 'B', qty: 2 },
        ],
        processed: false,
      }
      const { rule, calls } = countingRule<F>('r1', (f) => {
        f.processed = true
      })
      const engine = new RuleEngine(fact, { logger: silentLogger })
      engine.addRule(rule)
      await engine.run()
      expect(calls.n).toBe(2)
    })

    it('nested array length changes — detects', async () => {
      interface F {
        items: number[]
        iterations: number
      }
      const fact: F = { items: [1, 2], iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'push',
        condition: () => true,
        action: (f) => {
          f.items.push(f.iterations + 3)
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })

    it('array vs non-array at same key — treated as different', async () => {
      interface F {
        value: number[] | number
        iterations: number
      }
      const fact: F = { value: [1, 2, 3], iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'swap',
        condition: () => true,
        action: (f) => {
          f.value = Array.isArray(f.value) ? 42 : [1, 2, 3]
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })

    it('extra key in fact — detects', async () => {
      interface F {
        a: number
        b?: number
        iterations: number
      }
      const fact: F = { a: 1, iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'add',
        condition: () => true,
        action: (f) => {
          f.b ??= 5
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })
  })

  describe('Primitive edge cases', () => {
    it('NaN equal to NaN — idempotent rule fires exactly twice', async () => {
      interface F {
        v: number
        hit: boolean
      }
      const fact: F = { v: Number.NaN, hit: false }
      const { rule, calls } = countingRule<F>('r1', (f) => {
        f.hit = true
      })
      const engine = new RuleEngine(fact, { logger: silentLogger })
      engine.addRule(rule)
      await engine.run()
      expect(calls.n).toBe(2)
      expect(fact.hit).toBe(true)
    })

    it('null fact field — equal — idempotent rule fires exactly twice', async () => {
      interface F {
        v: null | number
        hit: boolean
      }
      const fact: F = { v: null, hit: false }
      const { rule, calls } = countingRule<F>('r1', (f) => {
        f.hit = true
      })
      const engine = new RuleEngine(fact, { logger: silentLogger })
      engine.addRule(rule)
      await engine.run()
      expect(calls.n).toBe(2)
    })

    it('null → object — detected as different', async () => {
      interface F {
        v: null | { x: number }
        iterations: number
      }
      const fact: F = { v: null, iterations: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'set',
        condition: () => true,
        action: (f) => {
          f.v = f.v === null ? { x: 1 } : null
          f.iterations++
        },
      })
      await engine.run()
      expect(fact.iterations).toBeGreaterThanOrEqual(2)
    })
  })
})
