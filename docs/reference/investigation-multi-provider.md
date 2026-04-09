# Investigation: Multi-Provider LLM Support (Azure AI & Vertex AI)

**Date**: 2026-04-09
**Status**: Complete
**Scope**: Technical investigation for adding Azure AI Inference and Google Vertex AI providers to LLM Wiki

---

## 1. Executive Summary

### Recommended Approach

1. **Azure AI**: Use `@azure-rest/ai-inference` (currently at `1.0.0-beta.6`) with `@azure/core-auth` for API key authentication. This REST client provides a unified interface to all Azure-hosted models (OpenAI, Anthropic, Mistral, DeepSeek) through a single `/chat/completions` endpoint. It supports function calling natively and returns token usage in responses. The SDK is still in beta but is Microsoft's recommended path for Azure AI model inference in JavaScript/TypeScript.

2. **Vertex AI**: Use `@google/genai` (currently at `^1.48.0`) instead of the originally planned `@google-cloud/vertexai`. The `@google-cloud/vertexai` package was **deprecated on June 24, 2025** and will be removed on June 24, 2026. The `@google/genai` SDK is Google's unified replacement, supporting both Gemini Developer API and Vertex AI through the same client. It supports function calling, native `countTokens`, and Application Default Credentials (ADC).

3. **Retry strategy**: Refactor to a generic HTTP-status-code-based approach. The Azure REST client does **not throw exceptions** for HTTP errors (it returns response objects with status codes), which requires a different error-handling pattern than Anthropic. The `@google/genai` SDK has built-in retry with exponential backoff, but we should still wrap calls in our own retry for consistency. Use duck-typing on `status`/`statusCode` properties for errors that are thrown.

4. **Configuration impact**: The SDK change from `@google-cloud/vertexai` to `@google/genai` does not change the config schema -- we still need `vertexProjectId` and `vertexLocation`. The `@google/genai` SDK accepts these as constructor parameters (`project` and `location`).

### Critical Change from Original Plan

The refined request document specifies `@google-cloud/vertexai` as the Vertex AI SDK. **This must be changed to `@google/genai`**. The original package is deprecated and will be removed in June 2026. The replacement SDK has a different API surface that affects the provider implementation.

---

## 2. Detailed Analysis

### 2.1 Azure AI Inference SDK

#### Package: `@azure-rest/ai-inference`

| Attribute | Value |
|-----------|-------|
| npm package | `@azure-rest/ai-inference` |
| Latest version | `1.0.0-beta.6` (no stable release yet) |
| Authentication companion | `@azure/core-auth` for `AzureKeyCredential` |
| API style | REST client (returns response objects, not exceptions) |
| TypeScript support | Full TypeScript types included |

#### Client Initialization

```typescript
import ModelClient from "@azure-rest/ai-inference";
import { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

const client = ModelClient(
  "https://<resource>.services.ai.azure.com/models",
  new AzureKeyCredential("<api-key>")
);
```

Key observations:
- `ModelClient` is a **function**, not a class (REST client pattern).
- The endpoint URL should point to `/models` on the Azure resource.
- The `isUnexpected()` helper is used to check for error responses (the client does NOT throw on HTTP errors).

#### Chat Completions

```typescript
const response = await client.path("/chat/completions").post({
  body: {
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "Hello" }
    ],
    model: "gpt-4o",  // deployment/model name
    max_tokens: 4096,
    temperature: 0.7
  }
});

if (isUnexpected(response)) {
  // response.status is a string like "429", "401", "500"
  throw response.body.error;
}

// Access response
const text = response.body.choices[0].message.content;
const usage = response.body.usage;
// usage.prompt_tokens, usage.completion_tokens, usage.total_tokens
```

#### Function Calling / Tool Use

Azure AI Inference uses OpenAI-compatible function calling format:

