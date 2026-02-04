# Specification: Chroma HTTP Client Mode

## Requirement

Enable ChromaSync to connect to an external Chroma server via HTTP API, supporting containerized deployments where Chroma runs as a separate service.

## Current State

`ChromaSync.ts` currently:
- Uses MCP SDK's `StdioClientTransport`
- Spawns `uvx chroma-mcp` as a subprocess
- Disabled on Windows (`process.platform === 'win32'`)
- No support for external Chroma servers

```typescript
// Current initialization (simplified)
const transport = new StdioClientTransport({
  command: 'uvx',
  args: ['--python', pythonVersion, 'chroma-mcp'],
});
this.client = new Client({ name: 'claude-mem', version: '1.0.0' }, {});
await this.client.connect(transport);
```

## Target Implementation

### New Settings (SettingsDefaultsManager.ts)

```typescript
// Add to defaults
CLAUDE_MEM_CHROMA_MODE: process.env.CLAUDE_MEM_CHROMA_MODE || 'auto',
// 'auto' = HTTP if URL set, MCP if available, disabled otherwise
// 'mcp' = Force MCP mode
// 'http' = Force HTTP mode
// 'disabled' = No Chroma

CLAUDE_MEM_CHROMA_URL: process.env.CLAUDE_MEM_CHROMA_URL || 'http://localhost:8000',
```

### Updated ChromaSync.ts

```typescript
import { ChromaClient, Collection } from 'chromadb';

export class ChromaSync {
  private mcpClient?: Client;
  private httpClient?: ChromaClient;
  private collection?: Collection;
  private mode: 'mcp' | 'http' | 'disabled';

  async initialize(settings: Settings): Promise<void> {
    this.mode = this.determineMode(settings);

    switch (this.mode) {
      case 'http':
        await this.initializeHttpClient(settings);
        break;
      case 'mcp':
        await this.initializeMcpClient(settings);
        break;
      case 'disabled':
        logger.info('Chroma disabled by configuration');
        break;
    }
  }

  private determineMode(settings: Settings): 'mcp' | 'http' | 'disabled' {
    const configuredMode = settings.CLAUDE_MEM_CHROMA_MODE;

    if (configuredMode === 'disabled') return 'disabled';
    if (configuredMode === 'http') return 'http';
    if (configuredMode === 'mcp') {
      // Check if MCP is available (not Windows)
      if (process.platform === 'win32') {
        logger.warn('MCP mode unavailable on Windows, falling back to disabled');
        return 'disabled';
      }
      return 'mcp';
    }

    // Auto mode: prefer HTTP if URL explicitly set, otherwise MCP
    if (process.env.CLAUDE_MEM_CHROMA_URL) return 'http';
    if (process.platform === 'win32') return 'disabled';
    return 'mcp';
  }

  private async initializeHttpClient(settings: Settings): Promise<void> {
    const url = settings.CLAUDE_MEM_CHROMA_URL;
    logger.info(`Connecting to Chroma via HTTP: ${url}`);

    this.httpClient = new ChromaClient({ path: url });

    // Verify connection
    const heartbeat = await this.httpClient.heartbeat();
    logger.info(`Chroma HTTP connected, heartbeat: ${heartbeat}`);

    // Get or create collection
    this.collection = await this.httpClient.getOrCreateCollection({
      name: 'claude-mem-observations',
      metadata: { 'hnsw:space': 'cosine' },
    });
  }

  async addEmbedding(id: string, text: string, metadata: Record<string, any>): Promise<void> {
    if (this.mode === 'disabled') return;

    if (this.mode === 'http' && this.collection) {
      await this.collection.add({
        ids: [id],
        documents: [text],
        metadatas: [metadata],
      });
    } else if (this.mode === 'mcp' && this.mcpClient) {
      // Existing MCP implementation
      await this.mcpClient.callTool('add_documents', { ... });
    }
  }

  async search(query: string, limit: number = 10): Promise<SearchResult[]> {
    if (this.mode === 'disabled') return [];

    if (this.mode === 'http' && this.collection) {
      const results = await this.collection.query({
        queryTexts: [query],
        nResults: limit,
      });
      return this.formatHttpResults(results);
    } else if (this.mode === 'mcp' && this.mcpClient) {
      // Existing MCP implementation
      return this.formatMcpResults(await this.mcpClient.callTool('query', { ... }));
    }

    return [];
  }
}
```

### Package.json Addition

```json
{
  "dependencies": {
    "chromadb": "^1.8.0"
  }
}
```

## Test Commands

```bash
# Unit test for mode detection
bun test tests/services/ChromaSync.test.ts

# Integration test with HTTP
docker run -d --name chroma-test -p 8000:8000 chromadb/chroma:latest
CLAUDE_MEM_CHROMA_MODE=http npm run test:integration
docker stop chroma-test && docker rm chroma-test

# Verify backward compatibility (MCP mode)
CLAUDE_MEM_CHROMA_MODE=mcp npm run test:integration
```

## Acceptance Criteria

1. `chromadb` package added to dependencies
2. Three modes work: 'mcp', 'http', 'disabled'
3. Auto-detection logic: HTTP if `CHROMA_URL` set, MCP if Unix, disabled if Windows
4. HTTP mode connects to `CLAUDE_MEM_CHROMA_URL`
5. Collection created automatically if missing
6. Search returns consistent format across modes
7. Graceful degradation: if Chroma unavailable, log warning and continue
8. Existing MCP tests still pass
