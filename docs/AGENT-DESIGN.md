# Governed tool agent (preview)

**Status:** preview, off by default. The agent isn't wired into the app; the copilot's ask box still uses the one-step reader. You can try it from the command line:

```bash
npm run agent:ask -- --user u_analyst "Compare pipeline coverage in East and West this quarter, then break it down by region"
```

The code is in `src/agent/governed-agent.ts` and `scripts/agent-ask.ts`, and the tests are in `tests/governed-agent.test.ts`.

## Why

On Oct 24, Alex asked for an agent that works under **context and system rules**, rather than guardrails alone, and for **every question to be logged so another agent can find trends**. The copilot already does both: the 10 written rules (#73), the question log, and the weekly trends agent (#61, #71). Its AI takes one step, though. It fills in one form, and code does the rest.

This preview is the next step. Claude may **plan a few steps**, such as "compare East and West, then break it down", but every step is a **governed tool**. The AI gets more autonomy in *what to ask*, and still none in *what data anyone sees*.

## What the agent can do

| Tool | What it runs |
|---|---|
| `get_metric` | One figure: a metric, optional regions, and the current or next quarter |
| `break_down` | The same, broken down by region, stage or owner |
| `compare` | The same figure for two sets of regions. Code writes the comparison sentence |
| `ask_user` | Stops and asks one of three **fixed** questions: which metric, which quarter, or which regions |

Each figure is an `answerIntent()` call. That's the same path the dashboard tiles use: `validateIntent` against the registry, **scope resolved from the database on that call**, compiled and parameterised SQL on the read-only login, and an audit row.

## What the agent can't do (and how that's enforced)

| Boundary | How it's enforced | Test |
|---|---|---|
| It never writes SQL, numbers or the answer | It can only call the four tools. Every sentence shown is built by code from rows, or comes from `ASK_TEXT` | "keeps the model's own text out of the reply" |
| **It never sees a figure** | A tool result tells it only `answered: <metric>, <regions> (N rows)` or `refused: …`. Business numbers, names and scopes never go to Anthropic, which keeps the system card's promise | "never sends a figure, a scope or a name to the model" |
| It can't widen access | Each step re-resolves the asker's scope. A region outside it fails with `ScopeViolation`, the step is shown as "Not answered", and the model is told not to retry | "refuses a step outside the asker's scope" |
| It can't probe who exists | Tool inputs take no person, account or product names, only metric ids, regions and a relative quarter | Schema (`Tools`, strict) |
| It can't run anything else | Unknown tools or extra fields aren't run. Inputs are checked by zod, and the API's strict mode is on | "does not run an unknown tool" |
| It can't run on | 4 tool calls and 6 model turns per question, then it stops and says so | "stops after 4 tool calls" |
| Attacks are stopped before any model call | The same `screen()` as a typed question: the lock, the flags, the length cap | "refuses an override before any model call" |
| Everything is logged | One `agent_question` row, plus one `agent_tool` row per step, linked by request id, with a fingerprint and never the text. The trends views read only `source = 'question'`, so nothing is counted twice | "writes one question row and one row per step" |
| Claude down or refusing | It stops with `unavailable` and nothing is shown. The caller can fall back to the one-step reader | "stops cleanly when the model is down or refuses" |

The model call uses `claude-opus-5-5` at low effort, with the default server-side fallback, a cached system prompt, and strict tools. The strict schemas can't carry array bounds (the API refuses `maxItems`), so zod enforces the sizes.

## Live check (Nov 2, 2026)

These ran with Claude on the embedded demo data:

- **Avery (analyst):** "Compare pipeline coverage in East and West this quarter, then break it down by region". Claude made 3 governed queries. East was 0.43x and West 0.75x. The code wrote "West is 0.32x higher than East", then the by-region breakdown followed (Central 0.76x highest, East 0.43x lowest).
- **Jordan (technical seller, East):** "Compare my pipeline coverage this quarter in East and West". East was 0.52x (Jordan's team). West came back as **"Not answered: You don't have access to the West region"**.
- **Jordan, vaguer:** "How does my coverage compare with West?". Claude chose `ask_user`, which shows the fixed question "Which regions should I compare?".

## Not built yet (next steps)

1. **`explain_difference` tool.** Wrap the existing "why is my number different?" explanation (`explainDiscrepancy`) as a governed tool.
2. **The trends agent proposes metrics.** Run the trends agent weekly. When a topic keeps going unanswered (support cases, say), it writes a **proposal** for a new governed metric to a review queue. A metric steward approves it through the normal registry PR. The agent never adds a metric itself.
3. **Wire into the app behind a flag** (`AGENT_MODE=governed`), with the one-step reader as the fallback. Show each step with its own receipt.
4. **Evaluate before turning it on.** Run a golden set of multi-step questions with pass^k, and add red-team cases aimed at the planner, such as a plan that tries to reach another region through a breakdown.