```typescript
const response = await client.path("/chat/completions").post({
  body: {
    messages: [...],
    model: "gpt-4o",
    tools: [
      {
        type: "function",
        function: {
          name: "extract_entities",
          description: "Extract entities from text",
          parameters: {
            type: "object",
            properties: { ... },
            required: [...]
          }
        }
      }
    ],
    tool_choice: { type: "function", function: { name: "extract_entities" } }
    // Or: tool_choice: "auto"
  }
});

// Extract function call from response
const toolCall = response.body.choices[0].message.tool_calls[0];
const functionName = toolCall.function.name;
const functionArgs = JSON.parse(toolCall.function.arguments);
```

**Confirmed**: Function calling is fully supported through the `/chat/completions` endpoint. The tool definition format uses `{ type: "function", function: { name, description, parameters } }` -- a straightforward mapping from our `ToolDefinition`.

#### Authentication

- **API Key**: Via `AzureKeyCredential` from `@azure/core-auth`. This is the approach for the initial implementation.
- **Entra ID (Azure AD)**: Via `DefaultAzureCredential` from `@azure/identity`. Not needed for this iteration (per Non-Goal #5 in the refined request).

#### Model Specification

The model is specified in the request body as the `model` field. This corresponds to the deployment name in Azure. The `azureDeployment` config field maps to this.

#### Token Usage in Responses

Response `usage` object contains:
- `prompt_tokens` (number)
- `completion_tokens` (number)
- `total_tokens` (number)

No cache-related token fields. The provider should map these to our `TokenUsage` interface with `cacheCreationTokens: 0` and `cacheReadTokens: 0`.

#### Error Handling Pattern (Critical Difference)

Unlike the Anthropic SDK which **throws** exceptions, the Azure REST client **returns response objects** for all HTTP statuses. Errors are detected using `isUnexpected(response)`:

```typescript
if (isUnexpected(response)) {
  // response.status is a string: "400", "401", "429", "500", etc.
  // response.body.error contains the error details
}
```

**Impact on retry module**: The `AzureAIProvider` cannot simply wrap API calls in `callWithRetry()` the same way Anthropic does (where the SDK throws). Instead, the provider must:
1. Make the API call
2. Check `isUnexpected(response)`
3. If unexpected, throw a structured error with the status code
4. Let `callWithRetry()` catch and classify the thrown error

This means the provider itself must convert non-throwing responses into thrown errors before the retry wrapper can process them.

#### No Native Token Counting

The Azure AI Inference API does not provide a `/count-tokens` endpoint. The provider must use the existing `estimateTokens()` heuristic, same as the current Anthropic implementation.

---

### 2.2 Google Vertex AI SDK

#### Package Change: `@google/genai` (replaces `@google-cloud/vertexai`)

| Attribute | Value |
|-----------|-------|
| npm package | `@google/genai` |
| Latest version | `^1.48.0` (actively maintained, frequent releases) |
| Replaces | `@google-cloud/vertexai` (deprecated June 2025, removal June 2026) |
| Supports | Both Gemini Developer API and Vertex AI |
| TypeScript support | Full TypeScript types included |

#### Why Not `@google-cloud/vertexai`

The `@google-cloud/vertexai` package and its `VertexAI` class were deprecated on June 24, 2025. Google's official migration guide directs users to `@google/genai`. Key reasons:
- No new Gemini 2.0+ features in the old SDK
- Will be completely removed by June 2026
- `@google/genai` is where all new development happens
- Same SDK works for both Google AI Studio (API key) and Vertex AI (ADC)

#### Client Initialization for Vertex AI

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  vertexai: true,
  project: 'my-gcp-project-123',
  location: 'us-central1',
});
```

The `vertexai: true` flag switches the SDK from Google AI Studio mode to Vertex AI mode. Authentication is handled automatically via ADC.

#### Chat Completions (generateContent)

```typescript
const response = await ai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: [
    { role: 'user', parts: [{ text: 'Hello, how are you?' }] }
  ],
  config: {
    systemInstruction: 'You are a helpful assistant.',
    maxOutputTokens: 4096,
    temperature: 0.7,
  }
});

