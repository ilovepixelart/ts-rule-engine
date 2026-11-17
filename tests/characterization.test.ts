import { describe, expect, it } from 'vitest'

import * as api from '../src/index'
import { RuleEngine } from '../src/index'

import type { Logger, RuleEngineOptions } from '../src/index'

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

class LogSink implements Logger {
  calls: { level: string; args: unknown[] }[] = []

  info(...args: unknown[]): void {
    this.calls.push({ level: 'info', args })
  }

  warn(...args: unknown[]): void {
    this.calls.push({ level: 'warn', args })
  }

  error(...args: unknown[]): void {
    this.calls.push({ level: 'error', args })
  }
}

// Runs one always-true rule whose action applies `mutate`, and returns how many times it fired.
// 1: the action did not change the fact. 2: the first call changed it, the second call did not.
// maxIterations (5): every call changed the fact.
const firings = async <T>(fact: T, mutate: (fact: T) => void, options: RuleEngineOptions = {}): Promise<number> => {
  let calls = 0
  const engine = new RuleEngine(fact, { maxIterations: 5, logger: silentLogger, ...options })
  engine.addRule({
    id: 'mutate',
    condition: () => true,
    action: (f) => {
      calls++
      mutate(f)
    },
  })
  await engine.run()
  return calls
}

describe('Characterization: public API', () => {
  it('exports only RuleEngine at runtime', () => {
    expect(Object.keys(api)).toEqual(['RuleEngine'])
  })

  it('run() with the default fact and no rules resolves', async () => {
    await expect(new RuleEngine(undefined, { logger: silentLogger }).run()).resolves.toBeUndefined()
  })
})

