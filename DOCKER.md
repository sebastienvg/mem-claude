# Docker Deployment Guide

This guide covers deploying claude-mem using Docker containers with various AI providers.

## Quick Start

```bash
# Clone and configure
git clone https://github.com/sebastienvg/mem-claude.git
cd mem-claude
cp .env.example .env

# Edit .env to choose your AI provider

# Start with local Ollama (recommended) - pulls pre-built images
docker compose --profile ollama up -d

# Pull a compression model
docker exec claude-mem-ollama ollama pull llama3.2:3b
```

## Host Requirements

While the worker runs in Docker, **the Claude Code plugin hooks run on your host machine** and require:

- **Bun**: JavaScript runtime for hook execution

```bash
# Install bun on the host
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc
```

Without bun installed on the host, hooks will fail silently and no observations will be captured, even though the worker API responds correctly.

## Pre-built vs Build from Source

**Default: Pull pre-built images** (fastest)
```bash
docker compose up -d                    # Pulls from ghcr.io
```

**Build from source** (for development)
```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Docker Network: claude-mem-network                             │
│                                                                 │
│  ┌───────────────────┐   ┌───────────────┐   ┌──────────────┐  │
│  │  Worker (:37777)  │──▶│  Chroma       │   │  Ollama      │  │
│  │                   │   │  (:8000)      │   │  (:11434)    │  │
│  │  - HTTP API       │   │               │   │              │  │
│  │  - AI compression │──▶│  Vector DB    │   │  Local LLM   │  │
│  │  - SQLite storage │   │  Embeddings   │   │  (optional)  │  │
│  └───────────────────┘   └───────────────┘   └──────────────┘  │
│         │                                            │          │
└─────────┼────────────────────────────────────────────┼──────────┘
          │                                            │
          ▼                                            ▼
    localhost:37777                              localhost:11434
    (Web UI + API)                               (Ollama API)
```

## Deployment Profiles

### Default (External AI)
```bash
docker compose up -d
```
Starts worker + Chroma. Use with external Ollama or cloud APIs.

### With Local Ollama
```bash
docker compose --profile ollama up -d
```
Includes containerized Ollama for fully self-hosted operation.

### With GPU Acceleration
```bash
docker compose --profile gpu up -d
```
Ollama with NVIDIA GPU passthrough. Requires nvidia-docker2.

## AI Provider Configuration

### Ollama (Recommended)

**Fully local, no API costs, full privacy.**

```bash
# In .env:
CLAUDE_MEM_PROVIDER=ollama
CLAUDE_MEM_OLLAMA_MODEL=llama3.2:3b

# Start stack
docker compose --profile ollama up -d

# Pull the model (first time)
docker exec claude-mem-ollama ollama pull llama3.2:3b
```

**Using existing Ollama installation:**
```bash
# In .env - point to host Ollama:
CLAUDE_MEM_OLLAMA_URL=http://host.docker.internal:11434

# Start without Ollama profile
docker compose up -d
```

### OpenRouter (Easy Cloud Setup)

**Free tier available, 50+ models, single API.**

```bash
# Get free API key: https://openrouter.ai/keys
# In .env:
CLAUDE_MEM_PROVIDER=openrouter
CLAUDE_MEM_OPENROUTER_API_KEY=sk-or-v1-...
CLAUDE_MEM_OPENROUTER_MODEL=google/gemini-2.0-flash-exp:free

docker compose up -d
```

### Gemini (Google Direct)

```bash
# Get API key: https://aistudio.google.com/apikey
# In .env:
CLAUDE_MEM_PROVIDER=gemini
CLAUDE_MEM_GEMINI_API_KEY=...
CLAUDE_MEM_GEMINI_MODEL=gemini-2.0-flash-exp

docker compose up -d
```

### Claude (Anthropic Direct)

```bash
# In .env:
CLAUDE_MEM_PROVIDER=claude
ANTHROPIC_API_KEY=sk-ant-...

docker compose up -d
```

---

## Model Recommendations

### For Observation Compression