const text = response.text;  // or response.candidates[0].content.parts[0].text
const usage = response.usageMetadata;
// usage.promptTokenCount, usage.candidatesTokenCount, usage.totalTokenCount
```

Key differences from Anthropic/Azure:
- Messages use `contents` with `parts` (not `messages` with `content`)
- System instruction goes in `config.systemInstruction`, not as a message
- Response text is accessible via `response.text` convenience getter
- Token usage is in `usageMetadata`, not `usage`

#### Function Calling / Tool Use

```typescript
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  Type,
} from '@google/genai';

const extractEntitiesFn: FunctionDeclaration = {
  name: 'extract_entities',
  description: 'Extract entities from text',
  parameters: {
    type: Type.OBJECT,
    properties: {
      entities: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: 'List of entities',
      },
    },
    required: ['entities'],
  },
};

// Or use parametersJsonSchema for direct JSON Schema pass-through:
const extractEntitiesFn: FunctionDeclaration = {
  name: 'extract_entities',
  description: 'Extract entities from text',
  parametersJsonSchema: {
    type: 'object',
    properties: { ... },
    required: [...]
  },
};

const response = await ai.models.generateContent({
  model: 'gemini-2.0-flash',
  contents: [{ role: 'user', parts: [{ text: 'Extract entities from this text...' }] }],
  config: {
    tools: [{ functionDeclarations: [extractEntitiesFn] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        allowedFunctionNames: ['extract_entities'],
      }
    }
  }
});

// Extract function call from response
const functionCall = response.candidates[0].content.parts.find(p => p.functionCall);
const name = functionCall.functionCall.name;
const args = functionCall.functionCall.args;
```

**Important**: The `parametersJsonSchema` field allows passing JSON Schema directly, which means we can map our `ToolDefinition.input_schema` directly without converting to Gemini's `Type.OBJECT` format. This simplifies the implementation significantly.

#### Tool Choice Translation

| Internal Format | Gemini Format |
|----------------|---------------|
| `{ type: 'tool', name: 'X' }` | `{ mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ['X'] }` |
| `{ type: 'auto' }` | `{ mode: FunctionCallingConfigMode.AUTO }` |

#### Authentication: Application Default Credentials (ADC)

The `@google/genai` SDK with `vertexai: true` uses ADC automatically. No API key needed. Setup methods:

1. **Local development**: `gcloud auth application-default login`
2. **CI/CD**: Set `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to a service account JSON key file
3. **GKE/Cloud Run**: Workload identity or attached service account (automatic)

The SDK resolves credentials in this order via the `google-auth-library`:
1. `GOOGLE_APPLICATION_CREDENTIALS` env var
2. gcloud CLI default credentials
3. Compute engine metadata service (GCE, GKE, Cloud Run)

**No API key field is needed** for Vertex AI. The `apiKey` field in `LLMConfig` should be optional and not required when `provider === 'vertex'`.

#### Token Counting (Native Support)

```typescript
const tokenCount = await ai.models.countTokens({
  model: 'gemini-2.0-flash',
  contents: [{ role: 'user', parts: [{ text: 'Some text to count' }] }],
});

console.log(tokenCount.totalTokens);
```

**Confirmed**: The `@google/genai` SDK provides a native `countTokens` method. The Vertex AI provider should use this instead of the heuristic estimation, providing more accurate token counts than the Anthropic and Azure providers.

#### Error Handling

The `@google/genai` SDK **throws exceptions** on errors (unlike Azure REST client). The SDK includes built-in retry with exponential backoff for transient errors (429, 5xx). However, for consistency with the rest of the codebase, we should still wrap calls in our `callWithRetry()`.

Error classification:
- 429 / `RESOURCE_EXHAUSTED`: Rate limit -- retry with backoff
- 400: Bad request -- fail fast
- 401/403: Authentication/permission -- fail fast
- 500/503: Server error -- retry with backoff

Errors from `@google/genai` typically have a `status` or `message` property. Duck-typing on error properties is the safest approach.

---

### 2.3 Retry Strategy

#### Current State

