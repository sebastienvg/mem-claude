# Observation Quality Controls & Docker MCP Sync

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give users control over observation verbosity/detail, make Chroma search recency configurable, and fix Docker MCP script staleness (issue #30).

**Architecture:** Three independent feature tracks that share the settings infrastructure (`SettingsDefaultsManager`). Each adds a new setting key, reads it at the appropriate layer (prompt builder, search constants, Docker entrypoint), and documents the change. No database migrations required.

**Tech Stack:** TypeScript (Bun runtime), Express HTTP API, ChromaDB, Docker, Mintlify MDX docs.

**Related Issues:**
- https://github.com/sebastienvg/mem-claude/issues/30 (Docker MCP sync)

---

## Phase 1: Observation Verbosity Setting

Controls how detailed the AI observer writes observations. Injected into the mode prompt so the AI knows whether to write terse summaries or rich narratives.

### Task 1: Add CLAUDE_MEM_VERBOSITY to settings

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts`

**Step 1: Write the failing test**

Create test file `tests/settings-verbosity.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';

describe('CLAUDE_MEM_VERBOSITY setting', () => {
  it('should have a default value of standard', () => {
    const defaults = SettingsDefaultsManager.getAllDefaults();
    expect(defaults.CLAUDE_MEM_VERBOSITY).toBe('standard');
  });

  it('should be accessible via get()', () => {
    const value = SettingsDefaultsManager.get('CLAUDE_MEM_VERBOSITY');
    expect(['minimal', 'standard', 'detailed']).toContain(value);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/settings-verbosity.test.ts`
Expected: FAIL — `CLAUDE_MEM_VERBOSITY` not in `SettingsDefaults` type.

**Step 3: Add the setting**

In `src/shared/SettingsDefaultsManager.ts`:

1. Add to `SettingsDefaults` interface (after `CLAUDE_MEM_MODE`):
```typescript
CLAUDE_MEM_VERBOSITY: string;  // 'minimal' | 'standard' | 'detailed'
```

2. Add to `DEFAULTS` object (after `CLAUDE_MEM_MODE` default):
```typescript
CLAUDE_MEM_VERBOSITY: 'standard',
```

**Step 4: Run test to verify it passes**

Run: `bun test tests/settings-verbosity.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts tests/settings-verbosity.test.ts
git commit -m "feat: add CLAUDE_MEM_VERBOSITY setting (default: standard)"
```

---

### Task 2: Inject verbosity into observer prompt

**Files:**
- Modify: `src/sdk/prompts.ts`
- Modify: `src/services/domain/types.ts` (add verbosity to ModeConfig if needed)

The verbosity instruction is appended to the system prompt in `buildInitPrompt()` and `buildContinuationPrompt()`. We read the setting at prompt-build time rather than baking it into the mode JSON, because verbosity is a runtime preference, not a mode-level concept.

**Step 1: Write the failing test**

Create test file `tests/prompts-verbosity.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { buildInitPrompt } from '../src/sdk/prompts.js';
import type { ModeConfig } from '../src/services/domain/types.js';

// Minimal mode config for testing
const mockMode: ModeConfig = {
  name: 'test',
  description: 'test mode',
  version: '1.0.0',
  observation_types: [{ id: 'discovery', label: 'Discovery', description: 'test', emoji: '🔵', work_emoji: '🔍' }],
  observation_concepts: [{ id: 'how-it-works', label: 'How', description: 'test' }],
  prompts: {
    system_identity: 'You are a test observer.',
    spatial_awareness: 'spatial',
    observer_role: 'observer role',
    recording_focus: 'recording focus',
    skip_guidance: 'skip guidance',
    type_guidance: 'type guidance',
    concept_guidance: 'concept guidance',
    field_guidance: 'field guidance',
    output_format_header: 'format header',
    format_examples: '',
    footer: 'footer',
    xml_title_placeholder: '[title]',
    xml_subtitle_placeholder: '[subtitle]',
    xml_fact_placeholder: '[fact]',
    xml_narrative_placeholder: '[narrative]',
    xml_concept_placeholder: '[concept]',
    xml_file_placeholder: '[file]',
    xml_summary_request_placeholder: '[request]',
    xml_summary_investigated_placeholder: '[investigated]',
    xml_summary_learned_placeholder: '[learned]',
    xml_summary_completed_placeholder: '[completed]',
    xml_summary_next_steps_placeholder: '[next]',
    xml_summary_notes_placeholder: '[notes]',
    header_memory_start: 'START',
    header_memory_continued: 'CONTINUED',
    header_summary_checkpoint: 'CHECKPOINT',
    continuation_greeting: 'Hello',
    continuation_instruction: 'Continue',
    summary_instruction: 'Summarize',
    summary_context_label: 'Context:',
    summary_format_instruction: 'Format:',
    summary_footer: 'Thanks',
  }
};

describe('Verbosity in prompts', () => {
  const originalEnv = process.env.CLAUDE_MEM_VERBOSITY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_MEM_VERBOSITY = originalEnv;
    } else {
      delete process.env.CLAUDE_MEM_VERBOSITY;
    }
  });

  it('should include minimal verbosity instruction when set to minimal', () => {
    process.env.CLAUDE_MEM_VERBOSITY = 'minimal';
    const prompt = buildInitPrompt('test-project', 'session-1', 'user request', mockMode);
    expect(prompt).toContain('VERBOSITY: minimal');
    expect(prompt).toContain('1-2 sentence');
  });

  it('should include detailed verbosity instruction when set to detailed', () => {
    process.env.CLAUDE_MEM_VERBOSITY = 'detailed';
    const prompt = buildInitPrompt('test-project', 'session-1', 'user request', mockMode);
    expect(prompt).toContain('VERBOSITY: detailed');
    expect(prompt).toContain('rich context');
  });

  it('should not include verbosity instruction when set to standard', () => {
    process.env.CLAUDE_MEM_VERBOSITY = 'standard';
    const prompt = buildInitPrompt('test-project', 'session-1', 'user request', mockMode);
    expect(prompt).not.toContain('VERBOSITY:');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/prompts-verbosity.test.ts`
Expected: FAIL — no verbosity text in prompt output.

**Step 3: Implement verbosity injection in prompts.ts**

In `src/sdk/prompts.ts`, add a helper function and use it in both `buildInitPrompt` and `buildContinuationPrompt`:

```typescript
import { SettingsDefaultsManager } from '../shared/SettingsDefaultsManager.js';

/**
 * Build verbosity instruction to inject into observer prompt.
 * Returns empty string for 'standard' (no override needed).
 */
function getVerbosityInstruction(): string {
  const verbosity = SettingsDefaultsManager.get('CLAUDE_MEM_VERBOSITY');
  switch (verbosity) {
    case 'minimal':
      return `\nVERBOSITY: minimal
Write 1-2 sentence narratives. Keep facts to 2-3 bullet points max. Skip context that can be inferred from the title. Optimize for token efficiency.\n`;
    case 'detailed':
      return `\nVERBOSITY: detailed
Write rich context in narratives: include rationale, alternatives considered, and implications. Extract 4-6 facts per observation. Capture nuance that would help future sessions understand not just what happened but why.\n`;
    default:
      return ''; // 'standard' = no override, use mode defaults
  }
}
```

In `buildInitPrompt`, insert `${getVerbosityInstruction()}` before `${mode.prompts.footer}`.

In `buildContinuationPrompt`, insert `${getVerbosityInstruction()}` before `${mode.prompts.footer}`.

**Step 4: Run test to verify it passes**

Run: `bun test tests/prompts-verbosity.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: No regressions.

**Step 6: Commit**

```bash
git add src/sdk/prompts.ts tests/prompts-verbosity.test.ts
git commit -m "feat: inject verbosity instruction into observer prompts"
```

---

## Phase 2: Configurable Search Recency Window

The Chroma search recency filter is hardcoded to 90 days. This makes older memories invisible to vector search, which is a problem for long-running projects.

### Task 3: Add CLAUDE_MEM_SEARCH_RECENCY_DAYS setting

**Files:**
- Modify: `src/shared/SettingsDefaultsManager.ts`
- Modify: `src/services/worker/search/types.ts`

**Step 1: Write the failing test**

Create test file `tests/search-recency-setting.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'bun:test';
import { SettingsDefaultsManager } from '../src/shared/SettingsDefaultsManager.js';

describe('CLAUDE_MEM_SEARCH_RECENCY_DAYS setting', () => {
  const originalEnv = process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS = originalEnv;
    } else {
      delete process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;
    }
  });

  it('should default to 90', () => {
    delete process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_SEARCH_RECENCY_DAYS')).toBe('90');
  });

  it('should respect environment variable override', () => {
    process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS = '365';
    expect(SettingsDefaultsManager.get('CLAUDE_MEM_SEARCH_RECENCY_DAYS')).toBe('365');
  });

  it('should be parseable as integer', () => {
    expect(SettingsDefaultsManager.getInt('CLAUDE_MEM_SEARCH_RECENCY_DAYS')).toBe(90);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/search-recency-setting.test.ts`
Expected: FAIL — key not in SettingsDefaults type.

**Step 3: Add the setting and wire it up**

In `src/shared/SettingsDefaultsManager.ts`:
1. Add `CLAUDE_MEM_SEARCH_RECENCY_DAYS: string;` to the interface.
2. Add `CLAUDE_MEM_SEARCH_RECENCY_DAYS: '90',` to DEFAULTS.

In `src/services/worker/search/types.ts`, replace the hardcoded constants:

```typescript
import { SettingsDefaultsManager } from '../../../shared/SettingsDefaultsManager.js';

/**
 * Get search recency values from settings (allows runtime configuration)
 */
function getRecencyDays(): number {
  return SettingsDefaultsManager.getInt('CLAUDE_MEM_SEARCH_RECENCY_DAYS');
}

export const SEARCH_CONSTANTS = {
  get RECENCY_WINDOW_DAYS() { return getRecencyDays(); },
  get RECENCY_WINDOW_MS() { return getRecencyDays() * 24 * 60 * 60 * 1000; },
  DEFAULT_LIMIT: 20,
  CHROMA_BATCH_SIZE: 100
} as const;
```

Note: Using getters ensures the setting is read at query time, not at import time. The `as const` assertion still applies to the literal properties.

**Step 4: Run test to verify it passes**

Run: `bun test tests/search-recency-setting.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `bun test`
Expected: No regressions. Verify `SearchManager` and related files still work (they read from `SEARCH_CONSTANTS` which now uses getters).

**Step 6: Commit**

```bash
git add src/shared/SettingsDefaultsManager.ts src/services/worker/search/types.ts tests/search-recency-setting.test.ts
git commit -m "feat: make search recency window configurable (default: 90 days)"
```

---

## Phase 3: Docker MCP Script Auto-Sync (Issue #30)

When the Docker image is updated, the containerized `mcp-server.cjs` has new tools but the host copy (used by Claude Code) stays stale. Fix: add a volume mount for the MCP script and auto-copy on container startup.

### Task 4: Add MCP script auto-sync to Docker entrypoint

**Files:**
- Modify: `docker-entrypoint.sh`
- Modify: `docker-compose.yml`
- Modify: `docs/public/docker.mdx`

**Step 1: Update docker-entrypoint.sh**

Add MCP script sync after directory initialization, before the main command:

```bash
# Sync MCP server script to host if volume mounted
if [ -d "/host-plugin" ]; then
    echo "Syncing MCP server script to host volume..."
    cp /app/plugin/scripts/mcp-server.cjs /host-plugin/mcp-server.cjs
    echo "MCP script synced. Restart Claude Code to pick up changes."
fi
```

This is a no-op if the volume isn't mounted (backward compatible).

**Step 2: Update docker-compose.yml**

Add the host-plugin volume mount to the worker service:

```yaml
volumes:
  - claude-mem-data:/data
  - ./plugin/scripts:/host-plugin
```

**Step 3: Update docs/public/docker.mdx**

Add a new section after "Updating":

```markdown
## MCP Script Sync

When running Docker with the MCP server on the host, the MCP script must stay
in sync with the container version. Docker Compose handles this automatically.

### Automatic (Docker Compose)

If using the `docker-compose.yml` from this repo, the MCP script is
automatically synced to `./plugin/scripts/mcp-server.cjs` on every container
start. Point your MCP config at this path:

\`\`\`json
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
\`\`\`

### Manual (docker run)

Mount a directory for the MCP script and it will be auto-synced:

\`\`\`bash
docker run -d \
  --name claude-mem \
  -p 37777:37777 \
  -v ~/.claude-mem:/data \
  -v /path/to/mcp-scripts:/host-plugin \
  registry.evthings.space/mem-claude/claude-mem:latest
\`\`\`

Then configure Claude Code to use `/path/to/mcp-scripts/mcp-server.cjs`.

### After updating the Docker image

\`\`\`bash
docker pull registry.evthings.space/mem-claude/claude-mem:latest
docker compose up -d
# MCP script synced automatically on startup
# Restart Claude Code to pick up new tools
\`\`\`
```

**Step 4: Test locally**

```bash
# Build image
docker build -t claude-mem-test .

# Test with volume mount
mkdir -p /tmp/test-mcp
docker run --rm -v /tmp/test-mcp:/host-plugin claude-mem-test echo "test"
ls -la /tmp/test-mcp/mcp-server.cjs
# Expected: file exists

# Test without volume mount (backward compat)
docker run --rm claude-mem-test echo "test"
# Expected: no error, no sync message
```

**Step 5: Commit**

```bash
git add docker-entrypoint.sh docker-compose.yml docs/public/docker.mdx
git commit -m "fix: auto-sync MCP script from Docker container to host (#30)"
```

---

## Phase 4: Documentation & Configuration UI

### Task 5: Update configuration docs

**Files:**
- Modify: `docs/public/configuration.mdx`

**Step 1: Add new settings to configuration docs**

Add to the Core Settings table:

| Setting | Default | Description |
|---------|---------|-------------|
| `CLAUDE_MEM_VERBOSITY` | `standard` | Observation detail level: `minimal`, `standard`, `detailed` |
| `CLAUDE_MEM_SEARCH_RECENCY_DAYS` | `90` | Days of history visible to vector search (0 = unlimited) |

Add a new "Observation Quality" section:

```markdown
## Observation Quality

Control how much detail the AI observer captures per tool execution.

### Verbosity Levels

| Level | Narrative Length | Facts | Best For |
|-------|-----------------|-------|----------|
| `minimal` | 1-2 sentences | 2-3 | Routine coding, low token budget |
| `standard` | 3-5 sentences | 3-5 | General development (default) |
| `detailed` | Full paragraphs | 4-6 | Research, architecture, debugging |

\`\`\`json
{
  "CLAUDE_MEM_VERBOSITY": "detailed"
}
\`\`\`

Changes take effect on the next observation (no worker restart needed).

### Search Recency

By default, vector search only returns results from the last 90 days.
For long-running projects, increase this:

\`\`\`json
{
  "CLAUDE_MEM_SEARCH_RECENCY_DAYS": "365"
}
\`\`\`

Set to `0` to disable the recency filter entirely (search all history).
Requires worker restart.
```

**Step 2: Commit**

```bash
git add docs/public/configuration.mdx
git commit -m "docs: add observation quality and search recency settings"
```

---

### Task 6: Handle SEARCH_RECENCY_DAYS=0 as "unlimited"

**Files:**
- Modify: `src/services/worker/search/types.ts`

**Step 1: Write the failing test**

Add to `tests/search-recency-setting.test.ts`:

```typescript
describe('SEARCH_CONSTANTS with recency=0 (unlimited)', () => {
  afterEach(() => {
    delete process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS;
  });

  it('should return Infinity for RECENCY_WINDOW_MS when set to 0', () => {
    process.env.CLAUDE_MEM_SEARCH_RECENCY_DAYS = '0';
    // Re-import to pick up new env
    const { SEARCH_CONSTANTS } = require('../src/services/worker/search/types.js');
    expect(SEARCH_CONSTANTS.RECENCY_WINDOW_DAYS).toBe(0);
    expect(SEARCH_CONSTANTS.RECENCY_WINDOW_MS).toBe(Infinity);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test tests/search-recency-setting.test.ts`
Expected: FAIL — returns 0 instead of Infinity for MS.

**Step 3: Add the zero-check**

In the getter in `types.ts`:

```typescript
get RECENCY_WINDOW_MS() {
  const days = getRecencyDays();
  return days === 0 ? Infinity : days * 24 * 60 * 60 * 1000;
},
```

This makes `Date.now() - Infinity` evaluate to `-Infinity`, meaning all observations pass the recency filter. No changes needed in `SearchManager` — the existing `epoch > ninetyDaysAgo` comparisons work naturally.

**Step 4: Run test to verify it passes**

Run: `bun test tests/search-recency-setting.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/services/worker/search/types.ts tests/search-recency-setting.test.ts
git commit -m "feat: support SEARCH_RECENCY_DAYS=0 for unlimited search history"
```

---

## Phase 5: Build and verify

### Task 7: Full build and integration test

**Step 1: Build the project**

Run: `npm run build`
Expected: Clean build, no errors.

**Step 2: Run full test suite**

Run: `bun test`
Expected: All tests pass.

**Step 3: Verify settings appear in generated settings.json**

Run: Delete `~/.claude-mem/settings.json` (or use a temp path), start worker, check the auto-generated file contains `CLAUDE_MEM_VERBOSITY` and `CLAUDE_MEM_SEARCH_RECENCY_DAYS`.

**Step 4: Test verbosity injection manually**

Set `CLAUDE_MEM_VERBOSITY=minimal` in environment, trigger a tool use, check worker logs for the prompt containing "VERBOSITY: minimal".

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: address integration test findings"
```

---

## Summary

| Phase | Tasks | Lines Changed (est.) | New Settings |
|-------|-------|---------------------|--------------|
| 1. Verbosity | 1-2 | ~40 | `CLAUDE_MEM_VERBOSITY` |
| 2. Search Recency | 3 | ~20 | `CLAUDE_MEM_SEARCH_RECENCY_DAYS` |
| 3. Docker MCP Sync | 4 | ~30 | (none, infrastructure) |
| 4. Documentation | 5-6 | ~60 | (docs only + zero-check) |
| 5. Integration | 7 | ~10 | (build/verify) |
| **Total** | **7 tasks** | **~160 lines** | **2 new settings** |

### Dependencies

```
Task 1 ──→ Task 2 (verbosity setting must exist before prompt injection)
Task 3 (independent - can run in parallel with Phase 1)
Task 4 (independent - Docker changes)
Task 5 depends on Tasks 1-4 (documents everything)
Task 6 depends on Task 3 (extends recency feature)
Task 7 depends on all above (integration verification)
```
