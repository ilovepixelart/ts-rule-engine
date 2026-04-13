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

const cloneFact = <T>(value: T): T => structuredClone(value)

const equalArrays = (a: unknown[], b: unknown[]): boolean => {
  if (a.length !== b.length) return false
  return a.every((item, i) => deepEqual(item, b[i]))
}

const equalObjects = (a: object, b: object): boolean => {
  const aKeys = Object.keys(a)
  if (aKeys.length !== Object.keys(b).length) return false
  const aRec = a as Record<string, unknown>
  const bRec = b as Record<string, unknown>
  return aKeys.every((key) => Object.hasOwn(b, key) && deepEqual(aRec[key], bRec[key]))
}

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (Object.is(a, b)) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime()
  if (a instanceof RegExp && b instanceof RegExp) return a.source === b.source && a.flags === b.flags
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && equalArrays(a, b)
  return equalObjects(a, b)
}

export class RuleEngine<T> {
  private rules: Rule<T>[] = []
  private rulesDirty = false
  private readonly fact: T
  private readonly ignoreFactChanges: boolean
  private iteration = 0
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
    this.terminate = false
    try {
      while (true) {
        if (this.rulesDirty) this.sort()
        const before = this.ignoreFactChanges ? undefined : cloneFact(this.fact)
        if (await this.runPass()) return
        if (this.ignoreFactChanges || deepEqual(before, this.fact)) {
          this.logger.info('Rule engine finished. With total iterations:', this.iteration)
          return
        }
      }
    } catch (error) {
      this.logger.error('Rule engine encountered an error: \n', error)
      throw error
    } finally {
      this.running = false
    }
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