The existing `callWithRetry()` in `src/llm/retry.ts` imports `Anthropic` from `@anthropic-ai/sdk` and uses `instanceof` checks against Anthropic-specific error classes:
- `Anthropic.AuthenticationError` (fail fast)
- `Anthropic.BadRequestError` (fail fast)
- `Anthropic.RateLimitError` (retry)
- `Anthropic.APIError` with `status >= 500` (retry)

#### Recommended Refactoring: Generic HTTP Status Code Detection

Replace provider-specific error class checks with duck-typing on error properties:

```typescript
function getHttpStatus(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    // Check common status properties across SDKs
    const e = error as Record<string, unknown>;
    if (typeof e.status === 'number') return e.status;
    if (typeof e.statusCode === 'number') return e.statusCode;
    // Azure REST client string status
    if (typeof e.status === 'string') return parseInt(e.status, 10);
  }
  return undefined;
}

function getRetryAfterMs(error: unknown): number | undefined {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    // Check for Retry-After header (Azure commonly provides this)
    if (typeof e.headers === 'object' && e.headers) {
      const headers = e.headers as Record<string, string>;
      const retryAfter = headers['retry-after'];
      if (retryAfter) return parseInt(retryAfter, 10) * 1000;
    }
  }
  return undefined;
}
```

Classification logic:
| HTTP Status | Action |
|------------|--------|
| 401, 403 | Fail fast (authentication/permission) |
| 400 | Fail fast (bad request) |
| 429 | Retry with backoff (use `Retry-After` header if present) |
| >= 500 | Retry with backoff |
| Unknown/no status | Fail fast (non-HTTP errors like network timeouts could be retried, but safer to fail fast) |

#### Azure-Specific Consideration

Since the Azure REST client does not throw on errors, the `AzureAIProvider` must convert error responses into thrown errors before `callWithRetry()` can process them:

```typescript
async complete(params: CompletionParams): Promise<CompletionResult> {
  return callWithRetry(async () => {
    const response = await this.client.path("/chat/completions").post({ body: { ... } });

    if (isUnexpected(response)) {
      // Create an error object with the HTTP status for the retry module
      const error = new Error(response.body.error?.message ?? 'Azure AI request failed');
      (error as any).status = parseInt(response.status, 10);
      (error as any).headers = response.headers;
      throw error;
    }

    return { text: ..., usage: ..., stopReason: ... };
  });
}
```

This pattern ensures the retry module receives a thrown error with a `.status` property it can classify generically.

#### Google GenAI SDK Built-in Retry

The `@google/genai` SDK has its own built-in retry logic. To avoid double-retry (SDK retry + our retry), we have two options:

1. **Disable SDK retry, use ours only**: This gives us full control but requires figuring out if the SDK exposes a retry-disable option.
2. **Keep both**: The SDK retries internally; if it still fails after its retries, it throws an error that our `callWithRetry()` will catch. Double-retry means more total attempts but is simpler to implement.

**Recommendation**: Keep both retry layers. The SDK's internal retry handles transient network-level issues, while our retry wrapper provides the configurable, logged retry behavior consistent across all providers. In practice, if the SDK exhausts its retries and throws, our wrapper gets one more chance.

---

### 2.4 Token Estimation and Context Limits

#### Current State

`CONTEXT_LIMITS` in `src/llm/tokens.ts` only contains Anthropic models. The `PromptBudgetAnalyzer` constructor throws if the model is not found.

#### Extended Context Limits

Add entries for commonly used models across all three providers:

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

#### Risk: Custom Deployment Names on Azure

Azure users may deploy models with custom names (e.g., `my-gpt4o-prod` instead of `gpt-4o`). Since the `PromptBudgetAnalyzer` throws on unknown model names, this will fail. Two options:

1. **Strict (current behavior)**: Throw on unknown model -- users must use standard model names or we add their custom names to the map. This is consistent with the project's no-fallback convention.
2. **Graceful degradation**: If model not found, use a conservative default (e.g., 128K) with a warning log. This violates the no-fallback rule.