The compression model extracts structured observations from tool usage. Key requirements:
- Good instruction following
- Structured output (XML parsing)
- Reasonable speed (processes during coding sessions)

| Model | Provider | Cost | Quality | Speed | VRAM |
|-------|----------|------|---------|-------|------|
| **llama3.2:3b** | Ollama | Free | ★★★☆☆ | ★★★★★ | 2GB |
| **qwen2.5:3b** | Ollama | Free | ★★★★☆ | ★★★★☆ | 2GB |
| **phi4:14b** | Ollama | Free | ★★★★★ | ★★★☆☆ | 8GB |
| **mistral:7b** | Ollama | Free | ★★★★☆ | ★★★★☆ | 4GB |
| **gemini-2.0-flash-exp:free** | OpenRouter | Free | ★★★★☆ | ★★★★★ | - |
| **gpt-4o-mini** | OpenRouter | $0.15/M | ★★★★☆ | ★★★★★ | - |
| **deepseek-chat** | OpenRouter | $0.14/M | ★★★★★ | ★★★★☆ | - |
| **claude-3.5-haiku** | OpenRouter | $0.25/M | ★★★★★ | ★★★★★ | - |

**Recommendations:**
- **Budget/Privacy**: `llama3.2:3b` (Ollama) - default, works great
- **Quality local**: `phi4:14b` or `qwen2.5:14b` (Ollama with 8GB+ VRAM)
- **Free cloud**: `google/gemini-2.0-flash-exp:free` (OpenRouter)
- **Best value**: `deepseek/deepseek-chat` (OpenRouter, $0.14/M tokens)
- **Premium**: `anthropic/claude-3.5-haiku` (OpenRouter, fastest high-quality)

### For Embeddings (Chroma Vector Search)

Embeddings power semantic search. Chroma uses sentence-transformers by default.

| Model | Provider | Quality | Size | Notes |
|-------|----------|---------|------|-------|
| **nomic-embed-text** | Ollama | ★★★★★ | 274MB | Best general purpose |
| **mxbai-embed-large** | Ollama | ★★★★★ | 669MB | Highest quality |
| **all-minilm** | Ollama | ★★★☆☆ | 46MB | Fastest, smallest |
| **text-embedding-3-small** | OpenAI | ★★★★☆ | - | Via API |

**To use Ollama embeddings:**
```bash
docker exec claude-mem-ollama ollama pull nomic-embed-text
```

### Remote Model Providers via OpenRouter

OpenRouter provides a unified API for 50+ models:

**OpenAI:**
- `openai/gpt-4o-mini` - $0.15/M in, fast, reliable
- `openai/gpt-4o` - $2.50/M in, best OpenAI quality
- `openai/o1-mini` - $3/M in, reasoning model

**xAI (Grok):**
- `x-ai/grok-2` - $2/M in, competitive quality
- `x-ai/grok-2-vision` - $2/M in, multimodal

**Moonshot:**
- `moonshot/moonshot-v1-8k` - $0.14/M, good value
- `moonshot/moonshot-v1-128k` - $0.84/M, huge context

**DeepSeek:**
- `deepseek/deepseek-chat` - $0.14/M, excellent value
- `deepseek/deepseek-reasoner` - $0.55/M, reasoning

---

## Data Persistence

All data is stored in Docker volumes:

| Volume | Content | Location in Container |
|--------|---------|----------------------|
| `claude-mem-data` | SQLite DB, settings | `/data` |
| `claude-mem-chroma-data` | Vector embeddings | `/chroma/chroma` |
| `claude-mem-ollama-data` | Ollama models | `/root/.ollama` |

**Backup:**
```bash
# Stop services
docker compose down

# Backup volumes
docker run --rm -v claude-mem-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/claude-mem-backup.tar.gz -C /data .
```

**Restore:**
```bash
docker run --rm -v claude-mem-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/claude-mem-backup.tar.gz -C /data
```

---

## GPU Setup (NVIDIA)

For faster local inference with larger models:

### Prerequisites
```bash
# Install nvidia-docker2
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | \
  sudo tee /etc/apt/sources.list.d/nvidia-docker.list
sudo apt-get update && sudo apt-get install -y nvidia-docker2
sudo systemctl restart docker
```

### Start with GPU
```bash
docker compose --profile gpu up -d

# Verify GPU access
docker exec claude-mem-ollama nvidia-smi
```

### GPU Memory Requirements

| Model | VRAM Required | Quality |
|-------|--------------|---------|
| llama3.2:1b | 1GB | Basic |
| llama3.2:3b | 2GB | Good |
| qwen2.5:7b | 4GB | Very Good |
| phi4:14b | 8GB | Excellent |
| qwen2.5:14b | 10GB | Excellent |
| llama3.3:70b-q4 | 40GB | Best |

---

## Integrating with Claude Code

### Method 1: Plugin + Remote Worker (Recommended)

Install the plugin in Claude Code, then point to your container:

```bash
# In Claude Code:
/plugin marketplace add thedotmack/claude-mem
/plugin install claude-mem
```

Edit `~/.claude-mem/settings.json`:
```json
{
  "CLAUDE_MEM_WORKER_URL": "http://localhost:37777"
}
```

### Method 2: MCP Server Only

Add to `~/.claude/settings.json`:
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

---

## Troubleshooting

### Check service health
```bash
# All services status
docker compose ps

# Worker logs
docker compose logs worker -f

# Ollama logs
docker compose logs ollama -f
```

### Worker not ready
```bash
curl http://localhost:37777/api/readiness
# Should return: {"ready":true}
```

### Ollama model not found
```bash
# List available models
docker exec claude-mem-ollama ollama list

# Pull missing model
docker exec claude-mem-ollama ollama pull llama3.2:3b
```

### Chroma connection issues
```bash
# Check Chroma is running
curl http://localhost:8000/api/v1/heartbeat

# View Chroma logs
docker compose logs chroma
```

### Out of memory (Ollama)
Use a smaller model:
```bash
# In .env
CLAUDE_MEM_OLLAMA_MODEL=llama3.2:1b
```

### Reset everything
```bash
docker compose down -v  # Warning: deletes all data!
docker compose --profile ollama up -d
```

---

## Environment Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_MEM_PROVIDER` | `ollama` | AI provider: ollama, openrouter, gemini, claude |
| `CLAUDE_MEM_OLLAMA_URL` | `http://ollama:11434` | Ollama API endpoint |
| `CLAUDE_MEM_OLLAMA_MODEL` | `llama3.2:3b` | Ollama model for compression |
| `CLAUDE_MEM_OPENROUTER_API_KEY` | - | OpenRouter API key |
| `CLAUDE_MEM_OPENROUTER_MODEL` | `google/gemini-2.0-flash-exp:free` | OpenRouter model |
| `CLAUDE_MEM_GEMINI_API_KEY` | - | Google Gemini API key |
| `CLAUDE_MEM_GEMINI_MODEL` | `gemini-2.0-flash-exp` | Gemini model |
| `ANTHROPIC_API_KEY` | - | Anthropic Claude API key |
| `CLAUDE_MEM_WORKER_PORT` | `37777` | Worker HTTP port |
| `CLAUDE_MEM_LOG_LEVEL` | `INFO` | Log level: DEBUG, INFO, WARN, ERROR |
| `CLAUDE_MEM_OLLAMA_MAX_CONTEXT_MESSAGES` | `20` | Max conversation turns |
| `CLAUDE_MEM_OLLAMA_MAX_TOKENS` | `100000` | Max tokens before truncation |

---

## Support

- **Original Project**: [github.com/thedotmack/claude-mem](https://github.com/thedotmack/claude-mem)
- **Documentation**: [docs.claude-mem.ai](https://docs.claude-mem.ai)
- **Issues**: [GitHub Issues](https://github.com/sebastienvg/mem-claude/issues)
- **Discord**: [Join Discord](https://discord.com/invite/J4wttp9vDu)
