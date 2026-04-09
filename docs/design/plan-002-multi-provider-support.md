# Plan 002: Multi-Provider LLM Support (Azure AI & Vertex AI)

**Date**: 2026-04-09
**Status**: Draft
**Scope**: Expand LLM Wiki from Anthropic-only to support Azure AI Inference and Google Vertex AI (Gemini)

---

## Overview

This plan adds two new LLM provider backends to LLM Wiki:

1. **Azure AI Inference** -- unified endpoint for Azure-hosted models (OpenAI GPT-4o, Anthropic Claude, Mistral Large, DeepSeek) via `@azure-rest/ai-inference`.
2. **Google Vertex AI** -- Gemini models via `@google/genai` (replaces deprecated `@google-cloud/vertexai`).

Both must implement the existing `LLMProvider` interface (`complete`, `completeWithTools`, `countTokens`) so all upstream modules (ingest, query, lint) work without modification.

---

## Reference Documents

| Document | Path | Purpose |
|----------|------|---------|
| Refined Requirements | `docs/reference/refined-request-multi-provider.md` | Functional requirements, acceptance criteria |
| Technical Investigation | `docs/reference/investigation-multi-provider.md` | SDK choices, patterns, architecture decisions |
| Codebase Scan | `docs/reference/codebase-scan-multi-provider.md` | Current architecture, file impact analysis |
| Azure Error Handling | `docs/reference/research-azure-error-types.md` | `isUnexpected()`, error body structure, retry-after headers |
| Google GenAI Tools | `docs/reference/research-google-genai-tools.md` | Function calling, `parametersJsonSchema`, `countTokens` |
| Google GenAI Errors | `docs/reference/research-google-genai-errors.md` | `ApiError` class, HTTP status codes, retry classification |

---

## Parallelization Map

```
Phase 1 (retry refactor)
    |
Phase 2 (config extension)
    |
    +----> Phase 3 (Azure AI provider) ----+
    |                                       |
    +----> Phase 4 (Vertex AI provider) ---+
                                            |
                                       Phase 5 (factory & integration tests)
                                            |
                                       Phase 6 (documentation)
```

- Phase 1 must complete before Phase 2 (retry is used by all providers).
- Phase 2 must complete before Phases 3 and 4 (providers depend on updated config types).
- **Phases 3 and 4 can run in parallel** -- they are independent provider implementations.
- Phase 5 depends on both 3 and 4 completing.
- Phase 6 depends on Phase 5.

---

## Phase 1: Refactor Retry Module to Be Provider-Agnostic

### Objective

Remove the `@anthropic-ai/sdk` import from `src/llm/retry.ts` and replace Anthropic-specific `instanceof` error class checks with generic HTTP status code detection using duck-typing.

### Files to Modify

| File | Change |
|------|--------|
| `src/llm/retry.ts` | Remove `import Anthropic from '@anthropic-ai/sdk'`; replace all `instanceof` checks with `getHttpStatus()` duck-typing helper; add `getRetryAfterMs()` helper; classify errors by status code |

### Files to Create

| File | Purpose |
|------|---------|
| `test_scripts/test-retry-generic.ts` | Unit tests for the refactored retry module using mock errors with various status code patterns |

### Detailed Changes

**`src/llm/retry.ts`** -- Replace the entire error classification block:

1. Add a `getHttpStatus(error: unknown): number | undefined` helper that:
   - Checks `error.status` as `number` (Anthropic SDK, Google GenAI `ApiError`)
   - Checks `error.statusCode` as `number` (alternative convention)
   - Checks `error.status` as `string` and parses to `number` (Azure REST client returns string status codes like `"429"`)
   - Returns `undefined` if no status found

2. Add a `getRetryAfterMs(error: unknown): number | undefined` helper that:
   - Checks `error.headers` for `retry-after` key (Azure provides this on 429 responses)
   - Parses the value as seconds and converts to milliseconds
   - Returns `undefined` if not available

3. Replace error classification logic:
   - `status === 401 || status === 403` --> fail fast (authentication/permission)
   - `status === 400` --> fail fast (bad request)
   - `status === 429` --> retry with backoff; use `getRetryAfterMs()` delay if available, else exponential backoff
   - `status >= 500` --> retry with backoff
   - `status === 408` --> retry with backoff (request timeout)
   - No status / unknown --> fail fast (non-HTTP errors)

4. Keep the function signature unchanged: `callWithRetry<T>(fn: () => Promise<T>, maxRetries?: number): Promise<T>`

5. Keep `RetryOptions` and `DEFAULT_OPTIONS` unchanged.

### Acceptance Criteria

