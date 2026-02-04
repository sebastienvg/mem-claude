# Task 3.2: Settings Integration

<!-- HANDOFF FROM TASK 3.1 -->
## Context from Previous Agent

Task 3.1 is complete. E2E tests are now in place:

### Test Coverage
- `tests/e2e/project-identity.e2e.test.ts`
  - Git remote detection (3 tests)
  - Alias registration (3 tests)
  - Cross-ID queries (2 tests)
  - Full integration flow (1 test)

- `tests/e2e/multi-agent.e2e.test.ts`
  - Full agent lifecycle (3 tests)
  - Visibility enforcement (5 tests)
  - Combined project identity + multi-agent (2 tests)
  - API integration patterns (3 tests)

All E2E tests passing: 22 tests total

### Key Implementation Notes
- Used ClaudeMemDatabase(':memory:') for in-memory test databases
- Lockout test requires using a key with the same prefix but wrong suffix (prefix-based lookup)
- SessionSearch creates its own DB connection - use raw queries for in-memory test databases

Your task is to add settings for the new features:
- Git remote preference order
- Default visibility level
- Agent key expiry days

Tests passing: `bun test tests/e2e/`
<!-- END HANDOFF -->

**Phase:** 3 - Integration & Testing
**Issue:** #14, #15
**Depends On:** Task 3.1 (E2E tests)
**Next Task:** `task-3.3-documentation.md`

---

## Objective

Add settings for new features to the SettingsDefaultsManager, enabling users to configure git remote preferences, default visibility, and agent key expiration.

---

## Files to Modify/Create

| File | Type |
|------|------|
| `src/shared/SettingsDefaultsManager.ts` | Modify |
| `tests/shared/settings-new-features.test.ts` | Create |
| `docs/plans/agents/specs/task-3.2.spec.md` | Specification |

---

## Step 1: Create Specification

Create `docs/plans/agents/specs/task-3.2.spec.md`:

```markdown
# Task 3.2 Specification: Settings Integration

## New Settings

### Git Remote Settings
- [ ] `CLAUDE_MEM_GIT_REMOTE_PREFERENCE`: Comma-separated list of preferred remotes
  - Default: `"origin,upstream"`
  - Type: string

### Agent Settings
- [ ] `CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY`: Default visibility for new observations
  - Default: `"project"`
  - Type: string (private|department|project|public)
- [ ] `CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS`: Days until API key expires
  - Default: `"90"`
  - Type: string (number)
- [ ] `CLAUDE_MEM_AGENT_LOCKOUT_DURATION`: Lockout duration in seconds after failed attempts
  - Default: `"300"`
  - Type: string (number)
- [ ] `CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS`: Max failed auth attempts before lockout
  - Default: `"5"`
  - Type: string (number)

## Validation
- [ ] Visibility must be valid enum value
- [ ] Numeric values must parse correctly
- [ ] Remote preference must be valid comma-separated list

## Test Cases
- [ ] Default values are correct
- [ ] Values can be overridden via settings file
- [ ] Invalid visibility is rejected or defaults
- [ ] Numeric values parse correctly
```

---

## Step 2: Write Failing Tests

Create `tests/shared/settings-new-features.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';
import { SettingsDefaultsManager } from '../../src/shared/SettingsDefaultsManager.js';

describe('New Feature Settings', () => {
  const testDir = '/tmp/claude-mem-settings-test';
  const settingsPath = path.join(testDir, 'settings.json');

  beforeEach(() => {
    // Clear singleton cache
    (SettingsDefaultsManager as any).cache = null;

    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('Default Values', () => {
    it('should have correct default for GIT_REMOTE_PREFERENCE', () => {
      const defaults = SettingsDefaultsManager.getDefaults();
      expect(defaults.CLAUDE_MEM_GIT_REMOTE_PREFERENCE).toBe('origin,upstream');
    });

    it('should have correct default for AGENT_DEFAULT_VISIBILITY', () => {
      const defaults = SettingsDefaultsManager.getDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY).toBe('project');
    });

    it('should have correct default for AGENT_KEY_EXPIRY_DAYS', () => {
      const defaults = SettingsDefaultsManager.getDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS).toBe('90');
    });

    it('should have correct default for AGENT_LOCKOUT_DURATION', () => {
      const defaults = SettingsDefaultsManager.getDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_LOCKOUT_DURATION).toBe('300');
    });

    it('should have correct default for AGENT_MAX_FAILED_ATTEMPTS', () => {
      const defaults = SettingsDefaultsManager.getDefaults();
      expect(defaults.CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS).toBe('5');
    });
  });

  describe('Settings Override', () => {
    it('should read custom GIT_REMOTE_PREFERENCE from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_GIT_REMOTE_PREFERENCE: 'upstream,origin,fork'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_GIT_REMOTE_PREFERENCE).toBe('upstream,origin,fork');
    });

    it('should read custom AGENT_DEFAULT_VISIBILITY from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: 'department'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY).toBe('department');
    });

    it('should read custom AGENT_KEY_EXPIRY_DAYS from file', () => {
      writeFileSync(settingsPath, JSON.stringify({
        CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: '30'
      }));

      const settings = SettingsDefaultsManager.loadFromFile(settingsPath);
      expect(settings.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS).toBe('30');
    });
  });

  describe('Parsing Helpers', () => {
    it('should parse git remote preference as array', () => {
      const pref = 'upstream,origin,fork';
      const parsed = pref.split(',').map(s => s.trim());
      expect(parsed).toEqual(['upstream', 'origin', 'fork']);
    });

    it('should parse numeric settings correctly', () => {
      const expiryDays = parseInt('30', 10);
      const lockoutDuration = parseInt('600', 10);
      const maxAttempts = parseInt('10', 10);

      expect(expiryDays).toBe(30);
      expect(lockoutDuration).toBe(600);
      expect(maxAttempts).toBe(10);
    });
  });
});
```

