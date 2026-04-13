---
name: Bug report
about: Report a bug in ts-rule-engine
title: ''
labels: bug
assignees: ''

---

**Describe the bug**
A clear and concise description of what the bug is.

**Versions**
Describe your setup

- `ts-rule-engine`:
- Node.js:
- OS:

**Minimal reproduction**
Fact shape, rule definitions, and how you invoke the engine.

```typescript
// fact interface + fact value
```

```typescript
// rule(s) that trigger the bug
```

```typescript
// engine construction + run() invocation
```

**Expected behavior**
What you expected to happen — which rule should have fired, which fact
fields should have been mutated, iteration count, stop() semantics, etc.

**Actual behavior**
What happened instead. Include error messages, stack traces, and the
output of the rule engine's `logger.info` lines if relevant.

**Additional context**
Anything else that might help — iteration limits, `ignoreFactChanges`
usage, async condition/action timing, custom logger output, etc.