describe('Characterization: fact change detection', () => {
  describe('plain objects', () => {
    it('no-op action: fires once', async () => {
      expect(await firings({ a: 1, b: 'x' }, () => {})).toBe(1)
    })

    it('idempotent assignment of a new value: fires twice', async () => {
      expect(
        await firings({ a: 1 }, (f) => {
          f.a = 2
        }),
      ).toBe(2)
    })

    it('counter increment: fires until maxIterations', async () => {
      expect(await firings({ a: 1 }, (f) => void f.a++)).toBe(5)
    })

    it('adding a key once: fires twice', async () => {
      expect(
        await firings<{ a: number; b?: number }>({ a: 1 }, (f) => {
          f.b = 1
        }),
      ).toBe(2)
    })

    it('adding a key whose value is undefined: fires twice', async () => {
      expect(
        await firings<{ a: number; b?: number | undefined }>({ a: 1 }, (f) => {
          f.b = undefined
        }),
      ).toBe(2)
    })

    it('deleting a key once: fires twice', async () => {
      expect(await firings<{ a: number; b?: number }>({ a: 1, b: 2 }, (f) => void delete f.b)).toBe(2)
    })

    it('class instance, no-op action: fires once', async () => {
      class Account {
        constructor(public balance: number) {}
      }
      expect(await firings(new Account(5), () => {})).toBe(1)
    })

    it('class instance, field change: fires twice', async () => {
      class Account {
        constructor(public balance: number) {}
      }
      expect(
        await firings(new Account(5), (f) => {
          f.balance = 0
        }),
      ).toBe(2)
    })

    it('own enumerable getter with a stable value: fires once', async () => {
      const fact = {
        base: 2,
        get double() {
          return this.base * 2
        },
      }
      expect(await firings(fact, () => {})).toBe(1)
    })

    it('own "__proto__" key from JSON.parse, no-op action: fires once', async () => {
      const fact = JSON.parse('{"__proto__": {"admin": true}, "a": 1}') as { a: number }
      expect(await firings(fact, () => {})).toBe(1)
      expect(Object.hasOwn(fact, '__proto__')).toBe(true)
    })

    it('own "__proto__" key from JSON.parse, nested change: fires twice', async () => {
      const protoKey = '__proto__'
      const fact = JSON.parse('{"__proto__": {"admin": true}, "a": 1}') as Record<string, { admin: boolean }>
      expect(
        await firings(fact, (f) => {
          ;(f[protoKey] as { admin: boolean }).admin = false
        }),
      ).toBe(2)
    })
  })

  describe('nested objects', () => {
    it('deep in-place increment: fires until maxIterations', async () => {
      expect(await firings({ a: { b: { c: 1 } } }, (f) => void f.a.b.c++)).toBe(5)
    })

    it('deep idempotent assignment: fires twice', async () => {
      expect(
        await firings({ a: { b: { c: 1 } } }, (f) => {
          f.a.b.c = 9
        }),
      ).toBe(2)
    })

    it('replacing a nested object with an equal copy: fires once', async () => {
      expect(
        await firings({ a: { b: 1 } }, (f) => {
          f.a = { b: 1 }
        }),
      ).toBe(1)
    })
  })

  describe('arrays', () => {
    it('push: fires until maxIterations', async () => {
      expect(await firings({ items: [1] }, (f) => void f.items.push(1))).toBe(5)
    })

    it('element set to the same value: fires once', async () => {
      expect(
        await firings({ items: [1, 2] }, (f) => {
          f.items[0] = 1
        }),
      ).toBe(1)
    })

    it('element set to a new value once: fires twice', async () => {
      expect(
        await firings({ items: [1, 2] }, (f) => {
          f.items[0] = 7
        }),
      ).toBe(2)
    })

    it('element of an object inside an array changed once: fires twice', async () => {
      expect(
        await firings({ items: [{ qty: 1 }] }, (f) => {
          ;(f.items[0] as { qty: number }).qty = 3
        }),
      ).toBe(2)
    })

    it('replaced with an equal array: fires once', async () => {
      expect(
        await firings({ items: [1, [2, 3]] }, (f) => {
          f.items = [1, [2, 3]]
        }),
      ).toBe(1)
    })
  })

  describe('Date', () => {
    it('setTime to the same time: fires once', async () => {
      expect(await firings({ at: new Date('2026-01-01T00:00:00Z') }, (f) => void f.at.setTime(f.at.getTime()))).toBe(1)
    })

    it('in-place setTime forward: fires until maxIterations', async () => {
      expect(await firings({ at: new Date('2026-01-01T00:00:00Z') }, (f) => void f.at.setTime(f.at.getTime() + 1))).toBe(5)
    })

    it('replaced with an equal Date: fires once', async () => {
      expect(
        await firings({ at: new Date('2026-01-01T00:00:00Z') }, (f) => {
          f.at = new Date('2026-01-01T00:00:00Z')
        }),
      ).toBe(1)
    })
  })

  describe('RegExp', () => {
    it('lastIndex change is not a fact change: fires once', async () => {
      expect(await firings({ re: /a/g }, (f) => void f.re.test('aaa'))).toBe(1)
    })

    it('replaced with an equal RegExp: fires once', async () => {
      expect(
        await firings({ re: /a/g }, (f) => {
          f.re = /a/g
        }),
      ).toBe(1)
    })

    it('replaced with a different source once: fires twice', async () => {
      expect(
        await firings({ re: /a/g }, (f) => {
          f.re = /b/g
        }),
      ).toBe(2)
    })
  })

  describe('numbers (Object.is semantics)', () => {
    it('NaN reassigned to NaN: fires once', async () => {
      expect(
        await firings({ v: Number.NaN }, (f) => {
          f.v = Number.NaN
        }),
      ).toBe(1)
    })

    it('NaN replaced by a number once: fires twice', async () => {
      expect(
        await firings({ v: Number.NaN }, (f) => {
          f.v = 0
        }),
      ).toBe(2)
    })

    it('+0 replaced by -0 once is a change: fires twice', async () => {
      expect(
        await firings({ v: 0 }, (f) => {
          f.v = -0
        }),
      ).toBe(2)
    })

    it('-0 reassigned to -0: fires once', async () => {
      expect(
        await firings({ v: -0 }, (f) => {
          f.v = -0
        }),
      ).toBe(1)
    })
  })

  describe('Map, Set and typed arrays', () => {
    it('Map, no-op action: fires once', async () => {
      expect(await firings({ m: new Map<string, unknown>([['k', { n: 1 }]]) }, () => {})).toBe(1)
    })

    it('Set of primitives and objects, no-op action: fires once', async () => {
      expect(await firings({ s: new Set<unknown>(['a', 1, { n: 1 }]) }, () => {})).toBe(1)
    })

    it('Uint8Array element increment: fires until maxIterations', async () => {
      expect(
        await firings({ bytes: new Uint8Array([0, 0]) }, (f) => {
          f.bytes[0] = (f.bytes[0] ?? 0) + 1
        }),
      ).toBe(5)
    })
  })

  describe('ignoreFactChanges', () => {
    it('a mutating rule fires exactly once', async () => {
      expect(await firings({ a: 1 }, (f) => void f.a++, { ignoreFactChanges: true })).toBe(1)
    })

    it('fired rules are removed: a second run() fires nothing', async () => {
      const fired: string[] = []
      const engine = new RuleEngine({ a: 1 }, { ignoreFactChanges: true, logger: silentLogger })
      engine.addRule({ id: 'x', condition: () => true, action: () => void fired.push('x') })
      engine.addRule({ id: 'y', condition: () => false, action: () => void fired.push('y') })
      await engine.run()
      await engine.run()
      expect(fired).toEqual(['x'])
    })
  })
})