- [ ] `src/llm/retry.ts` has zero imports from `@anthropic-ai/sdk`
- [ ] `callWithRetry()` retries on errors with `.status === 429` regardless of error class
- [ ] `callWithRetry()` retries on errors with `.status >= 500` regardless of error class
- [ ] `callWithRetry()` retries on errors with `.status === "429"` (string, Azure pattern)
- [ ] `callWithRetry()` fails fast on errors with `.status === 400` or `.status === 401`
- [ ] `callWithRetry()` fails fast on errors with no `.status` property
- [ ] `callWithRetry()` respects `retry-after` header when present on the error object
- [ ] Existing Anthropic provider continues to work (Anthropic SDK errors have numeric `.status`)
- [ ] All tests in `test_scripts/test-retry-generic.ts` pass

### Verification Commands

```bash
# Run retry unit tests
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-retry-generic.ts

# TypeScript compilation check (ensure no type errors)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsc --noEmit

# Verify no Anthropic imports remain in retry.ts
grep -c "anthropic" src/llm/retry.ts  # Should output 0
```

---

## Phase 2: Extend Configuration

### Objective

Add Vertex AI config fields, make `apiKey` optional, update validation for provider-specific requirements, update the loader for new environment variables, and extend `CONTEXT_LIMITS` for non-Anthropic models.

### Files to Modify

| File | Change |
|------|--------|
| `src/config/types.ts` | Make `apiKey` optional (`apiKey?: string`); add `vertexProjectId?: string`; add `vertexLocation?: string` |
| `src/config/validator.ts` | Make `apiKey` check conditional (required only for `anthropic` and `azure`); add `vertex` block requiring `vertexProjectId` and `vertexLocation`; skip `apiKeyExpiry` warning for `vertex` |
| `src/config/loader.ts` | Add `WIKI_VERTEX_PROJECT_ID` and `WIKI_VERTEX_LOCATION` env var mappings in `applyEnvOverrides()` |
| `src/llm/tokens.ts` | Add entries to `CONTEXT_LIMITS` for Azure-hosted and Gemini models |
| `src/llm/anthropic.ts` | Add non-null assertion on `config.apiKey!` in constructor (validator guarantees it for `anthropic` provider) |
| `src/templates/config-template.json` | Add commented/example fields for `azureEndpoint`, `azureDeployment`, `vertexProjectId`, `vertexLocation` |

### Files to Create

| File | Purpose |
|------|---------|
| `test_scripts/test-config-validation-providers.ts` | Tests for provider-specific config validation rules |

### Detailed Changes

**`src/config/types.ts`**:

```typescript
export interface LLMConfig {
  provider: 'anthropic' | 'azure' | 'vertex';
  model: string;
  apiKey?: string;                   // Changed from required to optional
  apiKeyExpiry?: string;
  azureEndpoint?: string;            // Existing
  azureDeployment?: string;          // Existing
  vertexProjectId?: string;          // NEW
  vertexLocation?: string;           // NEW
  maxTokens: number;
}
```

**`src/config/validator.ts`** -- Replace unconditional `apiKey` check (currently at line 28-30):

```typescript
// Before (current):
if (!config.llm.apiKey) {
  throw new ConfigurationError('llm.apiKey', 'Missing required configuration: llm.apiKey');
}

// After:
if (config.llm.provider === 'anthropic' || config.llm.provider === 'azure') {
  if (!config.llm.apiKey) {
    throw new ConfigurationError(
      'llm.apiKey',
      `Missing required configuration: llm.apiKey (required when provider is ${config.llm.provider})`,
    );
  }
}
```

Add vertex-specific validation after the existing Azure block:

```typescript
// Vertex-specific required fields
if (config.llm.provider === 'vertex') {
  if (!config.llm.vertexProjectId) {
    throw new ConfigurationError(
      'llm.vertexProjectId',
      'Missing required configuration: llm.vertexProjectId (required when provider is vertex)',
    );
  }
  if (!config.llm.vertexLocation) {
    throw new ConfigurationError(
      'llm.vertexLocation',
      'Missing required configuration: llm.vertexLocation (required when provider is vertex)',
    );
  }
}
```

Update `checkApiKeyExpiry()` to skip when provider is `vertex`:

```typescript
export function checkApiKeyExpiry(config: WikiConfig): void {
  // Vertex uses ADC, no API key to expire
  if (config.llm.provider === 'vertex') {
    return;
  }
  // ... rest unchanged
}
```

**`src/config/loader.ts`** -- Add to `applyEnvOverrides()`:

```typescript
if (process.env.WIKI_VERTEX_PROJECT_ID) {
  llm.vertexProjectId = process.env.WIKI_VERTEX_PROJECT_ID;
}
if (process.env.WIKI_VERTEX_LOCATION) {
  llm.vertexLocation = process.env.WIKI_VERTEX_LOCATION;
}
```

**`src/llm/tokens.ts`** -- Extend `CONTEXT_LIMITS`:

```typescript
const CONTEXT_LIMITS: Record<string, number> = {
  // Anthropic (existing)
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-3-5-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,

  // Azure-hosted OpenAI models
  'gpt-4o': 128_000,
  'gpt-4o-mini': 128_000,
  'gpt-4-turbo': 128_000,
  'gpt-4.1': 1_047_576,
  'gpt-4.1-mini': 1_047_576,
  'gpt-4.1-nano': 1_047_576,

  // Azure-hosted Mistral models
  'mistral-large-latest': 128_000,
  'mistral-large-2411': 128_000,

  // Azure-hosted DeepSeek models
  'deepseek-r1': 64_000,
  'DeepSeek-V3.1': 128_000,

  // Google Gemini models (Vertex AI)
  'gemini-2.0-flash': 1_048_576,
  'gemini-2.5-flash': 1_048_576,
  'gemini-2.5-pro': 1_048_576,
  'gemini-1.5-pro': 2_097_152,
  'gemini-1.5-flash': 1_048_576,
};
```

**`src/llm/anthropic.ts`** -- Update constructor:

```typescript
constructor(config: LLMConfig) {
  this.client = new Anthropic({ apiKey: config.apiKey! });  // Add non-null assertion
  this.model = config.model;
}
```

### Acceptance Criteria

- [ ] `LLMConfig.apiKey` is optional in the TypeScript interface
- [ ] `LLMConfig.vertexProjectId` and `LLMConfig.vertexLocation` fields exist
- [ ] Validator throws `ConfigurationError('llm.apiKey', ...)` when `provider === 'anthropic'` and `apiKey` is missing
- [ ] Validator throws `ConfigurationError('llm.apiKey', ...)` when `provider === 'azure'` and `apiKey` is missing
- [ ] Validator does NOT throw for missing `apiKey` when `provider === 'vertex'`
- [ ] Validator throws `ConfigurationError('llm.vertexProjectId', ...)` when `provider === 'vertex'` and `vertexProjectId` is missing
- [ ] Validator throws `ConfigurationError('llm.vertexLocation', ...)` when `provider === 'vertex'` and `vertexLocation` is missing
- [ ] `checkApiKeyExpiry()` does not warn for `vertex` provider
- [ ] `WIKI_VERTEX_PROJECT_ID` and `WIKI_VERTEX_LOCATION` env vars are mapped in `loader.ts`
- [ ] `CONTEXT_LIMITS` contains entries for `gpt-4o`, `gemini-2.0-flash`, `gemini-1.5-pro`, `mistral-large-latest`
- [ ] `PromptBudgetAnalyzer` works with `gpt-4o` model (returns 128K context limit)
- [ ] TypeScript compilation passes with no errors
- [ ] All tests in `test_scripts/test-config-validation-providers.ts` pass

### Verification Commands

```bash
# Run config validation tests
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-config-validation-providers.ts

# TypeScript compilation
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsc --noEmit

# Run existing config tests (regression)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-config-loader.ts
```

---

## Phase 3: Implement Azure AI Provider (Parallelizable with Phase 4)

### Objective

Create `AzureAIProvider` class implementing `LLMProvider` using the `@azure-rest/ai-inference` SDK with `@azure/core-auth` for API key authentication.

### Prerequisites

- Phase 1 (generic retry) complete
- Phase 2 (config extension) complete

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `@azure-rest/ai-inference` (`^1.0.0-beta.6`) and `@azure/core-auth` (`^1.9.0`) |

### Files to Create

| File | Purpose |
|------|---------|
| `src/llm/azure-ai.ts` | `AzureAIProvider` class implementing `LLMProvider` |
| `test_scripts/test-azure-ai-provider.ts` | Unit and integration tests for the Azure AI provider |

### Detailed Design: `src/llm/azure-ai.ts`

**Class**: `AzureAIProvider implements LLMProvider`

**Constructor**:
```typescript
constructor(config: LLMConfig) {
  // config.azureEndpoint and config.apiKey guaranteed by validator
  this.client = ModelClient(
    config.azureEndpoint!,
    new AzureKeyCredential(config.apiKey!)
  );
  this.model = config.azureDeployment ?? config.model;
  this.maxTokens = config.maxTokens;
}
```

**Imports**:
```typescript
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";
```

