# 🧠 YODA — Persistent Cognitive Operating System for AI

> **One Brain. Many AI systems. Your AI can change — YODA remembers.**

YODA is a universal, persistent cognitive layer that sits alongside your AI tools and coding agents. It continuously observes authorized work, understands experiences, evaluates outcomes, tracks causality, preserves cryptographic provenance, and transfers accumulated intelligence across different agents, models, and providers.

---

## 🌟 What is YODA?

Large Language Models (LLMs) and agent harnesses lose all context and learned lessons between sessions. They repeat previous mistakes, ignore past architectural decisions, and changing models resets accumulated experience.

**YODA solves this by decoupling persistent cognition from interchangeable reasoning engines.**

* **YODA stays.**
* **Agents change.**
* **Models change.**
* **Tools change.**
* **Accumulated intelligence, proven rules, and safety invariants remain.**

```text
                            HUMAN / USER
                                 │
                                 ▼
                     LIVE SESSION OBSERVATION
         (Permission-based, Pauseable, Redacted, Local-First)
                                 │
                   ┌─────────────┼─────────────┐
                   ▼             ▼             ▼
                 HUMAN         AGENTS     ENVIRONMENT
                   │             │             │
                   └─────────────┼─────────────┘
                                 ▼
                            EVIDENCE BUS
                                 │
                                 ▼
                        L0 IMMUTABLE LEDGER
                (Append-Only, SHA-256 Hash Chained)
                                 │
                                 ▼
                       L1 EPISODIC EXPERIENCE
            (Settlement State Machine + Delayed Causality)
                                 │
                                 ▼
                       CAUSALITY & ATTRIBUTION
           (Bayesian Likelihood vs Temporal Correlation)
                                 │
                                 ▼
                       L2 KNOWLEDGE SYNTHESIS
              (Confidence Tracking, Single-Observation)
                                 │
                                 ▼
                     L4 META-LEARNING ENGINE
             (Brier Calibration, Predictions, Bounds)
                                 │
                                 ▼
                    DYNAMIC L3 CONTEXT COMPILER
        (Cognitive Context + Heart Directives + Graft Cortex)
                                 │
                   ┌─────────────┴─────────────┐
                   ▼                           ▼
       INSTALLED AI CLIENTS             API / ENDPOINTS
    (Antigravity, OpenCode, Aider)     (Claude, GPT-4o, Gemini)
```

---

## 🚫 What YODA is NOT

* **NOT a model**: YODA provides cognition and memory; your chosen LLM performs reasoning.
* **NOT an Ollama wrapper**: Ollama is 100% optional for local inference.
* **NOT agent-specific**: Works across Antigravity, OpenCode, Cursor, Aider, Claude Code, etc.
* **NOT a generic chatbot**: YODA is a persistent operating system layer.
* **NOT a browser tab interceptor**: Sandboxed browser web chats (`chatgpt.com`, `claude.ai`) cannot be intercepted via localhost without an extension.
* **NOT an AGI claim**: YODA maintains an evolving, evidence-backed model of context, experiences, and outcomes.

---

## ⚡ Quickstart

