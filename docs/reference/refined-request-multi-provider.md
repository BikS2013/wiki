# Refined Request: Multi-Provider LLM Support

**Date**: 2026-04-09
**Status**: Draft
**Scope**: Expand LLM Wiki from Anthropic-only to support Azure AI and Google Vertex AI platforms

---

## Summary

LLM Wiki currently supports only Anthropic as an LLM provider. This change adds two new provider backends:

1. **Azure AI Inference** -- A unified endpoint that hosts multiple model families (OpenAI, Anthropic, Mistral, DeepSeek) through Azure's model-as-a-service platform.
2. **Google Vertex AI** -- Access to Google's Gemini models through the Vertex AI API.

Both new providers must implement the existing `LLMProvider` interface (`complete`, `completeWithTools`, `countTokens`) so that all upstream modules (ingest, query, lint) work without modification.

---

## Goals

1. Users can switch between Anthropic (direct), Azure AI, and Vertex AI by changing only the `config.json` provider settings.
2. Azure AI provider works with any model family deployed to Azure AI (OpenAI GPT-4o, Anthropic Claude, Mistral Large, DeepSeek-R1, etc.) through a single provider implementation using the Azure AI Inference SDK.
3. Vertex AI provider works with Google Gemini models through the Google Cloud AI SDK.
4. The retry module becomes provider-agnostic so all three providers benefit from exponential backoff.
5. The `PromptBudgetAnalyzer` context-limit map is extended for non-Anthropic models.
6. All configuration fields are validated -- no fallback values, strict conditional requirements per the project convention.
7. Documentation is updated: project-design.md, configuration-guide.md, CLAUDE.md.

## Non-Goals

1. No streaming support -- the project uses non-streaming calls exclusively.
2. No support for OpenAI directly (only through Azure AI).
3. No migration tool -- users must manually update their config.json.
4. No model-specific prompt tuning -- the same prompt templates are used across providers.
5. No support for Azure AD/Entra token-based authentication in this iteration (API key only).
6. No automatic model capability detection -- users are responsible for choosing a model that supports tool use.

---

## Functional Requirements

### FR-1: Azure AI Provider
The system must support Azure AI Inference as an LLM provider. When `provider` is set to `"azure"`, the system must use the Azure AI Inference SDK (`@azure-rest/ai-inference`) to communicate with the configured Azure endpoint and deployment.

### FR-2: Azure AI Tool Use
The Azure AI provider must support structured tool-use output (`completeWithTools`) using the Azure AI Inference chat completions API with function calling. The provider must translate the internal `ToolDefinition` format to Azure's function definition format and extract the function call result from the response.

### FR-3: Azure AI Token Counting
The Azure AI provider must implement `countTokens` using heuristic estimation (same approach as the current Anthropic implementation) since the Azure AI Inference API does not provide a native token counting endpoint.

### FR-4: Vertex AI Provider
The system must support Google Vertex AI as an LLM provider. When `provider` is set to `"vertex"`, the system must use the Google Cloud AI SDK (`@google-cloud/vertexai`) to communicate with the Gemini API.

### FR-5: Vertex AI Tool Use
The Vertex AI provider must support structured tool-use output using Gemini's function calling capability. The provider must translate the internal `ToolDefinition` format to Gemini's `FunctionDeclaration` format and extract the function call result from the response.

### FR-6: Vertex AI Token Counting
The Vertex AI provider must implement `countTokens` using the Gemini `countTokens` API if available, falling back to heuristic estimation.

### FR-7: Provider-Agnostic Retry
The retry module must work with all three providers. It must not depend on Anthropic-specific error classes. Instead, it must detect retryable errors (rate limiting, server errors) using HTTP status codes or generic error properties.

### FR-8: Extended Context Limits
The `PromptBudgetAnalyzer` must include context window limits for commonly used models across all three providers (Gemini 1.5 Pro, GPT-4o, Mistral Large, etc.).