**`complete()` method**:
1. Wrap in `callWithRetry()`
2. Map internal `MessageParam[]` to Azure format:
   - System prompt becomes `{ role: "system", content: systemPrompt }`
   - `role: "user"` maps directly
   - `role: "assistant"` maps directly
   - Content blocks: extract text from `ContentBlock[]` (concatenate text blocks)
3. Call `client.path("/chat/completions").post({ body: { messages, model, max_tokens, temperature } })`
4. Check `isUnexpected(response)`:
   - If unexpected: create an `Error` with `.status` set to `parseInt(response.status, 10)` and `.headers` set to `response.headers`, then throw it -- this allows `callWithRetry()` to classify and retry
5. Extract `response.body.choices[0].message.content`
6. Map usage: `prompt_tokens` -> `inputTokens`, `completion_tokens` -> `outputTokens`, cache fields = 0

**`completeWithTools()` method**:
1. Wrap in `callWithRetry()`
2. Map `ToolDefinition[]` to Azure format:
   ```typescript
   {
     type: "function",
     function: {
       name: tool.name,
       description: tool.description,
       parameters: tool.input_schema,
     }
   }
   ```
3. Map `toolChoice`:
   - `{ type: 'tool', name: 'X' }` -> `{ type: 'function', function: { name: 'X' } }`
   - `{ type: 'auto' }` -> `'auto'`
4. Call API with `tools` and `tool_choice` in body
5. Check `isUnexpected(response)` -- throw with status if unexpected
6. Extract `response.body.choices[0].message.tool_calls[0]`
7. Parse `JSON.parse(toolCall.function.arguments)` -- Azure returns arguments as a JSON string
8. Return `ToolCompletionResult` with `toolName`, `toolInput`, `usage`, `stopReason`

**`countTokens()` method**:
- Azure AI Inference has no native token counting endpoint
- Use `estimateTokens()` heuristic (same approach as current Anthropic implementation)
- Build full text from system + messages, pass to `estimateTokens()`

**Error conversion pattern** (critical for retry integration):
```typescript
if (isUnexpected(response)) {
  const error = new Error(response.body.error?.message ?? 'Azure AI request failed');
  (error as any).status = parseInt(response.status, 10);
  (error as any).headers = response.headers;
  throw error;
}
```

This ensures `callWithRetry()` can:
- Read `.status` as a number for classification
- Read `.headers["retry-after"]` for backoff timing

### Acceptance Criteria

- [ ] `AzureAIProvider` class exists in `src/llm/azure-ai.ts`
- [ ] `AzureAIProvider` implements all three `LLMProvider` methods
- [ ] `complete()` returns text from Azure `/chat/completions` endpoint
- [ ] `completeWithTools()` maps `ToolDefinition` to Azure function calling format and extracts function call results
- [ ] `completeWithTools()` parses `toolCall.function.arguments` (JSON string) to object
- [ ] Tool choice `{ type: 'tool', name: 'X' }` maps to `{ type: 'function', function: { name: 'X' } }`
- [ ] Error responses from Azure (non-2xx) are converted to thrown errors with numeric `.status`
- [ ] `Retry-After` header is propagated on the thrown error object
- [ ] `countTokens()` uses `estimateTokens()` heuristic
- [ ] Usage mapping: `prompt_tokens` -> `inputTokens`, `completion_tokens` -> `outputTokens`, cache fields = 0
- [ ] System prompt is sent as a `{ role: "system", content: ... }` message (Azure convention)
- [ ] All tests in `test_scripts/test-azure-ai-provider.ts` pass

### Verification Commands

```bash
# Install new dependencies
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npm install

# TypeScript compilation
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsc --noEmit

# Run provider tests (unit tests with mocks; integration requires Azure credentials)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-azure-ai-provider.ts

# Integration test (requires WIKI_AZURE_ENDPOINT, WIKI_AZURE_DEPLOYMENT, WIKI_LLM_API_KEY)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && WIKI_LLM_PROVIDER=azure npx tsx test_scripts/test-azure-ai-provider.ts --integration
```

---

## Phase 4: Implement Vertex AI Provider (Parallelizable with Phase 3)

### Objective

Create `VertexAIProvider` class implementing `LLMProvider` using the `@google/genai` SDK with Vertex AI backend and Application Default Credentials (ADC).

### Prerequisites

- Phase 1 (generic retry) complete
- Phase 2 (config extension) complete

### Critical SDK Note

Use `@google/genai` (NOT `@google-cloud/vertexai`). The `@google-cloud/vertexai` package was deprecated on June 24, 2025 and will be removed on June 24, 2026. The `@google/genai` SDK is Google's unified replacement.

