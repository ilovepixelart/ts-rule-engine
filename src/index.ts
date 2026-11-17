export interface Data<T> {
  rule: Rule<T>
  stop: () => void
  logger: Logger
}

export interface Rule<T> {
  id: string | number
  name?: string
  weight?: number
  condition: (fact: T, data: Data<T>) => Promise<boolean> | boolean
  action: (fact: T, data: Data<T>) => Promise<void> | void
}

export interface Logger {
  info: (message?: unknown, ...optionalParams: unknown[]) => void
  warn: (message?: unknown, ...optionalParams: unknown[]) => void
  error: (message?: unknown, ...optionalParams: unknown[]) => void
}

export interface RuleEngineOptions {
  ignoreFactChanges?: boolean
  maxIterations?: number
  logger?: Logger
}

type Pairs = Map<object, Set<object>>

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null

// The snapshot is only compared, never handed to rules. Functions and other non-objects are kept by
// reference, Proxies are read through their traps, and `seen` keeps cycles and shared references.
// Objects become null-prototype records so an own "__proto__" key stays an own key.
const cloneEntries = (value: object, seen: Map<object, unknown>): unknown => {
  if (value instanceof Map) {
    const copy = new Map<unknown, unknown>()
    seen.set(value, copy)
    for (const [key, item] of value) copy.set(key, cloneValue(item, seen))
    return copy
  }
  if (value instanceof Set) {
    const copy = new Set<unknown>()
    seen.set(value, copy)
    for (const item of value) copy.add(cloneValue(item, seen))
    return copy
  }
  const copy: Record<string, unknown> = Array.isArray(value) ? new Array(value.length) : Object.create(null)
  seen.set(value, copy)
  for (const key of Object.keys(value)) copy[key] = cloneValue((value as Record<string, unknown>)[key], seen)
  return copy
}

const cloneValue = (value: unknown, seen: Map<object, unknown>): unknown => {
  if (!isObject(value)) return value
  if (seen.has(value)) return seen.get(value)
  if (value instanceof Date) return new Date(value)
  if (value instanceof RegExp) return new RegExp(value)
  return cloneEntries(value, seen)
}

const cloneFact = (value: unknown): unknown => cloneValue(value, new Map())

const equalArrays = (a: unknown[], b: unknown[], pairs: Pairs): boolean => {
  if (a.length !== b.length) return false
  return a.every((item, i) => deepEqual(item, b[i], pairs))
}

const equalObjects = (a: object, b: object, pairs: Pairs): boolean => {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  const aRec = a as Record<string, unknown>
  const bRec = b as Record<string, unknown>
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(aRec[key], bRec[key], pairs))
}

const equalMaps = (a: Map<unknown, unknown>, b: Map<unknown, unknown>, pairs: Pairs): boolean => {
  if (a.size !== b.size) return false
  for (const [key, item] of a) {
    if (!b.has(key) || !deepEqual(item, b.get(key), pairs)) return false
  }
  return true
}

// Members are matched one to one: primitives by Set membership, objects by deep equality.
const equalSets = (a: Set<unknown>, b: Set<unknown>, pairs: Pairs): boolean => {
  if (a.size !== b.size) return false
  const candidates = [...b].filter(isObject)
  for (const item of a) {
    if (!isObject(item)) {
      if (!b.has(item)) return false
      continue
    }
    const index = candidates.findIndex((candidate) => deepEqual(item, candidate, pairs))
    if (index === -1) return false
    candidates.splice(index, 1)
  }
  return true
}

const equalEntries = (a: object, b: object, pairs: Pairs): boolean => {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && equalArrays(a, b, pairs)
  if (a instanceof Map || b instanceof Map) return a instanceof Map && b instanceof Map && equalMaps(a, b, pairs)
  if (a instanceof Set || b instanceof Set) return a instanceof Set && b instanceof Set && equalSets(a, b, pairs)
  return equalObjects(a, b, pairs)
}

// A pair already being compared further up the stack is a cycle; it counts as equal so the
// comparison is decided by the rest of the structure.
const equalOnce = (a: object, b: object, pairs: Pairs): boolean => {
  const partners = pairs.get(a) ?? new Set<object>()
  if (partners.has(b)) return true
  pairs.set(a, partners.add(b))
  try {
    return equalEntries(a, b, pairs)
  } finally {
    partners.delete(b)
  }
}

