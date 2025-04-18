# ts-rule-engine

Lightweight rule engine, written in typescript

[![npm](https://img.shields.io/npm/v/ts-rule-engine)](https://www.npmjs.com/package/ts-rule-engine)
[![npm](https://img.shields.io/npm/dt/ts-rule-engine)](https://www.npmjs.com/package/ts-rule-engine)
[![GitHub](https://img.shields.io/github/license/ilovepixelart/ts-rule-engine)](https://github.com/ilovepixelart/ts-rule-engine/blob/main/LICENSE)
\
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-rule-engine&metric=coverage)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-rule-engine)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-rule-engine&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-rule-engine)
\
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-rule-engine&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-rule-engine)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-rule-engine&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-rule-engine)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-rule-engine&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-rule-engine)

## Supports and tested with

```json
{
  "node": "18.x || 20.x || 22.x",
}
```

## Features

- Structure for rule definition
- Rerun rules after fact is updated
- Stop rule engine on any rule from executing further
- Infinite loop prevention with max iterations limit
- One time rule execution in sequence
- Rule weight for priority
- Logger interface for custom logging
- Supports ESM and CommonJS

## Installation

```bash
npm install ts-rule-engine
pnpm add ts-rule-engine
yarn add ts-rule-engine
bun add ts-rule-engine
```

### 1. Defining a Rule

A rule will consist of a condition and action, id, name and weight. The condition is a function that returns a boolean value. The action is a function that will be executed if the condition is true. The action function will be passed the fact, { rule, stop }. The stop function will stop the rule engine from executing further rules. This way you can control the flow of the rule engine.

```typescript
import type { Rule } from 'ts-rule-engine'

/* Define fact interface */
interface Fact {
  balance: number
  broke?: boolean
}

/* Define rule */
const rule: Rule<Fact> = {
  id: 1,
  name: 'Rule 1',
  weight: 1,
  condition: (fact) => {
    return fact.balance < 5
  },
  action: (fact, { stop }) => {
    fact.broke = true
    /* stop() will stop the rule engine from executing further rules */
    stop()
  }
}
```

Higher the weight of the rule, higher the priority of the rule. If the weight is not provided, it will be set to 0 by default and will be executed after all the rules with weight > 0 are executed. If all weights are same, rules will be executed in the order they are added to the rule engine.

### 2. Defining a Fact

Facts are those input json values on which the rule engine applies its rule to obtain results. A fact can have multiple attributes as you decide.

A sample Fact may look like

```typescript
/* Define fact interface */
interface Fact {
  application: string
  cost: number
  license?: string
  description?: string
}

/* Define fact */
const fact: Fact = {
  application: 'ts-rule-engine',
  cost: 0
}
```

### 3. Using the Rule Engine

The example below shows how to use the rule engine to apply a sample rule on a specific fact. Rules can be fed into the rule engine as Array of rules or as an individual rule object.

```typescript
import { RuleEngine } from 'ts-rule-engine'

/* Define fact */
const fact: Fact = {
  application: 'ts-rule-engine',
  cost: 0,
  license: '',
  description: ''
}

/* Define rule */
const rule: Rule<Fact> = {
  condition: (fact) => {
    return fact.cost === 0
  },
  consequence: (fact) => {
    fact.license = 'MIT'
    fact.description = 'License originating at the Massachusetts Institute of Technology (MIT) in the late 1980s'
    fact.stop()
  },
};

/* Creating Rule Engine instance */
const engine = new RuleEngine(fact)
engine.addRule(rule)
/* For multiple rules, use engine.addRules(rules) */
await engine.run()

console.log(fact)
/*
{
  application: 'ts-rule-engine',
  cost: 0,
  license: 'MIT',
  reason: 'License originating at the Massachusetts Institute of Technology (MIT) in the late 1980s'
}
*/
```

### 4. Using the Rule Engine with Logger

The example below shows how to use the rule engine with a custom logger. The logger should implement the Logger interface. If a logger is not provided, logs are written using the global `console` object.

```typescript
import { RuleEngine, Logger } from 'ts-rule-engine'

/* Define fact */
const fact: Fact = {
  application: 'ts-rule-engine',
  cost: 0,
  license: '',
  description: ''
}

/* Define rule */
const rule: Rule<Fact> = {
  condition: (fact) => {
    return fact.cost === 0
  },
  action: (fact, { logger }) => {
    logger.info('All Good')
    fact.license = 'MIT'
    fact.description = 'License originating at the Massachusetts Institute of Technology (MIT) in the late 1980s'
    fact.stop()
  },
};

/* Custom Logger */
class CustomLogger implements Logger {
  messages: string[] = []

  info(message?: string, ...optionalParams: string[]): void {
    this.messages.push(message)
  }

  warn(message?: string, ...optionalParams: string[]): void {
    this.messages.push(message)
  }

  error(message?: string, ...optionalParams: string[]): void {
    this.messages.push(message)
  }
}

/* Creating Rule Engine instance */
const logger = new CustomLogger()
const engine = new RuleEngine(fact, {logger})
engine.addRule(rule)
/* For multiple rules, use engine.addRules(rules) */
await engine.run()

// Check logger messages
console.log(logger.messages)
/*
[
  'Rule 1: Executing',
  'Rule 1: Executed',
  'Rule 1: Stopped'
]
*/

```
