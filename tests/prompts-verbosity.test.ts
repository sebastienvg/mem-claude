import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { buildInitPrompt, buildContinuationPrompt } from '../src/sdk/prompts.js';
import type { ModeConfig } from '../src/services/domain/types.js';

function createMockMode(): ModeConfig {
  return {
    name: 'test',
    description: 'Test mode',
    version: '1.0.0',
    observation_types: [{ id: 'test', label: 'Test', description: 'Test type', emoji: '🔵', work_emoji: '🛠️' }],
    observation_concepts: [{ id: 'test', label: 'Test', description: 'Test concept' }],
    prompts: {
      system_identity: 'You are a test observer.',
      spatial_awareness: 'Spatial awareness text.',
      observer_role: 'Observer role text.',
      recording_focus: 'Recording focus text.',
      skip_guidance: 'Skip guidance text.',
      type_guidance: 'Type guidance text.',
      concept_guidance: 'Concept guidance text.',
      field_guidance: 'Field guidance text.',
      output_format_header: 'Output format header.',
      format_examples: '',
      footer: 'FOOTER_MARKER',
      xml_title_placeholder: '[title]',
      xml_subtitle_placeholder: '[subtitle]',
      xml_fact_placeholder: '[fact]',
      xml_narrative_placeholder: '[narrative]',
      xml_concept_placeholder: '[concept]',
      xml_file_placeholder: '[file]',
      xml_summary_request_placeholder: '[request]',
      xml_summary_investigated_placeholder: '[investigated]',
      xml_summary_learned_placeholder: '[learned]',
      xml_summary_completed_placeholder: '[completed]',
      xml_summary_next_steps_placeholder: '[next_steps]',
      xml_summary_notes_placeholder: '[notes]',
      header_memory_start: 'MEMORY START',
      header_memory_continued: 'MEMORY CONTINUED',
      header_summary_checkpoint: 'SUMMARY CHECKPOINT',
      continuation_greeting: 'Hello again.',
      continuation_instruction: 'Continue observing.',
      summary_instruction: 'Summarize.',
      summary_context_label: 'Context:',
      summary_format_instruction: 'Use XML:',
      summary_footer: 'Summary footer.',
    },
  };
}

describe('Verbosity injection in prompts', () => {
  const originalEnv = process.env.CLAUDE_MEM_VERBOSITY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.CLAUDE_MEM_VERBOSITY = originalEnv;
    } else {
      delete process.env.CLAUDE_MEM_VERBOSITY;
    }
  });

  describe('buildInitPrompt', () => {
    it('should include minimal verbosity instruction when set to minimal', () => {
      process.env.CLAUDE_MEM_VERBOSITY = 'minimal';
      const prompt = buildInitPrompt('test-project', 'session-1', 'Do something', createMockMode());
      expect(prompt).toContain('VERBOSITY: minimal');
      expect(prompt).toContain('1-2 sentence');
    });

    it('should include detailed verbosity instruction when set to detailed', () => {
      process.env.CLAUDE_MEM_VERBOSITY = 'detailed';
      const prompt = buildInitPrompt('test-project', 'session-1', 'Do something', createMockMode());
      expect(prompt).toContain('VERBOSITY: detailed');
      expect(prompt).toContain('rich context');
    });

    it('should NOT include verbosity instruction when set to standard', () => {
      process.env.CLAUDE_MEM_VERBOSITY = 'standard';
      const prompt = buildInitPrompt('test-project', 'session-1', 'Do something', createMockMode());
      expect(prompt).not.toContain('VERBOSITY:');
    });
  });

  describe('buildContinuationPrompt', () => {
    it('should include minimal verbosity instruction when set to minimal', () => {
      process.env.CLAUDE_MEM_VERBOSITY = 'minimal';
      const prompt = buildContinuationPrompt('Do something', 2, 'session-1', createMockMode());
      expect(prompt).toContain('VERBOSITY: minimal');
      expect(prompt).toContain('1-2 sentence');
    });

    it('should include detailed verbosity instruction when set to detailed', () => {
      process.env.CLAUDE_MEM_VERBOSITY = 'detailed';
      const prompt = buildContinuationPrompt('Do something', 2, 'session-1', createMockMode());
      expect(prompt).toContain('VERBOSITY: detailed');
      expect(prompt).toContain('rich context');
    });

    it('should NOT include verbosity instruction when set to standard', () => {
      process.env.CLAUDE_MEM_VERBOSITY = 'standard';
      const prompt = buildContinuationPrompt('Do something', 2, 'session-1', createMockMode());
      expect(prompt).not.toContain('VERBOSITY:');
    });
  });
});
