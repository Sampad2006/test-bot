# Architecture Deep-Dive

This document covers the complete technical design of Wellness AI — every component, every design decision, and how it all fits together.

---

## Table of Contents
1. [System Overview](#system-overview)
2. [LangGraph Agent Pipeline](#langgraph-agent-pipeline)
3. [Memory Architecture](#memory-architecture)
4. [Router LLM](#router-llm)
5. [EmoGuard](#emoguard)
6. [System Prompt Design](#system-prompt-design)
7. [Frontend](#frontend)
8. [Fine-Tuning Pipeline](#fine-tuning-pipeline)
9. [Failure Modes & Resilience](#failure-modes--resilience)

---

## System Overview

Wellness AI is a **stateful, multi-agent system** built on LangGraph. Unlike a simple chatbot, every user message passes through a directed acyclic graph (with one conditional loop) before a response is produced.

```
WebSocket → chatHandler → wellnessGraph.invoke() → WebSocket
```

The graph is compiled once at startup (`graph.compile()`) and invoked per-message. State is carried across the graph via LangGraph's `Annotation.Root`, which merges partial state updates from each node using configured reducers.

---

## LangGraph Agent Pipeline

### State Schema (`state.ts`)

The graph maintains a typed state object with last-write-wins reducers for most fields and a `messagesStateReducer` (append-only) for the conversation history:

| Field | Type | Description |
|---|---|---|
| `messages` | `BaseMessage[]` | Full conversation history (LangChain format) |
| `userId` / `userName` | `string` | Session identifiers |
| `currentMessage` | `string` | The current user input |
| `routerOutput` | `RouterOutput` | Emotion analysis from Router LLM |
| `camaNodes` | `MemoryNode[]` | Retrieved CAMA ring memories |
| `camaConsole` | `CAMAConsole` | Persistent patterns/beliefs |
| `zepFacts` | `ZepFact[]` | Merged Zep + Local context facts |
| `zepSummary` | `string` | Rolling session summary |
| `responseDraft` | `string` | Generation output (may be refined) |
| `emoguardReport` | `EmoGuardReport` | Safety analysis |
| `refineCount` | `number` | Loop counter (max 2 refinements) |
| `finalResponse` | `string` | Committed output sent to user |
| `isCrisis` | `boolean` | Whether crisis path was taken |

### Node Descriptions

#### 1. `intake`
- Appends the current message as a `HumanMessage` to state
- Calls `hybridMemory.ensureSession()` to initialise both Zep and LocalContextStore

#### 2. `router`
- Dispatches to Gemini Flash with a structured JSON schema
- Extracts: primary/secondary emotion, intensity, trajectory, crisis level (0–5), implicit need, sarcasm flag, volatility score, semantic tags, episodic extract
- Sets `emoguardSensitivity` and `isCrisis` flag

#### 3. `crisis` *(conditional branch)*
- Activated when `crisis_level >= 4`
- Returns a pre-written, clinically-grounded hard-coded response
- Bypasses generation entirely — safer than asking an LLM to handle imminent danger

#### 4. `memory_fetch`
- Runs three parallel fetches:
  - CAMA recall (emotion-tag similarity, recency-weighted)
  - `hybridMemory.getContext()` (Zep + Local merged, keyword-sim ranked)
  - `hybridMemory.getUserFacts()` (identity/pattern heuristics)

#### 5. `generation`
- Builds a rich system prompt via `buildSystemPrompt()`
- Calls Groq (LLaMA 3.1 8B) with `temperature: 0.8`, `presence_penalty: 0.6`
- History: last 8 messages for context window efficiency

#### 6. `emoguard`
- Evaluates the response draft for therapeutic quality, safety, boundary violations
- Can set `should_refine: true` with `intervention_advice` injected back into the next generation call
- Max 2 refinement loops (guarded by `refineCount`)

#### 7. `output`
- Commits `responseDraft` → `finalResponse`
- Appends `AIMessage` to history
- Resets `refineCount`

#### 8. `memory_update`
- CAMA ingest (salience-gated at `> 0.3`)
- `hybridMemory.addTurn()` — writes to both Zep and LocalContextStore
- `logFineTuneTurn()` — fire-and-forget JSONL write

### Graph Flow

```
START → intake → router ─┬─ (crisis_level≥4) → crisis → memory_update → END
                          │
                          └─ (safe) → memory_fetch → generation → emoguard
                                                           │
                                        ┌──────────────────┤
                                        │ should_refine     │ output
                                        │ AND count < 2     │
                                        └──────── generation┘
                                                            │
                                              output → memory_update → END
```

---

## Memory Architecture

Wellness AI uses a **three-layer memory hierarchy** operating at different timescales:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  hybridMemory.ts  —  unified interface                                      │
│                                                                             │
│  ┌─────────────────────────┐    ┌──────────────────────────────────────┐   │
│  │  Zep Cloud              │    │  LocalContextStore (MongoDB)         │   │
│  │  ─────────────────────  │    │  ──────────────────────────────────  │   │
│  │  Knowledge graph        │    │  Sliding window: last 20 turns       │   │
│  │  Entity extraction      │    │  Keyword-overlap RAG (Jaccard-like)  │   │
│  │  LLM-derived summaries  │    │  Auto-summary: last 3 turns          │   │
│  │  Temporal validity      │    │  Pattern/name heuristics             │   │
│  │  Circuit-breaker: 5min  │    │  Always available                    │   │
│  └─────────────────────────┘    └──────────────────────────────────────┘   │
│                   ↘  results merged + deduped ↙                            │
└────────────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────┐
        │  CAMA (Circular Associative    │
        │  Memory Architecture)          │
        │  ───────────────────────────   │
        │  Ring buffer: last 50 nodes    │
        │  Salience gate: > 0.3          │
        │  Emotion-tag similarity recall │
        │  Recency decay: 7-day half-life│
        │  Persisted in MongoDB          │
        └────────────────────────────────┘
```

### Layer 1: Zep Cloud (Primary Long-Term)
- Extracts structured facts from conversation using LLM entity recognition
- Builds a temporal knowledge graph with `valid_at` / `invalid_at` windows
- Searches sessions by semantic similarity (text embeddings)
- **Circuit Breaker**: trips after any API error, stays open for 5 minutes, auto-resets

### Layer 2: LocalContextStore (Always-On Fallback)
- Stores raw turns in `wellness_db.context_store` (MongoDB)
- Retrieval: **Jaccard-like keyword overlap** between query and stored `keywords[]` (pre-indexed, stop-word filtered)
- Blended sort: `0.7 × relevance + 0.3 × recency`
- Returns top-6 as `ZepFact[]` for uniform consumption
- Summary: rolling digest of last 3 turns

### Layer 3: CAMA (Short-Term Associative)
- **Ring buffer** of emotionally significant moments (cap: 50 nodes)
- Each node stores: content, emotion tags, timestamp, salience score
- **Recall** by emotion-tag overlap + recency decay (exponential, 7-day half-life)
- **Console**: extracts recurring patterns (keyword heuristics), core beliefs (future: LLM-extracted)
- Persisted per-user in `wellness_db.cama_memory`

### Hybrid Merge Logic
```typescript
// getContext merges in priority order:
[ ...zepFacts, ...localFacts ]
// then dedup by first-40-chars content key
// Zep summary preferred; local rolling digest as fallback
```

---

## Router LLM

**Model**: Gemini 2.5 Flash (low temperature: `0.1`)  
**Output**: Strictly-typed JSON via `responseMimeType: "application/json"` + `responseSchema`

The router extracts:

| Field | Type | Range | Notes |
|---|---|---|---|
| `crisis_level` | integer | 0–5 | 0=none, 5=imminent danger |
| `crisis_flags` | string[] | — | Specific risk signals detected |
| `emotion.primary` | string | — | Specific label (not just "sad") |
| `emotion.secondary` | string | — | Undertone emotion |
| `emotion.intensity` | float | 0–1 | Drives CAMA salience |
| `emotion.trajectory` | enum | escalating/stable/de-escalating | |
| `implicit_need` | enum | validation/advice/venting/problem_solving/connection/unknown | |
| `sarcasm_detected` | boolean | — | |
| `volatility_score` | float | 0–1 | Drives EmoGuard sensitivity |
| `semantic_memory_tags` | string[] | — | Topic anchors for CAMA/Zep tagging |
| `episodic_memory_extract` | string | — | Key moment to store verbatim |

---

## EmoGuard

EmoGuard is a post-generation safety filter. It evaluates the draft response against the user message and conversation history.

**Evaluation criteria:**
- Premature advice-giving when user needed validation
- Crisis response inadequacy
- Boundary violations (role confusion, over-promising)
- Therapeutic mismatch (technique wrong for detected emotion)
- Harmful minimisation of expressed suffering

**Output** (`EmoGuardReport`):
```typescript
{
  risk_score: number;          // 0.0–1.0
  flags: string[];             // specific issues found
  intervention_advice: string; // injected into next generation attempt
  should_refine: boolean;      // triggers refinement loop
  refined_draft?: string;      // direct replacement if available
}
```

**Refinement loop**: If `should_refine` and `refineCount < 2`, the graph loops back to `generation` with EmoGuard's `intervention_advice` appended to the system prompt. This allows the model to self-correct without human intervention.

---

## System Prompt Design

The system prompt is dynamically assembled per-turn by `buildSystemPrompt()`. It includes:

1. **Identity**: Role framing (trauma-informed, CBT/MI training)
2. **Who They're Talking To**: Name + Zep summary (if available)
3. **Long-Term Memory**: Filtered Zep facts (valid only)
4. **Recent Emotional Moments**: CAMA ring nodes formatted with date
5. **Recurring Patterns**: CAMA console patterns
6. **Current Signal Analysis**: Router output (emotion, need, sarcasm, volatility, episodic extract)
7. **Rules (12 non-negotiables)**: Banned openers, specific reflection requirements, implicit need routing, memory reference requirement, zero-generic-fallback enforcement

Key anti-generic rules:
- Banned first words: "It", "That", "I", "Oh", "Wow", "Yes", "No", "So", "Well", "Absolutely", "Certainly", "Of course", "Sure"
- First sentence must be a **direct, specific reflection** — not a hedge or compliment
- Response must only apply to **this exact message from this exact person**

---

## Frontend

### Layout
Two-panel CSS Grid: `178px sidebar | 1fr main panel`

### Left Sidebar
- **Orb**: Canvas-rendered, morphing blob using quadratic Bézier curves — the shape changes are driven by overlapping sine waves with different frequencies
- **LIVE dot**: Mirrors WebSocket `onopen` (green, pulsing) and `onclose` (red, static) in real time
- **Cognitive Load**: Updates based on emotion intensity returned from the backend
- **Emotion Display**: Updates after each AI response

### Chat Panel
- Clean flat messages — no coloured bubbles
- AI messages: left-aligned with faint purple left-border accent
- User messages: right-aligned, initial avatar
- Typing indicator: 3-dot bounce animation
- Auto-scroll to bottom on new messages

### WebSocket Flow
```
start-btn click
  → generate userId + userName
  → new WebSocket(ws://host/chat)
    → onopen → send {type: "init", userId, userName}
    → receive {type: "ready"} → setLiveDot(true)
    → user types → send {type: "chat", message}
    → receive {type: "status", "thinking"} → showTypingIndicator()
    → receive {type: "response", message, emotion, isCrisis}
      → removeTypingIndicator()
      → appendMessage("ai", ...)
      → updateEmotion(emotion)
    → onclose → setLiveDot(false) → retry in 3s
```

---

## Fine-Tuning Pipeline

See [`FINETUNE.md`](./FINETUNE.md) for the complete guide.

The logger writes to `./finetune_data/turns_YYYY-MM-DD.jsonl` after every successful turn. Each line:

```json
{
  "messages": [
    {"role": "system", "content": "... full dynamic prompt ..."},
    {"role": "user",   "content": "... user message ..."},
    {"role": "assistant", "content": "... final AI response ..."}
  ],
  "_meta": {
    "timestamp": "2026-04-09T...",
    "userId": "user_...",
    "emotion": {"primary": "anxiety", "intensity": 0.7, ...},
    "implicit_need": "venting",
    "crisis_level": 0
  }
}
```

The `_meta` field is for analysis only — strip it before uploading to Groq.

---

## Failure Modes & Resilience

| Component | Failure Mode | Recovery |
|---|---|---|
| Zep Cloud | API error / expired key | Circuit-breaker trips (5 min); LocalContextStore provides full context |
| MongoDB | Connection failure | CAMA degrades gracefully; LocalContextStore returns empty (logged) |
| Gemini Router | API failure | Fallback RouterOutput with safe defaults (crisis_level=0, emotion=unknown) |
| EmoGuard | LLM error | `should_refine=false`, draft passes through unmodified |
| Groq generation | API error | WebSocket sends `{type: "error"}` message to frontend |
| JSONL logger | File write error | Silent warning only — never blocks the main pipeline |
| WebSocket | Disconnect | Frontend auto-reconnects after 3s; live dot goes red |