### FR-9: Configuration Validation
The validator must enforce provider-specific required fields:
- `azure`: requires `azureEndpoint` and `azureDeployment`
- `vertex`: requires `vertexProjectId` and `vertexLocation`
- `anthropic`: requires `apiKey` only (current behavior)

### FR-10: Factory Routing
The `createProvider` factory must instantiate the correct provider class based on `config.provider`, passing the full `LLMConfig` to each constructor.

---

## Technical Requirements

### SDKs

| Provider | NPM Package | Version | Purpose |
|----------|------------|---------|---------|
| Azure AI Inference | `@azure-rest/ai-inference` | `^1.0.0` | Unified REST client for Azure AI model deployments |
| Azure AI Inference (auth) | `@azure/core-auth` | `^1.9.0` | `AzureKeyCredential` for API key auth |
| Google Vertex AI | `@google-cloud/vertexai` | `^1.9.0` | Vertex AI Gemini SDK with function calling |

**Note on Azure SDK choice**: The `@azure-rest/ai-inference` package provides a unified client that works with any model deployed to Azure AI (OpenAI, Anthropic, Mistral, DeepSeek) through a single API surface. This is preferred over model-family-specific SDKs (e.g., `@azure/openai`) because Azure AI exposes all models through the same chat completions endpoint.

**Note on Vertex SDK choice**: The `@google-cloud/vertexai` package is Google's official TypeScript SDK for Vertex AI Generative models including Gemini. It supports function calling natively.

### Architecture Decisions

1. **One provider class per platform, not per model family**: Azure hosts OpenAI, Anthropic, Mistral, and DeepSeek models, but they all share the same inference API. A single `AzureAIProvider` class handles all of them.

2. **Retry module refactored to be generic**: The current `retry.ts` imports `@anthropic-ai/sdk` error classes. It must be refactored to detect retryable errors by HTTP status code (429, 5xx) or by inspecting generic error properties (`status`, `statusCode`, `code`). Provider-specific error handling stays in the provider class itself.

3. **Authentication approach**:
   - Azure: API key via `AzureKeyCredential` from `@azure/core-auth`
   - Vertex: Google Application Default Credentials (ADC) -- the SDK handles this automatically via `GOOGLE_APPLICATION_CREDENTIALS` env var or gcloud CLI auth. No API key field needed; instead `vertexProjectId` and `vertexLocation` are required.
   - Anthropic: API key (unchanged)

---

## Configuration Changes

### New Fields in `LLMConfig` Interface

```typescript
export interface LLMConfig {
  provider: 'anthropic' | 'azure' | 'vertex';
  model: string;
  apiKey: string;                    // Required for anthropic and azure; NOT required for vertex
  apiKeyExpiry?: string;
  maxTokens: number;

  // Azure-specific (existing, already in types.ts)
  azureEndpoint?: string;            // e.g. "https://my-resource.services.ai.azure.com"
  azureDeployment?: string;          // e.g. "gpt-4o" or "claude-sonnet"

  // Vertex-specific (NEW)
  vertexProjectId?: string;          // GCP project ID, e.g. "my-gcp-project-123"
  vertexLocation?: string;           // GCP region, e.g. "us-central1"
}
```

### New Environment Variables

| Variable | Maps To | Required When |
|----------|---------|---------------|
| `WIKI_VERTEX_PROJECT_ID` | `llm.vertexProjectId` | provider = vertex |
| `WIKI_VERTEX_LOCATION` | `llm.vertexLocation` | provider = vertex |

Existing env vars (`WIKI_AZURE_ENDPOINT`, `WIKI_AZURE_DEPLOYMENT`) are already wired in `loader.ts`.

### Validation Rules (No Fallbacks)