### 1. Prerequisites
* **Runtime**: [Bun](https://bun.sh) (v1.0.0 or higher; tested on v1.4.2)
* **OS**: Linux, macOS, or Windows (WSL2)

### 2. Installation
```bash
git clone https://github.com/your-org/yoda.git
cd yoda
bun install
```

### 3. Start YODA
```bash
bun start
```
* The cognitive daemon starts on `http://127.0.0.1:8080`.
* **Mission-Control Web GUI**: Open **[http://127.0.0.1:8080/ui](http://127.0.0.1:8080/ui)** in your browser.

---

## 🔌 Connecting Your AI Systems

YODA targets two primary integration surfaces:

### A. Locally Installed AI Clients & Agents
* **Antigravity CLI / IDE**: Communicates natively via live Evidence Bus and L2 shared rules in `GEMINI.md`.
* **OpenCode**: Point OpenCode to YODA by adding the provider block from [`opencode-provider.json`](./opencode-provider.json) to `~/.config/opencode/opencode.json`.
* **Cursor / Aider / VS Code**: Set OpenAI Base URL to `http://127.0.0.1:8080/v1` in your editor settings.

### B. API / Cloud AI Endpoints
* **Anthropic Claude Code**: Routes messages via standard format adapter (`ANTHROPIC_BASE_URL=http://127.0.0.1:8080`).
* **OpenAI GPT / Codex**: Direct Chat Completion format adapter at `/v1/chat/completions`.
* **Google Gemini**: Direct `generateContent` format adapter.
* **Universal REST / SDK**: Use `POST /api/compile` or `/api/adapters/capture` for custom scripts and agent workflows.

---

## 🔒 Privacy & Sovereign Governance

* **100% Local-First Storage**: All events (L0), experiences (L1), knowledge (L2), and calibrations (L4) are stored in your local SQLite database (`yoda_l0.db`).
* **Automatic Secret Redaction**: API keys (`sk-...`, `anthropic-...`), JWTs, bearer tokens, and passwords are automatically scrubbed before SHA-256 hashing and disk persistence.
* **Heart BIOS Safety Layer**: High-confidence learned rules **cannot bypass** fundamental safety invariants (destructive filesystem/database operations strictly require human override).
* **Zero Telemetry**: No conversation data is sent to external servers unless you explicitly configure a cloud model provider.

---

## 📊 Cognitive Tiers

| Tier | Component | Description |
| :---: | :--- | :--- |
| **L0** | **Event Ledger** | Append-only, SHA-256 verified sensory stream of prompts, tool calls, and test results. |
| **L1** | **Episodic Experiences** | Stateful lifecycle units (`PROPOSED` $\to$ `OBSERVATION` $\to$ `SETTLED`) with delayed causality. |
| **L2** | **Knowledge Store** | Synthesized Bayesian beliefs, project constraints, and preferences with cryptographic provenance. |
| **L3** | **Context Compiler** | Just-in-time synthesis of relevant rules, Codebase Cortex AST symbols, and Heart directives ($< 1,500$ tokens). |
| **L4** | **Epistemic Self-Model** | Meta-learning, Brier score calibration, and strategy efficacy scoring. |

---

## 📁 Repository Structure

```text
yoda/
├── src/
│   ├── adapters/        # Universal AI client adapters (Antigravity, OpenCode, Claude, Codex)
│   ├── beads/           # Beads-Lite cross-agent task continuity
│   ├── causality/       # Causality & delayed outcome settlement engine
│   ├── consolidation/   # Memory consolidation & background dreaming scheduler
│   ├── cortex/          # Codebase Cortex (Dual-Cortex AST symbol graph)
│   ├── db/              # SQLite WAL Event Ledger & schema definitions
│   ├── evidence/        # Evidence Bus sensory ingestion
│   ├── gateway/         # HTTP/SSE Gateway handlers, streaming, and REST API
│   ├── gui/             # Mission-Control industrial web console (/ui)
│   ├── heart/           # Heart Safety BIOS & zero-bypass supervisor
│   ├── l1/              # Episodic experience manager
│   ├── l2/              # Bayesian knowledge store, provenance, & learning engine
│   ├── l3/              # Dynamic context compiler & deterministic embedder
│   ├── l4/              # Epistemic self-model & meta-learning engine
│   ├── orchestrator/    # Closed cognitive loop orchestrator
│   ├── providers/       # Interchangeable model routers (Mock, Upstream, Ollama, Claude, OpenAI, Gemini)
│   ├── session/         # Live session observation, replay, & redaction
│   ├── tools/           # Sandboxed tool execution & registry
│   ├── index.ts         # Main runtime entrypoint
│   └── types.ts         # Core TypeScript type definitions
├── .env.example         # Environment template with placeholder keys
├── .gitignore           # Clean gitignore excluding databases, secrets, and caches
├── LICENSE              # MIT License
├── opencode-provider.json # OpenCode integration configuration
├── package.json         # Package manifest
├── README.md            # Public documentation
└── tsconfig.json        # TypeScript configuration
```

### Connecting Antigravity

Antigravity uses the YODA skill (`skills/yoda/SKILL.md`) to route interactions and emit outcome evidence to YODA:

* **Endpoint:** `http://127.0.0.1:8080/v1`
* **Skill Path:** `~/.gemini/config/skills/yoda/SKILL.md`

Antigravity sessions automatically share the same L0–L4 cognitive state, Heart BIOS safety constraints, and Evidence Bus with OpenCode.

---

## ⚖️ License

MIT License. See [LICENSE](./LICENSE) for details.
