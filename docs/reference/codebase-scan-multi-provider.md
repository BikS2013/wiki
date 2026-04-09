# Codebase Scan: Multi-Provider LLM Support

**Date**: 2026-04-09
**Purpose**: Map the current LLM provider architecture, configuration system, and all integration points to guide implementation of Azure AI and Vertex AI providers.

---

## 1. Current LLM Provider Architecture

### 1.1 Interface (`src/llm/provider.ts`)

The `LLMProvider` interface defines three methods that every provider must implement:

```typescript
interface LLMProvider {
  complete(params: CompletionParams): Promise<CompletionResult>;
  completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult>;
  countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult>;
}
```

All consumers depend exclusively on this interface -- never on a concrete class. This is a clean seam for adding new providers.

### 1.2 Shared Types (`src/llm/types.ts`)

Provider-agnostic types used across the entire system:

| Type | Purpose |
|------|---------|
| `CompletionParams` | System prompt, messages, maxTokens, temperature |
| `MessageParam` | Role + content (string or ContentBlock[]) |
| `ContentBlock` | Text or base64 image block |
| `CompletionResult` | text, usage (TokenUsage), stopReason |
| `ToolDefinition` | name, description, input_schema (JSON Schema) |
| `ToolCompletionParams` | Extends CompletionParams with tools[] and toolChoice |
| `ToolCompletionResult` | toolName, toolInput (parsed JSON), usage, stopReason |
| `TokenUsage` | inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens |
| `TokenCountResult` | inputTokens |

**Key observations**:
- `ContentBlock` uses Anthropic's `source.type: 'base64'` convention for images. Azure and Vertex use different image formats; new providers will need to translate.
- `ToolDefinition.input_schema` uses JSON Schema, which maps directly to all three providers' function calling formats.
- `toolChoice` supports `{ type: 'tool', name: string }` (forced) and `{ type: 'auto' }`. Azure AI uses `{ type: 'function', function: { name } }` format; Vertex uses `{ mode: 'ANY', allowedFunctionNames: [...] }`. Both providers must translate.
- `TokenUsage.cacheCreationTokens` and `cacheReadTokens` are Anthropic-specific. Azure and Vertex providers should return 0 for these fields.

### 1.3 Anthropic Implementation (`src/llm/anthropic.ts`)

`AnthropicProvider` implements `LLMProvider`:

