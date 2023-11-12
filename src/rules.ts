import cloneDeep from 'lodash.clonedeep'
import isEqual from 'lodash.isequal'

export interface Data<T> {
  rule: Rule<T>
  stop: () => void
}

export interface Rule<T> {
  id: string | number
  name?: string
  weight?: number
  condition: (fact: T, data: Data<T>) => Promise<boolean> | boolean
  action: (fact: T, data: Data<T>) => Promise<void> | void
}

export interface RuleEngineOptions {
  ignoreFactChanges?: boolean
  maxIterations?: number
} 

export class RuleEngine<T> {
  private rules: Rule<T>[] = []
  private fact: T = {} as T
  private ignoreFactChanges: boolean
  private iteration: number
  private maxIterations: number | null
  private terminate = false

  constructor(
    fact: T = {} as T,
    options: RuleEngineOptions = {}
  ) {
    this.fact = fact
    this.ignoreFactChanges = options.ignoreFactChanges ?? false
    this.iteration = 0
    this.maxIterations = options.maxIterations ?? null
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
          console.info('Termination condition met. Maximum iterations reached.')
          return
        }

        let message = `Evaluating rule: ${rule.name ?? rule.id}`
        const condition = await rule.condition(this.fact, { rule, stop: () => { this.stop() } })
        if (condition) {
          message += ' (condition met)'
          console.info(message)
          await this.executeRule(rule)

          if (this.terminate) {
            console.info('Termination condition met based on action.')
            return
          }
        } else {
          message += ' (skipped)'
          console.info(message)
        }
      }

      if (!isEqual(before, this.fact) && !this.ignoreFactChanges) {
        await this.run()
      } else {
        console.info('Rule engine finished. With total iterations:', this.iteration)
      }
    } catch (error) {
      console.error('Rule engine encountered an error: \n', error)
      throw error
    }
  }

  private async executeRule(rule: Rule<T>): Promise<void> {
    await rule.action(this.fact, { rule, stop: () => { this.stop() } } )
    this.iteration++
    if (this.ignoreFactChanges) {
      this.removeRule(rule.id)
    }
  }
}