### Files to Modify

| File | Change |
|------|--------|
| `package.json` | Add `@google/genai` (`^1.48.0`) |

### Files to Create

| File | Purpose |
|------|---------|
| `src/llm/vertex-ai.ts` | `VertexAIProvider` class implementing `LLMProvider` |
| `test_scripts/test-vertex-ai-provider.ts` | Unit and integration tests for the Vertex AI provider |

### Detailed Design: `src/llm/vertex-ai.ts`

**Class**: `VertexAIProvider implements LLMProvider`

**Constructor**:
```typescript
constructor(config: LLMConfig) {
  this.ai = new GoogleGenAI({
    vertexai: true,
    project: config.vertexProjectId!,    // Guaranteed by validator
    location: config.vertexLocation!,
  });
  this.model = config.model;
  this.maxTokens = config.maxTokens;
}
```

**Imports**:
```typescript
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import type { FunctionDeclaration, Content } from '@google/genai';
```

**`complete()` method**:
1. Wrap in `callWithRetry()`
2. Map messages to Gemini `Content[]` format:
   - `role: "user"` stays `"user"`
   - `role: "assistant"` becomes `"model"`
   - Content: `string` -> `[{ text: content }]`; `ContentBlock[]` -> extract text parts
3. System prompt goes in `config.systemInstruction` (NOT as a message)
4. Call `ai.models.generateContent({ model, contents, config: { systemInstruction, maxOutputTokens, temperature } })`
5. Extract response text via `response.text` convenience getter
6. Map usage: `response.usageMetadata?.promptTokenCount` -> `inputTokens`, `response.usageMetadata?.candidatesTokenCount` -> `outputTokens`, cache fields = 0
7. Stop reason from `response.candidates?.[0]?.finishReason`

**`completeWithTools()` method**:
1. Wrap in `callWithRetry()`
2. Map `ToolDefinition[]` to Gemini format using `parametersJsonSchema` (direct JSON Schema pass-through):
   ```typescript
   {
     functionDeclarations: tools.map(t => ({
       name: t.name,
       description: t.description,
       parametersJsonSchema: t.input_schema,
     }))
   }
   ```
3. Map `toolChoice`:
   - `{ type: 'tool', name: 'X' }` -> `{ functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['X'] } }`
   - `{ type: 'auto' }` -> `{ functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } }`
4. Call `ai.models.generateContent()` with `config.tools` and `config.toolConfig`
5. Extract function call via `response.functionCalls?.[0]`
6. `call.args` is already a parsed object (NOT a JSON string -- unlike Azure)
7. Return `ToolCompletionResult` with `toolName: call.name`, `toolInput: call.args`

**`countTokens()` method**:
- Use native `ai.models.countTokens()` API (Gemini supports this natively):
  ```typescript
  const result = await this.ai.models.countTokens({
    model: this.model,
    contents: this.mapMessages(params.messages),
  });
  return { inputTokens: result.totalTokens ?? 0 };
  ```
- This provides more accurate token counts than the heuristic used by Anthropic and Azure providers

**Message mapping helper**:
```typescript
private mapMessages(messages: MessageParam[]): Content[] {
  return messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : m.role,
    parts: typeof m.content === 'string'
      ? [{ text: m.content }]
      : m.content
          .filter(block => block.type === 'text')
          .map(block => ({ text: block.text! })),
  }));
}
```

**Error handling notes**:
- The `@google/genai` SDK **throws** `ApiError` on HTTP errors (unlike Azure which returns response objects)
- `ApiError` has a numeric `.status` property (e.g., 429, 500)
- This is directly compatible with the refactored `callWithRetry()` which reads `.status` via duck-typing
- The SDK has built-in retry (`p-retry`); we keep both retry layers (SDK handles transient network issues, our wrapper provides logged, configurable retry behavior)
- The SDK does NOT expose `Retry-After` headers on `ApiError`, so exponential backoff is the only option for 429s

### Acceptance Criteria

- [ ] `VertexAIProvider` class exists in `src/llm/vertex-ai.ts`
- [ ] `VertexAIProvider` implements all three `LLMProvider` methods
- [ ] `complete()` uses `ai.models.generateContent()` and returns text
- [ ] System prompt is passed via `config.systemInstruction` (not as a message)
- [ ] `role: "assistant"` is mapped to `role: "model"` for Gemini
- [ ] `completeWithTools()` uses `parametersJsonSchema` for tool definitions (direct JSON Schema pass-through)
- [ ] `completeWithTools()` uses `FunctionCallingConfigMode.ANY` with `allowedFunctionNames` for forced tool use
- [ ] Function call arguments (`call.args`) are used directly as parsed object (no `JSON.parse()`)
- [ ] `countTokens()` uses native `ai.models.countTokens()` API
- [ ] Usage mapping: `promptTokenCount` -> `inputTokens`, `candidatesTokenCount` -> `outputTokens`, cache fields = 0
- [ ] Authentication uses ADC (no API key passed to SDK)
- [ ] All tests in `test_scripts/test-vertex-ai-provider.ts` pass

