# mem-claude (Containerized)

> **This is a containerized fork of [claude-mem](https://github.com/thedotmack/claude-mem) by [thedotmack](https://github.com/thedotmack).**
>
> All credit for the original claude-mem project goes to **Alex Newman ([@thedotmack](https://github.com/thedotmack))**.
>
> This repository adds Docker containerization for easy deployment. For the original project, full documentation, and support, please visit: **https://github.com/thedotmack/claude-mem**

---

## What is Claude-Mem?

Claude-Mem is a persistent memory compression system built for [Claude Code](https://claude.com/claude-code). It seamlessly preserves context across sessions by automatically capturing tool usage observations, generating semantic summaries, and making them available to future sessions.

**Key Features:**
- Persistent Memory - Context survives across sessions
- Progressive Disclosure - Layered memory retrieval
- Skill-Based Search - Query your project history
- Web Viewer UI - Real-time memory stream at http://localhost:37777
- Privacy Control - Use `<private>` tags to exclude sensitive content

---

## Prerequisites

**Required on the host machine:**
- Docker and Docker Compose
- **Bun** - Required for Claude Code hooks to function

```bash
# Install bun (required for hooks)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc  # or restart your terminal
```

> **Important:** Even when running the worker in Docker, bun must be installed on your host machine. The Claude Code hooks run locally and use bun to communicate with the containerized worker.

---

## Quick Start

```bash
# Clone and configure
git clone https://github.com/sebastienvg/mem-claude.git
cd mem-claude
cp .env.example .env

# Choose your AI provider in .env (see options below)

# Start with local Ollama (recommended) - pulls pre-built images
docker compose --profile ollama up -d

# Pull the compression model
docker exec claude-mem-ollama ollama pull llama3.2:3b
```

**That's it!** Web UI available at http://localhost:37777

> **Build from source?** Use: `docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build`

---

## AI Provider Options

Choose **one** provider for observation compression:

| Provider | Cost | Setup | Best For |
|----------|------|-------|----------|
| **Ollama** | Free | Local | Privacy, no API costs |
| **OpenRouter** | Free tier | API key | Easy cloud, 50+ models |
| **Gemini** | Free tier | API key | Google ecosystem |
| **Claude** | Paid | API key | Maximum quality |

### Ollama (Recommended)
```bash
# In .env:
CLAUDE_MEM_PROVIDER=ollama
CLAUDE_MEM_OLLAMA_MODEL=llama3.2:3b

# Start with Ollama profile:
docker compose --profile ollama up -d
docker exec claude-mem-ollama ollama pull llama3.2:3b
```

### OpenRouter (50+ models including OpenAI, xAI, Moonshot)
```bash
# Get free API key: https://openrouter.ai/keys
# In .env:
CLAUDE_MEM_PROVIDER=openrouter
CLAUDE_MEM_OPENROUTER_API_KEY=sk-or-v1-...
CLAUDE_MEM_OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free  # Free!

# Or use premium models:
# CLAUDE_MEM_OPENROUTER_MODEL=openai/gpt-4o-mini      # OpenAI
# CLAUDE_MEM_OPENROUTER_MODEL=x-ai/grok-2            # xAI
# CLAUDE_MEM_OPENROUTER_MODEL=deepseek/deepseek-chat # Best value

docker compose up -d
```

---

## Recommended Models

### Local (Ollama)
| Model | VRAM | Quality | Speed |
|-------|------|---------|-------|
| `llama3.2:3b` | 2GB | ★★★☆☆ | ★★★★★ |
| `qwen2.5:3b` | 2GB | ★★★★☆ | ★★★★☆ |
| `phi4:14b` | 8GB | ★★★★★ | ★★★☆☆ |
| `mistral:7b` | 4GB | ★★★★☆ | ★★★★☆ |

### Cloud (via OpenRouter)
| Model | Cost | Notes |
|-------|------|-------|
| `google/gemini-2.0-flash-exp:free` | Free | Best free option |
| `deepseek/deepseek-chat` | $0.14/M | Excellent value |
| `openai/gpt-4o-mini` | $0.15/M | Reliable |
| `anthropic/claude-3.5-haiku` | $0.25/M | Fast, high quality |

📖 **See [DOCKER.md](DOCKER.md) for complete model recommendations and setup guides.**

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────────────────┐
│  Claude Code    │     │  Docker Containers               │
│                 │     │                                  │
│  ┌───────────┐  │     │  ┌─────────────────────────────┐ │
│  │ Hooks     │──┼────▶│  │  Worker Service (:37777)    │ │
│  │           │  │     │  │  - AI compression           │ │
│  └───────────┘  │     │  │  - SQLite database          │ │
│                 │     │  │  - Search API               │ │
│  ┌───────────┐  │     │  └─────────────────────────────┘ │
│  │ MCP Server│──┼────▶│                                  │
│  └───────────┘  │     │  ┌─────────────┐ ┌────────────┐  │
└─────────────────┘     │  │ Chroma      │ │ Ollama     │  │
                        │  │ (vectors)   │ │ (local AI) │  │
                        │  └─────────────┘ └────────────┘  │
                        └──────────────────────────────────┘
```

---

## Integrating with Claude Code

### Option 1: Plugin + Container Worker (Recommended)

```bash
# In Claude Code:
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```

Then set the worker URL in `~/.claude-mem/settings.json`:
```json
{
  "CLAUDE_MEM_WORKER_URL": "http://localhost:37777"
}
```

### Option 2: MCP Server Only

Add to `~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "claude-mem": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/plugin/scripts/mcp-server.cjs"],
      "env": {
        "CLAUDE_MEM_WORKER_URL": "http://localhost:37777"
      }
    }
  }
}
```

---

## Documentation

| Guide | Description |
|-------|-------------|
| [DOCKER.md](DOCKER.md) | Full Docker deployment guide |
| [.env.example](.env.example) | All configuration options |
| [Original Docs](https://docs.claude-mem.ai) | Full claude-mem documentation |

---

## Commands

```bash
# Start services (pulls pre-built images)
docker compose up -d                    # Worker + Chroma
docker compose --profile ollama up -d   # + Local Ollama
docker compose --profile gpu up -d      # + Ollama with GPU

# Build from source (for development)
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

# Manage Ollama models
docker exec claude-mem-ollama ollama pull llama3.2:3b
docker exec claude-mem-ollama ollama list

# View logs
docker compose logs -f worker
docker compose logs -f ollama

# Health check
curl http://localhost:37777/api/readiness

# Update
docker compose pull
docker compose up -d

# Reset (warning: deletes data)
docker compose down -v
```

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0).

**Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.**

---

## Credits & Support

- **Original Project**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Author**: Alex Newman ([@thedotmack](https://github.com/thedotmack))
- **Documentation**: [docs.claude-mem.ai](https://docs.claude-mem.ai)
- **Issues**: [GitHub Issues](https://github.com/thedotmack/claude-mem/issues)
- **Discord**: [Join Discord](https://discord.com/invite/J4wttp9vDu)

---

**Containerization by [@sebastienvg](https://github.com/sebastienvg)** | **Original by [@thedotmack](https://github.com/thedotmack)**
