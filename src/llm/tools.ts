// src/llm/tools.ts -- Tool definitions for structured LLM extraction

import type { ToolDefinition } from './types.js';

// ---------------------------------------------------------------------------
// Typed interfaces for tool outputs
// ---------------------------------------------------------------------------

/** A single entity extracted from a source document. */
export interface ExtractedEntity {
  name: string;
  type: 'person' | 'organization' | 'technology' | 'concept' | 'event' | 'place';
  description: string;
  relevance: 'primary' | 'secondary' | 'mentioned';
}

/** A topic/concept extracted from a source document. */
export interface ExtractedTopic {
  name: string;
  description: string;
  relatedEntities: string[];
}

/** A cross-reference link between two wiki pages. */
export interface CrossReference {
  from: string;
  to: string;
  relationship: string;
}

/** Combined result from the extract_entities tool. */
export interface ExtractionResult {
  entities: ExtractedEntity[];
  topics: ExtractedTopic[];
  crossReferences: CrossReference[];
}

/** Result from the select_relevant_pages tool. */
export interface PageSelection {
  pages: Array<{
    path: string;
    relevance: string;
  }>;
}

/** Result from the identify_contradictions tool. */
export interface ContradictionResult {
  contradictions: Array<{
    page1: string;
    page2: string;
    claim1: string;
    claim2: string;
    explanation: string;
  }>;
  missingLinks: Array<{
    page: string;
    mentionedEntity: string;
    suggestedLink: string;
  }>;
}

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema for Anthropic tool use)
// ---------------------------------------------------------------------------

/**
 * Tool for extracting entities, topics, and cross-references from a source document.
 * Used during the ingest pipeline's extraction step.
 */
export const EXTRACT_ENTITIES_TOOL: ToolDefinition = {
  name: 'extract_entities',
  description: 'Extract entities, topics, and cross-references from a source document',
  input_schema: {
    type: 'object',
    properties: {
      entities: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Entity name' },
            type: {
              type: 'string',
              enum: ['person', 'organization', 'technology', 'concept', 'event', 'place'],
              description: 'Entity category',
            },
            description: { type: 'string', description: 'Brief description from the source' },
            relevance: {
              type: 'string',
              enum: ['primary', 'secondary', 'mentioned'],
              description: 'How central this entity is to the source',
            },
          },
          required: ['name', 'type', 'description', 'relevance'],
        },
      },
      topics: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Topic name' },
            description: { type: 'string', description: 'Brief description of the topic' },
            relatedEntities: {
              type: 'array',
              items: { type: 'string' },
              description: 'Names of entities related to this topic',
            },
          },
          required: ['name', 'description'],
        },
      },
      crossReferences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', description: 'Source page name' },
            to: { type: 'string', description: 'Target page name' },
            relationship: { type: 'string', description: 'Nature of the link' },
          },
          required: ['from', 'to', 'relationship'],
        },
      },
    },
    required: ['entities', 'topics', 'crossReferences'],
  },
};

/**
 * Tool for selecting wiki pages relevant to a user question.
 * Used during the query pipeline to identify context pages.
 */
export const SELECT_PAGES_TOOL: ToolDefinition = {
  name: 'select_relevant_pages',
  description: 'Select wiki pages relevant to answering a user question',
  input_schema: {
    type: 'object',
    properties: {
      pages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Wiki page file path' },
            relevance: { type: 'string', description: 'Why this page is relevant' },
          },
          required: ['path', 'relevance'],
        },
      },
    },
    required: ['pages'],
  },
};

/**
 * Tool for identifying contradictions and missing cross-references across wiki pages.
 * Used during the lint pipeline's semantic checks.
 */
export const IDENTIFY_CONTRADICTIONS_TOOL: ToolDefinition = {
  name: 'identify_contradictions',
  description: 'Identify contradictions and missing cross-references across wiki pages',
  input_schema: {
    type: 'object',
    properties: {
      contradictions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            page1: { type: 'string', description: 'First page containing the claim' },
            page2: { type: 'string', description: 'Second page containing the conflicting claim' },
            claim1: { type: 'string', description: 'The claim from page1' },
            claim2: { type: 'string', description: 'The conflicting claim from page2' },
            explanation: { type: 'string', description: 'Why these claims contradict' },
          },
          required: ['page1', 'page2', 'claim1', 'claim2', 'explanation'],
        },
      },
      missingLinks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            page: { type: 'string', description: 'Page that mentions the entity' },
            mentionedEntity: { type: 'string', description: 'Entity name mentioned but not linked' },
            suggestedLink: { type: 'string', description: 'Suggested wiki link target' },
          },
          required: ['page', 'mentionedEntity', 'suggestedLink'],
        },
      },
    },
    required: ['contradictions', 'missingLinks'],
  },
};
