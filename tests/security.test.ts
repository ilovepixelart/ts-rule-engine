import { describe, expect, it } from 'vitest'

import { RuleEngine } from '../src/index'

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

describe('Security hardening', () => {
  describe('maxIterations validation at construction', () => {
    it('rejects zero', () => {
      expect(() => new RuleEngine({}, { maxIterations: 0, logger: silentLogger })).toThrow(RangeError)
    })

    it('rejects negative values', () => {
      expect(() => new RuleEngine({}, { maxIterations: -1, logger: silentLogger })).toThrow(RangeError)
    })

    it('rejects NaN', () => {
      expect(() => new RuleEngine({}, { maxIterations: Number.NaN, logger: silentLogger })).toThrow(RangeError)
    })

    it('rejects Infinity', () => {
      expect(() => new RuleEngine({}, { maxIterations: Number.POSITIVE_INFINITY, logger: silentLogger })).toThrow(RangeError)
    })

    it('rejects -Infinity', () => {
      expect(() => new RuleEngine({}, { maxIterations: Number.NEGATIVE_INFINITY, logger: silentLogger })).toThrow(RangeError)
    })

    it('accepts positive finite integers', () => {
      expect(() => new RuleEngine({}, { maxIterations: 1, logger: silentLogger })).not.toThrow()
      expect(() => new RuleEngine({}, { maxIterations: 1000, logger: silentLogger })).not.toThrow()
    })

    it('accepts omitted maxIterations (unbounded by default)', () => {
      expect(() => new RuleEngine({}, { logger: silentLogger })).not.toThrow()
    })
  })

  describe('stack-safe iteration', () => {
    it('mutating rule with large maxIterations does not overflow the call stack', async () => {
      interface F {
        counter: number
      }
      const fact: F = { counter: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 5000, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.counter++
        },
      })

      await expect(engine.run()).resolves.toBeUndefined()
      expect(fact.counter).toBe(5000)
    })

    it('10k-iteration mutation run completes without RangeError', async () => {
      interface F {
        counter: number
      }
      const fact: F = { counter: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 10_000, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.counter++
        },
      })

      await expect(engine.run()).resolves.toBeUndefined()
      expect(fact.counter).toBe(10_000)
    })
  })

  describe('re-entrant run() guard', () => {
    it('concurrent run() on the same engine throws on the second call', async () => {
      interface F {
        counter: number
      }
      const fact: F = { counter: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 100, logger: silentLogger })

      // Action blocks on an external promise we control — no timers, no races.
      let release: () => void = () => {}
      const blocker = new Promise<void>((resolve) => {
        release = resolve
      })

      engine.addRule({
        id: 'gate',
        condition: () => true,
        action: async (f) => {
          f.counter++
          await blocker
        },
      })

      const first = engine.run()
      // Yield so the engine enters the action and awaits `blocker`.
      await Promise.resolve()
      await Promise.resolve()

      await expect(engine.run()).rejects.toThrow(/not re-entrant/)

      release()
      await first
      expect(fact.counter).toBeGreaterThan(0)
    })

    it('sequential run() calls on the same engine are allowed', async () => {
      interface F {
        counter: number
      }
      const fact: F = { counter: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 5, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.counter++
        },
      })

      await engine.run()
      await engine.run()
      expect(fact.counter).toBeGreaterThan(0)
    })
  })

  describe('state reset on run() re-entry', () => {
    it('run() after stop() does not short-circuit on stale terminate flag', async () => {
      interface F {
        first: boolean
        second: boolean
      }
      const fact: F = { first: false, second: false }
      const engine = new RuleEngine(fact, { logger: silentLogger })
      engine.addRule({
        id: 'stopper',
        condition: () => !fact.first,
        action: (f, { stop }) => {
          f.first = true
          stop()
        },
      })
      engine.addRule({
        id: 'second',
        condition: () => fact.first && !fact.second,
        action: (f) => {
          f.second = true
        },
      })

      await engine.run()
      expect(fact.first).toBe(true)
      expect(fact.second).toBe(false)

      await engine.run()
      expect(fact.second).toBe(true)
    })

    it('run() after hitting maxIterations resets iteration counter', async () => {
      interface F {
        counter: number
      }
      const fact: F = { counter: 0 }
      const engine = new RuleEngine(fact, { maxIterations: 3, logger: silentLogger })
      engine.addRule({
        id: 'bump',
        condition: () => true,
        action: (f) => {
          f.counter++
        },
      })

      await engine.run()
      expect(fact.counter).toBe(3)

      await engine.run()
      expect(fact.counter).toBe(6)
    })
  })

  describe('updateRule return value', () => {
    it('returns true when a rule with the given id exists', () => {
      const engine = new RuleEngine({}, { logger: silentLogger })
      engine.addRule({ id: 'a', condition: () => true, action: () => {} })
      const result = engine.updateRule('a', { id: 'a', condition: () => false, action: () => {} })
      expect(result).toBe(true)
    })

    it('returns false when no rule with the given id exists', () => {
      const engine = new RuleEngine({}, { logger: silentLogger })
      engine.addRule({ id: 'a', condition: () => true, action: () => {} })
      const result = engine.updateRule('missing', { id: 'missing', condition: () => false, action: () => {} })
      expect(result).toBe(false)
    })
  })
})
