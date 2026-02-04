# Task 1.1 Specification: Git Remote URL Utility

## Requirements

### git-available.ts
- [x] Function `isGitAvailable()` returns boolean
- [x] Caches result after first call (no repeated shell calls)
- [x] Returns `false` gracefully if git not installed
- [x] Has 5 second timeout to prevent hanging
- [x] Function `resetGitAvailableCache()` for testing

### git-remote.ts
- [x] Interface `GitRemote { name: string; url: string }`
- [x] Function `normalizeGitUrl(url: string): string | null`
  - [x] Handles HTTPS GitHub URLs: `https://github.com/user/repo.git` -> `github.com/user/repo`
  - [x] Handles SSH GitHub URLs: `git@github.com:user/repo.git` -> `github.com/user/repo`
  - [x] Handles URLs with ports: `https://github.example.com:8443/org/repo.git` -> `github.example.com/org/repo`
  - [x] Strips `.git` suffix
  - [x] Returns `null` for invalid URLs, empty strings
- [x] Function `parseGitRemotes(output: string): GitRemote[]`
  - [x] Parses `git remote -v` output
  - [x] Only includes fetch URLs (not push)
  - [x] Deduplicates by name
- [x] Function `getPreferredRemote(remotes, preference?): GitRemote | null`
  - [x] Default preference: `['origin', 'upstream']`
  - [x] Falls back to first remote if no preferred found
- [x] Function `getGitRemoteIdentifier(cwd, preference?): string | null`
  - [x] Returns `null` if git not available
  - [x] Returns `null` if no `.git` directory
  - [x] Returns `null` if no remotes configured
  - [x] Uses 5 second timeout on git command

## Test Cases

### git-available.test.ts
- [x] Returns boolean (true if git installed)
- [x] Caches result on second call
- [x] resetGitAvailableCache clears cache

### git-remote.test.ts
- [x] normalizeGitUrl: HTTPS GitHub URL
- [x] normalizeGitUrl: HTTPS GitHub URL without .git
- [x] normalizeGitUrl: SSH GitHub URL
- [x] normalizeGitUrl: GitHub enterprise with port
- [x] normalizeGitUrl: Returns null for invalid URL
- [x] normalizeGitUrl: Returns null for empty string
- [x] parseGitRemotes: Parses git remote -v output correctly
- [x] getPreferredRemote: Prefers origin by default
- [x] getPreferredRemote: Respects custom preference
- [x] getPreferredRemote: Falls back to first remote
- [x] getGitRemoteIdentifier: Returns null for non-git directory
- [x] getGitRemoteIdentifier: Returns normalized remote for current repo (integration)

## Completion Status

**Completed:** 2026-02-03

All requirements and test cases have been implemented and verified.