### Verification Commands

```bash
# Install new dependency
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npm install

# TypeScript compilation
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsc --noEmit

# Run provider tests
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-vertex-ai-provider.ts

# Integration test (requires gcloud auth application-default login + GCP project)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && WIKI_LLM_PROVIDER=vertex WIKI_VERTEX_PROJECT_ID=my-project WIKI_VERTEX_LOCATION=us-central1 npx tsx test_scripts/test-vertex-ai-provider.ts --integration
```

---

## Phase 5: Update Factory and Integrate

### Objective

Wire the new provider classes into the factory, ensure end-to-end integration, and run comprehensive tests across all three providers.

### Prerequisites

- Phase 3 (Azure AI provider) complete
- Phase 4 (Vertex AI provider) complete

### Files to Modify

| File | Change |
|------|--------|
| `src/llm/factory.ts` | Import `AzureAIProvider` and `VertexAIProvider`; replace `throw new Error('Provider not yet implemented: ...')` with `return new AzureAIProvider(config)` and `return new VertexAIProvider(config)` |

### Detailed Changes

**`src/llm/factory.ts`**:

```typescript
import type { LLMProvider } from './provider.js';
import type { LLMConfig } from '../config/types.js';
import { AnthropicProvider } from './anthropic.js';
import { AzureAIProvider } from './azure-ai.js';
import { VertexAIProvider } from './vertex-ai.js';

export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'azure':
      return new AzureAIProvider(config);
    case 'vertex':
      return new VertexAIProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM provider: ${exhaustive}`);
    }
  }
}
```

### Integration Testing

Run the existing test suite to verify no regressions:

```bash
# Existing tests (should all pass unchanged)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-config-loader.ts
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-retry-generic.ts
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-config-validation-providers.ts
```

End-to-end smoke tests with each provider (requires credentials):

```bash
# Anthropic (existing)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx src/cli.ts query "What is TypeScript?"

# Azure AI (requires Azure credentials configured)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && WIKI_LLM_PROVIDER=azure WIKI_AZURE_ENDPOINT=https://... WIKI_AZURE_DEPLOYMENT=gpt-4o WIKI_LLM_API_KEY=... npx tsx src/cli.ts query "What is TypeScript?"

# Vertex AI (requires gcloud ADC configured)
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && WIKI_LLM_PROVIDER=vertex WIKI_VERTEX_PROJECT_ID=... WIKI_VERTEX_LOCATION=us-central1 WIKI_LLM_MODEL=gemini-2.0-flash npx tsx src/cli.ts query "What is TypeScript?"
```

### Acceptance Criteria

- [ ] `factory.ts` imports and instantiates `AzureAIProvider` for `provider === 'azure'`
- [ ] `factory.ts` imports and instantiates `VertexAIProvider` for `provider === 'vertex'`
- [ ] No `throw new Error('Provider not yet implemented...')` remains in factory
- [ ] TypeScript compilation passes
- [ ] `wiki query` command works with Anthropic provider (regression test)
- [ ] `wiki query` command works with Azure AI provider (given valid credentials)
- [ ] `wiki query` command works with Vertex AI provider (given valid credentials)
- [ ] `wiki ingest` command works with each provider (given valid credentials)

### Verification Commands

```bash
# TypeScript compilation
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsc --noEmit

