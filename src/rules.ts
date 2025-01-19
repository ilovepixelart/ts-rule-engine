import { cloneDeep, isEqual } from 'lodash'

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

export class RuleEngine<T> {
  private rules: Rule<T>[]
  private readonly fact: T
  private readonly ignoreFactChanges: boolean
  private iteration: number
  private readonly maxIterations: number | null
  private terminate: boolean
  private readonly logger: Logger

  constructor(fact: T = {} as T, options: RuleEngineOptions = {}) {
    this.rules = []
    this.fact = fact
    this.ignoreFactChanges = options.ignoreFactChanges ?? false
    this.iteration = 0
    this.maxIterations = options.maxIterations ?? null
    this.terminate = false
    this.logger = options.logger ?? console
  }

  addRule(rule: Rule<T>): void {
    this.rules.push(rule)
  }

  addRules(rules: Rule<T>[]): void {
    this.rules.push(...rules)
  }

  updateRule(id: string | number, newRule: Rule<T>): void {
    const index = this.rules.findIndex((rule) => rule.id === id)
    if (index !== -1) {
      this.rules[index] = cloneDeep(newRule)
    }
  }

  removeRule(id: string | number): void {
    this.rules = this.rules.filter((rule) => rule.id !== id)
  }

  stop(): void {
    this.terminate = true
  }

  sort(): void {
    this.rules.sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
  }

  async run(): Promise<void> {
    try {
      const before = cloneDeep(this.fact)
      this.sort()
      for await (const rule of this.rules) {
        if (this.maxIterations && this.iteration >= this.maxIterations) {
          this.logger.info('Termination condition met. Maximum iterations reached.')
          return
        }

        let message = `Evaluating rule: ${rule.name ?? rule.id.toString()}`
        const condition = await rule.condition(this.fact, {
          rule,
          stop: () => {
            this.stop()
          },
          logger: this.logger,
        })
        if (condition) {
          message += ' (condition met)'
          this.logger.info(message)
          await this.executeRule(rule)

          if (this.terminate) {
            this.logger.info('Termination condition met based on action.')
            return
          }
        } else {
          message += ' (skipped)'
          this.logger.info(message)
        }
      }

      if (!isEqual(before, this.fact) && !this.ignoreFactChanges) {
        await this.run()
      } else {
        this.logger.info('Rule engine finished. With total iterations:', this.iteration)
      }
    } catch (error) {
      this.logger.error('Rule engine encountered an error: \n', error)
      throw error
    }
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
