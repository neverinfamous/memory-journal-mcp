# Workflow Audit Categories

The workflow evaluator and adversarial tester score the workflow against 5 major categories.

## 1. Safety Gates (HITL)

- **Evaluator**: Are destructive actions (git push, merge, deploy, npm publish, database migrations) explicitly marked with HITL gates (e.g. `STOP HERE. Ask the user for confirmation`)?
- **Adversarial**: Could an over-eager agent chain tool calls together to bypass a confirmation? Are the stop instructions assertive enough?

## 2. Pre-Flight & Prerequisites

- **Evaluator**: Does the workflow begin with an explicit step to check prerequisites (e.g., "Run `/security-audit` first" or "Verify tests pass")?
- **Adversarial**: What if the prerequisite fails? Is there an instruction on what the agent should do, or does it blindly proceed to step 2?

## 3. Execution Determinism & Loop Prevention

- **Evaluator**: Are instructions explicit and imperative? Is there any ambiguous "try to fix this" wording that lacks boundaries?
- **Adversarial**: If a tool call (like `npm run build`) fails, does the workflow cap retry attempts or define an escalation path? Vague instructions like "fix errors until it passes" cause expensive infinite loops.

## 4. State Management

- **Evaluator**: If the workflow spans multiple steps, does it instruct the agent to journal or track state?
- **Adversarial**: If the user leaves and returns the next day, will the agent know where it left off?

## 5. Formatting & Token Efficiency

- **Evaluator**: Is the workflow concise? Does it avoid monolithic, repetitive examples? Are code blocks minimized?
- **Adversarial**: Are there markdown formatting bugs that could break an agent's markdown parser or regex?
