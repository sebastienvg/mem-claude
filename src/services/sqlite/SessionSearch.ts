import { Database } from 'bun:sqlite';
import { TableNameRow } from '../../types/database.js';
import { DATA_DIR, DB_PATH, ensureDir } from '../../shared/paths.js';
import { logger } from '../../utils/logger.js';
import { isDirectChild } from '../../shared/path-utils.js';
import {
  ObservationSearchResult,
  SessionSummarySearchResult,
  UserPromptSearchResult,
  SearchOptions,
  SearchFilters,
  DateRange,
  ObservationRow,
  UserPromptRow,
  VisibilityFilterOptions
} from './types.js';
import { getProjectsWithAliases } from './project-aliases.js';

/**
 * Search interface for session-based memory
 * Provides filter-only structured queries for sessions, observations, and user prompts
 * Vector search is handled by ChromaDB - this class only supports filtering without query text
 */
export class SessionSearch {
  private db: Database;

  constructor(dbPath?: string) {
    if (!dbPath) {
      ensureDir(DATA_DIR);
      dbPath = DB_PATH;
    }
    this.db = new Database(dbPath);
    this.db.run('PRAGMA journal_mode = WAL');

    // Ensure FTS tables exist
    this.ensureFTSTables();
  }

  /**
   * Ensure FTS5 tables exist (backward compatibility only - no longer used for search)
   *
   * FTS5 tables are maintained for backward compatibility but not used for search.
   * Vector search (Chroma) is now the primary search mechanism.
   *
   * Retention Rationale:
   * - Prevents breaking existing installations with FTS5 tables
   * - Allows graceful migration path for users
   * - Tables maintained but search paths removed
   * - Triggers still fire to keep tables synchronized
   *
   * TODO: Remove FTS5 infrastructure in future major version (v7.0.0)
   */
  private ensureFTSTables(): void {
    // Check if FTS tables already exist
    const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'").all() as TableNameRow[];
    const hasFTS = tables.some(t => t.name === 'observations_fts' || t.name === 'session_summaries_fts');

    if (hasFTS) {
      // Already migrated
      return;
    }

    logger.info('DB', 'Creating FTS5 tables');

    // Create observations_fts virtual table
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS observations_fts USING fts5(
        title,
        subtitle,
        narrative,
        text,
        facts,
        concepts,
        content='observations',
        content_rowid='id'
      );
    `);

    // Populate with existing data
    this.db.run(`
      INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
      SELECT id, title, subtitle, narrative, text, facts, concepts
      FROM observations;
    `);

    // Create triggers for observations
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS observations_ai AFTER INSERT ON observations BEGIN
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_ad AFTER DELETE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
      END;

      CREATE TRIGGER IF NOT EXISTS observations_au AFTER UPDATE ON observations BEGIN
        INSERT INTO observations_fts(observations_fts, rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES('delete', old.id, old.title, old.subtitle, old.narrative, old.text, old.facts, old.concepts);
        INSERT INTO observations_fts(rowid, title, subtitle, narrative, text, facts, concepts)
        VALUES (new.id, new.title, new.subtitle, new.narrative, new.text, new.facts, new.concepts);
      END;
    `);

    // Create session_summaries_fts virtual table
    this.db.run(`
      CREATE VIRTUAL TABLE IF NOT EXISTS session_summaries_fts USING fts5(
        request,
        investigated,
        learned,
        completed,
        next_steps,
        notes,
        content='session_summaries',
        content_rowid='id'
      );
    `);

    // Populate with existing data
    this.db.run(`
      INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
      SELECT id, request, investigated, learned, completed, next_steps, notes
      FROM session_summaries;
    `);

    // Create triggers for session_summaries
    this.db.run(`
      CREATE TRIGGER IF NOT EXISTS session_summaries_ai AFTER INSERT ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_ad AFTER DELETE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS session_summaries_au AFTER UPDATE ON session_summaries BEGIN
        INSERT INTO session_summaries_fts(session_summaries_fts, rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES('delete', old.id, old.request, old.investigated, old.learned, old.completed, old.next_steps, old.notes);
        INSERT INTO session_summaries_fts(rowid, request, investigated, learned, completed, next_steps, notes)
        VALUES (new.id, new.request, new.investigated, new.learned, new.completed, new.next_steps, new.notes);
      END;
    `);