**Recommendation**: Keep strict behavior (throw on unknown). Add a note in the configuration guide that the `model` field must match one of the known model identifiers. If users need custom deployment names, they should use the `azureDeployment` field for the deployment name and set `model` to the underlying model identifier (e.g., `gpt-4o`).

---

### 2.5 Configuration

#### Updated SDK Dependencies

The `package.json` dependencies should be updated from the original plan:

| Provider | NPM Package | Version | Purpose |
|----------|------------|---------|---------|
| Azure AI Inference | `@azure-rest/ai-inference` | `^1.0.0-beta.6` | Unified REST client for Azure AI model deployments |
| Azure AI Auth | `@azure/core-auth` | `^1.9.0` | `AzureKeyCredential` for API key auth |
| Google Gemini/Vertex | `@google/genai` | `^1.48.0` | **Replaces** `@google-cloud/vertexai` -- unified Gemini SDK with Vertex AI support |

**Removed**: `@google-cloud/vertexai` (deprecated)

#### Config Fields Required Per Provider

| Provider | Required Fields | Optional Fields |
|----------|----------------|-----------------|
| `anthropic` | `apiKey`, `model`, `maxTokens` | `apiKeyExpiry` |
| `azure` | `apiKey`, `model`, `maxTokens`, `azureEndpoint`, `azureDeployment` | `apiKeyExpiry` |
| `vertex` | `model`, `maxTokens`, `vertexProjectId`, `vertexLocation` | (no `apiKey` needed) |

The validation logic must:
1. Make `apiKey` optional in the TypeScript interface
2. Require `apiKey` only for `anthropic` and `azure`
3. Require `vertexProjectId` and `vertexLocation` only for `vertex`
4. Skip `apiKeyExpiry` check for `vertex` (uses ADC, no expiring API key)

#### Environment Variable Mappings

New env vars to add in `loader.ts`:

| Variable | Maps To | Required When |
|----------|---------|---------------|
| `WIKI_VERTEX_PROJECT_ID` | `llm.vertexProjectId` | provider = vertex |
| `WIKI_VERTEX_LOCATION` | `llm.vertexLocation` | provider = vertex |

Existing env vars (already wired):

| Variable | Maps To |
|----------|---------|
| `WIKI_AZURE_ENDPOINT` | `llm.azureEndpoint` |
| `WIKI_AZURE_DEPLOYMENT` | `llm.azureDeployment` |

---

## 3. Recommended SDK Versions and Patterns

### 3.1 Dependency Versions

```json
{
  "dependencies": {
    "@azure-rest/ai-inference": "^1.0.0-beta.6",
    "@azure/core-auth": "^1.9.0",
    "@google/genai": "^1.48.0"
  }
}
```

### 3.2 Provider Implementation Patterns

#### AzureAIProvider Pattern

```typescript
import ModelClient, { isUnexpected } from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

export class AzureAIProvider implements LLMProvider {
  private readonly client: ReturnType<typeof ModelClient>;
  private readonly model: string;

  constructor(config: LLMConfig) {
    this.client = ModelClient(
      config.azureEndpoint!,        // validated by config validator
      new AzureKeyCredential(config.apiKey!)
    );
    this.model = config.azureDeployment ?? config.model;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.client.path("/chat/completions").post({
        body: {
          model: this.model,
          messages: this.mapMessages(params),
          max_tokens: params.maxTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        }
      });

      if (isUnexpected(response)) {
        const error = new Error(response.body.error?.message ?? 'Azure AI request failed');
        (error as any).status = parseInt(response.status, 10);
        throw error;
      }

      return {
        text: response.body.choices[0].message.content ?? '',
        usage: {
          inputTokens: response.body.usage.prompt_tokens,
          outputTokens: response.body.usage.completion_tokens,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        stopReason: response.body.choices[0].finish_reason ?? 'unknown',
      };
    });
  }

  // Tool definition mapping
  private mapTool(tool: ToolDefinition) {
    return {
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema,
      }
    };
  }

  // Tool choice mapping
  private mapToolChoice(choice: ToolCompletionParams['toolChoice']) {
    if (choice.type === 'auto') return 'auto';
    return { type: 'function' as const, function: { name: choice.name } };
  }
}
```

