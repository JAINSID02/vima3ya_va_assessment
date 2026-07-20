# Vima3ya Steward — Voice Agent Orchestration Layer

A restaurant steward voice agent orchestration layer, built for the Vima3ya AI
Engineer Intern assessment. This implements the reasoning and state-management
engine that sits between "user said something" and "agent responds and acts
correctly" — STT and TTS are mocked per the assessment's scope note.

## How to run

```bash
npm install

# Run the default demo conversation (ordering, recommendation, quantity
# correction, dietary question, order summary, confirmation)
npm run demo

# Run the second demo conversation (unavailable item + mid-conversation swap)
npm run demo:modification

# Run the unit tests
npm test

# Type-check only
npm run build
```

No API keys or network access are required — the reasoning layer is
rule-based (see "LLM vs rule-based" below), so the demo and tests run fully
offline.

Requires Node.js 18+.

## Core requirements checklist

Mapped directly against the assessment's "Core Requirements" list:

- **Language: TypeScript** — entire codebase, `strict` mode on, zero `any`.
- **Session/Memory Handling** — `OrderState` (items, quantities, running total) and `ConversationContext` (turn history + last-mentioned item) both persist across turns within an `Orchestrator` instance. See `tests/orderState.test.ts`.
- **Conversational Depth** — both demo scripts run 6–9 turns, each covering an order, a modification, and a menu-grounded question (see `logs/`).
- **Data Grounding** — every item/price/description/availability claim reads from `MenuIndex` over `data/menu.json`; verified by tests asserting unknown items are rejected and quoted prices exactly match the dataset.
- **Tool/API Integration** — implemented as `ToolExecutor` in `tools.ts`, exposing exactly the four specified calls:
  - `checkAvailability(item)`
  - `addToOrder(item, quantity)`
  - `modifyOrder(item, change)` — `change` is `"remove" | "set_quantity" | "increment" | "decrement"`, covering both remove and quantity-change cases
  - `getOrderSummary()`

  (The underlying pure functions additionally take `menu`/`order` as explicit parameters rather than closures, so they can be unit-tested with no session/orchestrator involved at all — `ToolExecutor` is the session-bound wrapper that matches the call shape above 1:1. See `tests/toolExecutor.test.ts`.)
- **Intent Handling** — "make it two" and "remove that" resolve via `ConversationContext.lastMentionedItemId`; a correction always overwrites the earlier request rather than stacking with it. See the "intent changes and ambiguous references" tests in `tests/orchestrator.test.ts`.
- **Unavailable Item Handling** — `addToOrder` catches out-of-stock items before they reach `OrderState` and returns real, in-stock alternatives from the same category; the agent never proceeds as if the item were available. See `tests/unavailableItem.test.ts`.
- **LLM Reasoning** — rule-based stand-in (`nlu.ts`), by design — see the dedicated section below for why, and how a real LLM would slot into the same `parseIntent()` contract.

## Architecture

```
User utterance (string)
        │
        ▼
  transcribe()               ◄── mocked STT (sttTts.ts) — black box per spec
        │  (string)
        ▼
┌───────────────────────────────────────────────────────────┐
│                      Orchestrator                          │
│                    (orchestrator.ts)                       │
│                                                              │
│   1. splitCompoundUtterance()  — handles "actually cancel   │
│      X, add Y instead" as two clauses                       │
│   2. parseIntent()  (nlu.ts)   — raw text → typed Intent,    │
│      resolving pronouns ("that", "it") against              │
│      ConversationContext.lastMentionedItemId                 │
│   3. handleIntent()            — routes each Intent to a     │
│      response builder, which calls into tools.ts             │
└───────────────────────────────────────────────────────────┘
        │                              │
        ▼                              ▼
   tools.ts                       menu.ts (MenuIndex)
   checkAvailability()            data/menu.json  ◄── single source
   addToOrder()                   (fuzzy name/tag                of truth for
   modifyOrder()                   matching)                     all grounded
   getOrderSummary()                                              claims
        │
        ▼
   orderState.ts (OrderState)
   pure cart: line items, quantities, running total
        │
        ▼
   Agent response (string)
        │
        ▼
   synthesize()                ◄── mocked TTS (sttTts.ts)
```

### Module responsibilities (separation of concerns)

