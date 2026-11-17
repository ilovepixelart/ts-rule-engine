import { describe, expect, it } from 'vitest'

import { RuleEngine } from '../src/index'

import type { Logger, Rule } from '../src/index'

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
}

// A condition that never matches and throws once it has been evaluated more than `limit` times.
// The engine's loop never yields to the macrotask queue, so a vitest timeout cannot stop a
// runaway run; this guard turns "loops forever" into an assertable rejection.
const neverMatchesWithGuard = (limit: number) => {
  const counter = { evals: 0 }
  const condition = () => {
    counter.evals++
    if (counter.evals > limit) throw new Error(`runaway: condition evaluated ${counter.evals} times`)
    return false
  }
  return { counter, condition }
}

describe('invalid Date in the fact', () => {
  it('unparseable date, no rule fires: run() settles after one pass', async () => {
    const { counter, condition } = neverMatchesWithGuard(1000)
    const engine = new RuleEngine({ dob: new Date('31/02/1990') }, { maxIterations: 10, logger: silentLogger })
    engine.addRule({ id: 'never', condition, action: () => {} })
    await expect(engine.run()).resolves.toBeUndefined()
    expect(counter.evals).toBe(1)
  })

  it('control: valid date, same setup: run() settles after one pass', async () => {
    const { counter, condition } = neverMatchesWithGuard(1000)
    const engine = new RuleEngine({ dob: new Date('1990-02-28') }, { maxIterations: 10, logger: silentLogger })
    engine.addRule({ id: 'never', condition, action: () => {} })
    await expect(engine.run()).resolves.toBeUndefined()
    expect(counter.evals).toBe(1)
  })
})

describe('fact that changes without any rule firing', () => {
  it('getter returning a new value on every read, maxIterations 10: run() stops after 10 passes', async () => {
    const { counter, condition } = neverMatchesWithGuard(1000)
    let reads = 0
    const fact = {
      get tick() {
        return ++reads
      },
    }
    const logs: unknown[] = []
    const engine = new RuleEngine(fact, { maxIterations: 10, logger: { ...silentLogger, info: (message) => void logs.push(message) } })
    engine.addRule({ id: 'never', condition, action: () => {} })
    await expect(engine.run()).resolves.toBeUndefined()
    expect(counter.evals).toBe(10)
    expect(logs.at(-1)).toBe('Termination condition met. Maximum iterations reached.')
  })

  it('control: getter returning a stable value: run() settles after one pass', async () => {
    const { counter, condition } = neverMatchesWithGuard(1000)
    const fact = {
      get tick() {
        return 1
      },
    }
    const engine = new RuleEngine(fact, { maxIterations: 10, logger: silentLogger })
    engine.addRule({ id: 'never', condition, action: () => {} })
    await expect(engine.run()).resolves.toBeUndefined()
    expect(counter.evals).toBe(1)
  })

  it('passes that fire a rule do not count toward the bound on passes that fire none', async () => {
    const logs: unknown[] = []
    const fact = { n: 0, m: 0 }
    const engine = new RuleEngine(fact, { maxIterations: 3, logger: { ...silentLogger, info: (message) => void logs.push(message) } })
    engine.addRule({
      id: 'fires twice',
      weight: 1,
      condition: (f) => f.n < 2,
      action: (f) => {
        f.n++
      },
    })
    engine.addRule({
      id: 'side effect',
      condition: (f) => {
        if (f.m < 4) f.m++
        return false
      },
      action: () => {},
    })
    await engine.run()
    expect(fact).toEqual({ n: 2, m: 4 })
    expect(logs.at(-1)).toBe('Rule engine finished. With total iterations:')
  })
})

