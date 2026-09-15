# 🧠 YODA — Persistent Cognitive Operating System for AI

> **A persistent cognitive layer that continuously observes authorized work, understands experiences, evaluates outcomes, tracks causality, learns model/tool performance, preserves cryptographic provenance, and transfers that intelligence across agents and models.**

---

## What is YODA?

Large Language Models (LLMs) and agent harnesses lose all context and learned lessons between sessions. They do not retain historical outcomes, they repeat previous mistakes, and changing models resets accumulated experience.

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
                                ▼
               ANY AGENT (OpenCode, Aider, Custom)
                                │
                                ▼
               ANY MODEL (Ollama, Claude, GPT, DeepSeek)
```

---

## Core Capabilities

1. **Autonomous Closed Cognitive Loop:** Learns automatically from observed tool actions and outcomes without requiring manual memory injection.
2. **Cross-Agent Knowledge Transfer:** Independent agents inherit accumulated rules, constraints, and strategies through dynamic L3 context envelopes.
3. **Multi-Model Independence:** Persistent SQLite state survives hot-swapping or switching reasoning engines (Ollama, GPT-4o, Claude 3.5, DeepSeek).
4. **Delayed Causality & Outcome Settling:** Re-evaluates provisional outcomes when delayed consequences or test regressions occur.
5. **Cryptographic Provenance:** Every learned rule traces back through supporting experiences to raw, immutable SHA-256 hashed ledger events (*"Why does YODA believe this?"*).
6. **Local-First Privacy & Secret Redaction:** All state is persisted locally in SQLite. API keys, tokens, and passwords are automatically scrubbed prior to persistence.
7. **Heart BIOS Supervisory Layer:** Evaluates tool execution risks, enforces universal safety rules, and preserves the Human Authority invariant.
8. **Built-in Web GUI:** Complete interactive control panel for telemetry, live session observation, rule exploration, and provider switching.

---

## System Requirements

* **OS:** Linux, macOS, or Windows (WSL2)
* **Runtime:** [Bun](https://bun.sh) (v1.0.0 or higher; tested on v1.4.2)
* **Optional Reasoning Engine:** [Ollama](https://ollama.ai) (for local LLMs) or any OpenAI-compatible API endpoint.

---

## Installation & Setup

1. **Clone or copy the YODA directory:**
   ```bash
   git clone <repository-url> yoda
   cd yoda
   ```

2. **Install dependencies:**
   ```bash
   bun install
   ```

3. **Configure environment (optional):**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` to configure your port, host, reasoning provider, or database path.

---

## Starting & Stopping YODA

### Start the Daemon
Run with the default configuration (binds to `http://127.0.0.1:8080`):

```bash
bun run start
```

Or run with custom environment parameters:

```bash
PORT=8080 PROVIDER_TYPE=auto DEFAULT_MODEL=neutral-reasoner bun run src/index.ts
```

Output:
```text
================================================================
       YODA — PERSISTENT COGNITIVE OPERATING SYSTEM             
       OpenCode Compatible Local Service                         
   [L0] + [L1] + [L2] + [L3] + [L4 Meta-Learning] + [Heart BIOS] 
   [Dual-Cortex] + [Live Session Capture] + [Causality Engine]   
   [Tool Registry] + [Dream Scheduler] + [Beads-Lite Continuity] 
================================================================
[YODA Gateway] Listening on http://127.0.0.1:8080 (Provider: mock-engine, YODA Cognitive OS Active)
```

### Stop the Daemon
Press `Ctrl+C` in the running terminal or send `SIGINT`/`SIGTERM` to the process. YODA gracefully flushes in-memory indexes and closes the SQLite ledger cleanly.

---

## Accessing the Web GUI

Open your browser and navigate to:

```text
http://127.0.0.1:8080/
```
*(or `http://127.0.0.1:8080/ui`)*

### GUI Features:
* **🏠 Home Dashboard:** System health, active model, connected agent, and live cognitive tier metrics (L0, L1, L2, L4).
* **📡 Live Session:** Real-time event streaming with color-coded actor badges (`HUMAN`, `AGENT`, `MODEL`, `TOOL`, `ENVIRONMENT`, `YODA`), pause/resume controls, and source toggles.
* **🧠 Knowledge (L2):** Filterable rule catalog, confidence meters, and the *"Why does YODA believe this?"* cryptographic provenance inspector.
* **📜 Experiences (L1):** Interactive episodic experience browser with lifecycle flow and delayed consequence tracking.
* **🤖 Agents & Models:** Model performance matrix and live provider hot-swapping form.
* **🌳 Codebase (Graft):** Symbol graph search, crux definitions, and directory tree indexing.
* **❤️ Heart BIOS:** Universal safety rules catalog and interactive command evaluation sandbox.
* **⚙️ Settings & Privacy:** Observation source controls, redaction patterns, and background dreaming consolidation trigger.

---

## Connecting an Agent (e.g. OpenCode)

YODA exposes a fully OpenAI-compatible `/v1/chat/completions` gateway.

To route **OpenCode** through YODA, add the following configuration to `~/.config/opencode/opencode.json`:

```json
{
  "provider": {
    "yoda": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "YODA Gateway",
      "options": {
        "baseURL": "http://127.0.0.1:8080/v1"
      },
      "models": {
        "neutral-reasoner": { "name": "Neutral Reasoner" },
        "gpt-4o": { "name": "OpenAI GPT-4o (via YODA)" },
        "claude-3-5-sonnet": { "name": "Claude 3.5 Sonnet (via YODA)" },
        "deepseek-chat": { "name": "DeepSeek Chat (via YODA)" }
      }
    }
  }
}
```

Then run OpenCode with:
```bash
opencode --model yoda/neutral-reasoner
```

---

## Configuration Reference (`.env`)

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `8080` | HTTP port for YODA Gateway and Web GUI |
| `HOST` | `127.0.0.1` | Network interface to bind |
| `DB_PATH` | `yoda_l0.db` | Path to local SQLite state file |
| `PROVIDER_TYPE` | `auto` | Reasoning provider backend (`auto`, `mock`, `ollama`, `upstream`) |
| `DEFAULT_MODEL` | `neutral-reasoner` | Default model alias served to clients |
| `UPSTREAM_URL` | `http://127.0.0.1:11434` | Target URL for Ollama or upstream proxy |
| `UPSTREAM_KEY` | *(empty)* | Optional API key for upstream authentication |
| `GRAFT_PATH` | *(empty)* | Optional path to local Graft installation |

---

## Privacy & Local Data Storage

* **Local-First:** All L0 events, L1 experiences, L2 rules, and L4 predictions are stored locally on your machine in the SQLite file specified by `DB_PATH` (default `yoda_l0.db`).
* **Zero Telemetry Leaks:** YODA never uploads your memory or cognitive history to cloud servers.
* **Sensitive Data Redaction:** API keys (`sk-...`, `ghp_...`), bearer tokens, connection strings, and passwords are automatically redacted prior to database writes.

---

## Troubleshooting

1. **Port in use (`EADDRINUSE`):**
   Change the port in your environment: `PORT=8090 bun run start`.
2. **Upstream provider offline:**
   If using Ollama or a remote API, verify that the service is running at `UPSTREAM_URL`. If unavailable, YODA gracefully defaults to the local deterministic reasoner.
3. **Resetting state:**
   To start completely fresh, simply delete `yoda_l0.db` and restart YODA. A new SQLite database will be initialized automatically.

---

## License

MIT License. See [LICENSE](./LICENSE) for details.