- **Constructor**: Takes `LLMConfig`, creates `new Anthropic({ apiKey })`, stores `config.model`.
- **complete()**: Wraps `client.messages.create()` in `callWithRetry()`. Extracts text from `TextBlock` content blocks.
- **completeWithTools()**: Same pattern, passes tools and toolChoice to the SDK. Finds the `ToolUseBlock` in the response.
- **countTokens()**: Uses heuristic estimation via `estimateTokens()` (the SDK version doesn't support `countTokens`).
- **mapMessages()**: Converts internal `MessageParam[]` to Anthropic SDK format.
- **mapUsage()**: Converts SDK `Usage` to internal `TokenUsage`, including cache fields.

**Pattern to follow**: Each new provider class should:
1. Accept `LLMConfig` in the constructor
2. Wrap API calls in `callWithRetry()` (after it is refactored to be generic)
3. Translate internal types to/from the provider SDK types
4. Return results conforming to `CompletionResult` / `ToolCompletionResult`

### 1.4 Factory (`src/llm/factory.ts`)

```typescript
export function createProvider(config: LLMConfig): LLMProvider {
  switch (config.provider) {
    case 'anthropic': return new AnthropicProvider(config);
    case 'azure':     throw new Error('Provider not yet implemented: azure');
    case 'vertex':    throw new Error('Provider not yet implemented: vertex');
    default:          // exhaustive check via `never`
  }
}
```

The switch already has placeholder cases for `azure` and `vertex`. The `default` branch uses TypeScript's exhaustive check pattern (`const exhaustive: never = config.provider`), which means adding a new value to the `provider` union type will produce a compile-time error if the case is not handled.

**Changes needed**: Import `AzureAIProvider` and `VertexAIProvider`, replace `throw` with `return new XxxProvider(config)`.

### 1.5 Tool Definitions (`src/llm/tools.ts`)

Three tool definitions with JSON Schema `input_schema`:
- `EXTRACT_ENTITIES_TOOL` -- used by `src/ingest/extractor.ts`
- `SELECT_PAGES_TOOL` -- used by `src/query/pipeline.ts`
- `IDENTIFY_CONTRADICTIONS_TOOL` -- used by `src/lint/semantic.ts`

**No changes needed** -- these are provider-agnostic JSON Schema definitions. Each provider must translate them to its SDK's function declaration format internally.

### 1.6 Usage Tracker (`src/llm/usage-tracker.ts`)

Accumulates `TokenUsage` across multiple LLM calls. Fully provider-agnostic -- depends only on `TokenUsage` from `types.ts`. **No changes needed.**

---

## 2. Retry and Token Estimation

### 2.1 Retry Module (`src/llm/retry.ts`) -- COUPLED TO ANTHROPIC

The current `callWithRetry()` function is **tightly coupled to the Anthropic SDK**:

```typescript
import Anthropic from '@anthropic-ai/sdk';

// Uses these Anthropic-specific error classes:
error instanceof Anthropic.AuthenticationError   // fail fast
error instanceof Anthropic.BadRequestError        // fail fast
error instanceof Anthropic.RateLimitError         // retry with backoff
error instanceof Anthropic.APIError               // retry if status >= 500
```

**Refactoring plan**: Replace Anthropic error class checks with generic HTTP status code detection:
- Extract `status` from error objects using duck-typing: `(error as any).status` or `(error as any).statusCode`
- 401/403 -> fail fast (authentication)
- 400 -> fail fast (bad request)
- 429 -> retry with backoff (rate limit), parse `Retry-After` header if present
- 500+ -> retry with backoff (server error)
- Unknown errors -> fail fast

The function signature (`callWithRetry<T>(fn, maxRetries?)`) can remain the same. The `RetryOptions` interface is already generic.

### 2.2 Token Estimation (`src/llm/tokens.ts`) -- PARTIALLY COUPLED

**`estimateTokens()`**: Generic heuristic (chars/4 + 15% margin). Provider-agnostic. **No changes needed.**

**`PromptBudgetAnalyzer`**: **Coupled to Anthropic models** in `CONTEXT_LIMITS`:

```typescript
const CONTEXT_LIMITS: Record<string, number> = {
  'claude-opus-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-20250514': 200_000,
  'claude-haiku-3-5-20241022': 200_000,
  'claude-3-opus-20240229': 200_000,
  'claude-3-5-sonnet-20241022': 200_000,
};
```

The constructor **throws** if the model is not in this map. This will break immediately when any non-Anthropic model is used.

**Changes needed**: Add entries for Azure-hosted models and Vertex models:
- `gpt-4o`: 128,000
- `gpt-4o-mini`: 128,000
- `mistral-large-latest`: 128,000
- `deepseek-r1`: 64,000 (or as applicable)
- `gemini-2.0-flash`: 1,048,576
- `gemini-1.5-pro`: 2,097,152
- `gemini-2.5-pro`: 1,048,576

---

## 3. Configuration System

### 3.1 Config Types (`src/config/types.ts`)

```typescript
export interface LLMConfig {
  provider: 'anthropic' | 'azure' | 'vertex';
  model: string;
  apiKey: string;              // Currently required (non-optional)
  apiKeyExpiry?: string;
  azureEndpoint?: string;      // Already present
  azureDeployment?: string;    // Already present
  maxTokens: number;
}
```

**Changes needed**:
1. Make `apiKey` optional (`apiKey?: string`) -- Vertex uses ADC, not API keys
2. Add `vertexProjectId?: string`
3. Add `vertexLocation?: string`

### 3.2 Config Loader (`src/config/loader.ts`)

Environment variable mappings already include Azure:

| Env Var | Target Field |
|---------|-------------|
| `WIKI_LLM_PROVIDER` | `llm.provider` |
| `WIKI_LLM_MODEL` | `llm.model` |
| `WIKI_LLM_API_KEY` | `llm.apiKey` |
| `WIKI_LLM_MAX_TOKENS` | `llm.maxTokens` |
| `WIKI_ROOT_DIR` | `wiki.rootDir` |
| `WIKI_AZURE_ENDPOINT` | `llm.azureEndpoint` |
| `WIKI_AZURE_DEPLOYMENT` | `llm.azureDeployment` |

**Changes needed**: Add two new env var mappings in `applyEnvOverrides()`:
- `WIKI_VERTEX_PROJECT_ID` -> `llm.vertexProjectId`
- `WIKI_VERTEX_LOCATION` -> `llm.vertexLocation`

### 3.3 Config Validator (`src/config/validator.ts`)

Current validation flow:
1. Checks `llm.provider` exists and is in `['anthropic', 'azure', 'vertex']` (already supports all three values)
2. Checks `llm.model` is present
3. Checks `llm.apiKey` is present -- **always required, even for vertex** (BUG for vertex)
4. Checks `llm.maxTokens` is positive integer
5. If `provider === 'azure'`: requires `azureEndpoint` and `azureDeployment`
6. No vertex-specific validation exists yet

**Changes needed**:
1. Make `apiKey` check conditional: required only when `provider === 'anthropic'` or `provider === 'azure'`
2. Add vertex-specific block: require `vertexProjectId` and `vertexLocation` when `provider === 'vertex'`

The `checkApiKeyExpiry()` function should be skipped or harmless for Vertex (it checks `config.llm.apiKeyExpiry` which will be undefined).

---

## 4. Complete File Modification List

### Files to MODIFY

| File | Changes Required | Effort |
|------|-----------------|--------|
| `src/config/types.ts` | Make `apiKey` optional; add `vertexProjectId?`, `vertexLocation?` | Small |
| `src/config/loader.ts` | Add `WIKI_VERTEX_PROJECT_ID` and `WIKI_VERTEX_LOCATION` env var mappings | Small |
| `src/config/validator.ts` | Conditional `apiKey` validation; add vertex field validation | Small |
| `src/llm/retry.ts` | Remove `@anthropic-ai/sdk` import; use generic status code checks | Medium |
| `src/llm/anthropic.ts` | No structural changes if retry signature stays the same; may need minor adaptation if `apiKey` becomes optional (constructor already reads `config.apiKey`) | Small |
| `src/llm/factory.ts` | Import and instantiate `AzureAIProvider` and `VertexAIProvider` | Small |
| `src/llm/tokens.ts` | Extend `CONTEXT_LIMITS` with non-Anthropic models | Small |
| `package.json` | Add `@azure-rest/ai-inference`, `@azure/core-auth`, `@google-cloud/vertexai` | Small |
| `src/templates/config-template.json` | Add azure and vertex example fields | Small |

### Files to CREATE

| File | Purpose | Effort |
|------|---------|--------|
| `src/llm/azure-ai.ts` | `AzureAIProvider` implementing `LLMProvider` | Large |
| `src/llm/vertex-ai.ts` | `VertexAIProvider` implementing `LLMProvider` | Large |
| `test_scripts/test-azure-ai-provider.ts` | Tests for Azure AI provider | Medium |
| `test_scripts/test-vertex-ai-provider.ts` | Tests for Vertex AI provider | Medium |
| `test_scripts/test-retry-generic.ts` | Tests for refactored retry module | Medium |
| `test_scripts/test-config-validation-providers.ts` | Tests for provider-specific config validation | Medium |

### Files that need NO changes (consumers)

These files depend only on the `LLMProvider` interface and will work with any provider:

| File | How it uses the provider |
|------|------------------------|
| `src/ingest/pipeline.ts` | Receives `LLMProvider` via constructor; calls `complete()` for entity/topic page creation |
| `src/ingest/summarizer.ts` | Receives `LLMProvider` as parameter; calls `complete()` |
| `src/ingest/extractor.ts` | Receives `LLMProvider` as parameter; calls `completeWithTools()` with `EXTRACT_ENTITIES_TOOL` |
| `src/ingest/merger.ts` | Receives `LLMProvider` as parameter; calls `complete()` |
| `src/query/pipeline.ts` | Receives `LLMProvider` via constructor; calls `completeWithTools()` then `complete()` |
| `src/lint/semantic.ts` | Receives `LLMProvider` as parameter; calls `completeWithTools()` with `IDENTIFY_CONTRADICTIONS_TOOL` |
| `src/llm/tools.ts` | Pure data definitions, no provider dependency |
| `src/llm/usage-tracker.ts` | Depends only on `TokenUsage` type |

---

## 5. Integration Points (Where Providers Are Created/Used)

There are exactly **three call sites** where `createProvider()` is invoked:

1. **`src/commands/ingest.ts`** (line 35):
   ```typescript
   const provider = createProvider(config.llm);
   ```
   Then passed to `new IngestPipeline(config, provider, logger)`.

2. **`src/commands/query.ts`** (line 28):
   ```typescript
   const provider = createProvider(config.llm);
   ```
   Then passed to `new QueryPipeline(provider, pageManager, indexManager, logWriter, config, logger)`.

3. **`src/commands/lint.ts`** (line 90):
   ```typescript
   const provider = createProvider(config.llm);
   ```
   Then passed to `runSemanticChecks(provider, wikiDir, logger)`.

All three follow the same pattern: create provider from config, inject into consumer. No command file needs modification -- the factory handles routing transparently.

The CLI (`src/cli.ts`) itself does NOT import the factory. It loads config in a `preAction` hook and stores it as `program.setOptionValue('_config', config)`. Each command retrieves the config and creates the provider locally.

---

## 6. Patterns to Follow for Consistency

### 6.1 Provider Class Pattern

Based on `AnthropicProvider`, each new provider should:

```typescript
export class XxxProvider implements LLMProvider {
  private readonly client: SdkClient;
  private readonly model: string;

  constructor(config: LLMConfig) {
    // Initialize SDK client from config fields
    // Store model name
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      // 1. Translate params to SDK format
      // 2. Call SDK
      // 3. Extract text from response
      // 4. Map usage to TokenUsage
      // 5. Return CompletionResult
    });
  }

  async completeWithTools(params: ToolCompletionParams): Promise<ToolCompletionResult> {
    return callWithRetry(async () => {
      // 1. Translate tool definitions to SDK format
      // 2. Translate toolChoice to SDK format
      // 3. Call SDK
      // 4. Find function call in response
      // 5. Parse JSON arguments
      // 6. Return ToolCompletionResult
    });
  }

  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    // Use SDK's token counting if available, else estimateTokens()
  }
}
```

### 6.2 Tool Definition Translation

Each provider must translate `ToolDefinition` to its SDK format:

- **Anthropic**: Direct pass-through (the `input_schema` matches Anthropic's format)
- **Azure AI**: Map to `{ type: 'function', function: { name, description, parameters: input_schema } }`
- **Vertex AI**: Map to Gemini's `FunctionDeclaration { name, description, parameters: { type: 'OBJECT', properties: ..., required: ... } }`

### 6.3 Tool Choice Translation

- **Anthropic**: `{ type: 'tool', name }` or `{ type: 'auto' }`
- **Azure AI**: `{ type: 'function', function: { name } }` or `'auto'`
- **Vertex AI**: `{ mode: 'ANY', allowedFunctionNames: [name] }` or `{ mode: 'AUTO' }`

### 6.4 Test Script Pattern

Tests use Node.js built-in test runner (`node:test`) with `describe`/`it`/`assert`:

```typescript
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
```

No external test frameworks. Tests are run with: `npx tsx test_scripts/test-xxx.ts`

Config tests create temporary directories, write config files, test validation, and clean up. Provider tests should mock the SDK clients or use integration tests with real credentials.

### 6.5 Configuration Convention

Per project rules: **no fallback values**. Every required field must throw `ConfigurationError` with the field name if missing. The validator already follows this pattern consistently.

### 6.6 Error Messages

Configuration errors follow the pattern:
```typescript
throw new ConfigurationError(
  'llm.fieldName',
  'Missing required configuration: llm.fieldName (required when provider is xxx)',
);
```

---

## 7. Risk Areas and Considerations

1. **`apiKey` becoming optional**: The `AnthropicProvider` constructor reads `config.apiKey` directly. After making it optional in the type, the Anthropic constructor will get `string | undefined`. The validator guarantees it is present for `anthropic`, but TypeScript won't know that. Consider a non-null assertion or a runtime guard in the constructor.

2. **Retry module coupling**: The refactored retry must work with errors from three different SDKs. Each SDK throws different error types. The safest approach is duck-typing on `status`/`statusCode` properties.

3. **`PromptBudgetAnalyzer` throws on unknown models**: Any model string not in `CONTEXT_LIMITS` causes a hard error. Since Azure users may deploy custom model names (e.g., `my-gpt4o-deployment`), consider whether to relax this to a warning or add a config-level override for context limit.

4. **Image content blocks**: `ContentBlock` uses `source.type: 'base64'` which is Anthropic's format. Currently no consumer sends image content, so this is not a blocker, but it limits future image support for non-Anthropic providers.

5. **Cache token fields**: `TokenUsage` includes `cacheCreationTokens` and `cacheReadTokens`. Azure and Vertex do not support Anthropic-style prompt caching. New providers should return 0 for both fields.