# Run all unit test suites
cd /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki && npx tsx test_scripts/test-retry-generic.ts && npx tsx test_scripts/test-config-validation-providers.ts && npx tsx test_scripts/test-azure-ai-provider.ts && npx tsx test_scripts/test-vertex-ai-provider.ts
```

---

## Phase 6: Update Documentation

### Objective

Update all project documentation to reflect the multi-provider architecture.

### Prerequisites

- Phase 5 (factory integration) complete

### Files to Modify

| File | Change |
|------|--------|
| `docs/design/project-design.md` | Update technology stack table (add Azure AI Inference SDK, Google GenAI SDK); update source file listing (add `azure-ai.ts`, `vertex-ai.ts`); update LLM Provider Module section with new provider descriptions; update Dependencies section |
| `docs/design/project-functions.md` | Add FR-1 through FR-10 from the refined requirements document |
| `CLAUDE.md` | No changes needed (wiki CLI tool interface is unchanged; new providers are transparent) |

### Files to Create

| File | Purpose |
|------|---------|
| `docs/design/configuration-guide.md` | Full configuration guide per project conventions |

### Detailed Changes

**`docs/design/configuration-guide.md`** -- Must include per project convention:

1. **Configuration options and priority**: config.json < env vars < CLI params
2. **LLM configuration fields** (all providers):
   - `llm.provider`: Purpose, values (`anthropic`, `azure`, `vertex`), no default (required)
   - `llm.model`: Purpose, provider-specific values, no default (required)
   - `llm.apiKey`: Purpose, how to obtain (Anthropic console, Azure portal), required for `anthropic`/`azure`, not required for `vertex`
   - `llm.apiKeyExpiry`: Purpose (proactive expiry warnings), format (ISO 8601), recommended for `anthropic`/`azure`, irrelevant for `vertex`
   - `llm.maxTokens`: Purpose, recommended values per model, no default (required)
3. **Azure-specific fields**:
   - `llm.azureEndpoint`: Purpose, how to obtain (Azure portal > AI Foundry > endpoint URL), format (`https://<resource>.services.ai.azure.com`), required when `provider === 'azure'`
   - `llm.azureDeployment`: Purpose, how to obtain (Azure portal > model deployment name), required when `provider === 'azure'`
4. **Vertex-specific fields**:
   - `llm.vertexProjectId`: Purpose, how to obtain (`gcloud config get-value project`), required when `provider === 'vertex'`
   - `llm.vertexLocation`: Purpose, available regions (e.g., `us-central1`, `europe-west4`), required when `provider === 'vertex'`
5. **Environment variable mappings**: Full table of all `WIKI_*` env vars
6. **Example configurations**: Complete `config.json` examples for each provider
7. **Expiry warning proposal**: Recommend `apiKeyExpiry` for Azure keys (which rotate); note it is not applicable for Vertex (ADC handles credentials)

**`docs/design/project-design.md`** -- Key sections to update:

1. Technology Stack table: Add rows for `@azure-rest/ai-inference`, `@azure/core-auth`, `@google/genai`
2. Source File Structure: Add `src/llm/azure-ai.ts` and `src/llm/vertex-ai.ts`
3. Section 3.3 (LLM Provider Module): Add subsections for `AzureAIProvider` and `VertexAIProvider` describing their SDK usage, message mapping, tool definition translation, and error handling patterns
4. Dependencies section: Add the three new npm packages

**`docs/design/project-functions.md`** -- Add these functional requirements:
- FR: Azure AI Provider support
- FR: Azure AI Tool Use (function calling)
- FR: Azure AI Token Counting (heuristic)
- FR: Vertex AI Provider support
- FR: Vertex AI Tool Use (function calling)
- FR: Vertex AI Token Counting (native API)
- FR: Provider-Agnostic Retry
- FR: Extended Context Limits
- FR: Provider-Specific Configuration Validation
- FR: Factory Routing for all three providers

### Acceptance Criteria

- [ ] `docs/design/configuration-guide.md` exists and documents all config fields per project conventions
- [ ] Configuration guide explains priority: config.json < env vars < CLI params
- [ ] Configuration guide documents all env var mappings
- [ ] Configuration guide includes per-provider example `config.json` snippets
- [ ] Configuration guide proposes `apiKeyExpiry` for Azure keys
- [ ] `project-design.md` updated with new SDKs in technology stack
- [ ] `project-design.md` updated with new source files in file listing
- [ ] `project-design.md` updated with Azure/Vertex provider module descriptions
- [ ] `project-functions.md` includes all new functional requirements
- [ ] No stale references to "Anthropic-only" remain in documentation

### Verification Commands

```bash
# Verify all docs exist
ls -la /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki/docs/design/configuration-guide.md
ls -la /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki/docs/design/project-design.md
ls -la /Users/giorgosmarinos/aiwork/coding-platform/macbook-desktop/wiki/docs/design/project-functions.md
```

---

## Complete File Summary

### Files to Modify (10)

| File | Phase | Description |
|------|-------|-------------|
| `src/llm/retry.ts` | 1 | Remove Anthropic import; generic status code detection |
| `src/config/types.ts` | 2 | Make `apiKey` optional; add Vertex fields |
| `src/config/validator.ts` | 2 | Conditional `apiKey` validation; Vertex field validation |
| `src/config/loader.ts` | 2 | Add Vertex env var mappings |
| `src/llm/tokens.ts` | 2 | Extend `CONTEXT_LIMITS` for Azure/Gemini models |
| `src/llm/anthropic.ts` | 2 | Non-null assertion on `config.apiKey!` |
| `src/templates/config-template.json` | 2 | Add Vertex example fields |
| `package.json` | 3/4 | Add 3 new SDK dependencies |
| `src/llm/factory.ts` | 5 | Wire up new provider classes |
| `docs/design/project-design.md` | 6 | Multi-provider architecture |

