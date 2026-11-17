import { describe, expect, it } from 'vitest'

import { RuleEngine } from '../src/index'

import type { Logger, Rule } from '../src/index'

interface Fact {
  fired: string[]
}

class LogSink implements Logger {
  messages: unknown[] = []

  info(message?: unknown): void {
    this.messages.push(message)
  }

  warn(message?: unknown): void {
    this.messages.push(message)
  }

  error(message?: unknown): void {
    this.messages.push(message)
  }
}

const later: Rule<Fact> = {
  id: 'later',
  weight: 1,
  condition: (f) => !f.fired.includes('later'),
  action: (f) => {
    f.fired.push('later')
  },
}

describe('stop()', () => {
  it('called in an action: the rest of the pass is skipped and no further pass runs', async () => {
    const logger = new LogSink()
    const fact: Fact = { fired: [] }
    const engine = new RuleEngine(fact, { logger })
    engine.addRule({
      id: 'guard',
      weight: 10,
      condition: () => true,
      action: (f, { stop }) => {
        f.fired.push('guard')
        stop()
      },
    })
    engine.addRule(later)
    await engine.run()
    expect(fact.fired).toEqual(['guard'])
    expect(logger.messages).toEqual(['Evaluating rule: guard (condition met)', 'Termination condition met based on action.'])
  })

  it('called in a condition that returns true: that rule still fires, no later rule does', async () => {
    const logger = new LogSink()
    const fact: Fact = { fired: [] }
    const engine = new RuleEngine(fact, { logger })
    engine.addRule({
      id: 'guard',
      weight: 10,
      condition: (_f, { stop }) => {
        stop()
        return true
      },
      action: (f) => {
        f.fired.push('guard')
      },
    })
    engine.addRule(later)
    await engine.run()
    expect(fact.fired).toEqual(['guard'])
    expect(logger.messages).toEqual(['Evaluating rule: guard (condition met)', 'Termination condition met based on action.'])
  })

  it('called in a condition that returns false: no later rule fires', async () => {
    const logger = new LogSink()
    const fact: Fact = { fired: [] }
    const engine = new RuleEngine(fact, { logger })
    engine.addRule({
      id: 'guard',
      weight: 10,
      condition: (_f, { stop }) => {
        stop()
        return false
      },
      action: (f) => {
        f.fired.push('guard')
      },
    })
    engine.addRule(later)
    await engine.run()
    expect(fact.fired).toEqual([])
    expect(logger.messages).toEqual(['Evaluating rule: guard (skipped)', 'Termination condition met based on condition.'])
  })

  it('called on the engine while a condition is pending, condition returns false: no later rule fires', async () => {
    const fact: Fact = { fired: [] }
    const engine = new RuleEngine(fact, { logger: new LogSink() })
    engine.addRule({
      id: 'guard',
      weight: 10,
      condition: async () => {
        await Promise.resolve()
        engine.stop()
        return false
      },
      action: () => {},
    })
    engine.addRule(later)
    await engine.run()
    expect(fact.fired).toEqual([])
  })

  it('control: a condition that returns false without stop(): later rules fire', async () => {
    const logger = new LogSink()
    const fact: Fact = { fired: [] }
    const engine = new RuleEngine(fact, { logger })
    engine.addRule({ id: 'guard', weight: 10, condition: () => false, action: () => {} })
    engine.addRule(later)
    await engine.run()
    expect(fact.fired).toEqual(['later'])
    expect(logger.messages).toEqual(['Evaluating rule: guard (skipped)', 'Evaluating rule: later (condition met)', 'Evaluating rule: guard (skipped)', 'Evaluating rule: later (skipped)', 'Rule engine finished. With total iterations:'])
  })

  it('called before run(): has no effect, run() starts fresh', async () => {
    const fact: Fact = { fired: [] }
    const engine = new RuleEngine(fact, { logger: new LogSink() })
    engine.addRule(later)
    engine.stop()
    await engine.run()
    expect(fact.fired).toEqual(['later'])
  })
})
