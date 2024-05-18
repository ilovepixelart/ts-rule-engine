import { RuleEngine } from '../src/rules'
import type { Rule } from '../src/rules'
import type { Logger } from '../src/rules'

interface Fact {
  counter: number
}

class LogSink implements Logger {
  messages: string[] = []

  info(message?: string): void {
    this.messages.push(message)
  }

  warn(message?: string): void {
    this.messages.push(message)
  }

  error(message?: string): void {
    this.messages.push(message)
  }
}

const rule: Rule<Fact> = {
  id: 'always increment',
  weight: 1,
  condition: (fact: Fact, { logger }) => {
    logger.info('Always true')
    return true
  },
  action: (fact: Fact, { stop, logger }) => {
    fact.counter++
    logger.info('Incremented counter')
    stop()
  },
}

describe('Logger', function () {
  it('logs to console if a logger is not provided in the options', async () => {
    const consoleSpy = jest.spyOn(global.console, 'info')
    const fact: Fact = {
      counter: 0,
    }

    const engine = new RuleEngine(fact)
    engine.addRule(rule)
    await engine.run()

    expect(fact.counter).toBe(1)
    expect(consoleSpy).toHaveBeenCalledTimes(4)
  })

  it('logs to logger if a logger is provided in the options', async () => {
    const consoleSpy = jest.spyOn(global.console, 'info')
    const fact: Fact = {
      counter: 0,
    }

    const logger = new LogSink()

    const engine = new RuleEngine(fact, { logger })
    engine.addRule(rule)
    await engine.run()

    expect(fact.counter).toBe(1)
    expect(logger.messages).toHaveLength(4)
    expect(logger.messages[0]).toBe('Always true')
    expect(logger.messages[1]).toBe('Evaluating rule: always increment (condition met)')
    expect(logger.messages[2]).toBe('Incremented counter')
    expect(logger.messages[3]).toBe('Termination condition met based on action.')
    expect(consoleSpy).toHaveBeenCalledTimes(0)
  })
})
