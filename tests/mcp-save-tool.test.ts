/**
 * MCP Save Tool Tests
 *
 * Tests the 'save' tool definition added to mcp-server.ts.
 * Uses mocking to intercept MCP server setup and verify tool registration,
 * schema correctness, and handler behavior.
 *
 * Sources:
 * - mcp-server.ts from src/servers/mcp-server.ts
 * - Task spec from docs/plans/custom-mems-tasks/plan_task_2.md
 * - Task 1 endpoint from src/services/worker/http/routes/DataRoutes.ts
 */

import { describe, it, expect, beforeEach, afterEach, spyOn, mock, beforeAll } from 'bun:test';
import { logger } from '../src/utils/logger.js';

// Capture the tools and handlers registered with the MCP server
let capturedListToolsHandler: Function | null = null;
let capturedCallToolHandler: Function | null = null;

// Mock the MCP SDK before importing mcp-server.ts
const mockServer = {
  setRequestHandler: mock((schema: any, handler: Function) => {
    // The ListToolsRequestSchema and CallToolRequestSchema are imported objects.
    // We identify them by the order they're registered: list first, then call.
    if (!capturedListToolsHandler) {
      capturedListToolsHandler = handler;
    } else {
      capturedCallToolHandler = handler;
    }
  }),
  connect: mock(async () => {}),
};

mock.module('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: class MockServer {
    constructor() {
      return mockServer;
    }
  },
}));

mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class MockTransport {},
}));

mock.module('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: 'ListToolsRequestSchema',
  CallToolRequestSchema: 'CallToolRequestSchema',
}));

// Suppress logger output during tests
let loggerSpies: ReturnType<typeof spyOn>[] = [];

// Save the original global fetch so we can restore it
const originalFetch = globalThis.fetch;

describe('MCP Save Tool', () => {
  beforeAll(async () => {
    loggerSpies = [
      spyOn(logger, 'info').mockImplementation(() => {}),
      spyOn(logger, 'debug').mockImplementation(() => {}),
      spyOn(logger, 'warn').mockImplementation(() => {}),
      spyOn(logger, 'error').mockImplementation(() => {}),
    ];

    // Import mcp-server.ts to trigger tool registration
    // The mocked MCP SDK prevents it from actually starting a server
    await import('../src/servers/mcp-server.js');
  });

  afterEach(() => {
    // Restore fetch after each test
    globalThis.fetch = originalFetch;
  });

  // Test 1: Tool is registered
  it('should register a save tool in the tools list', async () => {
    expect(capturedListToolsHandler).not.toBeNull();

    const result = await capturedListToolsHandler!();
    const toolNames = result.tools.map((t: any) => t.name);

    expect(toolNames).toContain('save');
  });

  // Test 2: Tool schema is correct
  it('should have correct schema with all 10 properties and enums', async () => {
    const result = await capturedListToolsHandler!();
    const saveTool = result.tools.find((t: any) => t.name === 'save');

    expect(saveTool).toBeDefined();

    // Check required fields
    expect(saveTool.inputSchema.required).toEqual(['title', 'text']);
    expect(saveTool.inputSchema.additionalProperties).toBe(true);

    // Check all 10 properties exist
    const props = saveTool.inputSchema.properties;
    const expectedProperties = [
      'title', 'text', 'type', 'project', 'memory_session_id',
      'facts', 'concepts', 'agent', 'department', 'visibility',
    ];
    for (const prop of expectedProperties) {
      expect(props[prop]).toBeDefined();
    }

    // Check type enum
    expect(props.type.enum).toEqual(['decision', 'bugfix', 'feature', 'refactor', 'discovery', 'change']);

    // Check visibility enum
    expect(props.visibility.enum).toEqual(['private', 'department', 'project', 'public']);
  });

  // Test 3: Tool handler calls worker API
  it('should call POST /api/save on the worker', async () => {
    let capturedUrl = '';
    let capturedOptions: any = {};

    globalThis.fetch = mock(async (url: any, options?: any) => {
      capturedUrl = String(url);
      capturedOptions = options || {};
      return new Response(JSON.stringify({ success: true, id: 42, memory_session_id: 'mcp-123', created_at_epoch: 1234567890 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    expect(capturedCallToolHandler).not.toBeNull();

    await capturedCallToolHandler!({
      params: {
        name: 'save',
        arguments: { title: 'Test', text: 'Content' },
      },
    });

    // Verify the correct endpoint was called
    expect(capturedUrl).toContain('/api/save');
    expect(capturedOptions.method).toBe('POST');
    expect(capturedOptions.headers['Content-Type']).toBe('application/json');

    // Verify the body was passed through
    const sentBody = JSON.parse(capturedOptions.body);
    expect(sentBody.title).toBe('Test');
    expect(sentBody.text).toBe('Content');
  });

  // Test 4: Tool handler wraps response in MCP format
  it('should wrap worker response in MCP content format', async () => {
    const workerResponse = { success: true, id: 1, memory_session_id: 'mcp-abc', created_at_epoch: 123 };

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify(workerResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }) as any;

    const result = await capturedCallToolHandler!({
      params: {
        name: 'save',
        arguments: { title: 'Test', text: 'Content' },
      },
    });

    // callWorkerAPIPost wraps in { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
    expect(result.content).toBeDefined();
    expect(result.content.length).toBe(1);
    expect(result.content[0].type).toBe('text');

    const parsedText = JSON.parse(result.content[0].text);
    expect(parsedText.success).toBe(true);
    expect(parsedText.id).toBe(1);
    expect(parsedText.memory_session_id).toBe('mcp-abc');
  });

  // Test 5: Tool handler returns error on worker failure
  it('should return isError on worker HTTP error', async () => {
    globalThis.fetch = mock(async () => {
      return new Response('title is required and must be a string', {
        status: 400,
        statusText: 'Bad Request',
      });
    }) as any;

    const result = await capturedCallToolHandler!({
      params: {
        name: 'save',
        arguments: { text: 'Content' }, // missing title
      },
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Error calling Worker API');
    expect(result.isError).toBe(true);
  });

  // Test 6: Tool handler handles network error
  it('should return isError on network failure', async () => {
    globalThis.fetch = mock(async () => {
      throw new Error('Connection refused');
    }) as any;

    const result = await capturedCallToolHandler!({
      params: {
        name: 'save',
        arguments: { title: 'Test', text: 'Content' },
      },
    });

    expect(result.content).toBeDefined();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain('Error calling Worker API');
    expect(result.content[0].text).toContain('Connection refused');
    expect(result.isError).toBe(true);
  });
});