| Module | Owns | Does NOT do |
|---|---|---|
| `types.ts` | Shared domain types (`MenuItem`, `Intent`, `OrderLine`, …) | — |
| `sttTts.ts` | Mocked `transcribe`/`synthesize` black boxes | Any reasoning |
| `menu.ts` | Loading `data/menu.json`; fuzzy name/tag lookup (`MenuIndex`) | Mutating order state |
| `nlu.ts` | `parseIntent()` — raw text → typed `Intent`; anaphora resolution | Calling tools, mutating state |
| `tools.ts` | Pure functions (`checkAvailability`, `addToOrder`, `modifyOrder`, `getOrderSummary`) plus `ToolExecutor`, a thin stateful facade over them matching the brief's literal call shape | Text generation, NLU |
| `orderState.ts` | `OrderState` — pure cart (add/remove/set/adjust quantity, totals) | Menu lookups, text |
| `orchestrator.ts` | Ties the above together per turn; owns `ConversationContext` | STT/TTS, menu data |
| `cli.ts` | Demo driver wiring transcribe → orchestrator → synthesize | Business logic |

Each layer is independently unit-testable: `OrderState` needs no menu or NLU
to test (see `tests/orderState.test.ts`), `tools.ts` needs no orchestrator,
and the orchestrator's behavior can be asserted purely on the `Intent` →
response contract.

### How context/memory works

`ConversationContext` (owned by the `Orchestrator`) holds:
- `turns`: the full transcript, for reference/debugging.
- `lastMentionedItemId`: updated every time an item is added, modified, or
  discussed. This is what lets `"remove that"` or `"is that spicy?"` resolve
  correctly without the customer repeating the dish name — `resolveItemRef()`
  in `nlu.ts` checks for anaphora ("it", "that", "this", "them") and, if
  found, substitutes the last-mentioned item's id instead of trying to parse
  it as a menu name.

Order state itself (`OrderState`) is a separate object from conversation
context, since "what's in the cart" and "what did we just talk about" are
different concerns with different lifetimes (order state would need to
survive a lot longer in a real system — e.g. across a payment step — than
short-term reference resolution).

### Compound utterance handling

`"actually cancel the fries, add a coke instead"` is split into two clauses
(`splitCompoundUtterance`) on comma/`"actually"`, and each clause is parsed
and handled independently, in order. Because `modifyOrder`/`addToOrder` are
plain synchronous calls into a shared `OrderState`, later clauses always see
the effects of earlier ones within the same utterance. This is also what
makes "make it two" style corrections work when they arrive as a *separate*
follow-up turn: the intent lands on whatever `lastMentionedItemId` currently
points at, i.e. the most recent thing discussed — not the first item ever
ordered.

### Grounding

