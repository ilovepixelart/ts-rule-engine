'use strict'

// Scenarios run against the installed package exactly as a consumer uses it. Each `run` receives the
// module namespace (from require or import) and returns a JSON value; `expected` is written by hand from
// the README and the release notes, never from the output of the code under test.

const recorder = () => {
  const lines = []
  const push =
    (level) =>
    (message, ...rest) => {
      lines.push([level, String(message), ...rest.map((item) => (item instanceof Error ? `${item.name}: ${item.message}` : item))])
    }
  return { lines, logger: { info: push('info'), warn: push('warn'), error: push('error') } }
}

const errorOf = (error) => `${error.name}: ${error.message}`

const capture = async (fn) => {
  try {
    await fn()
    return 'resolved'
  } catch (error) {
    return errorOf(error)
  }
}

// The engine loop never yields to the macrotask queue, so a timeout cannot stop a runaway run.
// This guard turns "loops forever" into a rejection with a recognisable message.
const runawayGuard = (limit) => {
  let evals = 0
  return () => {
    evals++
    if (evals > limit) throw new Error(`runaway: condition evaluated ${evals} times`)
  }
}

const markOnce = {
  id: 'mark',
  condition: (f) => !f.done,
  action: (f) => {
    f.done = true
  },
}

const scenarios = [
  {
    name: 'exports: public runtime names',
    expected: ['RuleEngine'],
    run: async (lib) =>
      Object.keys(lib)
        .filter((key) => key !== 'default' && key !== 'module.exports')
        .sort(),
  },
  {
    name: 'README section 3: license rule sets fields and stops',
    expected: {
      fact: { application: 'ts-rule-engine', cost: 0, license: 'MIT', description: 'License originating at the Massachusetts Institute of Technology (MIT) in the late 1980s' },
      log: [
        ['info', 'Evaluating rule: license-mit (condition met)'],
        ['info', 'Termination condition met based on action.'],
      ],
    },
    run: async ({ RuleEngine }) => {
      const { lines, logger } = recorder()
      const fact = { application: 'ts-rule-engine', cost: 0, license: '', description: '' }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'license-mit',
        condition: (f) => f.cost === 0,
        action: (f, { stop }) => {
          f.license = 'MIT'
          f.description = 'License originating at the Massachusetts Institute of Technology (MIT) in the late 1980s'
          stop()
        },
      })
      await engine.run()
      return { fact, log: lines }
    },
  },
  {
    name: 'README section 4: custom logger receives engine and action messages',
    expected: ['Evaluating rule: license-mit (condition met)', 'All Good', 'Termination condition met based on action.'],
    run: async ({ RuleEngine }) => {
      const messages = []
      const logger = { info: (m) => messages.push(m), warn: (m) => messages.push(m), error: (m) => messages.push(m) }
      const engine = new RuleEngine({ cost: 0 }, { logger })
      engine.addRule({
        id: 'license-mit',
        condition: (f) => f.cost === 0,
        action: (_f, data) => {
          data.logger.info('All Good')
          data.stop()
        },
      })
      await engine.run()
      return messages
    },
  },
  {
    name: 'README section 1: rule data carries rule, stop and logger',
    expected: { conditionKeys: ['logger', 'rule', 'stop'], actionKeys: ['logger', 'rule', 'stop'], sameRule: true, name: 'Rule 1', broke: true },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const seen = {}
      const rule = {
        id: 1,
        name: 'Rule 1',
        weight: 1,
        condition: (f, data) => {
          seen.conditionKeys = Object.keys(data).sort()
          return f.balance < 5
        },
        action: (f, data) => {
          seen.actionKeys = Object.keys(data).sort()
          seen.sameRule = data.rule === rule && data.logger === logger
          f.broke = true
          data.stop()
        },
      }
      const fact = { balance: 3 }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule(rule)
      await engine.run()
      return { ...seen, name: rule.name, broke: fact.broke }
    },
  },
  {
    name: 'priorities: higher weight first, equal weights in insertion order, missing weight is 0',
    expected: ['high', 'mid-a', 'mid-b', 'none', 'negative'],
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { order: [] }
      const engine = new RuleEngine(fact, { logger, ignoreFactChanges: true })
      const rule = (id, weight) => ({ id, ...(weight === undefined ? {} : { weight }), condition: () => true, action: (f) => void f.order.push(id) })
      engine.addRule(rule('none'))
      engine.addRules([rule('mid-a', 5), rule('negative', -1), rule('mid-b', 5)])
      engine.addRule(rule('high', 10))
      await engine.run()
      return fact.order
    },
  },
  {
    name: 'sort(): public method orders rules by weight',
    expected: ['b', 'a'],
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { order: [] }
      const engine = new RuleEngine(fact, { logger, ignoreFactChanges: true })
      engine.addRules([
        { id: 'a', weight: 1, condition: () => true, action: (f) => void f.order.push('a') },
        { id: 'b', weight: 2, condition: () => true, action: (f) => void f.order.push('b') },
      ])
      engine.sort()
      await engine.run()
      return fact.order
    },
  },
  {
    name: 'fact changes: a change made by a later rule re-runs earlier rules',
    expected: { discount: 20, fired: ['mark-vip', 'vip-discount'] },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { total: 1500, vip: false, discount: 0, fired: [] }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'vip-discount',
        weight: 10,
        condition: (f) => f.vip && f.discount === 0,
        action: (f) => {
          f.discount = 20
          f.fired.push('vip-discount')
        },
      })
      engine.addRule({
        id: 'mark-vip',
        weight: 1,
        condition: (f) => f.total > 1000 && !f.vip,
        action: (f) => {
          f.vip = true
          f.fired.push('mark-vip')
        },
      })
      await engine.run()
      return { discount: fact.discount, fired: fact.fired }
    },
  },
  {
    name: 'fact changes: final log line reports total fired rules',
    expected: ['info', 'Rule engine finished. With total iterations:', 2],
    run: async ({ RuleEngine }) => {
      const { lines, logger } = recorder()
      const engine = new RuleEngine({ n: 0 }, { logger })
      engine.addRule({ id: 'inc', condition: (f) => f.n < 2, action: (f) => void f.n++ })
      await engine.run()
      return lines.at(-1)
    },
  },
  {
    name: 'ignoreFactChanges: each rule fires once in sequence, no re-run',
    expected: { n: 1, fired: ['inc', 'after'] },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { n: 0, fired: [] }
      const engine = new RuleEngine(fact, { logger, ignoreFactChanges: true })
      engine.addRule({
        id: 'inc',
        weight: 2,
        condition: (f) => f.n < 5,
        action: (f) => {
          f.n++
          f.fired.push('inc')
        },
      })
      engine.addRule({ id: 'after', weight: 1, condition: () => true, action: (f) => void f.fired.push('after') })
      await engine.run()
      return fact
    },
  },
  {
    name: 'maxIterations: bounds a rule that keeps changing the fact',
    expected: { n: 3, last: ['info', 'Termination condition met. Maximum iterations reached.'] },
    run: async ({ RuleEngine }) => {
      const { lines, logger } = recorder()
      const fact = { n: 0 }
      const engine = new RuleEngine(fact, { logger, maxIterations: 3 })
      engine.addRule({ id: 'forever', condition: () => true, action: (f) => void f.n++ })
      await engine.run()
      return { n: fact.n, last: lines.at(-1) }
    },
  },
  {
    name: 'maxIterations: rejects zero, negative, NaN and Infinity with RangeError',
    expected: [
      'RangeError: RuleEngine: maxIterations must be a positive finite number, got 0',
      'RangeError: RuleEngine: maxIterations must be a positive finite number, got -1',
      'RangeError: RuleEngine: maxIterations must be a positive finite number, got NaN',
      'RangeError: RuleEngine: maxIterations must be a positive finite number, got Infinity',
    ],
    run: async ({ RuleEngine }) => Promise.all([0, -1, Number.NaN, Number.POSITIVE_INFINITY].map((maxIterations) => capture(() => new RuleEngine({}, { maxIterations })))),
  },
  {
    name: 'stop() from an action: later rules do not fire',
    expected: { fired: ['first'], last: ['info', 'Termination condition met based on action.'] },
    run: async ({ RuleEngine }) => {
      const { lines, logger } = recorder()
      const fact = { fired: [] }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'first',
        weight: 2,
        condition: () => true,
        action: (f, { stop }) => {
          f.fired.push('first')
          stop()
        },
      })
      engine.addRule({ id: 'second', weight: 1, condition: () => true, action: (f) => void f.fired.push('second') })
      await engine.run()
      return { fired: fact.fired, last: lines.at(-1) }
    },
  },
  {
    name: 'stop() from a condition returning true: its action runs, later rules do not',
    expected: ['guard'],
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { fired: [] }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'guard',
        weight: 2,
        condition: (_f, { stop }) => {
          stop()
          return true
        },
        action: (f) => void f.fired.push('guard'),
      })
      engine.addRule({ id: 'later', weight: 1, condition: (f) => !f.fired.includes('later'), action: (f) => void f.fired.push('later') })
      await engine.run()
      return fact.fired
    },
  },
  {
    name: 'stop() from a condition returning false: the run ends (1.6.0)',
    expected: {
      fired: [],
      log: [
        ['info', 'Evaluating rule: guard (skipped)'],
        ['info', 'Termination condition met based on condition.'],
      ],
    },
    run: async ({ RuleEngine }) => {
      const { lines, logger } = recorder()
      const fact = { fired: [] }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'guard',
        weight: 10,
        condition: (_f, { stop }) => {
          stop()
          return false
        },
        action: () => {},
      })
      engine.addRule({ id: 'later', weight: 1, condition: (f) => !f.fired.includes('later'), action: (f) => void f.fired.push('later') })
      await engine.run()
      return { fired: fact.fired, log: lines }
    },
  },
  {
    name: 'engine.stop() before run(): run() resets the flag and runs',
    expected: { done: true },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { done: false }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule(markOnce)
      engine.stop()
      await engine.run()
      return fact
    },
  },
  {
    name: 'async rules: awaited conditions and actions, in weight order',
    expected: ['a:cond', 'a:act', 'b:cond', 'b:act'],
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { trace: [] }
      const tick = () => new Promise((resolve) => setTimeout(resolve, 1))
      const rule = (id, weight) => ({
        id,
        weight,
        condition: async (f) => {
          await tick()
          f.trace.push(`${id}:cond`)
          return true
        },
        action: async (f) => {
          await tick()
          f.trace.push(`${id}:act`)
        },
      })
      const engine = new RuleEngine(fact, { logger, ignoreFactChanges: true })
      engine.addRules([rule('b', 1), rule('a', 2)])
      await engine.run()
      return fact.trace
    },
  },
  {
    name: 'run(): not re-entrant while a run is pending',
    expected: { second: 'Error: RuleEngine: run() is not re-entrant. Wait for the previous run() to settle before calling again.', first: 'resolved', third: 'resolved' },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const engine = new RuleEngine({ done: false }, { logger })
      engine.addRule({
        id: 'slow',
        condition: (f) => !f.done,
        action: async (f) => {
          await new Promise((r) => setTimeout(r, 5))
          f.done = true
        },
      })
      const first = capture(() => engine.run())
      const second = await capture(() => engine.run())
      return { second, first: await first, third: await capture(() => engine.run()) }
    },
  },
  {
    name: 'errors: a throwing action rejects run() and is logged',
    expected: { result: 'Error: boom', last: ['error', 'Rule engine encountered an error: \n', 'Error: boom'], rerun: 'Error: boom' },
    run: async ({ RuleEngine }) => {
      const { lines, logger } = recorder()
      const engine = new RuleEngine({}, { logger })
      engine.addRule({
        id: 'bad',
        condition: () => true,
        action: () => {
          throw new Error('boom')
        },
      })
      const result = await capture(() => engine.run())
      return { result, last: lines.at(-1), rerun: await capture(() => engine.run()) }
    },
  },
  {
    name: 'errors: a rejecting async condition rejects run()',
    expected: 'TypeError: bad condition',
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const engine = new RuleEngine({}, { logger })
      engine.addRule({ id: 'bad', condition: async () => Promise.reject(new TypeError('bad condition')), action: () => {} })
      return capture(() => engine.run())
    },
  },
  {
    name: 'updateRule/removeRule: replace by id, unknown id returns false, removed rule never fires',
    expected: { updated: true, missing: false, fired: ['b2'] },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { fired: [] }
      const engine = new RuleEngine(fact, { logger, ignoreFactChanges: true })
      engine.addRules([
        { id: 'a', condition: () => true, action: (f) => void f.fired.push('a') },
        { id: 'b', condition: () => true, action: (f) => void f.fired.push('b') },
      ])
      const updated = engine.updateRule('b', { id: 'b', condition: () => true, action: (f) => void f.fired.push('b2') })
      const missing = engine.updateRule('zzz', { id: 'zzz', condition: () => true, action: () => {} })
      engine.removeRule('a')
      await engine.run()
      return { updated, missing, fired: fact.fired }
    },
  },
  {
    name: 'defaults: no fact argument and no logger use {} and console',
    expected: { fact: { touched: true } },
    run: async ({ RuleEngine }) => {
      const original = console.info
      console.info = () => {}
      try {
        let seen
        const engine = new RuleEngine()
        engine.addRule({
          id: 'x',
          condition: (f) => !f.touched,
          action: (f) => {
            f.touched = true
            seen = f
          },
        })
        await engine.run()
        return { fact: seen }
      } finally {
        console.info = original
      }
    },
  },
  // Fact change detection fixes shipped in 1.5.3.
  {
    name: 'fact changes (1.5.3): invalid Date in the fact does not loop forever',
    expected: 'resolved',
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const guard = runawayGuard(1000)
      const engine = new RuleEngine({ dob: new Date('31/02/1990') }, { logger, maxIterations: 10 })
      engine.addRule({
        id: 'never',
        condition: () => {
          guard()
          return false
        },
        action: () => {},
      })
      return capture(() => engine.run())
    },
  },
  {
    name: 'fact changes (1.5.3): circular reference in the fact',
    expected: { result: 'resolved', done: true },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { done: false, children: [] }
      fact.children.push({ parent: fact })
      const engine = new RuleEngine(fact, { logger })
      engine.addRule(markOnce)
      return { result: await capture(() => engine.run()), done: fact.done }
    },
  },
  {
    name: 'fact changes (1.5.3): function-valued property in the fact',
    expected: { result: 'resolved', done: true },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { done: false, format: (n) => `$${n}` }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule(markOnce)
      return { result: await capture(() => engine.run()), done: fact.done }
    },
  },
  {
    name: 'fact changes (1.5.3): fact wrapped in a Proxy',
    expected: { result: 'resolved', done: true },
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = new Proxy({ done: false }, {})
      const engine = new RuleEngine(fact, { logger })
      engine.addRule(markOnce)
      return { result: await capture(() => engine.run()), done: fact.done }
    },
  },
  {
    name: 'fact changes (1.5.3): a value added to a Set triggers another pass',
    expected: 20,
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { total: 1500, tags: new Set(), discount: 0 }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'vip-discount',
        weight: 10,
        condition: (f) => f.tags.has('vip') && f.discount === 0,
        action: (f) => {
          f.discount = 20
        },
      })
      engine.addRule({ id: 'mark-vip', weight: 1, condition: (f) => f.total > 1000 && !f.tags.has('vip'), action: (f) => void f.tags.add('vip') })
      await engine.run()
      return fact.discount
    },
  },
  {
    name: 'fact changes (1.5.3): an entry set on a Map triggers another pass',
    expected: 20,
    run: async ({ RuleEngine }) => {
      const { logger } = recorder()
      const fact = { total: 1500, attrs: new Map(), discount: 0 }
      const engine = new RuleEngine(fact, { logger })
      engine.addRule({
        id: 'gold-discount',
        weight: 10,
        condition: (f) => f.attrs.get('tier') === 'gold' && f.discount === 0,
        action: (f) => {
          f.discount = 20
        },
      })
      engine.addRule({ id: 'mark-gold', weight: 1, condition: (f) => f.total > 1000 && !f.attrs.has('tier'), action: (f) => void f.attrs.set('tier', 'gold') })
      await engine.run()
      return fact.discount
    },
  },
]

module.exports = { scenarios }
