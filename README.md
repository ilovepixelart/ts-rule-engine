# ts-rule-engine

Light weight forward chaining rule engine, written in typescript

[![npm](https://img.shields.io/npm/v/ts-rule-engine)](https://www.npmjs.com/package/ts-rule-engine)
[![npm](https://img.shields.io/npm/dt/ts-rule-engine)](https://www.npmjs.com/package/ts-rule-engine)
[![GitHub](https://img.shields.io/github/license/ilovepixelart/ts-rule-engine)](https://github.com/ilovepixelart/ts-rule-engine/blob/main/LICENSE)
\
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-migrate-mongoose&metric=coverage)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-migrate-mongoose)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-migrate-mongoose&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-migrate-mongoose)
\
[![Reliability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-migrate-mongoose&metric=reliability_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-migrate-mongoose)
[![Maintainability Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-migrate-mongoose&metric=sqale_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-migrate-mongoose)
[![Security Rating](https://sonarcloud.io/api/project_badges/measure?project=ilovepixelart_ts-migrate-mongoose&metric=security_rating)](https://sonarcloud.io/summary/new_code?id=ilovepixelart_ts-migrate-mongoose)

[![npm](https://nodei.co/npm/ts-rule-engine.png)](https://www.npmjs.com/package/ts-rule-engine)

## Installation

```bash
npm install ts-rule-engine
yarn add ts-rule-engine
```

### 1. Defining a Rule

A rule will consist of a condition and action

```typescript
import type { Rule } from 'ts-rule-engine';

/* Define fact interface */
interface Fact {
  balance: number;
  broke?: boolean;
}

/* Define rule */
const rule: Rule<Fact> = {
  id: 1
  name: "Rule 1",
  weight: 1,
  condition: (fact) => {
    return fact.balance < 5;
  },
  action: (fact, { stop }) => {
    fact.broke = true;
    /* stop() will stop the rule engine from executing further rules */
    stop();
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
  name: string;
  application: string;
  cost: number;
  license?: string;
  description?: string;
}

/* Define fact */
const fact: Fact = {
  name: "Alex",
  application: "ts-rule-engine",
  cost: 0,
}
```

### 3. Using the Rule Engine

The example below shows how to use the rule engine to apply a sample rule on a specific fact. Rules can be fed into the rule engine as Array of rules or as an individual rule object.

```typescript
const { RuleEngine } = require("ts-rule-engine");

/* Define fact */
const fact: Fact = {
  name: "Alex",
  application: "ts-rule-engine",
  cost: 0,
  license: '?'
  description: '?'
}

/* Define rule */
const rule: Rule<Fact> = {
  condition: (fact) => {
    return fact.cost === 0);
  },
  consequence: (fact) => {
    fact.license = 'MIT';
    fact.description = "Cost of use is free of charge";
    fact.stop();
  },
};

/* Creating Rule Engine instance */
const engine = new RuleEngine(fact);
engine.addRule(rule);
/* For multiple rules, use engine.addRules(rules) */
await engine.run();

console.log(fact);
/*
{
  name: "Alex",
  application: "ts-rule-engine",
  cost: 0,
  license: 'MIT',
  reason: "Cost of use is free of charge"
}
*/
```