Every claim about an item's name, price, description, or availability is
read from `MenuIndex`, which wraps `data/menu.json` directly — there is no
path in the orchestrator or NLU layer that fabricates an item. Unknown items
("pizza margherita", which isn't on the menu) fail `MenuIndex.findByName()`
and get a "couldn't find that" response rather than being treated as valid.
Out-of-stock items are caught in `tools.addToOrder()` before they ever reach
`OrderState`, and the response offers real, currently-available alternatives
from the same category (`suggestAlternatives()` in `tools.ts`) — not
invented ones.

## Evaluation criteria coverage

Mapped directly against the assessment's grading table, for quick verification:

| Area | How this is addressed |
|---|---|
| **Code Quality** | Strict TypeScript (`strict`, `noUnusedLocals`, `noImplicitReturns` all on, zero `any`), one responsibility per module, comments explaining *why*, not just *what*. `npm run build` type-checks clean. |
| **Separation of Concerns** | Reasoning (`nlu.ts`), tool-calling (`tools.ts`), state (`orderState.ts`), and I/O (`sttTts.ts`) are separate modules with no circular knowledge of each other — `OrderState` doesn't know about the menu, `nlu.ts` doesn't call tools, `sttTts.ts` doesn't know the domain exists. Each has its own test file (`tests/orderState.test.ts`, `tests/sttTts.test.ts`, plus orchestrator/tool behavior in `tests/orchestrator.test.ts` and `tests/unavailableItem.test.ts`) that exercises it without needing the others. |
| **Memory/State Management** | `OrderState` is the single mutable source of truth for the cart; `ConversationContext.lastMentionedItemId` is the single source of truth for "what are we currently discussing." `tests/orderState.test.ts` verifies totals stay correct across add/remove/adjust sequences. |
| **Grounding** | Every name/price/description/availability claim reads from `MenuIndex` over `data/menu.json` — nothing is fabricated. Verified by tests asserting: an unknown item is rejected rather than invented, a quoted price exactly matches the dataset value, and spice/dietary answers reflect the item's actual tags. |
| **Robustness** | Ambiguous references ("remove that", "make it two") resolve via `ConversationContext`; mid-conversation corrections ("actually cancel X, add Y instead") are handled via `splitCompoundUtterance`; unavailable items get a real, in-stock alternative instead of being silently added; invalid input (e.g. a zero quantity) is caught before it can throw, returning a clarifying response instead of crashing. |
| **Tooling** | `checkAvailability`, `addToOrder`, `modifyOrder`, `getOrderSummary` are plain typed functions taking/returning explicit interfaces (`AddToOrderResult`, `ModifyOrderResult`, etc.) — no hidden global state, no framework coupling. Pointing them at a real backend later means changing function bodies, not signatures or callers. |
| **Documentation** | This README covers architecture, module responsibilities, the LLM-vs-rule-based tradeoff, and explicit assumptions/limitations below — not just setup steps. |

## LLM vs rule-based reasoning

The brief explicitly allows either; I used a **rule-based NLU layer**
(`nlu.ts`) rather than a real LLM call, for three reasons:

1. **Determinism for grading/testing.** A rule-based `parseIntent()` gives
   reproducible outputs, which made it much easier to write targeted unit
   tests for specific orchestration behaviors (intent-change, unavailable
   item, anaphora resolution) without dealing with LLM sampling variance.
2. **No external dependency to run the demo.** No API key needed to clone
   and run this in one command.
3. **The seam is designed so a real LLM slots in cleanly.** `parseIntent(utterance, context, menuItems): Intent`
   is the entire contract the orchestrator depends on. Swapping the rule-based
   implementation for an LLM call (e.g. structured-output/tool-calling against
   the same `Intent` union) would not require touching `orchestrator.ts`,
   `tools.ts`, or `orderState.ts` at all — this is precisely the "reasoning is
   decoupled from tool-calling and state" separation the assessment asks for.

The tradeoff: a rule-based NLU is less robust to genuinely novel phrasing
than an LLM would be. I mitigated this with fuzzy word-overlap matching for
item names (`MenuIndex.findByName`) and a fallback path (an utterance that
mentions no trigger phrase but does name a real menu item is still treated as
an implicit add), but it will still miss some phrasings an LLM would catch.
For a production system I'd keep this exact typed-`Intent` contract and put a
real LLM behind it with function/tool-calling constrained to the same union
type, so the orchestration guarantees (never hallucinate an item, always
resolve against `OrderState`) hold regardless of which reasoning backend is
used.

## Assumptions & other tradeoffs

- **Single table/session per `Orchestrator` instance.** No multi-session or
  concurrency handling — matches the CLI demo scope. A real deployment would
  key `OrderState`/`ConversationContext` by call/session id.
- **Currency/locale (₹, INR) is hardcoded** for the demo; would be
  configuration in production.
- **"Confirm order" doesn't validate stock again at confirmation time** (e.g.
  an item going out of stock between adding and confirming isn't re-checked).
  Given the 1-day scope, I prioritized the ordering/modification/grounding
  paths the brief explicitly asks for over this edge case.
- **Multi-item single-utterance parsing is intentionally limited.** A single
  utterance naming two distinct new items (e.g. "fries and a kebab") will
  currently resolve to whichever item scores highest in `extractItemMention`
  rather than adding both — the assessment's examples focus on one item per
  turn plus explicit multi-clause corrections (comma/"actually"), which *is*
  fully handled. Extending `Intent` to `ADD_ITEM[]` for true multi-item
  single-utterance parsing would be a natural next step.
- **Fuzzy matching threshold (`score >= 0.5` for names, `0.34` for mention
  extraction) is a judgment call** tuned against this menu's naming patterns
  (e.g. "tikka masala" → "Chicken Tikka Masala"). A larger/messier menu might
  need a smarter matcher (edit distance, embeddings) instead of word-overlap.
- **Testing scope**: per the brief's guidance to prioritize orchestration
  correctness over broad coverage, the 26 tests focus on the three explicitly
  requested cases — order-state updates, an intent-change case, and an
  unavailable-item case — plus grounding (including exact price matching),
  anaphora resolution, malformed/invalid input (zero or negative quantities,
  empty utterances), the `ToolExecutor` call surface, and a couple of tests
  confirming the mocked I/O layer is independently testable, rather than
  exhaustively covering every NLU regex branch.

## Project structure

```
data/menu.json          Menu dataset (source of truth for grounding)
src/types.ts             Shared domain types
src/sttTts.ts             Mocked transcribe()/synthesize()
src/menu.ts               MenuIndex: load + fuzzy lookup
src/nlu.ts                 parseIntent(): text -> typed Intent
src/tools.ts                checkAvailability/addToOrder/modifyOrder/getOrderSummary
src/orderState.ts            OrderState: pure cart
src/orchestrator.ts           Orchestrator: ties it together, owns context
src/cli.ts                    Demo driver
tests/orderState.test.ts       Order-state correctness
tests/unavailableItem.test.ts   Unavailable-item + invalid-input handling
tests/orchestrator.test.ts       Intent-change, anaphora, grounding
tests/toolExecutor.test.ts        Tool/API surface (matches spec signatures)
tests/sttTts.test.ts               I/O boundary testability
logs/sample-conversation-*.md     Captured demo transcripts
```