---

## Step 3: Update SettingsDefaultsManager

Modify `src/shared/SettingsDefaultsManager.ts`:

```typescript
// Add to the interface
export interface Settings {
  // ... existing settings ...

  // Git Remote Settings
  CLAUDE_MEM_GIT_REMOTE_PREFERENCE: string;

  // Agent Settings
  CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: string;
  CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: string;
  CLAUDE_MEM_AGENT_LOCKOUT_DURATION: string;
  CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS: string;
}

// Add to defaults
const DEFAULT_SETTINGS: Settings = {
  // ... existing defaults ...

  // Git Remote Settings
  CLAUDE_MEM_GIT_REMOTE_PREFERENCE: 'origin,upstream',

  // Agent Settings
  CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: 'project',
  CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: '90',
  CLAUDE_MEM_AGENT_LOCKOUT_DURATION: '300',
  CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS: '5',
};
```

---

## Step 4: Create Settings Helpers

Add helper functions for parsing settings:

```typescript
// src/shared/settings-helpers.ts

import { SettingsDefaultsManager } from './SettingsDefaultsManager.js';

/**
 * Get git remote preference as array.
 */
export function getGitRemotePreference(settingsPath?: string): string[] {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getDefaults();

  return settings.CLAUDE_MEM_GIT_REMOTE_PREFERENCE
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Get default visibility for observations.
 */
export function getDefaultVisibility(settingsPath?: string): 'private' | 'department' | 'project' | 'public' {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getDefaults();

  const value = settings.CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY;
  const valid = ['private', 'department', 'project', 'public'];

  if (valid.includes(value)) {
    return value as any;
  }

  return 'project'; // Fallback
}

/**
 * Get agent key expiry in days.
 */
export function getAgentKeyExpiryDays(settingsPath?: string): number {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getDefaults();

  const parsed = parseInt(settings.CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS, 10);
  return isNaN(parsed) ? 90 : parsed;
}

/**
 * Get lockout duration in seconds.
 */
export function getLockoutDuration(settingsPath?: string): number {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getDefaults();

  const parsed = parseInt(settings.CLAUDE_MEM_AGENT_LOCKOUT_DURATION, 10);
  return isNaN(parsed) ? 300 : parsed;
}

/**
 * Get max failed attempts before lockout.
 */
export function getMaxFailedAttempts(settingsPath?: string): number {
  const settings = settingsPath
    ? SettingsDefaultsManager.loadFromFile(settingsPath)
    : SettingsDefaultsManager.getDefaults();

  const parsed = parseInt(settings.CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS, 10);
  return isNaN(parsed) ? 5 : parsed;
}
```

---

## Step 5: Update Code to Use Settings

Update `AgentService` to use settings:

```typescript
// In AgentService constructor or initialization
import { getAgentKeyExpiryDays, getLockoutDuration, getMaxFailedAttempts } from '../../shared/settings-helpers.js';

// Use in registerAgent:
const expiryDays = getAgentKeyExpiryDays();

// Use in findAgentByKey:
const maxAttempts = getMaxFailedAttempts();
const lockoutSeconds = getLockoutDuration();
```

Update git remote to use settings:

```typescript
// In getGitRemoteIdentifier
import { getGitRemotePreference } from '../../shared/settings-helpers.js';

const preference = remotePreference ?? getGitRemotePreference();
```

---

## Step 6: Run Tests

```bash
bun test tests/shared/settings-new-features.test.ts
```

---

## Step 7: Verify Spec Compliance

Check all boxes in `docs/plans/agents/specs/task-3.2.spec.md`.

---

## Step 8: Commit

```bash
git add src/shared/SettingsDefaultsManager.ts \
        src/shared/settings-helpers.ts \
        tests/shared/settings-new-features.test.ts \
        docs/plans/agents/specs/task-3.2.spec.md
git commit -m "feat: add settings for git remote preference and agent configuration

New settings:
- CLAUDE_MEM_GIT_REMOTE_PREFERENCE: Remote priority order
- CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY: Default observation visibility
- CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS: API key expiration
- CLAUDE_MEM_AGENT_LOCKOUT_DURATION: Brute-force lockout time
- CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS: Attempts before lockout

Part of #14, #15"
```

---

## Handoff

When complete, add a comment to the next task file:

**File:** `docs/plans/agents/task-3.3-documentation.md`

**Comment to add at top:**

```markdown
<!-- HANDOFF FROM TASK 3.2 -->
## Context from Previous Agent

Task 3.2 is complete. Settings are now configurable:

### New Settings in ~/.claude-mem/settings.json

```json
{
  "CLAUDE_MEM_GIT_REMOTE_PREFERENCE": "origin,upstream",
  "CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY": "project",
  "CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS": "90",
  "CLAUDE_MEM_AGENT_LOCKOUT_DURATION": "300",
  "CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS": "5"
}
```

### Helper Functions
- `getGitRemotePreference()`: Returns string[]
- `getDefaultVisibility()`: Returns visibility enum
- `getAgentKeyExpiryDays()`: Returns number
- `getLockoutDuration()`: Returns seconds
- `getMaxFailedAttempts()`: Returns number

Your task is to update documentation for these new features.

Tests passing: `bun test tests/shared/settings-new-features.test.ts`
<!-- END HANDOFF -->
```

---

## Acceptance Criteria

- [ ] All spec items checked
- [ ] All tests pass
- [ ] Settings have sensible defaults
- [ ] Code uses settings instead of hardcoded values
- [ ] Code committed
- [ ] Handoff comment added to task-3.3