describe('circular references in the fact', () => {
  interface Node {
    name: string
    done: boolean
    parent?: Node
    children: Node[]
  }
  const once: Rule<Node> = {
    id: 'mark',
    condition: (f) => !f.done,
    action: (f) => {
      f.done = true
    },
  }

  it('parent/child back-reference: run() resolves and the change is applied', async () => {
    const fact: Node = { name: 'root', done: false, children: [] }
    fact.children.push({ name: 'child', done: false, parent: fact, children: [] })
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule(once)
    await expect(engine.run()).resolves.toBeUndefined()
    expect(fact.done).toBe(true)
  })

  it('change reachable only through the cycle triggers another pass', async () => {
    const fact: Node = { name: 'root', done: false, children: [] }
    fact.children.push({ name: 'child', done: false, parent: fact, children: [] })
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'child',
      condition: (f) => {
        evals++
        return !f.children[0]?.done
      },
      action: (f) => {
        const child = f.children[0] as Node
        child.done = true
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('control: same tree without the back-reference: run() resolves', async () => {
    const fact: Node = { name: 'root', done: false, children: [] }
    fact.children.push({ name: 'child', done: false, children: [] })
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule(once)
    await expect(engine.run()).resolves.toBeUndefined()
    expect(fact.done).toBe(true)
  })
})

describe('facts structuredClone cannot copy', () => {
  interface Fact {
    amount: number
    done: boolean
    format?: (n: number) => string
  }
  const once: Rule<Fact> = {
    id: 'mark',
    condition: (f) => !f.done,
    action: (f) => {
      f.done = true
    },
  }

  it('function-valued property: run() resolves', async () => {
    const fact: Fact = { amount: 5, done: false, format: (n) => `$${n}` }
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule(once)
    await expect(engine.run()).resolves.toBeUndefined()
    expect(fact.done).toBe(true)
  })

  it('function-valued property replaced by another function triggers another pass', async () => {
    const fact: Fact = { amount: 5, done: false, format: (n) => `$${n}` }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'swap',
      condition: (f) => {
        evals++
        return !f.done
      },
      action: (f) => {
        f.format = (n) => `EUR ${n}`
        f.done = true
      },
    })
    await engine.run()
    expect(evals).toBe(2)
    expect(fact.format?.(1)).toBe('EUR 1')
  })

  it('fact wrapped in a Proxy: run() resolves', async () => {
    const fact = new Proxy<Fact>({ amount: 5, done: false }, {})
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule(once)
    await expect(engine.run()).resolves.toBeUndefined()
    expect(fact.done).toBe(true)
  })

  it('control: plain fact, same rule: run() resolves', async () => {
    const fact: Fact = { amount: 5, done: false }
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule(once)
    await expect(engine.run()).resolves.toBeUndefined()
    expect(fact.done).toBe(true)
  })
})

describe('mutations inside a Set or Map', () => {
  // The higher-weight rule runs first and depends on what the lower-weight rule adds later in the
  // same pass, so the result is correct only if the engine sees the change and runs another pass.
  it('tag added to a Set: the dependent higher-weight rule fires on the next pass', async () => {
    const fact = { total: 1500, tags: new Set<string>(), discount: 0 }
    const engine = new RuleEngine(fact, { logger: silentLogger })
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
    expect(fact.discount).toBe(20)
  })

  it('entry set on a Map: the dependent higher-weight rule fires on the next pass', async () => {
    const fact = { total: 1500, attrs: new Map<string, string>(), discount: 0 }
    const engine = new RuleEngine(fact, { logger: silentLogger })
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
    expect(fact.discount).toBe(20)
  })

  it('object inside a Set mutated in place triggers another pass', async () => {
    const item = { qty: 1 }
    const fact = { items: new Set([item, { qty: 2 }]) }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'bump',
      condition: () => {
        evals++
        return item.qty === 1
      },
      action: () => {
        item.qty = 5
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('object value inside a Map mutated in place triggers another pass', async () => {
    const fact = { byId: new Map([['a', { qty: 1 }]]) }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'bump',
      condition: (f) => {
        evals++
        return f.byId.get('a')?.qty === 1
      },
      action: (f) => {
        const entry = f.byId.get('a') as { qty: number }
        entry.qty = 5
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('Set member replaced by another primitive, same size: triggers another pass', async () => {
    const fact = { tags: new Set(['new']) }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'rename',
      condition: (f) => {
        evals++
        return f.tags.has('new')
      },
      action: (f) => {
        f.tags.delete('new')
        f.tags.add('seen')
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('Map key renamed, value undefined, same size: triggers another pass', async () => {
    const fact = { flags: new Map<string, undefined>([['old', undefined]]) }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'rename',
      condition: (f) => {
        evals++
        return f.flags.has('old')
      },
      action: (f) => {
        f.flags.delete('old')
        f.flags.set('new', undefined)
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('one of two equal objects in a Set changed: triggers another pass', async () => {
    const second = { n: 1 }
    const fact = { items: new Set([{ n: 1 }, second]) }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'bump',
      condition: () => {
        evals++
        return second.n === 1
      },
      action: () => {
        second.n = 2
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('a pair found unequal while matching Set members is compared again elsewhere', async () => {
    // Swapping the contents leaves the Set equal as a collection, but matching the snapshot of `x`
    // first tries `x` itself and finds it unequal. `pick` holds `x`, so the swap is still a change.
    const x = { n: 1 }
    const y = { n: 2 }
    const fact = { items: new Set([x, y]), pick: x }
    let evals = 0
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'swap',
      condition: () => {
        evals++
        return x.n === 1
      },
      action: () => {
        x.n = 2
        y.n = 1
      },
    })
    await engine.run()
    expect(evals).toBe(2)
  })

  it('control: same rules with tags in an array: the dependent rule fires on the next pass', async () => {
    const fact = { total: 1500, tags: [] as string[], discount: 0 }
    const engine = new RuleEngine(fact, { logger: silentLogger })
    engine.addRule({
      id: 'vip-discount',
      weight: 10,
      condition: (f) => f.tags.includes('vip') && f.discount === 0,
      action: (f) => {
        f.discount = 20
      },
    })
    engine.addRule({ id: 'mark-vip', weight: 1, condition: (f) => f.total > 1000 && !f.tags.includes('vip'), action: (f) => void f.tags.push('vip') })
    await engine.run()
    expect(fact.discount).toBe(20)
  })
})