| Condition | Required Fields | Error if Missing |
|-----------|----------------|-----------------|
| `provider === 'anthropic'` | `apiKey` | ConfigurationError('llm.apiKey', ...) |
| `provider === 'azure'` | `apiKey`, `azureEndpoint`, `azureDeployment` | ConfigurationError for each missing field |
| `provider === 'vertex'` | `vertexProjectId`, `vertexLocation` | ConfigurationError for each missing field |
| `provider === 'vertex'` | `apiKey` is NOT required | (vertex uses ADC, not API keys) |

### Example config.json Snippets

**Azure AI (OpenAI model)**:
```json
{
  "llm": {
    "provider": "azure",
    "model": "gpt-4o",
    "apiKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "apiKeyExpiry": "2026-07-01",
    "azureEndpoint": "https://my-resource.services.ai.azure.com",
    "azureDeployment": "gpt-4o",
    "maxTokens": 4096
  }
}
```

**Azure AI (Anthropic model on Azure)**:
```json
{
  "llm": {
    "provider": "azure",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
    "azureEndpoint": "https://my-resource.services.ai.azure.com",
    "azureDeployment": "claude-sonnet",
    "maxTokens": 4096
  }
}
```

**Vertex AI (Gemini)**:
```json
{
  "llm": {
    "provider": "vertex",
    "model": "gemini-2.0-flash",
    "apiKey": "",
    "vertexProjectId": "my-gcp-project-123",
    "vertexLocation": "us-central1",
    "maxTokens": 8192
  }
}
```

---

## Affected Files (Modifications)

| File | Change |
|------|--------|
| `src/config/types.ts` | Add `vertexProjectId` and `vertexLocation` optional fields to `LLMConfig` |
| `src/config/loader.ts` | Add env var mappings for `WIKI_VERTEX_PROJECT_ID` and `WIKI_VERTEX_LOCATION` |
| `src/config/validator.ts` | Add vertex-specific conditional validation (require `vertexProjectId` + `vertexLocation`); relax `apiKey` requirement when provider is `vertex` |
| `src/llm/factory.ts` | Import new provider classes; instantiate `AzureAIProvider` and `VertexAIProvider` in the switch statement |
| `src/llm/retry.ts` | Remove `@anthropic-ai/sdk` import; refactor to use generic HTTP status code detection for retryable errors |
| `src/llm/tokens.ts` | Add context window limits for Azure-hosted models (GPT-4o, Mistral Large, DeepSeek-R1) and Vertex models (Gemini 2.0 Flash, Gemini 1.5 Pro, Gemini 2.5 Pro) |
| `src/llm/anthropic.ts` | Update to use the refactored generic retry utility (if the retry signature changes) |
| `package.json` | Add `@azure-rest/ai-inference`, `@azure/core-auth`, `@google-cloud/vertexai` dependencies |
| `src/templates/config-template.json` | Add commented examples for azure and vertex fields |
| `docs/design/project-design.md` | Update technology stack table, source file listing, module specs for LLM module, dependencies section |
| `docs/design/configuration-guide.md` | Add azure and vertex configuration sections with full field documentation |
| `CLAUDE.md` | No tool changes needed (wiki CLI tool doc stays the same) |

---

## New Files

| File | Purpose |
|------|---------|
| `src/llm/azure-ai.ts` | `AzureAIProvider` class implementing `LLMProvider` using `@azure-rest/ai-inference` |
| `src/llm/vertex-ai.ts` | `VertexAIProvider` class implementing `LLMProvider` using `@google-cloud/vertexai` |
| `test_scripts/test-azure-ai-provider.ts` | Unit/integration test for the Azure AI provider |
| `test_scripts/test-vertex-ai-provider.ts` | Unit/integration test for the Vertex AI provider |
| `test_scripts/test-retry-generic.ts` | Test that the refactored retry module works with generic errors |
| `test_scripts/test-config-validation-providers.ts` | Test config validation for all three provider types |

---

## Acceptance Criteria