#### VertexAIProvider Pattern

```typescript
import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';

export class VertexAIProvider implements LLMProvider {
  private readonly ai: GoogleGenAI;
  private readonly model: string;

  constructor(config: LLMConfig) {
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: config.vertexProjectId!,   // validated by config validator
      location: config.vertexLocation!,
    });
    this.model = config.model;
  }

  async complete(params: CompletionParams): Promise<CompletionResult> {
    return callWithRetry(async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: this.mapMessages(params.messages),
        config: {
          systemInstruction: params.system,
          maxOutputTokens: params.maxTokens,
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
        }
      });

      return {
        text: response.text ?? '',
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
        stopReason: response.candidates?.[0]?.finishReason ?? 'unknown',
      };
    });
  }

  async countTokens(params: Omit<CompletionParams, 'maxTokens'>): Promise<TokenCountResult> {
    // Use native countTokens API
    const result = await this.ai.models.countTokens({
      model: this.model,
      contents: this.mapMessages(params.messages),
    });
    return { inputTokens: result.totalTokens ?? 0 };
  }

  // Tool definition mapping (using parametersJsonSchema for direct pass-through)
  private mapTool(tool: ToolDefinition) {
    return {
      functionDeclarations: [{
        name: tool.name,
        description: tool.description,
        parametersJsonSchema: tool.input_schema,
      }]
    };
  }

  // Tool choice mapping
  private mapToolChoice(choice: ToolCompletionParams['toolChoice']) {
    if (choice.type === 'auto') {
      return { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } };
    }
    return {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        allowedFunctionNames: [choice.name],
      }
    };
  }

  // Message mapping: internal format -> Gemini contents format
  private mapMessages(messages: MessageParam[]) {
    return messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : m.role,
      parts: typeof m.content === 'string'
        ? [{ text: m.content }]
        : m.content.map(block =>
            block.type === 'text' ? { text: block.text! } : { text: '' }
          ),
    }));
  }
}
```

### 3.3 Message Format Translation Summary

| Internal Format | Anthropic | Azure AI | Gemini (`@google/genai`) |
|----------------|-----------|----------|--------------------------|
| System prompt | `system` param | `messages[0].role: "system"` | `config.systemInstruction` |
| User message | `role: "user"` | `role: "user"` | `role: "user"`, `parts: [{ text }]` |
| Assistant message | `role: "assistant"` | `role: "assistant"` | `role: "model"`, `parts: [{ text }]` |
| Max output tokens | `max_tokens` | `max_tokens` | `config.maxOutputTokens` |
| Temperature | `temperature` | `temperature` | `config.temperature` |

### 3.4 Token Usage Field Mapping

| Internal Field | Anthropic | Azure AI | Gemini |
|---------------|-----------|----------|--------|
| `inputTokens` | `usage.input_tokens` | `usage.prompt_tokens` | `usageMetadata.promptTokenCount` |
| `outputTokens` | `usage.output_tokens` | `usage.completion_tokens` | `usageMetadata.candidatesTokenCount` |
| `cacheCreationTokens` | `usage.cache_creation_input_tokens` | `0` (not supported) | `0` (not supported) |
| `cacheReadTokens` | `usage.cache_read_input_tokens` | `0` (not supported) | `0` (not supported) |

---

## 4. Technical Research Guidance

Research needed: Yes

### Topic: Azure REST Client Error Response Structure
- **Why**: The `@azure-rest/ai-inference` REST client returns responses rather than throwing. The exact TypeScript types for error responses (`response.body.error`, `response.headers`, `response.status`) need to be validated against the actual SDK type exports to ensure type-safe error handling in the provider.
- **Focus**: Import the SDK, inspect the types for `ChatCompletionsOutput`, error body structure, and `isUnexpected` type narrowing behavior. Verify that `response.headers['retry-after']` is accessible.
- **Depth**: Targeted -- install the package, write a small test that inspects types. Should take 30 minutes.

