import { Database } from 'bun:sqlite';
import { logger } from '../../../utils/logger.js';
import {
  TableColumnInfo,
  IndexInfo,
  TableNameRow,
  SchemaVersion
} from '../../../types/database.js';

/**
 * MigrationRunner handles all database schema migrations
 * Extracted from SessionStore to separate concerns
 */
export class MigrationRunner {
  constructor(private db: Database) {}

  /**
   * Run all migrations in order
   * This is the only public method - all migrations are internal
   */
  runAllMigrations(): void {
    this.initializeSchema();
    this.ensureWorkerPortColumn();
    this.ensurePromptTrackingColumns();
    this.removeSessionSummariesUniqueConstraint();
    this.addObservationHierarchicalFields();
    this.makeObservationsTextNullable();
    this.createUserPromptsTable();
    this.ensureDiscoveryTokensColumn();
    this.createPendingMessagesTable();
    this.renameSessionIdColumns();
    this.repairSessionIdColumnRename();
    this.addFailedAtEpochColumn();
    this.createMultiAgentTables();
    this.createProjectAliasesTable();
    this.addAgentLineageColumns();
    this.addBeadIdColumns();
  }

  /**
   * Initialize database schema using migrations (migration004)
   * This runs the core SDK tables migration if no tables exist
   */
  private initializeSchema(): void {
    // Create schema_versions table if it doesn't exist
    this.db.run(`
      CREATE TABLE IF NOT EXISTS schema_versions (
        id INTEGER PRIMARY KEY,
        version INTEGER UNIQUE NOT NULL,
        applied_at TEXT NOT NULL
      )
    `);

    // Get applied migrations
    const appliedVersions = this.db.prepare('SELECT version FROM schema_versions ORDER BY version').all() as SchemaVersion[];
    const maxApplied = appliedVersions.length > 0 ? Math.max(...appliedVersions.map(v => v.version)) : 0;

    // Only run migration004 if no migrations have been applied
    // This creates the sdk_sessions, observations, and session_summaries tables
    if (maxApplied === 0) {
      logger.info('DB', 'Initializing fresh database with migration004');

      // Migration004: SDK agent architecture tables
      this.db.run(`
        CREATE TABLE IF NOT EXISTS sdk_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          content_session_id TEXT UNIQUE NOT NULL,
          memory_session_id TEXT UNIQUE,
          project TEXT NOT NULL,
          user_prompt TEXT,
          started_at TEXT NOT NULL,
          started_at_epoch INTEGER NOT NULL,
          completed_at TEXT,
          completed_at_epoch INTEGER,
          status TEXT CHECK(status IN ('active', 'completed', 'failed')) NOT NULL DEFAULT 'active'
        );

        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_claude_id ON sdk_sessions(content_session_id);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_sdk_id ON sdk_sessions(memory_session_id);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_project ON sdk_sessions(project);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_status ON sdk_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_sdk_sessions_started ON sdk_sessions(started_at_epoch DESC);

        CREATE TABLE IF NOT EXISTS observations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT NOT NULL,
          project TEXT NOT NULL,
          text TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery')),
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_observations_sdk_session ON observations(memory_session_id);
        CREATE INDEX IF NOT EXISTS idx_observations_project ON observations(project);
        CREATE INDEX IF NOT EXISTS idx_observations_type ON observations(type);
        CREATE INDEX IF NOT EXISTS idx_observations_created ON observations(created_at_epoch DESC);

        CREATE TABLE IF NOT EXISTS session_summaries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          memory_session_id TEXT UNIQUE NOT NULL,
          project TEXT NOT NULL,
          request TEXT,
          investigated TEXT,
          learned TEXT,
          completed TEXT,
          next_steps TEXT,
          files_read TEXT,
          files_edited TEXT,
          notes TEXT,
          created_at TEXT NOT NULL,
          created_at_epoch INTEGER NOT NULL,
          FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
        CREATE INDEX IF NOT EXISTS idx_session_summaries_project ON session_summaries(project);
        CREATE INDEX IF NOT EXISTS idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
      `);

      // Record migration004 as applied
      this.db.prepare('INSERT INTO schema_versions (version, applied_at) VALUES (?, ?)').run(4, new Date().toISOString());

      logger.info('DB', 'Migration004 applied successfully');
    }
  }

