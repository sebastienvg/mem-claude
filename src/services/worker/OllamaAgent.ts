/**
 * OllamaAgent: Ollama-based observation extraction
 *
 * Alternative to SDKAgent that uses local Ollama instance
 * for fully self-hosted operation with no API costs.
 *
 * Responsibility:
 * - Call Ollama REST API for observation extraction
 * - Parse XML responses (same format as Claude/Gemini/OpenRouter)
 * - Sync to database and Chroma
 * - Support local models (llama3, mistral, phi3, etc.)
 */

import { DatabaseManager } from './DatabaseManager.js';
import { SessionManager } from './SessionManager.js';
import { logger } from '../../utils/logger.js';
import { buildInitPrompt, buildObservationPrompt, buildSummaryPrompt, buildContinuationPrompt } from '../../sdk/prompts.js';
import { SettingsDefaultsManager } from '../../shared/SettingsDefaultsManager.js';
import { USER_SETTINGS_PATH } from '../../shared/paths.js';
import type { ActiveSession, ConversationMessage } from '../worker-types.js';
import { ModeManager } from '../domain/ModeManager.js';
import {
  processAgentResponse,
  shouldFallbackToClaude,
  isAbortError,
  type WorkerRef,
  type FallbackAgent
} from './agents/index.js';

// Default Ollama API endpoint
const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

// Context window management constants
const DEFAULT_MAX_CONTEXT_MESSAGES = 20;
const DEFAULT_MAX_ESTIMATED_TOKENS = 100000;
const CHARS_PER_TOKEN_ESTIMATE = 4;

// OpenAI-compatible message format (Ollama supports this)
interface OllamaMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

interface OllamaResponse {
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  total_duration?: number;
  eval_count?: number;
  prompt_eval_count?: number;
  error?: string;
}

export class OllamaAgent {
  private dbManager: DatabaseManager;
  private sessionManager: SessionManager;
  private fallbackAgent: FallbackAgent | null = null;

  constructor(dbManager: DatabaseManager, sessionManager: SessionManager) {
    this.dbManager = dbManager;
    this.sessionManager = sessionManager;
  }

  /**
   * Set the fallback agent (Claude SDK) for when Ollama API fails
   * Must be set after construction to avoid circular dependency
   */
  setFallbackAgent(agent: FallbackAgent): void {
    this.fallbackAgent = agent;
  }

