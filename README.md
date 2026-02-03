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

For full documentation, see the **[original project](https://github.com/thedotmack/claude-mem)**.

---

## Docker Quick Start

### Single Container

```bash
# Using Ollama (fully local, no API costs)
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e CLAUDE_MEM_PROVIDER=ollama \
  -e CLAUDE_MEM_OLLAMA_URL=http://host.docker.internal:11434 \
  registry.evthings.space/mem-claude/claude-mem:latest

# Or using OpenRouter (free models available)
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e CLAUDE_MEM_PROVIDER=openrouter \
  -e CLAUDE_MEM_OPENROUTER_API_KEY=$OPENROUTER_API_KEY \
  registry.evthings.space/mem-claude/claude-mem:latest
```

### Docker Compose (Recommended)

For the full stack including Chroma vector search:

```bash
git clone https://github.com/sebastienvg/mem-claude.git
cd mem-claude

# Configure environment
cp .env.example .env
# Edit .env with your API key

# Start services
docker compose up -d
```

---

## Environment Variables

The worker service uses an AI model to compress and summarize your observations. Choose **one** provider:

| Variable | Description |
|----------|-------------|
| `CLAUDE_MEM_PROVIDER` | Provider: `ollama`, `openrouter`, `gemini`, or `claude` |
| `CLAUDE_MEM_OLLAMA_URL` | Ollama endpoint (default: `http://localhost:11434`) |
| `CLAUDE_MEM_OLLAMA_MODEL` | Ollama model (default: `llama3.2`) |
| `CLAUDE_MEM_OPENROUTER_API_KEY` | OpenRouter API key |
| `CLAUDE_MEM_GEMINI_API_KEY` | Gemini API key |
| `ANTHROPIC_API_KEY` | Claude API key |

**Recommended:** Use **Ollama** for fully local operation with no API costs. See "Using Ollama" below.

---

## Data Persistence

Mount `/data` to persist the SQLite database, vector embeddings, and configuration:

```bash
-v ~/.claude-mem:/data
```

---

## Health Check

```bash
curl http://localhost:37777/api/readiness
```

---

## Updating

```bash
docker pull registry.evthings.space/mem-claude/claude-mem:latest
docker compose up -d
```

---

## Using Ollama (Recommended)

For fully self-hosted operation with no API costs, use Ollama:

### If you already have Ollama running locally:

```bash
# Point to your existing Ollama instance
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -e CLAUDE_MEM_PROVIDER=ollama \
  -e CLAUDE_MEM_OLLAMA_URL=http://host.docker.internal:11434 \
  registry.evthings.space/mem-claude/claude-mem:latest
```

### If you don't have Ollama:

Uncomment the `ollama` service in `docker-compose.yml`, then:

```bash
docker compose up -d

# Pull a model (first time only)
docker exec claude-mem-ollama ollama pull llama3.2
```

### Recommended Ollama models:
- `llama3.2` - Fast, good quality (default)
- `mistral` - Excellent for structured extraction
- `phi3` - Smaller, faster

---

---

## Integrating with Claude Code

The containerized worker provides the HTTP API that powers claude-mem's memory features. To use it with Claude Code:

### Option 1: Plugin + Remote Worker (Recommended)

Install the plugin normally, then point it to your containerized worker:

```bash
# In Claude Code TUI:
> /plugin marketplace add thedotmack/claude-mem
> /plugin install claude-mem
```

Then set the worker URL in `~/.claude-mem/settings.json`:
```json
{
  "CLAUDE_MEM_WORKER_URL": "http://localhost:37777"
}
```

The plugin's hooks will send observations to your containerized worker for processing.

### Option 2: MCP Server Only (Search Tools)

If you only want the search/memory tools without the full plugin, configure Claude Code's MCP settings:

**~/.claude/settings.json:**
```json
{
  "mcpServers": {
    "claude-mem": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/claude-mem/plugin/scripts/mcp-server.cjs"],
      "env": {
        "CLAUDE_MEM_WORKER_URL": "http://localhost:37777"
      }
    }
  }
}
```

This gives Claude access to memory search tools (`search`, `timeline`, `get_observation`, etc.).

### Architecture

```
┌─────────────────┐     ┌──────────────────────────────────┐
│  Claude Code    │     │  Docker Container                │
│  (TUI)          │     │                                  │
│                 │     │  ┌─────────────────────────────┐ │
│  ┌───────────┐  │     │  │  Worker Service (37777)     │ │
│  │ Hooks     │──┼────►│  │  - Observation processing   │ │
│  │           │  │     │  │  - AI compression (Ollama)  │ │
│  └───────────┘  │     │  │  - SQLite database          │ │
│                 │     │  │  - Search API               │ │
│  ┌───────────┐  │     │  └─────────────────────────────┘ │
│  │ MCP Server│──┼────►│                                  │
│  │ (search)  │  │     │  ┌─────────────────────────────┐ │
│  └───────────┘  │     │  │  Chroma (8000)              │ │
└─────────────────┘     │  │  - Vector embeddings        │ │
                        │  └─────────────────────────────┘ │
                        │                                  │
                        │  ┌─────────────────────────────┐ │
                        │  │  Ollama (11434) [optional]  │ │
                        │  │  - Local AI compression     │ │
                        │  └─────────────────────────────┘ │
                        └──────────────────────────────────┘
```

### Web Viewer UI

Access the memory viewer at: **http://localhost:37777**

View your observations, search history, and manage settings through the web interface.

---

## License

This project is licensed under the **GNU Affero General Public License v3.0** (AGPL-3.0).

**Copyright (C) 2025 Alex Newman (@thedotmack). All rights reserved.**

See the [LICENSE](LICENSE) file for full details.

---

## Credits & Support

- **Original Project**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Author**: Alex Newman ([@thedotmack](https://github.com/thedotmack))
- **Documentation**: [docs.claude-mem.ai](https://docs.claude-mem.ai)
- **Issues**: [GitHub Issues](https://github.com/thedotmack/claude-mem/issues) (report to original project)
- **Discord**: [Join Discord](https://discord.com/invite/J4wttp9vDu)
- **X**: [@Claude_Memory](https://x.com/Claude_Memory)

---

**Containerization by [@sebastienvg](https://github.com/sebastienvg)** | **Original by [@thedotmack](https://github.com/thedotmack)**
