# Research: Anthropic SDK Structured Output & Tool Use

## Summary

The `@anthropic-ai/sdk` provides two primary mechanisms for extracting structured data from Claude: **tool use (function calling)** and **prompt-based JSON extraction**. For the LLM Wiki ingest workflow, tool use is the recommended approach — it provides schema enforcement and reliable JSON parsing.

---

## 1. Tool Use / Function Calling

### Defining Tools

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

const tools: Anthropic.Tool[] = [
  {
    name: 'extract_entities',
    description: 'Extract entities (people, organizations, technologies, concepts) mentioned in the source document',
    input_schema: {
      type: 'object' as const,
      properties: {
        entities: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Entity name' },
              type: { type: 'string', enum: ['person', 'organization', 'technology', 'concept', 'event', 'place'] },
              description: { type: 'string', description: 'Brief description from the source' },
              relevance: { type: 'string', enum: ['primary', 'secondary', 'mentioned'] }
            },
            required: ['name', 'type', 'description', 'relevance']
          }
        },
        topics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              related_entities: { type: 'array', items: { type: 'string' } }
            },
            required: ['name', 'description']
          }
        },
        cross_references: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', description: 'Source page name' },
              to: { type: 'string', description: 'Target page name' },
              relationship: { type: 'string', description: 'Nature of the link' }
            },
            required: ['from', 'to', 'relationship']
          }
        }
      },
      required: ['entities', 'topics', 'cross_references']
    }
  }
];
```

### Parsing Tool Use Responses

```typescript
const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  tools,
  tool_choice: { type: 'tool', name: 'extract_entities' }, // Force tool use
  messages: [{ role: 'user', content: sourceContent }],
  system: schemaPrompt
});

// Extract the tool use block
const toolUseBlock = response.content.find(
  (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
);

if (!toolUseBlock) {
  throw new Error('LLM did not return tool_use response');
}

const extracted = toolUseBlock.input as {
  entities: Array<{ name: string; type: string; description: string; relevance: string }>;
  topics: Array<{ name: string; description: string; related_entities?: string[] }>;
  cross_references: Array<{ from: string; to: string; relationship: string }>;
};
```

### Key Points
- Use `tool_choice: { type: 'tool', name: 'tool_name' }` to force the model to call a specific tool — guarantees structured output
- Use `tool_choice: { type: 'auto' }` when the model should decide whether to use a tool
- The `input` field contains the parsed JSON matching your schema
- Tool use supports nested objects and arrays

---

## 2. Multi-Step Chained Prompts

For the ingest workflow, chain multiple LLM calls sequentially:

```typescript
// Step 1: Summarize the source
const summaryResponse = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: [{ role: 'user', content: `Summarize this source document:\n\n${sourceContent}` }],
  system: 'You are a wiki editor. Write a concise summary in markdown with YAML frontmatter.'
});

const summaryMarkdown = summaryResponse.content
  .filter((b): b is Anthropic.TextBlock => b.type === 'text')
  .map(b => b.text)
  .join('');

// Step 2: Extract entities and topics (structured)
const extractionResponse = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  tools,
  tool_choice: { type: 'tool', name: 'extract_entities' },
  messages: [{
    role: 'user',
    content: `Given this source summary and original document, extract all entities, topics, and cross-references.\n\nSummary:\n${summaryMarkdown}\n\nOriginal:\n${sourceContent}`
  }],
  system: schemaPrompt
});

// Step 3: For each entity, merge into existing page (if exists)
for (const entity of extracted.entities) {
  const existingPage = await readWikiPage(`entities/${kebabCase(entity.name)}.md`);
  if (existingPage) {
    const mergeResponse = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Merge new information into this existing wiki page.\n\nExisting page:\n${existingPage}\n\nNew information from source "${sourceName}":\n${entity.description}\n\nPreserve existing content. Add new information. Note contradictions with > [!warning] Contradiction callout.`
      }],
      system: schemaPrompt
    });
    // Write updated page
  } else {
    // Create new entity page
  }
}
```

### Best Practices for Chaining
- Each step should have a focused, single-purpose prompt
- Pass only relevant context forward (not the entire conversation)
- Use structured output (tool use) for extraction steps, free-form text for content generation
- Track token usage across all calls: `response.usage.input_tokens + response.usage.output_tokens`

---

## 3. Error Handling

```typescript
import Anthropic from '@anthropic-ai/sdk';

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      if (error instanceof Anthropic.APIError && error.status >= 500) {
        if (attempt < maxRetries) continue;
      }
      throw error;
    }
  }
  throw new Error('Max retries exceeded');
}
```

### Common Error Types
- `Anthropic.RateLimitError` (429) — retry with exponential backoff
- `Anthropic.APIError` with status 500+ — transient, retry
- `Anthropic.AuthenticationError` (401) — bad API key, fail fast
- `Anthropic.BadRequestError` (400) — prompt too large or invalid, fail fast

---

## 4. Streaming vs Non-Streaming

For the wiki CLI's batch processing, **non-streaming** is recommended:
- Simpler code, easier error handling
- Token usage available immediately in response
- No need for real-time display during ingest

Use streaming only for interactive query mode if desired:

```typescript
const stream = client.messages.stream({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 4096,
  messages: [{ role: 'user', content: question }]
});

for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}

const finalMessage = await stream.finalMessage();
// finalMessage.usage has accurate token counts
```

---

## Recommendations for LLM Wiki

1. **Use tool_choice: { type: 'tool' }** for all extraction steps to guarantee structured JSON
2. **Use free-form text responses** for summary generation and page merging (markdown output)
3. **Chain 3-4 focused calls per ingest** rather than one massive prompt
4. **Non-streaming for all batch operations**, optional streaming for query command
5. **Wrap all LLM calls** in a retry utility with exponential backoff
6. **Track cumulative usage** across all calls in a single ingest operation for cost visibility
