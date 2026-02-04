# Specification: Hook Integration

## Requirement

Enable hooks to communicate with the worker service regardless of whether it runs natively or in a container.

## Current State

Hooks likely construct worker URL from settings:
```typescript
const host = settings.CLAUDE_MEM_WORKER_HOST || '127.0.0.1';
const port = settings.CLAUDE_MEM_WORKER_PORT || 37777;
const url = `http://${host}:${port}`;
```

This works for native but may need adjustment for containers.

## Target Implementation

### URL Resolution Logic

```typescript
// src/utils/worker-url.ts (or add to existing utility)

export function getWorkerUrl(settings?: Partial<Settings>): string {
  // Explicit URL takes precedence
  if (process.env.CLAUDE_MEM_WORKER_URL) {
    return process.env.CLAUDE_MEM_WORKER_URL;
  }

  // Construct from host/port
  const host = settings?.CLAUDE_MEM_WORKER_HOST
    || process.env.CLAUDE_MEM_WORKER_HOST
    || '127.0.0.1';

  const port = settings?.CLAUDE_MEM_WORKER_PORT
    || process.env.CLAUDE_MEM_WORKER_PORT
    || '37777';

  return `http://${host}:${port}`;
}
```

### Usage in Hooks

```typescript
// In each hook that calls the worker
import { getWorkerUrl } from '../utils/worker-url';

async function callWorker(endpoint: string, data: any): Promise<Response> {
  const baseUrl = getWorkerUrl();
  const url = `${baseUrl}${endpoint}`;

  try {
    return await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      throw new Error(
        `Worker not reachable at ${baseUrl}. ` +
        `Is the worker running? Set CLAUDE_MEM_WORKER_URL to override.`
      );
    }
    throw error;
  }
}
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `CLAUDE_MEM_WORKER_URL` | Full URL to worker | (constructed) |
| `CLAUDE_MEM_WORKER_HOST` | Worker host | `127.0.0.1` |
| `CLAUDE_MEM_WORKER_PORT` | Worker port | `37777` |

### Scenarios

1. **Native worker (default)**:
   - No env vars set → `http://127.0.0.1:37777`

2. **Containerized worker with port forwarding**:
   - Container exposes 37777 → `http://127.0.0.1:37777` (same as native!)

3. **Remote worker**:
   - `CLAUDE_MEM_WORKER_URL=http://192.168.1.100:37777`

4. **Docker for Mac/Windows**:
   - Inside container: `CLAUDE_MEM_WORKER_URL=http://host.docker.internal:37777`

## Test Commands

```bash
# Test URL resolution
node -e "
  process.env.CLAUDE_MEM_WORKER_URL = 'http://custom:8080';
  const { getWorkerUrl } = require('./dist/utils/worker-url');
  console.log(getWorkerUrl());  // Should print http://custom:8080
"

# Integration test with container
docker compose up -d
curl -s http://localhost:37777/api/readiness  # Verify worker accessible
npm run hook:test:session-start               # Test hook communication
docker compose down
```

## Acceptance Criteria

1. `getWorkerUrl()` function exists and is used by all hooks
2. `CLAUDE_MEM_WORKER_URL` environment variable respected
3. Fallback chain: URL → host+port → localhost:37777
4. Error messages include current URL and hint to set override
5. Works with: native, Docker port-forwarded, remote worker
6. No breaking changes for users not using containers