  /**
   * Start Ollama agent for a session
   * Uses multi-turn conversation to maintain context across messages
   */
  async startSession(session: ActiveSession, worker?: WorkerRef): Promise<void> {
    try {
      // Get Ollama configuration
      const { baseUrl, model } = this.getOllamaConfig();

      // Load active mode
      const mode = ModeManager.getInstance().getActiveMode();

      // Build initial prompt
      const initPrompt = session.lastPromptNumber === 1
        ? buildInitPrompt(session.project, session.contentSessionId, session.userPrompt, mode)
        : buildContinuationPrompt(session.userPrompt, session.lastPromptNumber, session.contentSessionId, mode);

      // Add to conversation history and query Ollama with full context
      session.conversationHistory.push({ role: 'user', content: initPrompt });
      const initResponse = await this.queryOllamaMultiTurn(session.conversationHistory, baseUrl, model);

      if (initResponse.content) {
        // Add response to conversation history
        session.conversationHistory.push({ role: 'assistant', content: initResponse.content });

        // Track token usage (estimated from Ollama's eval_count)
        const tokensUsed = initResponse.tokensUsed || 0;
        session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
        session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);

        // Process response using shared ResponseProcessor
        await processAgentResponse(
          initResponse.content,
          session,
          this.dbManager,
          this.sessionManager,
          worker,
          tokensUsed,
          null,
          'Ollama',
          undefined
        );
      } else {
        logger.error('SDK', 'Empty Ollama init response - session may lack context', {
          sessionId: session.sessionDbId,
          model
        });
      }

      // Track lastCwd from messages for CLAUDE.md generation
      let lastCwd: string | undefined;

      // Process pending messages
      for await (const message of this.sessionManager.getMessageIterator(session.sessionDbId)) {
        // Capture cwd from messages for proper worktree support
        if (message.cwd) {
          lastCwd = message.cwd;
        }
        // Capture earliest timestamp BEFORE processing
        const originalTimestamp = session.earliestPendingTimestamp;

        if (message.type === 'observation') {
          // Update last prompt number
          if (message.prompt_number !== undefined) {
            session.lastPromptNumber = message.prompt_number;
          }

          // Build observation prompt
          const obsPrompt = buildObservationPrompt({
            id: 0,
            tool_name: message.tool_name!,
            tool_input: JSON.stringify(message.tool_input),
            tool_output: JSON.stringify(message.tool_response),
            created_at_epoch: originalTimestamp ?? Date.now(),
            cwd: message.cwd
          });

          // Add to conversation history and query Ollama with full context
          session.conversationHistory.push({ role: 'user', content: obsPrompt });
          const obsResponse = await this.queryOllamaMultiTurn(session.conversationHistory, baseUrl, model);

          let tokensUsed = 0;
          if (obsResponse.content) {
            // Add response to conversation history
            session.conversationHistory.push({ role: 'assistant', content: obsResponse.content });

            tokensUsed = obsResponse.tokensUsed || 0;
            session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
            session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
          }

          // Process response using shared ResponseProcessor
          await processAgentResponse(
            obsResponse.content || '',
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            tokensUsed,
            originalTimestamp,
            'Ollama',
            lastCwd
          );

        } else if (message.type === 'summarize') {
          // Build summary prompt
          const summaryPrompt = buildSummaryPrompt({
            id: session.sessionDbId,
            memory_session_id: session.memorySessionId,
            project: session.project,
            user_prompt: session.userPrompt,
            last_assistant_message: message.last_assistant_message || ''
          }, mode);

          // Add to conversation history and query Ollama with full context
          session.conversationHistory.push({ role: 'user', content: summaryPrompt });
          const summaryResponse = await this.queryOllamaMultiTurn(session.conversationHistory, baseUrl, model);

          let tokensUsed = 0;
          if (summaryResponse.content) {
            // Add response to conversation history
            session.conversationHistory.push({ role: 'assistant', content: summaryResponse.content });

            tokensUsed = summaryResponse.tokensUsed || 0;
            session.cumulativeInputTokens += Math.floor(tokensUsed * 0.7);
            session.cumulativeOutputTokens += Math.floor(tokensUsed * 0.3);
          }

          // Process response using shared ResponseProcessor
          await processAgentResponse(
            summaryResponse.content || '',
            session,
            this.dbManager,
            this.sessionManager,
            worker,
            tokensUsed,
            originalTimestamp,
            'Ollama',
            lastCwd
          );
        }
      }

      // Mark session complete
      const sessionDuration = Date.now() - session.startTime;
      logger.success('SDK', 'Ollama agent completed', {
        sessionId: session.sessionDbId,
        duration: `${(sessionDuration / 1000).toFixed(1)}s`,
        historyLength: session.conversationHistory.length,
        model
      });

    } catch (error: unknown) {
      if (isAbortError(error)) {
        logger.warn('SDK', 'Ollama agent aborted', { sessionId: session.sessionDbId });
        throw error;
      }

      // Check if we should fall back to Claude
      if (shouldFallbackToClaude(error) && this.fallbackAgent) {
        logger.warn('SDK', 'Ollama API failed, falling back to Claude SDK', {
          sessionDbId: session.sessionDbId,
          error: error instanceof Error ? error.message : String(error),
          historyLength: session.conversationHistory.length
        });

        // Pass session with accumulated history to fallback
        return this.fallbackAgent.startSession(session, worker);
      }

      // No fallback available or error not recoverable
      logger.error('SDK', 'Ollama agent error (no fallback)', {
        sessionDbId: session.sessionDbId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  /**
   * Estimate token count from text (rough approximation)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
  }

  /**
   * Truncate conversation history to stay within context window limits
   */
  private truncateHistory(history: ConversationMessage[]): ConversationMessage[] {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    const MAX_CONTEXT_MESSAGES = parseInt(settings.CLAUDE_MEM_OLLAMA_MAX_CONTEXT_MESSAGES) || DEFAULT_MAX_CONTEXT_MESSAGES;
    const MAX_ESTIMATED_TOKENS = parseInt(settings.CLAUDE_MEM_OLLAMA_MAX_TOKENS) || DEFAULT_MAX_ESTIMATED_TOKENS;

    if (history.length <= MAX_CONTEXT_MESSAGES) {
      const totalTokens = history.reduce((sum, m) => sum + this.estimateTokens(m.content), 0);
      if (totalTokens <= MAX_ESTIMATED_TOKENS) {
        return history;
      }
    }

    // Sliding window: keep most recent messages within limits
    const truncated: ConversationMessage[] = [];
    let tokenCount = 0;

    for (let i = history.length - 1; i >= 0; i--) {
      const msg = history[i];
      const msgTokens = this.estimateTokens(msg.content);

      if (truncated.length >= MAX_CONTEXT_MESSAGES || tokenCount + msgTokens > MAX_ESTIMATED_TOKENS) {
        logger.warn('SDK', 'Ollama context window truncated', {
          originalMessages: history.length,
          keptMessages: truncated.length,
          droppedMessages: i + 1,
          estimatedTokens: tokenCount,
          tokenLimit: MAX_ESTIMATED_TOKENS
        });
        break;
      }

      truncated.unshift(msg);
      tokenCount += msgTokens;
    }

    return truncated;
  }

  /**
   * Convert shared ConversationMessage array to Ollama message format
   */
  private conversationToOllamaMessages(history: ConversationMessage[]): OllamaMessage[] {
    return history.map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content
    }));
  }