### Topic: `@google/genai` FunctionDeclaration `parametersJsonSchema` Support
- **Why**: The `parametersJsonSchema` field (which allows direct JSON Schema pass-through) simplifies tool definition mapping significantly. However, this is a newer feature and its availability and behavior need to be confirmed in the current SDK version. If unavailable, we need to build a JSON Schema to Gemini Type converter.
- **Focus**: Confirm `parametersJsonSchema` exists in `@google/genai@^1.48.0` TypeScript types. Test with a sample function declaration that uses JSON Schema directly. Verify it works with Vertex AI backend.
- **Depth**: Targeted -- install the package, check types, run a minimal function calling example. Should take 1 hour.

### Topic: `@google/genai` Error Object Structure for Retry Classification
- **Why**: We need to know the exact shape of errors thrown by `@google/genai` to reliably extract HTTP status codes in our retry module. The SDK may throw its own error class (e.g., `GoogleGenAIError`) with specific properties.
- **Focus**: Inspect the SDK's error types/classes. Determine whether thrown errors have a `.status` or `.statusCode` property, or whether status must be parsed from `.message`. Check if `ClientError` vs `ServerError` distinctions exist.
- **Depth**: Targeted -- inspect SDK source or types, write a test that triggers a known error (e.g., invalid API key). Should take 30 minutes.

---

## 5. Updated File Impact Assessment

Based on the investigation findings, the file modification list from the refined request is accurate with one change:

### Changed from Original Plan

| Original | Updated | Reason |
|----------|---------|--------|
| `@google-cloud/vertexai` in `package.json` | `@google/genai` | Original package deprecated June 2025 |
| `VertexAIProvider` using `@google-cloud/vertexai` API | `VertexAIProvider` using `@google/genai` API | Different client initialization, message format, and function calling API |

### Additional Consideration

The `@azure-rest/ai-inference` package is still in beta (`1.0.0-beta.6`). This means:
- API may change between versions
- Should pin to a specific beta version rather than using `^1.0.0`
- Monitor for stable release

---

## 6. Open Questions Resolution

| Question | Resolution |
|----------|-----------|
| Azure API version pinning | The SDK handles API version internally. No config field needed. |
| Vertex authentication flexibility | ADC is the correct approach. The `@google/genai` SDK handles ADC automatically. |
| Tool use compatibility | Let API errors propagate. Document which models support function calling. |
| `apiKey` field for Vertex | Make `apiKey` optional in interface. Validator only requires it for `anthropic` and `azure`. |
| Azure model family detection | Not needed. Azure AI Inference provides a unified API. |
| Rate limit handling | Use `Retry-After` header when present (Azure). For Gemini, rely on exponential backoff. The generic retry module handles both via duck-typing. |

---

## Sources

- [npm: @azure-rest/ai-inference](https://www.npmjs.com/package/@azure-rest/ai-inference)
- [Azure AI Inference SDK TypeScript Samples](https://github.com/Azure/azure-sdk-for-js/blob/main/sdk/ai/ai-inference-rest/samples/v1-beta/typescript/src/)
- [Azure AI Inference REST API Reference](https://learn.microsoft.com/en-us/javascript/api/@azure-rest/ai-inference/?view=azure-node-preview)
- [Azure Function Calling Guide](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/how-to/function-calling)
- [npm: @google/genai](https://www.npmjs.com/package/@google/genai)
- [GitHub: googleapis/js-genai](https://github.com/googleapis/js-genai)
- [Google Gen AI SDK Overview](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/sdks/overview)
- [Vertex AI SDK Migration Guide](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk)
- [Vertex AI Function Calling](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling)
- [Vertex AI Token Counting](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/multimodal/get-token-count)
- [Vertex AI Retry Strategy](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/retry-strategy)
- [Building Resilient GenAI Apps with TypeScript](https://medium.com/google-cloud/how-to-build-genai-apps-for-resilience-with-typescript-06908aca62c2)
