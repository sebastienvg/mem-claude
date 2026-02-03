/**
 * ChromaSync Service
 *
 * Automatically syncs observations and session summaries to ChromaDB.
 * Supports two modes:
 * - MCP mode: Spawns local chroma-mcp subprocess via uvx (original behavior)
 * - HTTP mode: Connects to external Chroma server via HTTP API (containerized/cloud)
 *
 * Design: Fail-fast with no fallbacks - if Chroma is unavailable, syncing fails.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ChromaClient, Collection } from 'chromadb';
import { ParsedObservation, ParsedSummary } from '../../sdk/parser.js';
import { SessionStore } from '../sqlite/SessionStore.js';
import { logger } from '../../utils/logger.js';
import { SettingsDefaultsManager, SettingsDefaults } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH, VECTOR_DB_DIR } from '../../shared/paths.js';
import path from 'path';

// Version injected at build time by esbuild define
declare const __DEFAULT_PACKAGE_VERSION__: string;
const packageVersion = typeof __DEFAULT_PACKAGE_VERSION__ !== 'undefined' ? __DEFAULT_PACKAGE_VERSION__ : '0.0.0-dev';

type ChromaMode = 'mcp' | 'http' | 'disabled';

interface ChromaDocument {
  id: string;
  document: string;
  metadata: Record<string, string | number>;
}

interface StoredObservation {
  id: number;
  memory_session_id: string;
  project: string;
  text: string | null;
  type: string;
  title: string | null;
  subtitle: string | null;
  facts: string | null; // JSON
  narrative: string | null;
  concepts: string | null; // JSON
  files_read: string | null; // JSON
  files_modified: string | null; // JSON
  prompt_number: number;
  discovery_tokens: number; // ROI metrics
  created_at: string;
  created_at_epoch: number;
}

interface StoredSummary {
  id: number;
  memory_session_id: string;
  project: string;
  request: string | null;
  investigated: string | null;
  learned: string | null;
  completed: string | null;
  next_steps: string | null;
  notes: string | null;
  prompt_number: number;
  discovery_tokens: number; // ROI metrics
  created_at: string;
  created_at_epoch: number;
}

interface StoredUserPrompt {
  id: number;
  content_session_id: string;
  prompt_number: number;
  prompt_text: string;
  created_at: string;
  created_at_epoch: number;
  memory_session_id: string;
  project: string;
}

export class ChromaSync {
  // MCP mode client
  private mcpClient: Client | null = null;
  private transport: StdioClientTransport | null = null;

  // HTTP mode client
  private httpClient: ChromaClient | null = null;
  private collection: Collection | null = null;

  // Shared state
  private connected: boolean = false;
  private mode: ChromaMode = 'disabled';
  private project: string;
  private collectionName: string;
  private readonly VECTOR_DB_DIR: string;
  private readonly BATCH_SIZE = 100;

  constructor(project: string) {
    this.project = project;
    this.collectionName = `cm__${project}`;
    this.VECTOR_DB_DIR = VECTOR_DB_DIR;
  }

  /**
   * Determine which Chroma mode to use based on settings and environment
   */
  private determineMode(settings: SettingsDefaults): ChromaMode {
    const configuredMode = settings.CLAUDE_MEM_CHROMA_MODE;

    if (configuredMode === 'disabled') {
      return 'disabled';
    }

    if (configuredMode === 'http') {
      return 'http';
    }

    if (configuredMode === 'mcp') {
      // MCP mode not available on Windows (console popup issues)
      if (process.platform === 'win32') {
        logger.warn('CHROMA_SYNC', 'MCP mode unavailable on Windows, falling back to disabled', {
          project: this.project,
          reason: 'MCP SDK subprocess spawning causes visible console windows'
        });
        return 'disabled';
      }
      return 'mcp';
    }

    // Auto mode: prefer HTTP if CHROMA_URL env var explicitly set, otherwise MCP
    if (process.env.CLAUDE_MEM_CHROMA_URL) {
      return 'http';
    }

    // On Windows, default to disabled (no MCP available)
    if (process.platform === 'win32') {
      logger.warn('CHROMA_SYNC', 'Auto mode on Windows defaults to disabled', {
        project: this.project,
        hint: 'Set CLAUDE_MEM_CHROMA_URL to enable HTTP mode with containerized Chroma'
      });
      return 'disabled';
    }

    // Unix: default to MCP mode
    return 'mcp';
  }

  /**
   * Check if Chroma is disabled
   */
  isDisabled(): boolean {
    return this.mode === 'disabled';
  }

  /**
   * Get current mode
   */
  getMode(): ChromaMode {
    return this.mode;
  }

  /**
   * Initialize HTTP client connection to external Chroma server
   */
  private async initializeHttpClient(settings: SettingsDefaults): Promise<void> {
    // Check env var first for container deployments, then settings file, then default
    const url = process.env.CLAUDE_MEM_CHROMA_URL || settings.CLAUDE_MEM_CHROMA_URL;
    logger.info('CHROMA_SYNC', `Connecting to Chroma via HTTP: ${url}`, { project: this.project });

    try {
      this.httpClient = new ChromaClient({ path: url });

      // Verify connection with heartbeat
      const heartbeat = await this.httpClient.heartbeat();
      logger.info('CHROMA_SYNC', `Chroma HTTP connected, heartbeat: ${heartbeat}`, { project: this.project });

      // Get or create collection
      this.collection = await this.httpClient.getOrCreateCollection({
        name: this.collectionName,
        metadata: { 'hnsw:space': 'cosine' },
      });

      this.connected = true;
      logger.info('CHROMA_SYNC', 'HTTP mode initialized', {
        project: this.project,
        collection: this.collectionName
      });
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Failed to connect to Chroma HTTP server', {
        project: this.project,
        url
      }, error as Error);
      throw new Error(`Chroma HTTP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Initialize MCP client connection (spawns local chroma-mcp subprocess)
   */
  private async initializeMcpClient(settings: SettingsDefaults): Promise<void> {
    logger.info('CHROMA_SYNC', 'Connecting to Chroma MCP server...', { project: this.project });

    try {
      const pythonVersion = settings.CLAUDE_MEM_PYTHON_VERSION;
      const isWindows = process.platform === 'win32';

      const transportOptions: any = {
        command: 'uvx',
        args: [
          '--python', pythonVersion,
          'chroma-mcp',
          '--client-type', 'persistent',
          '--data-dir', this.VECTOR_DB_DIR
        ],
        stderr: 'ignore'
      };

      // On Windows, try to hide console window
      if (isWindows) {
        transportOptions.windowsHide = true;
        logger.debug('CHROMA_SYNC', 'Windows detected, attempting to hide console window', { project: this.project });
      }

      this.transport = new StdioClientTransport(transportOptions);

      this.mcpClient = new Client({
        name: 'claude-mem-chroma-sync',
        version: packageVersion
      }, {
        capabilities: {}
      });

      await this.mcpClient.connect(this.transport);
      this.connected = true;

      logger.info('CHROMA_SYNC', 'Connected to Chroma MCP server', { project: this.project });
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Failed to connect to Chroma MCP server', { project: this.project }, error as Error);
      throw new Error(`Chroma MCP connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Ensure client is connected based on configured mode
   * Throws error if connection fails
   */
  private async ensureConnection(): Promise<void> {
    if (this.connected) {
      return;
    }

    // Load settings and determine mode on first connection
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
    this.mode = this.determineMode(settings);

    if (this.mode === 'disabled') {
      logger.info('CHROMA_SYNC', 'Chroma disabled by configuration', { project: this.project });
      return;
    }

    if (this.mode === 'http') {
      await this.initializeHttpClient(settings);
    } else {
      await this.initializeMcpClient(settings);
    }
  }

  /**
   * Ensure collection exists (MCP mode only - HTTP mode creates in initializeHttpClient)
   * Throws error if collection creation fails
   */
  private async ensureCollection(): Promise<void> {
    await this.ensureConnection();

    if (this.mode === 'disabled') {
      return;
    }

    // HTTP mode: collection already created in initializeHttpClient
    if (this.mode === 'http') {
      return;
    }

    // MCP mode: check/create collection
    if (!this.mcpClient) {
      throw new Error(
        'Chroma MCP client not initialized. Call ensureConnection() before using client methods.' +
        ` Project: ${this.project}`
      );
    }

    try {
      await this.mcpClient.callTool({
        name: 'chroma_get_collection_info',
        arguments: {
          collection_name: this.collectionName
        }
      });

      logger.debug('CHROMA_SYNC', 'Collection exists', { collection: this.collectionName });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isConnectionError =
        errorMessage.includes('Not connected') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('MCP error -32000');

      if (isConnectionError) {
        this.connected = false;
        this.mcpClient = null;
        logger.error('CHROMA_SYNC', 'Connection lost during collection check',
          { collection: this.collectionName }, error as Error);
        throw new Error(`Chroma connection lost: ${errorMessage}`);
      }

      logger.info('CHROMA_SYNC', 'Creating collection', { collection: this.collectionName });

      try {
        await this.mcpClient.callTool({
          name: 'chroma_create_collection',
          arguments: {
            collection_name: this.collectionName,
            embedding_function_name: 'default'
          }
        });

        logger.info('CHROMA_SYNC', 'Collection created', { collection: this.collectionName });
      } catch (createError) {
        logger.error('CHROMA_SYNC', 'Failed to create collection', { collection: this.collectionName }, createError as Error);
        throw new Error(`Collection creation failed: ${createError instanceof Error ? createError.message : String(createError)}`);
      }
    }
  }

  /**
   * Format observation into Chroma documents (granular approach)
   * Each semantic field becomes a separate vector document
   */
  private formatObservationDocs(obs: StoredObservation): ChromaDocument[] {
    const documents: ChromaDocument[] = [];

    const facts = obs.facts ? JSON.parse(obs.facts) : [];
    const concepts = obs.concepts ? JSON.parse(obs.concepts) : [];
    const files_read = obs.files_read ? JSON.parse(obs.files_read) : [];
    const files_modified = obs.files_modified ? JSON.parse(obs.files_modified) : [];

    const baseMetadata: Record<string, string | number> = {
      sqlite_id: obs.id,
      doc_type: 'observation',
      memory_session_id: obs.memory_session_id,
      project: obs.project,
      created_at_epoch: obs.created_at_epoch,
      type: obs.type || 'discovery',
      title: obs.title || 'Untitled'
    };

    if (obs.subtitle) {
      baseMetadata.subtitle = obs.subtitle;
    }
    if (concepts.length > 0) {
      baseMetadata.concepts = concepts.join(',');
    }
    if (files_read.length > 0) {
      baseMetadata.files_read = files_read.join(',');
    }
    if (files_modified.length > 0) {
      baseMetadata.files_modified = files_modified.join(',');
    }

    if (obs.narrative) {
      documents.push({
        id: `obs_${obs.id}_narrative`,
        document: obs.narrative,
        metadata: { ...baseMetadata, field_type: 'narrative' }
      });
    }

    if (obs.text) {
      documents.push({
        id: `obs_${obs.id}_text`,
        document: obs.text,
        metadata: { ...baseMetadata, field_type: 'text' }
      });
    }

    facts.forEach((fact: string, index: number) => {
      documents.push({
        id: `obs_${obs.id}_fact_${index}`,
        document: fact,
        metadata: { ...baseMetadata, field_type: 'fact', fact_index: index }
      });
    });

    return documents;
  }

  /**
   * Format summary into Chroma documents (granular approach)
   * Each summary field becomes a separate vector document
   */
  private formatSummaryDocs(summary: StoredSummary): ChromaDocument[] {
    const documents: ChromaDocument[] = [];

    const baseMetadata: Record<string, string | number> = {
      sqlite_id: summary.id,
      doc_type: 'session_summary',
      memory_session_id: summary.memory_session_id,
      project: summary.project,
      created_at_epoch: summary.created_at_epoch,
      prompt_number: summary.prompt_number || 0
    };

    if (summary.request) {
      documents.push({
        id: `summary_${summary.id}_request`,
        document: summary.request,
        metadata: { ...baseMetadata, field_type: 'request' }
      });
    }

    if (summary.investigated) {
      documents.push({
        id: `summary_${summary.id}_investigated`,
        document: summary.investigated,
        metadata: { ...baseMetadata, field_type: 'investigated' }
      });
    }

    if (summary.learned) {
      documents.push({
        id: `summary_${summary.id}_learned`,
        document: summary.learned,
        metadata: { ...baseMetadata, field_type: 'learned' }
      });
    }

    if (summary.completed) {
      documents.push({
        id: `summary_${summary.id}_completed`,
        document: summary.completed,
        metadata: { ...baseMetadata, field_type: 'completed' }
      });
    }

    if (summary.next_steps) {
      documents.push({
        id: `summary_${summary.id}_next_steps`,
        document: summary.next_steps,
        metadata: { ...baseMetadata, field_type: 'next_steps' }
      });
    }

    if (summary.notes) {
      documents.push({
        id: `summary_${summary.id}_notes`,
        document: summary.notes,
        metadata: { ...baseMetadata, field_type: 'notes' }
      });
    }

    return documents;
  }

  /**
   * Add documents to Chroma in batch (mode-aware)
   * Throws error if batch add fails
   */
  private async addDocuments(documents: ChromaDocument[]): Promise<void> {
    if (documents.length === 0) {
      return;
    }

    await this.ensureCollection();

    if (this.mode === 'disabled') {
      return;
    }

    if (this.mode === 'http') {
      await this.addDocumentsHttp(documents);
    } else {
      await this.addDocumentsMcp(documents);
    }
  }

  /**
   * Add documents via HTTP client
   */
  private async addDocumentsHttp(documents: ChromaDocument[]): Promise<void> {
    if (!this.collection) {
      throw new Error('Chroma HTTP collection not initialized');
    }

    try {
      await this.collection.add({
        ids: documents.map(d => d.id),
        documents: documents.map(d => d.document),
        metadatas: documents.map(d => d.metadata),
      });

      logger.debug('CHROMA_SYNC', 'Documents added via HTTP', {
        collection: this.collectionName,
        count: documents.length
      });
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Failed to add documents via HTTP', {
        collection: this.collectionName,
        count: documents.length
      }, error as Error);
      throw new Error(`HTTP document add failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Add documents via MCP client
   */
  private async addDocumentsMcp(documents: ChromaDocument[]): Promise<void> {
    if (!this.mcpClient) {
      throw new Error(
        'Chroma MCP client not initialized. Call ensureConnection() before using client methods.' +
        ` Project: ${this.project}`
      );
    }

    try {
      await this.mcpClient.callTool({
        name: 'chroma_add_documents',
        arguments: {
          collection_name: this.collectionName,
          documents: documents.map(d => d.document),
          ids: documents.map(d => d.id),
          metadatas: documents.map(d => d.metadata)
        }
      });

      logger.debug('CHROMA_SYNC', 'Documents added via MCP', {
        collection: this.collectionName,
        count: documents.length
      });
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Failed to add documents via MCP', {
        collection: this.collectionName,
        count: documents.length
      }, error as Error);
      throw new Error(`MCP document add failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Sync a single observation to Chroma
   * Blocks until sync completes, throws on error
   */
  async syncObservation(
    observationId: number,
    memorySessionId: string,
    project: string,
    obs: ParsedObservation,
    promptNumber: number,
    createdAtEpoch: number,
    discoveryTokens: number = 0
  ): Promise<void> {
    await this.ensureConnection();
    if (this.mode === 'disabled') return;

    const stored: StoredObservation = {
      id: observationId,
      memory_session_id: memorySessionId,
      project: project,
      text: null,
      type: obs.type,
      title: obs.title,
      subtitle: obs.subtitle,
      facts: JSON.stringify(obs.facts),
      narrative: obs.narrative,
      concepts: JSON.stringify(obs.concepts),
      files_read: JSON.stringify(obs.files_read),
      files_modified: JSON.stringify(obs.files_modified),
      prompt_number: promptNumber,
      discovery_tokens: discoveryTokens,
      created_at: new Date(createdAtEpoch * 1000).toISOString(),
      created_at_epoch: createdAtEpoch
    };

    const documents = this.formatObservationDocs(stored);

    logger.info('CHROMA_SYNC', 'Syncing observation', {
      observationId,
      documentCount: documents.length,
      project,
      mode: this.mode
    });

    await this.addDocuments(documents);
  }

  /**
   * Sync a single summary to Chroma
   * Blocks until sync completes, throws on error
   */
  async syncSummary(
    summaryId: number,
    memorySessionId: string,
    project: string,
    summary: ParsedSummary,
    promptNumber: number,
    createdAtEpoch: number,
    discoveryTokens: number = 0
  ): Promise<void> {
    await this.ensureConnection();
    if (this.mode === 'disabled') return;

    const stored: StoredSummary = {
      id: summaryId,
      memory_session_id: memorySessionId,
      project: project,
      request: summary.request,
      investigated: summary.investigated,
      learned: summary.learned,
      completed: summary.completed,
      next_steps: summary.next_steps,
      notes: summary.notes,
      prompt_number: promptNumber,
      discovery_tokens: discoveryTokens,
      created_at: new Date(createdAtEpoch * 1000).toISOString(),
      created_at_epoch: createdAtEpoch
    };

    const documents = this.formatSummaryDocs(stored);

    logger.info('CHROMA_SYNC', 'Syncing summary', {
      summaryId,
      documentCount: documents.length,
      project,
      mode: this.mode
    });

    await this.addDocuments(documents);
  }

  /**
   * Format user prompt into Chroma document
   */
  private formatUserPromptDoc(prompt: StoredUserPrompt): ChromaDocument {
    return {
      id: `prompt_${prompt.id}`,
      document: prompt.prompt_text,
      metadata: {
        sqlite_id: prompt.id,
        doc_type: 'user_prompt',
        memory_session_id: prompt.memory_session_id,
        project: prompt.project,
        created_at_epoch: prompt.created_at_epoch,
        prompt_number: prompt.prompt_number
      }
    };
  }

  /**
   * Sync a single user prompt to Chroma
   * Blocks until sync completes, throws on error
   */
  async syncUserPrompt(
    promptId: number,
    memorySessionId: string,
    project: string,
    promptText: string,
    promptNumber: number,
    createdAtEpoch: number
  ): Promise<void> {
    await this.ensureConnection();
    if (this.mode === 'disabled') return;

    const stored: StoredUserPrompt = {
      id: promptId,
      content_session_id: '',
      prompt_number: promptNumber,
      prompt_text: promptText,
      created_at: new Date(createdAtEpoch * 1000).toISOString(),
      created_at_epoch: createdAtEpoch,
      memory_session_id: memorySessionId,
      project: project
    };

    const document = this.formatUserPromptDoc(stored);

    logger.info('CHROMA_SYNC', 'Syncing user prompt', {
      promptId,
      project,
      mode: this.mode
    });

    await this.addDocuments([document]);
  }

  /**
   * Fetch all existing document IDs from Chroma collection (mode-aware)
   * Returns Sets of SQLite IDs for observations, summaries, and prompts
   */
  private async getExistingChromaIds(): Promise<{
    observations: Set<number>;
    summaries: Set<number>;
    prompts: Set<number>;
  }> {
    await this.ensureConnection();

    if (this.mode === 'disabled') {
      return { observations: new Set(), summaries: new Set(), prompts: new Set() };
    }

    if (this.mode === 'http') {
      return this.getExistingChromaIdsHttp();
    } else {
      return this.getExistingChromaIdsMcp();
    }
  }

  /**
   * Get existing IDs via HTTP client
   */
  private async getExistingChromaIdsHttp(): Promise<{
    observations: Set<number>;
    summaries: Set<number>;
    prompts: Set<number>;
  }> {
    if (!this.collection) {
      throw new Error('Chroma HTTP collection not initialized');
    }

    const observationIds = new Set<number>();
    const summaryIds = new Set<number>();
    const promptIds = new Set<number>();

    logger.info('CHROMA_SYNC', 'Fetching existing Chroma document IDs via HTTP...', { project: this.project });

    try {
      // Get all documents with project filter
      const result = await this.collection.get({
        where: { project: this.project },
        include: ['metadatas'],
      });

      const metadatas = result.metadatas || [];

      for (const meta of metadatas) {
        if (meta && meta.sqlite_id) {
          const sqliteId = meta.sqlite_id as number;
          if (meta.doc_type === 'observation') {
            observationIds.add(sqliteId);
          } else if (meta.doc_type === 'session_summary') {
            summaryIds.add(sqliteId);
          } else if (meta.doc_type === 'user_prompt') {
            promptIds.add(sqliteId);
          }
        }
      }

      logger.info('CHROMA_SYNC', 'Existing IDs fetched via HTTP', {
        project: this.project,
        observations: observationIds.size,
        summaries: summaryIds.size,
        prompts: promptIds.size
      });

      return { observations: observationIds, summaries: summaryIds, prompts: promptIds };
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Failed to fetch existing IDs via HTTP', { project: this.project }, error as Error);
      throw error;
    }
  }

  /**
   * Get existing IDs via MCP client
   */
  private async getExistingChromaIdsMcp(): Promise<{
    observations: Set<number>;
    summaries: Set<number>;
    prompts: Set<number>;
  }> {
    if (!this.mcpClient) {
      throw new Error(
        'Chroma MCP client not initialized. Call ensureConnection() before using client methods.' +
        ` Project: ${this.project}`
      );
    }

    const observationIds = new Set<number>();
    const summaryIds = new Set<number>();
    const promptIds = new Set<number>();

    let offset = 0;
    const limit = 1000;

    logger.info('CHROMA_SYNC', 'Fetching existing Chroma document IDs via MCP...', { project: this.project });

    while (true) {
      try {
        const result = await this.mcpClient.callTool({
          name: 'chroma_get_documents',
          arguments: {
            collection_name: this.collectionName,
            limit,
            offset,
            where: { project: this.project },
            include: ['metadatas']
          }
        });

        const data = result.content[0];
        if (data.type !== 'text') {
          throw new Error('Unexpected response type from chroma_get_documents');
        }

        const parsed = JSON.parse(data.text);
        const metadatas = parsed.metadatas || [];

        if (metadatas.length === 0) {
          break;
        }

        for (const meta of metadatas) {
          if (meta.sqlite_id) {
            if (meta.doc_type === 'observation') {
              observationIds.add(meta.sqlite_id);
            } else if (meta.doc_type === 'session_summary') {
              summaryIds.add(meta.sqlite_id);
            } else if (meta.doc_type === 'user_prompt') {
              promptIds.add(meta.sqlite_id);
            }
          }
        }

        offset += limit;

        logger.debug('CHROMA_SYNC', 'Fetched batch of existing IDs via MCP', {
          project: this.project,
          offset,
          batchSize: metadatas.length
        });
      } catch (error) {
        logger.error('CHROMA_SYNC', 'Failed to fetch existing IDs via MCP', { project: this.project }, error as Error);
        throw error;
      }
    }

    logger.info('CHROMA_SYNC', 'Existing IDs fetched via MCP', {
      project: this.project,
      observations: observationIds.size,
      summaries: summaryIds.size,
      prompts: promptIds.size
    });

    return { observations: observationIds, summaries: summaryIds, prompts: promptIds };
  }

  /**
   * Backfill: Sync all observations missing from Chroma
   * Reads from SQLite and syncs in batches
   * Throws error if backfill fails
   */
  async ensureBackfilled(): Promise<void> {
    await this.ensureConnection();
    if (this.mode === 'disabled') return;

    logger.info('CHROMA_SYNC', 'Starting smart backfill', { project: this.project, mode: this.mode });

    await this.ensureCollection();

    const existing = await this.getExistingChromaIds();

    const db = new SessionStore();

    try {
      // Build exclusion list for observations
      const existingObsIds = Array.from(existing.observations);
      const obsExclusionClause = existingObsIds.length > 0
        ? `AND id NOT IN (${existingObsIds.join(',')})`
        : '';

      const observations = db.db.prepare(`
        SELECT * FROM observations
        WHERE project = ? ${obsExclusionClause}
        ORDER BY id ASC
      `).all(this.project) as StoredObservation[];

      const totalObsCount = db.db.prepare(`
        SELECT COUNT(*) as count FROM observations WHERE project = ?
      `).get(this.project) as { count: number };

      logger.info('CHROMA_SYNC', 'Backfilling observations', {
        project: this.project,
        missing: observations.length,
        existing: existing.observations.size,
        total: totalObsCount.count
      });

      const allDocs: ChromaDocument[] = [];
      for (const obs of observations) {
        allDocs.push(...this.formatObservationDocs(obs));
      }

      for (let i = 0; i < allDocs.length; i += this.BATCH_SIZE) {
        const batch = allDocs.slice(i, i + this.BATCH_SIZE);
        await this.addDocuments(batch);

        logger.debug('CHROMA_SYNC', 'Backfill progress', {
          project: this.project,
          progress: `${Math.min(i + this.BATCH_SIZE, allDocs.length)}/${allDocs.length}`
        });
      }

      // Build exclusion list for summaries
      const existingSummaryIds = Array.from(existing.summaries);
      const summaryExclusionClause = existingSummaryIds.length > 0
        ? `AND id NOT IN (${existingSummaryIds.join(',')})`
        : '';

      const summaries = db.db.prepare(`
        SELECT * FROM session_summaries
        WHERE project = ? ${summaryExclusionClause}
        ORDER BY id ASC
      `).all(this.project) as StoredSummary[];

      const totalSummaryCount = db.db.prepare(`
        SELECT COUNT(*) as count FROM session_summaries WHERE project = ?
      `).get(this.project) as { count: number };

      logger.info('CHROMA_SYNC', 'Backfilling summaries', {
        project: this.project,
        missing: summaries.length,
        existing: existing.summaries.size,
        total: totalSummaryCount.count
      });

      const summaryDocs: ChromaDocument[] = [];
      for (const summary of summaries) {
        summaryDocs.push(...this.formatSummaryDocs(summary));
      }

      for (let i = 0; i < summaryDocs.length; i += this.BATCH_SIZE) {
        const batch = summaryDocs.slice(i, i + this.BATCH_SIZE);
        await this.addDocuments(batch);

        logger.debug('CHROMA_SYNC', 'Backfill progress', {
          project: this.project,
          progress: `${Math.min(i + this.BATCH_SIZE, summaryDocs.length)}/${summaryDocs.length}`
        });
      }

      // Build exclusion list for prompts
      const existingPromptIds = Array.from(existing.prompts);
      const promptExclusionClause = existingPromptIds.length > 0
        ? `AND up.id NOT IN (${existingPromptIds.join(',')})`
        : '';

      const prompts = db.db.prepare(`
        SELECT
          up.*,
          s.project,
          s.memory_session_id
        FROM user_prompts up
        JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
        WHERE s.project = ? ${promptExclusionClause}
        ORDER BY up.id ASC
      `).all(this.project) as StoredUserPrompt[];

      const totalPromptCount = db.db.prepare(`
        SELECT COUNT(*) as count
        FROM user_prompts up
        JOIN sdk_sessions s ON up.content_session_id = s.content_session_id
        WHERE s.project = ?
      `).get(this.project) as { count: number };

      logger.info('CHROMA_SYNC', 'Backfilling user prompts', {
        project: this.project,
        missing: prompts.length,
        existing: existing.prompts.size,
        total: totalPromptCount.count
      });

      const promptDocs: ChromaDocument[] = [];
      for (const prompt of prompts) {
        promptDocs.push(this.formatUserPromptDoc(prompt));
      }

      for (let i = 0; i < promptDocs.length; i += this.BATCH_SIZE) {
        const batch = promptDocs.slice(i, i + this.BATCH_SIZE);
        await this.addDocuments(batch);

        logger.debug('CHROMA_SYNC', 'Backfill progress', {
          project: this.project,
          progress: `${Math.min(i + this.BATCH_SIZE, promptDocs.length)}/${promptDocs.length}`
        });
      }

      logger.info('CHROMA_SYNC', 'Smart backfill complete', {
        project: this.project,
        mode: this.mode,
        synced: {
          observationDocs: allDocs.length,
          summaryDocs: summaryDocs.length,
          promptDocs: promptDocs.length
        },
        skipped: {
          observations: existing.observations.size,
          summaries: existing.summaries.size,
          prompts: existing.prompts.size
        }
      });

    } catch (error) {
      logger.error('CHROMA_SYNC', 'Backfill failed', { project: this.project }, error as Error);
      throw new Error(`Backfill failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      db.close();
    }
  }

  /**
   * Query Chroma collection for semantic search (mode-aware)
   * Used by SearchManager for vector-based search
   */
  async queryChroma(
    query: string,
    limit: number,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    await this.ensureConnection();

    if (this.mode === 'disabled') {
      return { ids: [], distances: [], metadatas: [] };
    }

    if (this.mode === 'http') {
      return this.queryChromaHttp(query, limit, whereFilter);
    } else {
      return this.queryChromaMcp(query, limit, whereFilter);
    }
  }

  /**
   * Query via HTTP client
   */
  private async queryChromaHttp(
    query: string,
    limit: number,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    if (!this.collection) {
      throw new Error('Chroma HTTP collection not initialized');
    }

    try {
      const queryOptions: any = {
        queryTexts: [query],
        nResults: limit,
        include: ['documents', 'metadatas', 'distances'],
      };

      if (whereFilter) {
        queryOptions.where = whereFilter;
      }

      const result = await this.collection.query(queryOptions);

      // Extract unique IDs from results
      const ids: number[] = [];
      const docIds = result.ids?.[0] || [];

      for (const docId of docIds) {
        const obsMatch = docId.match(/obs_(\d+)_/);
        const summaryMatch = docId.match(/summary_(\d+)_/);
        const promptMatch = docId.match(/prompt_(\d+)/);

        let sqliteId: number | null = null;
        if (obsMatch) {
          sqliteId = parseInt(obsMatch[1], 10);
        } else if (summaryMatch) {
          sqliteId = parseInt(summaryMatch[1], 10);
        } else if (promptMatch) {
          sqliteId = parseInt(promptMatch[1], 10);
        }

        if (sqliteId !== null && !ids.includes(sqliteId)) {
          ids.push(sqliteId);
        }
      }

      const distances = result.distances?.[0] || [];
      const metadatas = result.metadatas?.[0] || [];

      return { ids, distances, metadatas };
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Query failed via HTTP', { project: this.project, query }, error as Error);
      throw error;
    }
  }

  /**
   * Query via MCP client
   */
  private async queryChromaMcp(
    query: string,
    limit: number,
    whereFilter?: Record<string, any>
  ): Promise<{ ids: number[]; distances: number[]; metadatas: any[] }> {
    if (!this.mcpClient) {
      throw new Error(
        'Chroma MCP client not initialized. Call ensureConnection() before using client methods.' +
        ` Project: ${this.project}`
      );
    }

    const whereStringified = whereFilter ? JSON.stringify(whereFilter) : undefined;

    const arguments_obj = {
      collection_name: this.collectionName,
      query_texts: [query],
      n_results: limit,
      include: ['documents', 'metadatas', 'distances'],
      where: whereStringified
    };

    let result;
    try {
      result = await this.mcpClient.callTool({
        name: 'chroma_query_documents',
        arguments: arguments_obj
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isConnectionError =
        errorMessage.includes('Not connected') ||
        errorMessage.includes('Connection closed') ||
        errorMessage.includes('MCP error -32000');

      if (isConnectionError) {
        this.connected = false;
        this.mcpClient = null;
        logger.error('CHROMA_SYNC', 'Connection lost during query',
          { project: this.project, query }, error as Error);
        throw new Error(`Chroma query failed - connection lost: ${errorMessage}`);
      }
      throw error;
    }

    const resultText = result.content[0]?.text || (() => {
      logger.error('CHROMA', 'Missing text in MCP chroma_query_documents result', {
        project: this.project,
        query_text: query
      });
      return '';
    })();

    let parsed: any;
    try {
      parsed = JSON.parse(resultText);
    } catch (error) {
      logger.error('CHROMA_SYNC', 'Failed to parse Chroma response', { project: this.project }, error as Error);
      return { ids: [], distances: [], metadatas: [] };
    }

    const ids: number[] = [];
    const docIds = parsed.ids?.[0] || [];
    for (const docId of docIds) {
      const obsMatch = docId.match(/obs_(\d+)_/);
      const summaryMatch = docId.match(/summary_(\d+)_/);
      const promptMatch = docId.match(/prompt_(\d+)/);

      let sqliteId: number | null = null;
      if (obsMatch) {
        sqliteId = parseInt(obsMatch[1], 10);
      } else if (summaryMatch) {
        sqliteId = parseInt(summaryMatch[1], 10);
      } else if (promptMatch) {
        sqliteId = parseInt(promptMatch[1], 10);
      }

      if (sqliteId !== null && !ids.includes(sqliteId)) {
        ids.push(sqliteId);
      }
    }

    const distances = parsed.distances?.[0] || [];
    const metadatas = parsed.metadatas?.[0] || [];

    return { ids, distances, metadatas };
  }

  /**
   * Close the Chroma client connection and cleanup
   */
  async close(): Promise<void> {
    if (!this.connected && !this.mcpClient && !this.transport && !this.httpClient) {
      return;
    }

    // Close MCP client and transport
    if (this.mcpClient) {
      await this.mcpClient.close();
    }

    if (this.transport) {
      await this.transport.close();
    }

    // HTTP client doesn't need explicit close

    logger.info('CHROMA_SYNC', 'Chroma client closed', { project: this.project, mode: this.mode });

    // Reset state
    this.connected = false;
    this.mcpClient = null;
    this.transport = null;
    this.httpClient = null;
    this.collection = null;
  }
}
