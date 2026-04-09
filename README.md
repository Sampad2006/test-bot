# Wellness AI

> An emotionally-aware conversational AI for mental health support — built with a multi-layer memory architecture, emotion routing, and a therapeutic safety guard.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![LangGraph](https://img.shields.io/badge/LangGraph-0.2-blueviolet)](https://langchain-ai.github.io/langgraphjs/)

---

## Overview

Wellness AI is not a chatbot. It's a stateful, multi-agent system that:

- Analyses every message through a **Router LLM** (Gemini Flash) to detect emotions, crisis signals, and implicit needs
- Retrieves relevant context from a **dual-layer memory** (Zep Cloud knowledge graph + MongoDB local store)
- Generates responses grounded in **Cognitive Behavioral Therapy** and **Motivational Interviewing** principles
- Filters every draft through **EmoGuard**, a therapeutic safety layer that can reject and regenerate unsuitable replies
- Logs every turn to a **fine-tuning dataset** for future model improvement via Groq's API
- Presents everything in a minimal, dark, split-panel UI with a real-time status orb

---

## Quick Start

### Prerequisites
- Node.js 18+
- A MongoDB Atlas cluster (free tier works)
- Groq API key (free tier)
- Google AI Studio key (for Gemini Flash router)
- *(Optional)* Zep Cloud account — the system falls back to MongoDB automatically

### Installation

```bash
git clone <repo-url>
cd wellness-ai
npm install
cp .env.example .env   # fill in your keys
npm run dev
```

Open `http://localhost:8001` in your browser.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | ✅ | Main generation model |
| `GEMINI_API_KEY` | ✅ | Router LLM (emotion analysis) |
| `MONGODB_URI` | ✅ | CAMA + local context storage |
| `ZEP_API_KEY` | ⚠️ optional | Zep Cloud long-term memory — system degrades gracefully if missing |
| `PORT` | — | Default: `8001` |
| `GROQ_MODEL` | — | Default: `llama-3.1-8b-instant` |
| `ROUTER_MODEL` | — | Default: `gemini-2.5-flash` |
| `EMOGUARD_MODEL` | — | Default: `llama-3.1-8b-instant` |

---

## Project Structure

```
wellness-ai/
├── frontend/              # Vanilla HTML/CSS/JS interface
│   ├── index.html         # Two-panel split layout
│   ├── style.css          # Design system + orb styles
│   └── app.js             # WS client + canvas orb + real-time state
│
├── src/
│   ├── main.ts            # Express + WebSocket server
│   ├── config.ts          # Env var management
│   ├── types.ts           # Shared TypeScript interfaces
│   │
│   ├── api/
│   │   ├── chat.ts        # WebSocket message handler
│   │   └── session.ts     # REST session endpoints
│   │
│   ├── graph/             # LangGraph stateful agent
│   │   ├── graph.ts       # Node wiring + conditional edges
│   │   ├── nodes.ts       # All node implementations
│   │   └── state.ts       # Annotated state schema
│   │
│   ├── memory/            # Multi-layer memory system
│   │   ├── hybridMemory.ts # Unified interface (Zep + Local)
│   │   ├── zepClient.ts   # Zep Cloud (with circuit-breaker)
│   │   ├── localContext.ts # MongoDB sliding-window RAG
│   │   └── cama.ts        # Circular Associative Memory
│   │
│   ├── router/
│   │   └── routerLlm.ts   # Gemini-based emotion router
│   │
│   ├── prompts/
│   │   └── systemPrompt.ts # Dynamic prompt builder
│   │
│   ├── safety/
│   │   └── emoguard.ts    # Therapeutic safety filter
│   │
│   └── finetune/
│       └── logger.ts      # JSONL fine-tune data logger
│
├── finetune_data/         # Auto-created; gitignored
│   └── turns_YYYY-MM-DD.jsonl
│
└── docs/
    ├── ARCHITECTURE.md    # Deep technical design doc
    └── FINETUNE.md        # Fine-tuning workflow guide
```

---

## Architecture Summary

```
User Message
     │
     ▼
┌─────────────┐     ┌──────────────────┐
│  Intake     │────▶│  Router LLM      │  (Gemini Flash)
│  Node       │     │  emotion/crisis  │
└─────────────┘     └────────┬─────────┘
                             │
                    crisis?  │  safe
                    ┌────────┴────────┐
                    ▼                 ▼
             ┌──────────┐    ┌───────────────┐
             │  Crisis  │    │  Memory Fetch │
             │  Node    │    │  (CAMA+Hybrid)│
             └──────────┘    └───────┬───────┘
                                     │
                             ┌───────▼───────┐
                             │  Generation   │  (Groq LLaMA)
                             └───────┬───────┘
                                     │
                             ┌───────▼───────┐
                             │   EmoGuard    │  (refine loop ≤2x)
                             └───────┬───────┘
                                     │
                    ┌────────────────┴──────────────────┐
                    ▼                                   ▼
             ┌────────────┐                   ┌──────────────────┐
             │   Output   │                   │  Memory Update   │
             │   Node     │                   │  + FT Logger     │
             └────────────┘                   └──────────────────┘
```

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the full deep-dive.

---

## Fine-Tuning

Every conversation turn is automatically logged to `finetune_data/` in OpenAI JSONL format, ready for upload to Groq's fine-tuning API.

See [`docs/FINETUNE.md`](./docs/FINETUNE.md) for the complete workflow.

---

## Safety

This project includes a multi-layer safety system:
1. **Router LLM** — detects crisis signals (0–5 scale) before generation
2. **EmoGuard** — post-generation filter that can reject and regenerate responses
3. **Crisis banner** — UI-level alert with helpline number (iCall: 9152987821)
4. **Hard-coded crisis responses** — pre-written, clinically-grounded replies for level 4–5 crises

> ⚠️ This is an experimental research project, not a licensed mental health product. Never use in production without clinical supervision.

---

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start dev server with hot-reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled build |

---

## License

MIT — see LICENSE file.