    logger.info('DB', 'FTS5 tables created successfully');
  }


  /**
   * Build visibility filter clause for multi-agent access control
   *
   * Visibility levels:
   * - public: Everyone can see
   * - project: Currently = public (no project ACLs yet)
   * - department: Same department only
   * - private: Owner only
   *
   * IMPORTANT: visibility = 'project' currently means "visible to everyone".
   * If project-level ACLs are added in future, this filter must be updated
   * to check project membership.
   *
   * @param visibility - Visibility filter options (agentId and agentDepartment)
   * @param params - Array to push parameters to
   * @param tableAlias - Table alias (default 'o')
   * @returns SQL condition string for visibility filtering
   */
  private buildVisibilityClause(
    visibility: VisibilityFilterOptions | undefined,
    params: any[],
    tableAlias: string = 'o'
  ): string {
    // If no visibility options provided (legacy mode), filter to public/project only
    if (!visibility || !visibility.agentId) {
      return `${tableAlias}.visibility IN ('public', 'project')`;
    }

    const { agentId, agentDepartment } = visibility;

    // If we have an agent ID but no department, we can only do agent-level filtering
    // and must fall back to public/project for department visibility
    if (!agentDepartment) {
      params.push(agentId);
      return `(
        ${tableAlias}.visibility IN ('public', 'project')
        OR (${tableAlias}.visibility = 'private' AND ${tableAlias}.agent = ?)
      )`;
    }

    // Full visibility filtering with department
    // - public and project: everyone can see
    // - department: same department only
    // - private: owner only
    params.push(agentDepartment, agentId);
    return `(
      ${tableAlias}.visibility IN ('public', 'project')
      OR (${tableAlias}.visibility = 'department' AND ${tableAlias}.department = ?)
      OR (${tableAlias}.visibility = 'private' AND ${tableAlias}.agent = ?)
    )`;
  }

  /**
   * Build WHERE clause for structured filters (includes project alias expansion and visibility)
   */
  private buildFilterClause(
    filters: SearchFilters,
    params: any[],
    tableAlias: string = 'o',
    visibility?: VisibilityFilterOptions
  ): string {
    const conditions: string[] = [];

    // Project filter (with alias expansion)
    if (filters.project) {
      const projects = getProjectsWithAliases(this.db, filters.project);
      const placeholders = projects.map(() => '?').join(', ');
      conditions.push(`${tableAlias}.project IN (${placeholders})`);
      params.push(...projects);
    }

    // Visibility filter for multi-agent access control
    const visibilityClause = this.buildVisibilityClause(visibility, params, tableAlias);
    conditions.push(visibilityClause);

    // Type filter (for observations only)
    if (filters.type) {
      if (Array.isArray(filters.type)) {
        const placeholders = filters.type.map(() => '?').join(',');
        conditions.push(`${tableAlias}.type IN (${placeholders})`);
        params.push(...filters.type);
      } else {
        conditions.push(`${tableAlias}.type = ?`);
        params.push(filters.type);
      }
    }

    // Date range filter
    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      if (start) {
        const startEpoch = typeof start === 'number' ? start : new Date(start).getTime();
        conditions.push(`${tableAlias}.created_at_epoch >= ?`);
        params.push(startEpoch);
      }
      if (end) {
        const endEpoch = typeof end === 'number' ? end : new Date(end).getTime();
        conditions.push(`${tableAlias}.created_at_epoch <= ?`);
        params.push(endEpoch);
      }
    }

    // Concepts filter (JSON array search)
    if (filters.concepts) {
      const concepts = Array.isArray(filters.concepts) ? filters.concepts : [filters.concepts];
      const conceptConditions = concepts.map(() => {
        return `EXISTS (SELECT 1 FROM json_each(${tableAlias}.concepts) WHERE value = ?)`;
      });
      if (conceptConditions.length > 0) {
        conditions.push(`(${conceptConditions.join(' OR ')})`);
        params.push(...concepts);
      }
    }

    // Files filter (JSON array search)
    if (filters.files) {
      const files = Array.isArray(filters.files) ? filters.files : [filters.files];
      const fileConditions = files.map(() => {
        return `(
          EXISTS (SELECT 1 FROM json_each(${tableAlias}.files_read) WHERE value LIKE ?)
          OR EXISTS (SELECT 1 FROM json_each(${tableAlias}.files_modified) WHERE value LIKE ?)
        )`;
      });
      if (fileConditions.length > 0) {
        conditions.push(`(${fileConditions.join(' OR ')})`);
        files.forEach(file => {
          params.push(`%${file}%`, `%${file}%`);
        });
      }
    }

    return conditions.length > 0 ? conditions.join(' AND ') : '';
  }

  /**
   * Build ORDER BY clause
   */
  private buildOrderClause(orderBy: SearchOptions['orderBy'] = 'relevance', hasFTS: boolean = true, ftsTable: string = 'observations_fts'): string {
    switch (orderBy) {
      case 'relevance':
        return hasFTS ? `ORDER BY ${ftsTable}.rank ASC` : 'ORDER BY o.created_at_epoch DESC';
      case 'date_desc':
        return 'ORDER BY o.created_at_epoch DESC';
      case 'date_asc':
        return 'ORDER BY o.created_at_epoch ASC';
      default:
        return 'ORDER BY o.created_at_epoch DESC';
    }
  }

  /**
   * Search observations using filter-only direct SQLite query.
   * Vector search is handled by ChromaDB - this only supports filtering without query text.
   * Supports visibility filtering when options.visibility is provided.
   */
  searchObservations(query: string | undefined, options: SearchOptions = {}): ObservationSearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'relevance', visibility, ...filters } = options;

    // FILTER-ONLY PATH: When no query text, query table directly
    // This enables date filtering which Chroma cannot do (requires direct SQLite access)
    if (!query) {
      const filterClause = this.buildFilterClause(filters, params, 'o', visibility);
      if (!filterClause) {
        throw new Error('Either query or filters required for search');
      }

      const orderClause = this.buildOrderClause(orderBy, false);

      const sql = `
        SELECT o.*, o.discovery_tokens
        FROM observations o
        WHERE ${filterClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
    }

    // Vector search with query text should be handled by ChromaDB
    // This method only supports filter-only queries (query=undefined)
    logger.warn('DB', 'Text search not supported - use ChromaDB for vector search');
    return [];
  }

  /**
   * Search session summaries using filter-only direct SQLite query.
   * Vector search is handled by ChromaDB - this only supports filtering without query text.
   * Supports visibility filtering when options.visibility is provided.
   */
  searchSessions(query: string | undefined, options: SearchOptions = {}): SessionSummarySearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'relevance', visibility, ...filters } = options;

    // FILTER-ONLY PATH: When no query text, query session_summaries table directly
    if (!query) {
      const filterOptions = { ...filters };
      delete filterOptions.type;
      const filterClause = this.buildFilterClause(filterOptions, params, 's', visibility);
      if (!filterClause) {
        throw new Error('Either query or filters required for search');
      }

      const orderClause = orderBy === 'date_asc'
        ? 'ORDER BY s.created_at_epoch ASC'
        : 'ORDER BY s.created_at_epoch DESC';

      const sql = `
        SELECT s.*, s.discovery_tokens
        FROM session_summaries s
        WHERE ${filterClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      return this.db.prepare(sql).all(...params) as SessionSummarySearchResult[];
    }

    // Vector search with query text should be handled by ChromaDB
    // This method only supports filter-only queries (query=undefined)
    logger.warn('DB', 'Text search not supported - use ChromaDB for vector search');
    return [];
  }

  /**
   * Find observations by concept tag
   * Supports visibility filtering when options.visibility is provided.
   */
  findByConcept(concept: string, options: SearchOptions = {}): ObservationSearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'date_desc', visibility, ...filters } = options;

    // Add concept to filters
    const conceptFilters = { ...filters, concepts: concept };
    const filterClause = this.buildFilterClause(conceptFilters, params, 'o', visibility);
    const orderClause = this.buildOrderClause(orderBy, false);

    const sql = `
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${filterClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
  }

  /**
   * Check if an observation has any files that are direct children of the folder
   */
  private hasDirectChildFile(obs: ObservationSearchResult, folderPath: string): boolean {
    const checkFiles = (filesJson: string | null): boolean => {
      if (!filesJson) return false;
      try {
        const files = JSON.parse(filesJson);
        if (Array.isArray(files)) {
          return files.some(f => isDirectChild(f, folderPath));
        }
      } catch {}
      return false;
    };

    return checkFiles(obs.files_modified) || checkFiles(obs.files_read);
  }

  /**
   * Check if a session has any files that are direct children of the folder
   */
  private hasDirectChildFileSession(session: SessionSummarySearchResult, folderPath: string): boolean {
    const checkFiles = (filesJson: string | null): boolean => {
      if (!filesJson) return false;
      try {
        const files = JSON.parse(filesJson);
        if (Array.isArray(files)) {
          return files.some(f => isDirectChild(f, folderPath));
        }
      } catch {}
      return false;
    };

    return checkFiles(session.files_read) || checkFiles(session.files_edited);
  }

  /**
   * Find observations and summaries by file path
   * When isFolder=true, only returns results with files directly in the folder (not subfolders)
   * Supports visibility filtering when options.visibility is provided.
   */
  findByFile(filePath: string, options: SearchOptions = {}): {
    observations: ObservationSearchResult[];
    sessions: SessionSummarySearchResult[];
  } {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'date_desc', isFolder = false, visibility, ...filters } = options;

    // Query more results if we're filtering to direct children
    const queryLimit = isFolder ? limit * 3 : limit;

    // Add file to filters
    const fileFilters = { ...filters, files: filePath };
    const filterClause = this.buildFilterClause(fileFilters, params, 'o', visibility);
    const orderClause = this.buildOrderClause(orderBy, false);

    const observationsSql = `
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${filterClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(queryLimit, offset);

    let observations = this.db.prepare(observationsSql).all(...params) as ObservationSearchResult[];

    // Post-filter to direct children if isFolder mode
    if (isFolder) {
      observations = observations.filter(obs => this.hasDirectChildFile(obs, filePath)).slice(0, limit);
    }

    // For session summaries, search files_read and files_edited
    const sessionParams: any[] = [];
    const sessionFilters = { ...filters };
    delete sessionFilters.type; // Remove type filter for sessions

    const baseConditions: string[] = [];
    if (sessionFilters.project) {
      const sessionProjects = getProjectsWithAliases(this.db, sessionFilters.project);
      const sessionPlaceholders = sessionProjects.map(() => '?').join(', ');
      baseConditions.push(`s.project IN (${sessionPlaceholders})`);
      sessionParams.push(...sessionProjects);
    }

    // Visibility filter for sessions
    const sessionVisibilityClause = this.buildVisibilityClause(visibility, sessionParams, 's');
    baseConditions.push(sessionVisibilityClause);

    if (sessionFilters.dateRange) {
      const { start, end } = sessionFilters.dateRange;
      if (start) {
        const startEpoch = typeof start === 'number' ? start : new Date(start).getTime();
        baseConditions.push('s.created_at_epoch >= ?');
        sessionParams.push(startEpoch);
      }
      if (end) {
        const endEpoch = typeof end === 'number' ? end : new Date(end).getTime();
        baseConditions.push('s.created_at_epoch <= ?');
        sessionParams.push(endEpoch);
      }
    }

    // File condition
    baseConditions.push(`(
      EXISTS (SELECT 1 FROM json_each(s.files_read) WHERE value LIKE ?)
      OR EXISTS (SELECT 1 FROM json_each(s.files_edited) WHERE value LIKE ?)
    )`);
    sessionParams.push(`%${filePath}%`, `%${filePath}%`);

    const sessionsSql = `
      SELECT s.*, s.discovery_tokens
      FROM session_summaries s
      WHERE ${baseConditions.join(' AND ')}
      ORDER BY s.created_at_epoch DESC
      LIMIT ? OFFSET ?
    `;

    sessionParams.push(queryLimit, offset);

    let sessions = this.db.prepare(sessionsSql).all(...sessionParams) as SessionSummarySearchResult[];

    // Post-filter to direct children if isFolder mode
    if (isFolder) {
      sessions = sessions.filter(s => this.hasDirectChildFileSession(s, filePath)).slice(0, limit);
    }

    return { observations, sessions };
  }

  /**
   * Find observations by type
   * Supports visibility filtering when options.visibility is provided.
   */
  findByType(
    type: ObservationRow['type'] | ObservationRow['type'][],
    options: SearchOptions = {}
  ): ObservationSearchResult[] {
    const params: any[] = [];
    const { limit = 50, offset = 0, orderBy = 'date_desc', visibility, ...filters } = options;

    // Add type to filters
    const typeFilters = { ...filters, type };
    const filterClause = this.buildFilterClause(typeFilters, params, 'o', visibility);
    const orderClause = this.buildOrderClause(orderBy, false);

    const sql = `
      SELECT o.*, o.discovery_tokens
      FROM observations o
      WHERE ${filterClause}
      ${orderClause}
      LIMIT ? OFFSET ?
    `;

    params.push(limit, offset);

    return this.db.prepare(sql).all(...params) as ObservationSearchResult[];
  }

  /**
   * Search user prompts using filter-only direct SQLite query.
   * Vector search is handled by ChromaDB - this only supports filtering without query text.
   */
  searchUserPrompts(query: string | undefined, options: SearchOptions = {}): UserPromptSearchResult[] {
    const params: any[] = [];
    const { limit = 20, offset = 0, orderBy = 'relevance', ...filters } = options;

    // Build filter conditions (join with sdk_sessions for project filtering)
    const baseConditions: string[] = [];
    if (filters.project) {
      const projects = getProjectsWithAliases(this.db, filters.project);
      const placeholders = projects.map(() => '?').join(', ');
      baseConditions.push(`s.project IN (${placeholders})`);
      params.push(...projects);
    }

    if (filters.dateRange) {
      const { start, end } = filters.dateRange;
      if (start) {
        const startEpoch = typeof start === 'number' ? start : new Date(start).getTime();
        baseConditions.push('up.created_at_epoch >= ?');
        params.push(startEpoch);
      }
      if (end) {
        const endEpoch = typeof end === 'number' ? end : new Date(end).getTime();
        baseConditions.push('up.created_at_epoch <= ?');
        params.push(endEpoch);
      }
    }

    // FILTER-ONLY PATH: When no query text, query user_prompts table directly
    if (!query) {
      if (baseConditions.length === 0) {
        throw new Error('Either query or filters required for search');
      }

      const whereClause = `WHERE ${baseConditions.join(' AND ')}`;
      const orderClause = orderBy === 'date_asc'
        ? 'ORDER BY up.created_at_epoch ASC'
        : 'ORDER BY up.created_at_epoch DESC';

      const sql = `
        SELECT up.*
        FROM user_prompts up
        JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
        ${whereClause}
        ${orderClause}
        LIMIT ? OFFSET ?
      `;

      params.push(limit, offset);
      return this.db.prepare(sql).all(...params) as UserPromptSearchResult[];
    }

    // Vector search with query text should be handled by ChromaDB
    // This method only supports filter-only queries (query=undefined)
    logger.warn('DB', 'Text search not supported - use ChromaDB for vector search');
    return [];
  }

  /**
   * Get all prompts for a session by content_session_id
   */
  getUserPromptsBySession(contentSessionId: string): UserPromptRow[] {
    const stmt = this.db.prepare(`
      SELECT
        id,
        content_session_id,
        prompt_number,
        prompt_text,
        created_at,
        created_at_epoch
      FROM user_prompts
      WHERE content_session_id = ?
      ORDER BY prompt_number ASC
    `);

    return stmt.all(contentSessionId) as UserPromptRow[];
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