  /**
   * Query Ollama via REST API with full conversation history (multi-turn)
   */
  private async queryOllamaMultiTurn(
    history: ConversationMessage[],
    baseUrl: string,
    model: string
  ): Promise<{ content: string; tokensUsed?: number }> {
    // Truncate history to prevent context overflow
    const truncatedHistory = this.truncateHistory(history);
    const messages = this.conversationToOllamaMessages(truncatedHistory);
    const totalChars = truncatedHistory.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedTokens = this.estimateTokens(truncatedHistory.map(m => m.content).join(''));

    logger.debug('SDK', `Querying Ollama multi-turn (${model})`, {
      turns: truncatedHistory.length,
      totalChars,
      estimatedTokens,
      baseUrl
    });

    const apiUrl = `${baseUrl}/api/chat`;

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        options: {
          temperature: 0.3,  // Lower temperature for structured extraction
        }
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as OllamaResponse;

    // Check for API error in response body
    if (data.error) {
      throw new Error(`Ollama API error: ${data.error}`);
    }

    if (!data.message?.content) {
      logger.error('SDK', 'Empty response from Ollama');
      return { content: '' };
    }

    const content = data.message.content;
    // Ollama provides eval_count (output tokens) and prompt_eval_count (input tokens)
    const tokensUsed = (data.eval_count || 0) + (data.prompt_eval_count || 0);

    if (tokensUsed) {
      logger.info('SDK', 'Ollama API usage', {
        model,
        promptTokens: data.prompt_eval_count || 0,
        evalTokens: data.eval_count || 0,
        totalTokens: tokensUsed,
        duration: data.total_duration ? `${(data.total_duration / 1e9).toFixed(2)}s` : 'unknown',
        messagesInContext: truncatedHistory.length
      });
    }

    return { content, tokensUsed };
  }

  /**
   * Get Ollama configuration from settings or environment
   */
  private getOllamaConfig(): { baseUrl: string; model: string } {
    const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);

    // Base URL: check settings first, then environment, then default
    const baseUrl = settings.CLAUDE_MEM_OLLAMA_URL || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;

    // Model: from settings or default to llama3.2
    const model = settings.CLAUDE_MEM_OLLAMA_MODEL || 'llama3.2';

    return { baseUrl, model };
  }
}

/**
 * Check if Ollama is available (endpoint is reachable)
 */
export async function isOllamaAvailable(): Promise<boolean> {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  const baseUrl = settings.CLAUDE_MEM_OLLAMA_URL || process.env.OLLAMA_URL || DEFAULT_OLLAMA_URL;

  try {
    const response = await fetch(`${baseUrl}/api/tags`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Check if Ollama is the selected provider
 */
export function isOllamaSelected(): boolean {
  const settings = SettingsDefaultsManager.loadFromFile(USER_SETTINGS_PATH);
  return settings.CLAUDE_MEM_PROVIDER === 'ollama';
}
