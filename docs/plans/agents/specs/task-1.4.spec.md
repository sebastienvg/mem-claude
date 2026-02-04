# Task 1.4 Specification: Project Alias Resolution Service

## Constants

- [x] MAX_ALIASES_IN_QUERY = 100 (hard cap to avoid SQLite 999 parameter limit)

## Functions

### registerProjectAlias(db, oldProject, newProject)
- [x] Inserts new alias mapping
- [x] Uses INSERT OR IGNORE to handle duplicates gracefully
- [x] Returns boolean indicating if new alias was created
- [x] Skips registration if oldProject equals newProject
- [x] Logs alias registration

### getProjectsWithAliases(db, project)
- [x] Returns array starting with the input project
- [x] Appends all old_project aliases for the project
- [x] Limited to MAX_ALIASES_IN_QUERY aliases
- [x] Logs warning if limit is exceeded
- [x] Returns at least [project] even if no aliases

### getAliasCount(db, project)
- [x] Returns total count of aliases for a project
- [x] Used to check if limit was exceeded

### cleanupOldAliases(db, olderThanDays = 365)
- [x] Deletes aliases older than specified days
- [x] Returns number of deleted rows
- [x] Logs cleanup result

## Test Cases

### project-alias-resolution.test.ts
- [x] registerProjectAlias: Creates new alias
- [x] registerProjectAlias: Ignores duplicate gracefully
- [x] registerProjectAlias: Returns false when old equals new
- [x] getProjectsWithAliases: Returns project + aliases
- [x] getProjectsWithAliases: Returns only project when no aliases
- [x] getProjectsWithAliases: Respects MAX_ALIASES_IN_QUERY limit
- [x] getAliasCount: Returns correct count
- [x] getAliasCount: Returns 0 for project without aliases
- [x] cleanupOldAliases: Deletes old aliases
- [x] cleanupOldAliases: Keeps recent aliases