  /**
   * Ensure worker_port column exists (migration 5)
   */
  private ensureWorkerPortColumn(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(5) as SchemaVersion | undefined;
    if (applied) return;

    // Check if column exists
    const tableInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasWorkerPort = tableInfo.some(col => col.name === 'worker_port');

    if (!hasWorkerPort) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN worker_port INTEGER');
      logger.debug('DB', 'Added worker_port column to sdk_sessions table');
    }

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(5, new Date().toISOString());
  }

  /**
   * Ensure prompt tracking columns exist (migration 6)
   */
  private ensurePromptTrackingColumns(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(6) as SchemaVersion | undefined;
    if (applied) return;

    // Check sdk_sessions for prompt_counter
    const sessionsInfo = this.db.query('PRAGMA table_info(sdk_sessions)').all() as TableColumnInfo[];
    const hasPromptCounter = sessionsInfo.some(col => col.name === 'prompt_counter');

    if (!hasPromptCounter) {
      this.db.run('ALTER TABLE sdk_sessions ADD COLUMN prompt_counter INTEGER DEFAULT 0');
      logger.debug('DB', 'Added prompt_counter column to sdk_sessions table');
    }

    // Check observations for prompt_number
    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasPromptNumber = observationsInfo.some(col => col.name === 'prompt_number');

    if (!obsHasPromptNumber) {
      this.db.run('ALTER TABLE observations ADD COLUMN prompt_number INTEGER');
      logger.debug('DB', 'Added prompt_number column to observations table');
    }

    // Check session_summaries for prompt_number
    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasPromptNumber = summariesInfo.some(col => col.name === 'prompt_number');

    if (!sumHasPromptNumber) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN prompt_number INTEGER');
      logger.debug('DB', 'Added prompt_number column to session_summaries table');
    }

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(6, new Date().toISOString());
  }

  /**
   * Remove UNIQUE constraint from session_summaries.memory_session_id (migration 7)
   */
  private removeSessionSummariesUniqueConstraint(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(7) as SchemaVersion | undefined;
    if (applied) return;

    // Check if UNIQUE constraint exists
    const summariesIndexes = this.db.query('PRAGMA index_list(session_summaries)').all() as IndexInfo[];
    const hasUniqueConstraint = summariesIndexes.some(idx => idx.unique === 1);

    if (!hasUniqueConstraint) {
      // Already migrated (no constraint exists)
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Removing UNIQUE constraint from session_summaries.memory_session_id');

    // Begin transaction
    this.db.run('BEGIN TRANSACTION');

    // Create new table without UNIQUE constraint
    this.db.run(`
      CREATE TABLE session_summaries_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        request TEXT,
        investigated TEXT,
        learned TEXT,
        completed TEXT,
        next_steps TEXT,
        files_read TEXT,
        files_edited TEXT,
        notes TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `);

    // Copy data from old table
    this.db.run(`
      INSERT INTO session_summaries_new
      SELECT id, memory_session_id, project, request, investigated, learned,
             completed, next_steps, files_read, files_edited, notes,
             prompt_number, created_at, created_at_epoch
      FROM session_summaries
    `);

    // Drop old table
    this.db.run('DROP TABLE session_summaries');

    // Rename new table
    this.db.run('ALTER TABLE session_summaries_new RENAME TO session_summaries');

    // Recreate indexes
    this.db.run(`
      CREATE INDEX idx_session_summaries_sdk_session ON session_summaries(memory_session_id);
      CREATE INDEX idx_session_summaries_project ON session_summaries(project);
      CREATE INDEX idx_session_summaries_created ON session_summaries(created_at_epoch DESC);
    `);

    // Commit transaction
    this.db.run('COMMIT');

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(7, new Date().toISOString());

    logger.debug('DB', 'Successfully removed UNIQUE constraint from session_summaries.memory_session_id');
  }

  /**
   * Add hierarchical fields to observations table (migration 8)
   */
  private addObservationHierarchicalFields(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(8) as SchemaVersion | undefined;
    if (applied) return;

    // Check if new fields already exist
    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const hasTitle = tableInfo.some(col => col.name === 'title');

    if (hasTitle) {
      // Already migrated
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(8, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Adding hierarchical fields to observations table');

    // Add new columns
    this.db.run(`
      ALTER TABLE observations ADD COLUMN title TEXT;
      ALTER TABLE observations ADD COLUMN subtitle TEXT;
      ALTER TABLE observations ADD COLUMN facts TEXT;
      ALTER TABLE observations ADD COLUMN narrative TEXT;
      ALTER TABLE observations ADD COLUMN concepts TEXT;
      ALTER TABLE observations ADD COLUMN files_read TEXT;
      ALTER TABLE observations ADD COLUMN files_modified TEXT;
    `);

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(8, new Date().toISOString());

    logger.debug('DB', 'Successfully added hierarchical fields to observations table');
  }

  /**
   * Make observations.text nullable (migration 9)
   * The text field is deprecated in favor of structured fields (title, subtitle, narrative, etc.)
   */
  private makeObservationsTextNullable(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(9) as SchemaVersion | undefined;
    if (applied) return;

    // Check if text column is already nullable
    const tableInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const textColumn = tableInfo.find(col => col.name === 'text');

    if (!textColumn || textColumn.notnull === 0) {
      // Already migrated or text column doesn't exist
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(9, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Making observations.text nullable');

    // Begin transaction
    this.db.run('BEGIN TRANSACTION');

    // Create new table with text as nullable
    this.db.run(`
      CREATE TABLE observations_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_session_id TEXT NOT NULL,
        project TEXT NOT NULL,
        text TEXT,
        type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change')),
        title TEXT,
        subtitle TEXT,
        facts TEXT,
        narrative TEXT,
        concepts TEXT,
        files_read TEXT,
        files_modified TEXT,
        prompt_number INTEGER,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
      )
    `);

    // Copy data from old table (all existing columns)
    this.db.run(`
      INSERT INTO observations_new
      SELECT id, memory_session_id, project, text, type, title, subtitle, facts,
             narrative, concepts, files_read, files_modified, prompt_number,
             created_at, created_at_epoch
      FROM observations
    `);

    // Drop old table
    this.db.run('DROP TABLE observations');

    // Rename new table
    this.db.run('ALTER TABLE observations_new RENAME TO observations');

    // Recreate indexes
    this.db.run(`
      CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id);
      CREATE INDEX idx_observations_project ON observations(project);
      CREATE INDEX idx_observations_type ON observations(type);
      CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC);
    `);

    // Commit transaction
    this.db.run('COMMIT');

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(9, new Date().toISOString());

    logger.debug('DB', 'Successfully made observations.text nullable');
  }

  /**
   * Create user_prompts table with FTS5 support (migration 10)
   */
  private createUserPromptsTable(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(10) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists
    const tableInfo = this.db.query('PRAGMA table_info(user_prompts)').all() as TableColumnInfo[];
    if (tableInfo.length > 0) {
      // Already migrated
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating user_prompts table with FTS5 support');

    // Begin transaction
    this.db.run('BEGIN TRANSACTION');

    // Create main table (using content_session_id since memory_session_id is set asynchronously by worker)
    this.db.run(`
      CREATE TABLE user_prompts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content_session_id TEXT NOT NULL,
        prompt_number INTEGER NOT NULL,
        prompt_text TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_at_epoch INTEGER NOT NULL,
        FOREIGN KEY(content_session_id) REFERENCES sdk_sessions(content_session_id) ON DELETE CASCADE
      );

      CREATE INDEX idx_user_prompts_claude_session ON user_prompts(content_session_id);
      CREATE INDEX idx_user_prompts_created ON user_prompts(created_at_epoch DESC);
      CREATE INDEX idx_user_prompts_prompt_number ON user_prompts(prompt_number);
      CREATE INDEX idx_user_prompts_lookup ON user_prompts(content_session_id, prompt_number);
    `);

    // Create FTS5 virtual table
    this.db.run(`
      CREATE VIRTUAL TABLE user_prompts_fts USING fts5(
        prompt_text,
        content='user_prompts',
        content_rowid='id'
      );
    `);

    // Create triggers to sync FTS5
    this.db.run(`
      CREATE TRIGGER user_prompts_ai AFTER INSERT ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;

      CREATE TRIGGER user_prompts_ad AFTER DELETE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
      END;

      CREATE TRIGGER user_prompts_au AFTER UPDATE ON user_prompts BEGIN
        INSERT INTO user_prompts_fts(user_prompts_fts, rowid, prompt_text)
        VALUES('delete', old.id, old.prompt_text);
        INSERT INTO user_prompts_fts(rowid, prompt_text)
        VALUES (new.id, new.prompt_text);
      END;
    `);

    // Commit transaction
    this.db.run('COMMIT');

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(10, new Date().toISOString());

    logger.debug('DB', 'Successfully created user_prompts table with FTS5 support');
  }

  /**
   * Ensure discovery_tokens column exists (migration 11)
   * CRITICAL: This migration was incorrectly using version 7 (which was already taken by removeSessionSummariesUniqueConstraint)
   * The duplicate version number may have caused migration tracking issues in some databases
   */
  private ensureDiscoveryTokensColumn(): void {
    // Check if migration already applied to avoid unnecessary re-runs
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(11) as SchemaVersion | undefined;
    if (applied) return;

    // Check if discovery_tokens column exists in observations table
    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasDiscoveryTokens = observationsInfo.some(col => col.name === 'discovery_tokens');

    if (!obsHasDiscoveryTokens) {
      this.db.run('ALTER TABLE observations ADD COLUMN discovery_tokens INTEGER DEFAULT 0');
      logger.debug('DB', 'Added discovery_tokens column to observations table');
    }

    // Check if discovery_tokens column exists in session_summaries table
    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasDiscoveryTokens = summariesInfo.some(col => col.name === 'discovery_tokens');

    if (!sumHasDiscoveryTokens) {
      this.db.run('ALTER TABLE session_summaries ADD COLUMN discovery_tokens INTEGER DEFAULT 0');
      logger.debug('DB', 'Added discovery_tokens column to session_summaries table');
    }

    // Record migration only after successful column verification/addition
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(11, new Date().toISOString());
  }

  /**
   * Create pending_messages table for persistent work queue (migration 16)
   * Messages are persisted before processing and deleted after success.
   * Enables recovery from SDK hangs and worker crashes.
   */
  private createPendingMessagesTable(): void {
    // Check if migration already applied
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(16) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='pending_messages'").all() as TableNameRow[];
    if (tables.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(16, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating pending_messages table');

    this.db.run(`
      CREATE TABLE pending_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_db_id INTEGER NOT NULL,
        content_session_id TEXT NOT NULL,
        message_type TEXT NOT NULL CHECK(message_type IN ('observation', 'summarize')),
        tool_name TEXT,
        tool_input TEXT,
        tool_response TEXT,
        cwd TEXT,
        last_user_message TEXT,
        last_assistant_message TEXT,
        prompt_number INTEGER,
        status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at_epoch INTEGER NOT NULL,
        started_processing_at_epoch INTEGER,
        completed_at_epoch INTEGER,
        FOREIGN KEY (session_db_id) REFERENCES sdk_sessions(id) ON DELETE CASCADE
      )
    `);

    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_session ON pending_messages(session_db_id)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_status ON pending_messages(status)');
    this.db.run('CREATE INDEX IF NOT EXISTS idx_pending_messages_claude_session ON pending_messages(content_session_id)');

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(16, new Date().toISOString());

    logger.debug('DB', 'pending_messages table created successfully');
  }

  /**
   * Rename session ID columns for semantic clarity (migration 17)
   * - claude_session_id -> content_session_id (user's observed session)
   * - sdk_session_id -> memory_session_id (memory agent's session for resume)
   *
   * IDEMPOTENT: Checks each table individually before renaming.
   * This handles databases in any intermediate state (partial migration, fresh install, etc.)
   */
  private renameSessionIdColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(17) as SchemaVersion | undefined;
    if (applied) return;

    logger.debug('DB', 'Checking session ID columns for semantic clarity rename');

    let renamesPerformed = 0;

    // Helper to safely rename a column if it exists
    const safeRenameColumn = (table: string, oldCol: string, newCol: string): boolean => {
      const tableInfo = this.db.query(`PRAGMA table_info(${table})`).all() as TableColumnInfo[];
      const hasOldCol = tableInfo.some(col => col.name === oldCol);
      const hasNewCol = tableInfo.some(col => col.name === newCol);

      if (hasNewCol) {
        // Already renamed, nothing to do
        return false;
      }

      if (hasOldCol) {
        // SQLite 3.25+ supports ALTER TABLE RENAME COLUMN
        this.db.run(`ALTER TABLE ${table} RENAME COLUMN ${oldCol} TO ${newCol}`);
        logger.debug('DB', `Renamed ${table}.${oldCol} to ${newCol}`);
        return true;
      }

      // Neither column exists - table might not exist or has different schema
      logger.warn('DB', `Column ${oldCol} not found in ${table}, skipping rename`);
      return false;
    };

    // Rename in sdk_sessions table
    if (safeRenameColumn('sdk_sessions', 'claude_session_id', 'content_session_id')) renamesPerformed++;
    if (safeRenameColumn('sdk_sessions', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    // Rename in pending_messages table
    if (safeRenameColumn('pending_messages', 'claude_session_id', 'content_session_id')) renamesPerformed++;

    // Rename in observations table
    if (safeRenameColumn('observations', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    // Rename in session_summaries table
    if (safeRenameColumn('session_summaries', 'sdk_session_id', 'memory_session_id')) renamesPerformed++;

    // Rename in user_prompts table
    if (safeRenameColumn('user_prompts', 'claude_session_id', 'content_session_id')) renamesPerformed++;

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(17, new Date().toISOString());

    if (renamesPerformed > 0) {
      logger.debug('DB', `Successfully renamed ${renamesPerformed} session ID columns`);
    } else {
      logger.debug('DB', 'No session ID column renames needed (already up to date)');
    }
  }

  /**
   * Repair session ID column renames (migration 19)
   * DEPRECATED: Migration 17 is now fully idempotent and handles all cases.
   * This migration is kept for backwards compatibility but does nothing.
   */
  private repairSessionIdColumnRename(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(19) as SchemaVersion | undefined;
    if (applied) return;

    // Migration 17 now handles all column rename cases idempotently.
    // Just record this migration as applied.
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(19, new Date().toISOString());
  }

  /**
   * Add failed_at_epoch column to pending_messages (migration 20)
   * Used by markSessionMessagesFailed() for error recovery tracking
   */
  private addFailedAtEpochColumn(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(20) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const hasColumn = tableInfo.some(col => col.name === 'failed_at_epoch');

    if (!hasColumn) {
      this.db.run('ALTER TABLE pending_messages ADD COLUMN failed_at_epoch INTEGER');
      logger.debug('DB', 'Added failed_at_epoch column to pending_messages table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(20, new Date().toISOString());
  }

  /**
   * Create multi-agent architecture tables (migration 21)
   *
   * Key design decisions:
   * - api_key_prefix: First 12 chars of key for O(1) lookup (indexed)
   * - api_key_hash: Full SHA-256 hash for verification (unique)
   * - expires_at_epoch: Optional key expiration (default 90 days)
   * - failed_attempts: Counter for brute-force protection
   * - locked_until_epoch: Temporary lockout after too many failures
   *
   * Also extends observations and session_summaries with agent metadata:
   * - agent: The agent ID that created the record (default 'legacy' for existing data)
   * - department: The department the agent belongs to (default 'default')
   * - visibility: Access control level (private, department, project, public)
   */
  private createMultiAgentTables(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(21) as SchemaVersion | undefined;
    if (applied) {
      // Verify columns actually exist (repair stale version records from old duplicate migration)
      const obsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
      const obsHasAgent = obsInfo.some(col => col.name === 'agent');
      if (obsHasAgent) {
        return; // Properly applied
      }
      // Stale version record — delete it and re-run
      logger.warn('DB', 'Migration 21 recorded but columns missing — repairing');
      this.db.prepare('DELETE FROM schema_versions WHERE version = ?').run(21);
    }

    logger.debug('DB', 'Creating multi-agent architecture tables');

    // Check if agents table already exists
    const agentsTables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='agents'").all() as TableNameRow[];
    if (agentsTables.length === 0) {
      // Create agents table with O(1) key lookup
      this.db.run(`
        CREATE TABLE agents (
          id TEXT PRIMARY KEY,
          department TEXT NOT NULL DEFAULT 'default',
          permissions TEXT NOT NULL DEFAULT 'read,write',
          api_key_prefix TEXT,
          api_key_hash TEXT UNIQUE,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
          last_seen_at TEXT,
          last_seen_at_epoch INTEGER,
          verified INTEGER NOT NULL DEFAULT 0,
          expires_at TEXT,
          expires_at_epoch INTEGER,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until_epoch INTEGER
        )
      `);

      this.db.run('CREATE INDEX idx_agents_department ON agents(department)');
      this.db.run('CREATE INDEX idx_agents_verified ON agents(verified)');
      this.db.run('CREATE INDEX idx_agents_api_key_prefix ON agents(api_key_prefix)');

      logger.debug('DB', 'Created agents table with O(1) key lookup indexes');
    }

    // Check if audit_log table already exists
    const auditTables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='audit_log'").all() as TableNameRow[];
    if (auditTables.length === 0) {
      // Create audit log for security tracking
      this.db.run(`
        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id TEXT NOT NULL,
          action TEXT NOT NULL,
          resource_type TEXT,
          resource_id TEXT,
          details TEXT,
          ip_address TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
      `);

      this.db.run('CREATE INDEX idx_audit_log_agent ON audit_log(agent_id)');
      this.db.run('CREATE INDEX idx_audit_log_action ON audit_log(action)');
      this.db.run('CREATE INDEX idx_audit_log_created ON audit_log(created_at_epoch DESC)');

      logger.debug('DB', 'Created audit_log table');
    }

    // Add agent metadata columns to observations
    // Try table recreation first (for CHECK constraint), fall back to ALTER TABLE if it fails
    const observationsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasAgent = observationsInfo.some(col => col.name === 'agent');

    if (!obsHasAgent) {
      logger.debug('DB', 'Adding agent metadata columns to observations table');

      let tableRecreationSucceeded = false;

      try {
        this.db.run('BEGIN TRANSACTION');

        // Create new observations table with agent metadata and visibility CHECK constraint
        this.db.run(`
          CREATE TABLE observations_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            memory_session_id TEXT NOT NULL,
            project TEXT NOT NULL,
            text TEXT,
            type TEXT NOT NULL CHECK(type IN ('decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change')),
            title TEXT,
            subtitle TEXT,
            facts TEXT,
            narrative TEXT,
            concepts TEXT,
            files_read TEXT,
            files_modified TEXT,
            prompt_number INTEGER,
            discovery_tokens INTEGER DEFAULT 0,
            agent TEXT DEFAULT 'legacy',
            department TEXT DEFAULT 'default',
            visibility TEXT DEFAULT 'project' CHECK(visibility IN ('private', 'department', 'project', 'public')),
            created_at TEXT NOT NULL,
            created_at_epoch INTEGER NOT NULL,
            FOREIGN KEY(memory_session_id) REFERENCES sdk_sessions(memory_session_id) ON DELETE CASCADE
          )
        `);

        // Copy data from old table
        this.db.run(`
          INSERT INTO observations_new (
            id, memory_session_id, project, text, type, title, subtitle, facts,
            narrative, concepts, files_read, files_modified, prompt_number,
            discovery_tokens, created_at, created_at_epoch
          )
          SELECT
            id, memory_session_id, project, text, type, title, subtitle, facts,
            narrative, concepts, files_read, files_modified, prompt_number,
            discovery_tokens, created_at, created_at_epoch
          FROM observations
        `);

        // Drop old table
        this.db.run('DROP TABLE observations');

        // Rename new table
        this.db.run('ALTER TABLE observations_new RENAME TO observations');

        // Recreate all indexes
        this.db.run('CREATE INDEX idx_observations_sdk_session ON observations(memory_session_id)');
        this.db.run('CREATE INDEX idx_observations_project ON observations(project)');
        this.db.run('CREATE INDEX idx_observations_type ON observations(type)');
        this.db.run('CREATE INDEX idx_observations_created ON observations(created_at_epoch DESC)');
        this.db.run('CREATE INDEX idx_observations_agent ON observations(agent)');
        this.db.run('CREATE INDEX idx_observations_department ON observations(department)');
        this.db.run('CREATE INDEX idx_observations_visibility ON observations(visibility)');

        this.db.run('COMMIT');
        tableRecreationSucceeded = true;

        logger.debug('DB', 'Recreated observations table with agent metadata columns');
      } catch (err) {
        // Rollback on failure
        try {
          this.db.run('ROLLBACK');
        } catch {
          // Ignore rollback errors
        }

        // Clean up observations_new if it exists
        try {
          this.db.run('DROP TABLE IF EXISTS observations_new');
        } catch {
          // Ignore cleanup errors
        }

        logger.warn('DB', `Table recreation failed, falling back to ALTER TABLE: ${err}`);
      }

      // Fallback: use ALTER TABLE if table recreation failed
      if (!tableRecreationSucceeded) {
        logger.debug('DB', 'Using ALTER TABLE fallback for observations');

        this.db.run("ALTER TABLE observations ADD COLUMN agent TEXT DEFAULT 'legacy'");
        this.db.run("ALTER TABLE observations ADD COLUMN department TEXT DEFAULT 'default'");
        this.db.run("ALTER TABLE observations ADD COLUMN visibility TEXT DEFAULT 'project'");

        // Create indexes for new columns
        try {
          this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_agent ON observations(agent)');
          this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_department ON observations(department)');
          this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_visibility ON observations(visibility)');
        } catch {
          // Indexes might already exist
        }

        logger.debug('DB', 'Added agent/department/visibility columns via ALTER TABLE');
      }

      // Verify columns were added
      const verifyInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
      const hasAllColumns = ['agent', 'department', 'visibility'].every(
        col => verifyInfo.some(c => c.name === col)
      );

      if (!hasAllColumns) {
        logger.error('DB', 'CRITICAL: Failed to add agent metadata columns to observations table');
        throw new Error('Migration 21 failed: observations table missing required columns');
      }
    }

    // Add agent metadata columns to session_summaries
    const summariesInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
    const sumHasAgent = summariesInfo.some(col => col.name === 'agent');

    if (!sumHasAgent) {
      this.db.run("ALTER TABLE session_summaries ADD COLUMN agent TEXT DEFAULT 'legacy'");
      this.db.run("ALTER TABLE session_summaries ADD COLUMN department TEXT DEFAULT 'default'");
      this.db.run("ALTER TABLE session_summaries ADD COLUMN visibility TEXT DEFAULT 'project'");

      logger.debug('DB', 'Added agent/department/visibility columns to session_summaries table');

      // Verify columns were added
      const verifySumInfo = this.db.query('PRAGMA table_info(session_summaries)').all() as TableColumnInfo[];
      const sumHasAllColumns = ['agent', 'department', 'visibility'].every(
        col => verifySumInfo.some(c => c.name === col)
      );

      if (!sumHasAllColumns) {
        logger.error('DB', 'CRITICAL: Failed to add agent metadata columns to session_summaries table');
        throw new Error('Migration 21 failed: session_summaries table missing required columns');
      }
    }

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(21, new Date().toISOString());

    logger.debug('DB', 'Multi-agent architecture tables created successfully');
  }

  /**
   * Create project_aliases table for migration compatibility (migration 22)
   *
   * Maps old folder-based project names to new git-remote-based identifiers.
   * Enables querying historical data using either format.
   *
   * Key design decisions:
   * - old_project: The folder basename (e.g., 'claude-mem')
   * - new_project: The git remote identifier (e.g., 'github.com/sebastienvg/claude-mem')
   * - UNIQUE(old_project, new_project): Prevents duplicate mappings
   * - Indexes on new_project (reverse lookup) and created_at_epoch (cleanup)
   */
  private createProjectAliasesTable(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(22) as SchemaVersion | undefined;
    if (applied) return;

    // Check if table already exists (idempotent)
    const tables = this.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='project_aliases'").all() as TableNameRow[];
    if (tables.length > 0) {
      this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(22, new Date().toISOString());
      return;
    }

    logger.debug('DB', 'Creating project_aliases table for migration compatibility');

    // Create project_aliases table
    this.db.run(`
      CREATE TABLE IF NOT EXISTS project_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        old_project TEXT NOT NULL,
        new_project TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        created_at_epoch INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
        UNIQUE(old_project, new_project)
      )
    `);

    // Index for looking up aliases when querying by new project
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_aliases_new_project
      ON project_aliases(new_project)
    `);

    // Index for cleanup queries by age
    this.db.run(`
      CREATE INDEX IF NOT EXISTS idx_project_aliases_created_at_epoch
      ON project_aliases(created_at_epoch)
    `);

    // Record migration
    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(22, new Date().toISOString());

    logger.debug('DB', 'project_aliases table created successfully');
  }

  /**
   * Add agent lineage columns to agents table (migration 23)
   *
   * Adds spawned_by, bead_id, and role columns to track which agent
   * spawned another, which bead (task) they're working on, and their role.
   */
  private addAgentLineageColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(23) as SchemaVersion | undefined;
    if (applied) return;

    const tableInfo = this.db.query('PRAGMA table_info(agents)').all() as TableColumnInfo[];
    const hasSpawnedBy = tableInfo.some(col => col.name === 'spawned_by');

    if (!hasSpawnedBy) {
      this.db.run("ALTER TABLE agents ADD COLUMN spawned_by TEXT");
      this.db.run("ALTER TABLE agents ADD COLUMN bead_id TEXT");
      this.db.run("ALTER TABLE agents ADD COLUMN role TEXT");
      this.db.run('CREATE INDEX IF NOT EXISTS idx_agents_spawned_by ON agents(spawned_by)');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_agents_bead_id ON agents(bead_id)');

      logger.debug('DB', 'Added spawned_by, bead_id, role columns to agents table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(23, new Date().toISOString());
  }

  /**
   * Add bead_id column to observations and pending_messages (migration 24)
   *
   * Links observations to the bead/task that produced them.
   * The CURRENT_BEAD env var is set by start-agent.sh when --bead flag is used.
   */
  private addBeadIdColumns(): void {
    const applied = this.db.prepare('SELECT version FROM schema_versions WHERE version = ?').get(24) as SchemaVersion | undefined;
    if (applied) return;

    const obsInfo = this.db.query('PRAGMA table_info(observations)').all() as TableColumnInfo[];
    const obsHasBeadId = obsInfo.some(col => col.name === 'bead_id');

    if (!obsHasBeadId) {
      this.db.run('ALTER TABLE observations ADD COLUMN bead_id TEXT');
      this.db.run('CREATE INDEX IF NOT EXISTS idx_observations_bead_id ON observations(bead_id)');
      logger.debug('DB', 'Added bead_id column to observations table');
    }

    const pendingInfo = this.db.query('PRAGMA table_info(pending_messages)').all() as TableColumnInfo[];
    const pendingHasBeadId = pendingInfo.some(col => col.name === 'bead_id');

    if (!pendingHasBeadId) {
      this.db.run('ALTER TABLE pending_messages ADD COLUMN bead_id TEXT');
      logger.debug('DB', 'Added bead_id column to pending_messages table');
    }

    this.db.prepare('INSERT OR IGNORE INTO schema_versions (version, applied_at) VALUES (?, ?)').run(24, new Date().toISOString());
  }
}
