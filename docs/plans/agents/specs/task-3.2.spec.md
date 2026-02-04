# Task 3.2 Specification: Settings Integration

## Objective

Add configurable settings for new multi-agent and project identity features to the SettingsDefaultsManager.

## New Settings

### Git Remote Settings
- [x] `CLAUDE_MEM_GIT_REMOTE_PREFERENCE`: Comma-separated list of preferred remotes
  - Default: `"origin,upstream"`
  - Type: string
  - Usage: Determines which git remote to use for project identification

### Agent Settings
- [x] `CLAUDE_MEM_AGENT_DEFAULT_VISIBILITY`: Default visibility for new observations
  - Default: `"project"`
  - Type: string (private|department|project|public)
  - Usage: Applied when creating observations without explicit visibility

- [x] `CLAUDE_MEM_AGENT_KEY_EXPIRY_DAYS`: Days until API key expires
  - Default: `"90"`
  - Type: string (number)
  - Usage: Determines expiration date when generating new API keys

- [x] `CLAUDE_MEM_AGENT_LOCKOUT_DURATION`: Lockout duration in seconds after failed attempts
  - Default: `"300"`
  - Type: string (number)
  - Usage: Brute-force protection lockout period

- [x] `CLAUDE_MEM_AGENT_MAX_FAILED_ATTEMPTS`: Max failed auth attempts before lockout
  - Default: `"5"`
  - Type: string (number)
  - Usage: Threshold for triggering lockout

## Validation Requirements

- [x] Visibility must be valid enum value (private|department|project|public)
- [x] Numeric values must parse correctly (fallback to defaults on parse failure)
- [x] Remote preference must be valid comma-separated list (empty segments filtered)

## Helper Functions

- [x] `getGitRemotePreference(settingsPath?)`: Returns string[] of remote names
- [x] `getDefaultVisibility(settingsPath?)`: Returns Visibility enum value
- [x] `getAgentKeyExpiryDays(settingsPath?)`: Returns number of days
- [x] `getLockoutDuration(settingsPath?)`: Returns seconds as number
- [x] `getMaxFailedAttempts(settingsPath?)`: Returns number

## Integration Points

- [x] AgentService uses settings for key expiry, lockout, max attempts
- [x] git-remote.ts uses settings for remote preference

## Test Cases

### Default Values
- [x] Default for GIT_REMOTE_PREFERENCE is "origin,upstream"
- [x] Default for AGENT_DEFAULT_VISIBILITY is "project"
- [x] Default for AGENT_KEY_EXPIRY_DAYS is "90"
- [x] Default for AGENT_LOCKOUT_DURATION is "300"
- [x] Default for AGENT_MAX_FAILED_ATTEMPTS is "5"

### Settings Override
- [x] Custom GIT_REMOTE_PREFERENCE from file works
- [x] Custom AGENT_DEFAULT_VISIBILITY from file works
- [x] Custom AGENT_KEY_EXPIRY_DAYS from file works

### Helper Functions
- [x] Git remote preference parses as array correctly
- [x] Numeric settings parse correctly
- [x] Invalid visibility falls back to 'project'
- [x] Invalid numeric values fall back to defaults

## Files Modified/Created

| File | Action |
|------|--------|
| `src/shared/SettingsDefaultsManager.ts` | Modify - add new settings |
| `src/shared/settings-helpers.ts` | Create - helper functions |
| `tests/shared/settings-new-features.test.ts` | Create - tests |
| `src/services/agents/AgentService.ts` | Modify - use settings |
| `src/utils/git-remote.ts` | Modify - use settings |
| `docs/plans/agents/specs/task-3.2.spec.md` | Create - this file |

## Acceptance Criteria

- [x] All settings have sensible defaults
- [x] All tests pass (29 tests in settings-new-features.test.ts)
- [x] Settings can be overridden via settings file
- [x] Code uses settings instead of hardcoded values
- [x] Helper functions validate and parse correctly

## Implementation Notes

- AgentService now uses `getAgentKeyExpiryDays()`, `getLockoutDuration()`, and `getMaxFailedAttempts()` instead of hardcoded constants
- git-remote.ts now uses `getGitRemotePreference()` when no explicit preference is provided
- All helper functions gracefully handle invalid values by falling back to sensible defaults