- [ ] **AC-1**: Setting `provider: "azure"` with valid `azureEndpoint`, `azureDeployment`, `apiKey`, and `model` successfully creates an `AzureAIProvider` and completes a text generation request.
- [ ] **AC-2**: Setting `provider: "vertex"` with valid `vertexProjectId`, `vertexLocation`, and `model` successfully creates a `VertexAIProvider` and completes a text generation request.
- [ ] **AC-3**: `AzureAIProvider.completeWithTools()` returns structured JSON output using Azure function calling for at least one Azure-hosted model (e.g., GPT-4o).
- [ ] **AC-4**: `VertexAIProvider.completeWithTools()` returns structured JSON output using Gemini function calling.
- [ ] **AC-5**: The `wiki ingest` command completes successfully with each of the three providers (given appropriate model and credentials).
- [ ] **AC-6**: The `wiki query` command completes successfully with each of the three providers.
- [ ] **AC-7**: Config validation throws `ConfigurationError` when `provider: "azure"` is set but `azureEndpoint` is missing.
- [ ] **AC-8**: Config validation throws `ConfigurationError` when `provider: "vertex"` is set but `vertexProjectId` is missing.
- [ ] **AC-9**: Config validation does NOT require `apiKey` when `provider: "vertex"`.
- [ ] **AC-10**: The retry module retries on HTTP 429 and 5xx errors regardless of which provider is in use, without importing any provider-specific SDK.
- [ ] **AC-11**: The `PromptBudgetAnalyzer` correctly returns context limits for GPT-4o (128K), Gemini 2.0 Flash (1M), Gemini 1.5 Pro (2M), and Mistral Large (128K).
- [ ] **AC-12**: Existing Anthropic provider continues to work without regression after the retry module refactoring.
- [ ] **AC-13**: `project-design.md` is updated to reflect the multi-provider architecture.
- [ ] **AC-14**: `configuration-guide.md` documents all new config fields, env vars, and per-provider requirements.
- [ ] **AC-15**: `apiKeyExpiry` check works for Azure keys (which do expire) and is skipped/ignored for Vertex (which uses ADC).

---

## Open Questions

1. **Azure API version pinning**: The `@azure-rest/ai-inference` SDK requires an `api-version` query parameter. Should this be exposed as a config field (e.g., `azureApiVersion`) or hardcoded to a known-good value like `"2024-12-01-preview"`? **Recommendation**: Hardcode initially, add config field later if needed.

2. **Vertex authentication flexibility**: The initial implementation uses Application Default Credentials (ADC). Should we also support explicit service account JSON key file paths via a `vertexCredentialsFile` config field? **Recommendation**: ADC only for now; it covers local dev (`gcloud auth application-default login`), CI/CD, and GKE workloads.

3. **Tool use compatibility across models**: Not all models support function calling equally. DeepSeek-R1 on Azure, for example, may have limited or no function calling support. Should the provider throw a clear error if tool use fails, or should there be a capability check? **Recommendation**: Let the API error propagate naturally; add a note in documentation about model capabilities.

4. **`apiKey` field for Vertex**: The `LLMConfig` interface currently marks `apiKey` as required (non-optional). For Vertex, it is not used. Should we: (a) make `apiKey` optional in the interface, or (b) require a placeholder value? **Recommendation**: Make `apiKey` optional in the TypeScript interface and update the validator to only require it for `anthropic` and `azure` providers. This is a breaking type change but the correct approach.

5. **Azure model family detection**: Should the `AzureAIProvider` attempt to detect which model family is deployed (OpenAI vs Anthropic vs Mistral) to adjust request formatting? **Recommendation**: No. Azure AI Inference provides a unified API regardless of underlying model family. The provider should use the same request format for all models.

6. **Rate limit handling differences**: Azure and Vertex return rate limit information differently (Azure uses `Retry-After` header, Vertex uses gRPC error details). Should the retry module parse these provider-specific signals? **Recommendation**: Parse `Retry-After` header when present (standard HTTP); otherwise fall back to exponential backoff.