describe('Characterization: run() control flow and logger calls', () => {
  it('two passes: logs each evaluation, then the finish line with the fired count', async () => {
    const logger = new LogSink()
    const engine = new RuleEngine({ a: 1, seen: false }, { logger })
    engine.addRule({
      id: 'set',
      condition: () => true,
      action: (f) => {
        f.a = 2
      },
    })
    engine.addRule({ id: 'never', name: 'Never', condition: () => false, action: () => {} })
    await engine.run()
    expect(logger.calls).toEqual([
      { level: 'info', args: ['Evaluating rule: set (condition met)'] },
      { level: 'info', args: ['Evaluating rule: Never (skipped)'] },
      { level: 'info', args: ['Evaluating rule: set (condition met)'] },
      { level: 'info', args: ['Evaluating rule: Never (skipped)'] },
      { level: 'info', args: ['Rule engine finished. With total iterations:', 2] },
    ])
  })

  it('maxIterations: stops after exactly N firings and logs the limit', async () => {
    const logger = new LogSink()
    const fact = { n: 0 }
    const engine = new RuleEngine(fact, { maxIterations: 3, logger })
    engine.addRule({ id: 'inc', condition: () => true, action: (f) => void f.n++ })
    await engine.run()
    expect(fact.n).toBe(3)
    expect(logger.calls.at(-1)).toEqual({ level: 'info', args: ['Termination condition met. Maximum iterations reached.'] })
    expect(logger.calls.filter((c) => c.args[0] === 'Evaluating rule: inc (condition met)')).toHaveLength(3)
  })

  it('maxIterations: a condition that changes the fact a few times without firing still settles normally', async () => {
    const logger = new LogSink()
    const fact = { n: 0 }
    let evals = 0
    const engine = new RuleEngine(fact, { maxIterations: 10, logger })
    engine.addRule({
      id: 'probe',
      condition: (f) => {
        evals++
        if (f.n < 3) f.n++
        return false
      },
      action: () => {},
    })
    await engine.run()
    expect(evals).toBe(4)
    expect(fact.n).toBe(3)
    expect(logger.calls.at(-1)).toEqual({ level: 'info', args: ['Rule engine finished. With total iterations:', 0] })
  })

  it('stop() in an action: no later rule and no further pass, even though the fact changed', async () => {
    const logger = new LogSink()
    const fired: string[] = []
    const engine = new RuleEngine({ n: 0 }, { logger })
    engine.addRule({
      id: 'first',
      weight: 2,
      condition: () => true,
      action: (f, { stop }) => {
        fired.push('first')
        f.n++
        stop()
      },
    })
    engine.addRule({ id: 'second', weight: 1, condition: () => true, action: () => void fired.push('second') })
    await engine.run()
    expect(fired).toEqual(['first'])
    expect(logger.calls.at(-1)).toEqual({ level: 'info', args: ['Termination condition met based on action.'] })
  })

  it('a throwing condition: logs the error and rejects with the same error', async () => {
    const logger = new LogSink()
    const boom = new Error('boom')
    const engine = new RuleEngine({}, { logger })
    engine.addRule({
      id: 'bad',
      condition: () => {
        throw boom
      },
      action: () => {},
    })
    await expect(engine.run()).rejects.toBe(boom)
    expect(logger.calls).toEqual([{ level: 'error', args: ['Rule engine encountered an error: \n', boom] }])
  })

  it('the fact passed to rules is the caller object, not a copy', async () => {
    const fact = { a: 1 }
    const seen: unknown[] = []
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'r',
      condition: (f) => {
        seen.push(f)
        return false
      },
      action: () => {},
    })
    await engine.run()
    expect(seen).toEqual([fact])
    expect(seen[0]).toBe(fact)
  })
})
