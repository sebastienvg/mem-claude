# SPEC: Add sender_id to user_prompts (bd-uyv)

## Goal
Track WHO sent each prompt so the viewer displays: `seb@MBP -> davinci: "tell Max to..."`

## Schema Change
- Migration 26: `ALTER TABLE user_prompts ADD COLUMN sender_id TEXT`
- Nullable (existing rows remain NULL, render without errors)

## sender_id Format
- `$USER@$(hostname -s)` — e.g. `seb@MBP`
- Constructed in session-init hook: `${process.env.USER || 'unknown'}@${hostname().split('.')[0]}`

## Data Flow
1. **Hook** (`session-init.ts`) — constructs `sender_id`, adds to POST body
2. **Route** (`SessionRoutes.ts`) — destructures `sender_id` from req.body, passes to store
3. **Store** (`prompts/store.ts`) — INSERT includes `sender_id` column
4. **SessionStore** (`SessionStore.ts`) — wrapper passes `sender_id` through
5. **API** — queries using `up.*` / `p.*` wildcards auto-include new column; explicit-column queries (`getPromptById`, `getPromptsByIds`, `getAllRecentUserPrompts`) need `sender_id` added
6. **Viewer** — PromptCard shows sender badge, types.ts gets `sender_id` field

## Files Changed
1. `src/services/sqlite/migrations/runner.ts` — migration 26
2. `src/cli/handlers/session-init.ts` — construct + send sender_id
3. `src/services/worker/http/routes/SessionRoutes.ts` — pass sender_id through
4. `src/services/sqlite/prompts/store.ts` — INSERT sender_id
5. `src/services/sqlite/SessionStore.ts` — wrapper accepts sender_id
6. `src/ui/viewer/types.ts` — add sender_id to UserPrompt
7. `src/ui/viewer/components/PromptCard.tsx` — render sender badge

## Test Plan
- sender_id stored correctly when provided
- sender_id NULL when omitted (backwards compat)
- sender_id column exists in schema