### Files to Create (7)

| File | Phase | Description |
|------|-------|-------------|
| `test_scripts/test-retry-generic.ts` | 1 | Generic retry tests |
| `test_scripts/test-config-validation-providers.ts` | 2 | Config validation tests |
| `src/llm/azure-ai.ts` | 3 | Azure AI provider |
| `test_scripts/test-azure-ai-provider.ts` | 3 | Azure AI tests |
| `src/llm/vertex-ai.ts` | 4 | Vertex AI provider |
| `test_scripts/test-vertex-ai-provider.ts` | 4 | Vertex AI tests |
| `docs/design/configuration-guide.md` | 6 | Full configuration guide |

### Files Updated (Documentation Only, Phase 6)

| File | Description |
|------|-------------|
| `docs/design/project-functions.md` | Add multi-provider functional requirements |

### Files That Need NO Changes (Consumers)

These depend only on `LLMProvider` interface and work with any provider:

| File | Role |
|------|------|
| `src/ingest/pipeline.ts` | Receives `LLMProvider` via constructor |
| `src/ingest/summarizer.ts` | Receives `LLMProvider` as parameter |
| `src/ingest/extractor.ts` | Calls `completeWithTools()` |
| `src/ingest/merger.ts` | Calls `complete()` |
| `src/query/pipeline.ts` | Calls `completeWithTools()` then `complete()` |
| `src/lint/semantic.ts` | Calls `completeWithTools()` |
| `src/llm/tools.ts` | Pure data definitions |
| `src/llm/usage-tracker.ts` | Depends only on `TokenUsage` type |
| `src/commands/ingest.ts` | Creates provider via factory |
| `src/commands/query.ts` | Creates provider via factory |
| `src/commands/lint.ts` | Creates provider via factory |

---

## NPM Dependencies to Add

| Package | Version | Provider | Purpose |
|---------|---------|----------|---------|
| `@azure-rest/ai-inference` | `^1.0.0-beta.6` | Azure AI | Unified REST client for Azure AI model deployments |
| `@azure/core-auth` | `^1.9.0` | Azure AI | `AzureKeyCredential` for API key authentication |
| `@google/genai` | `^1.48.0` | Vertex AI | Unified Gemini SDK with Vertex AI support (replaces deprecated `@google-cloud/vertexai`) |

---

## Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| `@azure-rest/ai-inference` is still in beta (1.0.0-beta.6) | API surface may change between versions | Pin to specific beta version; monitor for stable release |
| Azure custom deployment names not in `CONTEXT_LIMITS` | `PromptBudgetAnalyzer` throws on unknown model | Document that `model` field must match known model identifiers; use `azureDeployment` for the deployment name |
| `parametersJsonSchema` support in `@google/genai` | Simplifies tool mapping; if unsupported, need Type enum conversion | Confirmed in SDK v1.48.0 README as the recommended approach |
| Double retry (Google GenAI SDK built-in + our wrapper) | More total attempts than intended | Acceptable trade-off; SDK handles transient network issues, our wrapper adds logging and config |
| `apiKey` becoming optional breaks TypeScript strictness | `AnthropicProvider` constructor gets `string \| undefined` | Add non-null assertion (`config.apiKey!`); validator guarantees presence for `anthropic` |
| Google GenAI `usageMetadata` field names may vary | Token usage mapping could return 0s | Check both `promptTokenCount`/`candidatesTokenCount` and `inputTokens`/`outputTokens` at runtime |

---

## Open Questions (Carried from Requirements)

| # | Question | Recommendation | Decision |
|---|----------|----------------|----------|
| 1 | Azure API version pinning | Hardcode initially; SDK handles API version internally | Hardcode |
| 2 | Vertex ADC vs. explicit credentials file | ADC only for now (covers local dev, CI/CD, GKE) | ADC only |
| 3 | Tool use compatibility across Azure models | Let API errors propagate; document model capabilities | Let propagate |
| 4 | `apiKey` for Vertex | Make optional in interface; validator skips for vertex | Make optional |
| 5 | Azure model family detection | Not needed; Azure AI Inference provides unified API | Not needed |
| 6 | Rate limit `Retry-After` handling | Parse header when present (Azure); exponential backoff otherwise | Parse + fallback |