const deepEqual = (a: unknown, b: unknown, pairs: Pairs = new Map()): boolean => {
  if (Object.is(a, b)) return true
  if (!isObject(a) || !isObject(b)) return false
  if (a instanceof Date && b instanceof Date) return Object.is(a.getTime(), b.getTime())
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags
  return equalOnce(a, b, pairs)
}

export class RuleEngine<T> {
  private rules: Rule<T>[] = []
  private rulesDirty = false
  private readonly fact: T
  private readonly ignoreFactChanges: boolean
  private iteration = 0
  private idlePasses = 0
  private readonly maxIterations: number | null
  private terminate = false
  private running = false
  private readonly logger: Logger

  constructor(fact: T = {} as T, options: RuleEngineOptions = {}) {
    if (options.maxIterations !== undefined && (!Number.isFinite(options.maxIterations) || options.maxIterations <= 0)) {
      throw new RangeError(`RuleEngine: maxIterations must be a positive finite number, got ${String(options.maxIterations)}`)
    }
    this.fact = fact
    this.ignoreFactChanges = options.ignoreFactChanges ?? false
    this.maxIterations = options.maxIterations ?? null
    this.logger = options.logger ?? console
  }

  addRule(rule: Rule<T>): void {
    this.rules.push(rule)
    this.rulesDirty = true
  }

  addRules(rules: Rule<T>[]): void {
    this.rules.push(...rules)
    this.rulesDirty = true
  }

  updateRule(id: string | number, newRule: Rule<T>): boolean {
    const index = this.rules.findIndex((rule) => rule.id === id)
    if (index === -1) return false
    this.rules[index] = { ...newRule }
    this.rulesDirty = true
    return true
  }

  removeRule(id: string | number): void {
    this.rules = this.rules.filter((rule) => rule.id !== id)
  }

  stop(): void {
    this.terminate = true
  }

  sort(): void {
    this.rules.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
    this.rulesDirty = false
  }

  async run(): Promise<void> {
    if (this.running) {
      throw new Error('RuleEngine: run() is not re-entrant. Wait for the previous run() to settle before calling again.')
    }
    this.running = true
    this.iteration = 0
    this.idlePasses = 0
    this.terminate = false
    try {
      while (true) {
        if (this.rulesDirty) this.sort()
        const before = this.ignoreFactChanges ? undefined : cloneFact(this.fact)
        const fired = this.iteration
        if (await this.runPass()) return
        if (this.ignoreFactChanges || deepEqual(before, this.fact)) {
          this.logger.info('Rule engine finished. With total iterations:', this.iteration)
          return
        }
        if (this.idleLimitReached(this.iteration === fired)) return
      }
    } catch (error) {
      this.logger.error('Rule engine encountered an error: \n', error)
      throw error
    } finally {
      this.running = false
    }
  }

  // A pass that fires no rule but still leaves the fact different (a getter, a condition with side
  // effects, code outside the engine) never advances the fired-rule count, so maxIterations bounds
  // those passes too; otherwise such a fact would keep run() looping.
  private idleLimitReached(idle: boolean): boolean {
    if (idle) this.idlePasses++
    if (this.maxIterations === null || this.idlePasses < this.maxIterations) return false
    this.logger.info('Termination condition met. Maximum iterations reached.')
    return true
  }

  private async runPass(): Promise<boolean> {
    for (const rule of this.rules) {
      if (this.maxIterations !== null && this.iteration >= this.maxIterations) {
        this.logger.info('Termination condition met. Maximum iterations reached.')
        return true
      }
      if (await this.evaluateRule(rule)) return true
    }
    return false
  }

  private async evaluateRule(rule: Rule<T>): Promise<boolean> {
    const label = `Evaluating rule: ${rule.name ?? rule.id.toString()}`
    const condition = await rule.condition(this.fact, {
      rule,
      stop: () => {
        this.stop()
      },
      logger: this.logger,
    })
    if (!condition) {
      this.logger.info(`${label} (skipped)`)
      if (this.terminate) {
        this.logger.info('Termination condition met based on condition.')
        return true
      }
      return false
    }
    this.logger.info(`${label} (condition met)`)
    await this.executeRule(rule)
    if (this.terminate) {
      this.logger.info('Termination condition met based on action.')
      return true
    }
    return false
  }

  private async executeRule(rule: Rule<T>): Promise<void> {
    await rule.action(this.fact, {
      rule,
      stop: () => {
        this.stop()
      },
      logger: this.logger,
    })
    this.iteration++
    if (this.ignoreFactChanges) {
      this.removeRule(rule.id)
    }
  }
}
