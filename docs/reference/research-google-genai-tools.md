# @google/genai — Function Calling / Tool Use with Vertex AI

**Research Date:** 2026-04-09
**Package Version Researched:** `@google/genai` v1.48.0 (latest as of research date)
**Scope:** Function calling, tool use, Vertex AI backend, token counting — TypeScript

---

## Overview

`@google/genai` is Google DeepMind's unified "vanilla" SDK for all Gemini API interactions. It supports both the **Gemini Developer API** (API key-based) and **Vertex AI** (GCP project-based). As of 2025, this is the canonical SDK — the older `@google/generative-ai` and `@google-cloud/vertexai` packages are deprecated and no longer receive new features.

**Key deprecation notice:** The `VertexAI` class from `@google-cloud/vertexai` is deprecated as of June 24, 2025 and will be removed on **June 24, 2026**. Migrate to `@google/genai`.

**Installation:**
```bash
npm install @google/genai
```

---

## Key Concepts

| Concept | Description |
|---------|-------------|
| `GoogleGenAI` | Main client class. All API access flows through its submodules. |
| `ai.models` | Primary submodule for `generateContent`, `countTokens`, etc. |
| `FunctionDeclaration` | Describes a tool the model can call. |
| `parametersJsonSchema` | The preferred way to define tool parameters as plain JSON Schema. |
| `FunctionCallingConfigMode` | Enum controlling when the model calls tools: `AUTO`, `ANY`, `NONE`. |
| `allowedFunctionNames` | Restricts which functions the model may call (used with `ANY` mode). |
| `response.functionCalls` | Convenience accessor for tool call results on `GenerateContentResponse`. |

---

## 1. Vertex AI Backend Initialization

### Option A: Explicit constructor arguments

```typescript
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({
  vertexai: true,
  project: 'your-gcp-project-id',
  location: 'us-central1',
});
```

### Option B: Environment variables (Node.js only)

```bash
export GOOGLE_GENAI_USE_VERTEXAI=true
export GOOGLE_CLOUD_PROJECT='your-gcp-project-id'
export GOOGLE_CLOUD_LOCATION='us-central1'
```

```typescript
import { GoogleGenAI } from '@google/genai';

// Picks up all three env vars automatically
const ai = new GoogleGenAI();
```

### Option C: Pin to stable API version

By default, the SDK targets the `v1beta` endpoint (which enables preview features). To use the stable `v1` endpoint:

```typescript
const ai = new GoogleGenAI({
  vertexai: true,
  project: 'your-gcp-project-id',
  location: 'us-central1',
  apiVersion: 'v1',   // stable; omit for beta (default)
});
```

### Authentication

Vertex AI uses Application Default Credentials. Set these up once with:

```bash
gcloud auth application-default login
```

No API key is required for Vertex AI. The SDK automatically uses the GCP credentials.

### Vertex AI Prerequisites

1. A GCP project with billing enabled.
2. The [Vertex AI API enabled](https://console.cloud.google.com/flows/enableapi?apiid=aiplatform.googleapis.com).
3. gcloud CLI installed and initialized.
4. `gcloud auth application-default login` executed.

---

## 2. Defining Function Declarations

The `FunctionDeclaration` interface describes a tool. There are two approaches for specifying parameters:

### Approach A: `parametersJsonSchema` (recommended — plain JSON Schema)

This is the **modern, preferred approach** in `@google/genai` v1.x. Pass a raw JSON Schema object directly. No import of `Type` enum required.

```typescript
import { GoogleGenAI, FunctionDeclaration } from '@google/genai';

const extractWikiDataDeclaration: FunctionDeclaration = {
  name: 'extractWikiData',
  description: 'Extract structured wiki metadata from a document.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The document title.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'List of relevant tags.',
      },
      summary: {
        type: 'string',
        description: 'A one-paragraph summary of the document.',
      },
      confidence: {
        type: 'number',
        description: 'Confidence score from 0.0 to 1.0.',
      },
    },
    required: ['title', 'summary'],
  },
};
```

### Approach B: `parameters` with `Type` enum (legacy-compatible style)

This approach uses the `Type` enum from the SDK. It still works in `@google/genai` v1.x but is the older pattern from `@google/generative-ai`.

```typescript
import { GoogleGenAI, FunctionDeclaration, Type } from '@google/genai';

const controlLightDeclaration: FunctionDeclaration = {
  name: 'controlLight',
  description: 'Set the brightness and color temperature of a room light.',
  parameters: {
    type: Type.OBJECT,
    properties: {
      brightness: {
        type: Type.NUMBER,
        description: 'Light level from 0 to 100.',
      },
      colorTemperature: {
        type: Type.STRING,
        description: 'Color temperature: daylight, cool, or warm.',
      },
    },
    required: ['brightness', 'colorTemperature'],
  },
};
```

**Recommendation:** Use `parametersJsonSchema` for new code. It avoids importing the `Type` enum and works cleanly with existing JSON Schema definitions.

---

## 3. Forcing the Model to Call a Specific Function

The equivalent of Anthropic's `tool_choice: { type: 'tool', name: 'X' }` is achieved using `FunctionCallingConfigMode.ANY` combined with `allowedFunctionNames`.

### `FunctionCallingConfigMode` values

| Mode | Behavior |
|------|----------|
| `AUTO` | Default. Model decides whether to call a function or respond in natural language. |
| `ANY` | Model **must** call a function. Use `allowedFunctionNames` to restrict to a specific one. |
| `NONE` | Model will **not** call any function (all declarations are ignored). |

### Forcing a specific named function

```typescript
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  FunctionDeclaration,
} from '@google/genai';

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT!,
  location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
});

const extractWikiDataDeclaration: FunctionDeclaration = {
  name: 'extractWikiData',
  description: 'Extract structured wiki metadata from a document.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      title: { type: 'string' },
      summary: { type: 'string' },
      tags: { type: 'array', items: { type: 'string' } },
    },
    required: ['title', 'summary'],
  },
};

const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'Here is a document about TypeScript generics: ...',
  config: {
    tools: [{ functionDeclarations: [extractWikiDataDeclaration] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        // Equivalent to Anthropic's tool_choice: { type: 'tool', name: 'extractWikiData' }
        allowedFunctionNames: ['extractWikiData'],
      },
    },
  },
});
```

**Key note:** `allowedFunctionNames` is only meaningful when `mode` is `ANY`. With `ANY` and a single name in `allowedFunctionNames`, the model is forced to call exactly that function every time.

---

## 4. Parsing Function Call Results from the Response

The `GenerateContentResponse` exposes a convenience `functionCalls` property that returns an array of `FunctionCall` objects, or `undefined` if the model responded with text instead.

### Single-turn: read function call args directly

```typescript
const response = await ai.models.generateContent({ ... });

if (response.functionCalls && response.functionCalls.length > 0) {
  const call = response.functionCalls[0];

  console.log('Function name:', call.name);
  // call.args is already a parsed object (not a JSON string)
  console.log('Arguments:', call.args);

  // Access individual fields
  const title = call.args?.title as string;
  const summary = call.args?.summary as string;
  const tags = call.args?.tags as string[] | undefined;
} else {
  // Model returned text instead of a tool call
  console.log('Text response:', response.text);
}
```

### Full type of a `FunctionCall`

```typescript
interface FunctionCall {
  name: string;         // matches FunctionDeclaration.name
  args?: Record<string, unknown>;  // parsed JSON object
  id?: string;          // call identifier (needed for multi-turn FunctionResponse)
}
```

### Accessing raw response parts (alternative path)

```typescript
const parts = response.candidates?.[0]?.content?.parts ?? [];
for (const part of parts) {
  if (part.functionCall) {
    console.log('Tool called:', part.functionCall.name);
    console.log('Args:', part.functionCall.args);
  }
}
```

---

## 5. Multi-Turn: Sending Function Results Back to the Model

When you need the model to continue after you have executed the function, you must send the result back as a `FunctionResponse`. The `Content[]` structure must be explicit — the SDK will throw if you try to pass `FunctionCall`/`FunctionResponse` parts as simple strings.

```typescript
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  Content,
} from '@google/genai';

const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT!,
  location: 'us-central1',
});

const getWeatherDeclaration: FunctionDeclaration = {
  name: 'getWeather',
  description: 'Get current weather for a location.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      location: { type: 'string', description: 'City and country.' },
    },
    required: ['location'],
  },
};

// --- Turn 1: Initial request ---
const turn1Response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: 'What is the weather in Tokyo?',
  config: {
    tools: [{ functionDeclarations: [getWeatherDeclaration] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        allowedFunctionNames: ['getWeather'],
      },
    },
  },
});

const functionCall = turn1Response.functionCalls?.[0];
if (!functionCall) throw new Error('Expected a function call');

// --- Execute the actual function ---
const weatherResult = { temperature: '18°C', condition: 'Partly cloudy' };

// --- Turn 2: Send function result back ---
// FunctionCall and FunctionResponse parts require explicit Content[] structure.
const history: Content[] = [
  { role: 'user', parts: [{ text: 'What is the weather in Tokyo?' }] },
  {
    role: 'model',
    parts: [{ functionCall: { name: functionCall.name, args: functionCall.args } }],
  },
  {
    role: 'user',
    parts: [
      {
        functionResponse: {
          name: functionCall.name,
          response: weatherResult,
        },
      },
    ],
  },
];

const turn2Response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: history,
  config: {
    tools: [{ functionDeclarations: [getWeatherDeclaration] }],
  },
});

console.log(turn2Response.text);
// "The weather in Tokyo is 18°C and partly cloudy."
```

### Simplified multi-turn with `ai.chats`

For multi-turn conversations where history management is needed, `ai.chats` can simplify the work:

```typescript
const chat = ai.chats.create({
  model: 'gemini-2.5-flash',
  config: {
    tools: [{ functionDeclarations: [getWeatherDeclaration] }],
  },
});

const response = await chat.sendMessage({
  message: 'What is the weather in Tokyo?',
});

// The chat automatically maintains history.
// You still need to manually send FunctionResponse for tool calls.
```

---

## 6. Token Counting with `countTokens`

Token counting works identically on both Gemini Developer API and Vertex AI backends.

### Basic usage

```typescript
const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT!,
  location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
});

const tokenResponse = await ai.models.countTokens({
  model: 'gemini-2.5-flash',
  contents: 'What is the highest mountain in Africa?',
});

console.log(tokenResponse.totalTokens); // e.g., 9
```

### Counting tokens for a conversation with tools

```typescript
const tokenResponse = await ai.models.countTokens({
  model: 'gemini-2.5-flash',
  contents: [
    { role: 'user', parts: [{ text: 'What is the weather in Tokyo?' }] },
  ],
  config: {
    tools: [{ functionDeclarations: [getWeatherDeclaration] }],
  },
});

console.log(tokenResponse.totalTokens);
```

### `CountTokensResponse` shape

```typescript
interface CountTokensResponse {
  totalTokens: number;
  totalBillableCharacters?: number;
  promptTokensDetails?: Array<{
    modality: string;   // e.g., 'TEXT', 'IMAGE'
    tokenCount: number;
  }>;
}
```

### `usageMetadata` on `generateContent` responses

Every `GenerateContentResponse` also contains token usage metadata:

```typescript
const response = await ai.models.generateContent({ ... });

console.log(response.usageMetadata?.inputTokens);       // prompt tokens
console.log(response.usageMetadata?.outputTokens);      // generated tokens
console.log(response.usageMetadata?.totalTokenCount);   // total
```

### `computeTokens` (Vertex AI only — detailed per-token info)

```typescript
const ai = new GoogleGenAI({
  vertexai: true,
  project: process.env.GOOGLE_CLOUD_PROJECT!,
  location: 'us-central1',
  apiVersion: 'v1',  // computeTokens requires v1 stable endpoint
});

const result = await ai.models.computeTokens({
  model: 'gemini-2.5-flash',
  contents: "What's the longest word in the English language?",
});

console.log(result.tokensInfo); // array of per-token details
```

---

## 7. Complete Integration Example (Vertex AI + Forced Tool Call)

The following is a realistic end-to-end TypeScript example showing all pieces together, as would be used in the Wiki CLI tool:

```typescript
import {
  GoogleGenAI,
  FunctionCallingConfigMode,
  FunctionDeclaration,
  GenerateContentResponse,
} from '@google/genai';

// --- Configuration ---
interface VertexConfig {
  project: string;
  location: string;
  model: string;
}

function createVertexClient(config: VertexConfig): GoogleGenAI {
  return new GoogleGenAI({
    vertexai: true,
    project: config.project,
    location: config.location,
  });
}

// --- Tool Definition ---
const wikiExtractDeclaration: FunctionDeclaration = {
  name: 'extractWikiMetadata',
  description:
    'Extract structured metadata from a wiki document for indexing purposes.',
  parametersJsonSchema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'The document title.',
      },
      summary: {
        type: 'string',
        description: 'A concise 2-3 sentence summary.',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Relevant topic tags (lowercase, hyphenated).',
      },
      primaryCategory: {
        type: 'string',
        enum: ['technical', 'process', 'reference', 'tutorial', 'decision'],
        description: 'The primary document category.',
      },
    },
    required: ['title', 'summary', 'primaryCategory'],
  },
};

// --- Main extraction function ---
interface WikiMetadata {
  title: string;
  summary: string;
  tags?: string[];
  primaryCategory: 'technical' | 'process' | 'reference' | 'tutorial' | 'decision';
}

async function extractWikiMetadata(
  documentContent: string,
  config: VertexConfig
): Promise<WikiMetadata> {
  const ai = createVertexClient(config);

  const response: GenerateContentResponse = await ai.models.generateContent({
    model: config.model,
    contents: `Analyze the following document and extract metadata:\n\n${documentContent}`,
    config: {
      tools: [{ functionDeclarations: [wikiExtractDeclaration] }],
      toolConfig: {
        functionCallingConfig: {
          // Force the model to always call extractWikiMetadata
          mode: FunctionCallingConfigMode.ANY,
          allowedFunctionNames: ['extractWikiMetadata'],
        },
      },
    },
  });

  if (!response.functionCalls || response.functionCalls.length === 0) {
    throw new Error('Model did not return a function call as expected.');
  }

  const call = response.functionCalls[0];

  if (call.name !== 'extractWikiMetadata') {
    throw new Error(`Unexpected function call: ${call.name}`);
  }

  // call.args is already a parsed object
  const args = call.args as WikiMetadata;

  // Log token usage
  if (response.usageMetadata) {
    console.log(`Tokens used — input: ${response.usageMetadata.inputTokens}, output: ${response.usageMetadata.outputTokens}`);
  }

  return args;
}

// --- Token counting before a request ---
async function estimateTokens(
  content: string,
  config: VertexConfig
): Promise<number> {
  const ai = createVertexClient(config);

  const result = await ai.models.countTokens({
    model: config.model,
    contents: content,
  });

  return result.totalTokens;
}

// --- Usage ---
async function main() {
  const config: VertexConfig = {
    project: process.env.GOOGLE_CLOUD_PROJECT ?? '',
    location: process.env.GOOGLE_CLOUD_LOCATION ?? 'us-central1',
    model: 'gemini-2.5-flash',
  };

  if (!config.project) {
    throw new Error('GOOGLE_CLOUD_PROJECT environment variable is required.');
  }

  const doc = `
    # TypeScript Generics Deep Dive
    This document covers advanced TypeScript generics patterns including
    conditional types, mapped types, and infer keyword usage. It includes
    practical examples for building type-safe utility functions.
  `;

  const tokenCount = await estimateTokens(doc, config);
  console.log(`Estimated tokens: ${tokenCount}`);

  const metadata = await extractWikiMetadata(doc, config);
  console.log('Extracted metadata:', JSON.stringify(metadata, null, 2));
}

main().catch(console.error);
```

---

## 8. Known Pitfalls and Gotchas

### Pitfall 1: `ANY` mode with no-parameter functions throws `INVALID_ARGUMENT`

Using `FunctionCallingConfigMode.ANY` with a `FunctionDeclaration` that has no `parameters` or `parametersJsonSchema` field results in a `400 INVALID_ARGUMENT` from the API. Always include at least one property in the schema.

### Pitfall 2: `FunctionCall`/`FunctionResponse` parts need explicit `Content[]`

When building multi-turn history containing function call/response parts, you must use the full `Content[]` structure with explicit `role` fields. Passing these as simple strings causes the SDK to throw an error.

```typescript
// WRONG — SDK will throw
const response = await ai.models.generateContent({
  contents: someFunctionCallPart,  // Error!
  ...
});

// CORRECT — explicit Content[]
const response = await ai.models.generateContent({
  contents: [
    { role: 'user', parts: [{ text: '...' }] },
    { role: 'model', parts: [{ functionCall: { name: '...', args: {} } }] },
    { role: 'user', parts: [{ functionResponse: { name: '...', response: {} } }] },
  ],
  ...
});
```

### Pitfall 3: `allowedFunctionNames` is only valid with `ANY` mode

Setting `allowedFunctionNames` when `mode` is `AUTO` or `NONE` is ignored or may cause unexpected behavior. Only set it when `mode` is `ANY`.

### Pitfall 4: Beta vs. stable endpoint differences

The default endpoint is `v1beta`, which includes preview features. `computeTokens` requires `apiVersion: 'v1'`. Be explicit when API version matters.

### Pitfall 5: Legacy packages vs. current package

| Package | Status | Notes |
|---------|--------|-------|
| `@google/genai` | **Current** | Use this for all new code |
| `@google/generative-ai` | Deprecated | Was v0.x Gemini SDK; uses `SchemaType` enum, `getGenerativeModel()` |
| `@google-cloud/vertexai` | Deprecated (removed June 2026) | Old Vertex-specific SDK |

Import patterns that are WRONG in `@google/genai`:
- `GoogleGenerativeAI` (old class name — correct is `GoogleGenAI`)
- `ai.models.getGenerativeModel(...)` (old pattern — correct is `ai.models.generateContent(...)`)
- `generationConfig` (old field name — correct is `config`)

---

## 9. `FunctionDeclaration` with `parametersJsonSchema` — Confirmed Support

**Direct answer to the primary research question:** Yes, `parametersJsonSchema` is fully supported in `FunctionDeclaration` in `@google/genai` v1.x (current SDK). It is the **recommended approach** in the official README's function calling section, shown as the primary example over the `parameters`+`Type` enum approach.

The `parametersJsonSchema` field accepts a plain JSON Schema draft-7 compatible object. Supported JSON Schema features include:
- `type`: `'object'`, `'string'`, `'number'`, `'integer'`, `'boolean'`, `'array'`, `'null'`
- `properties` (for objects)
- `items` (for arrays)
- `required` (list of required property names)
- `enum` (list of allowed values)
- `description` (per-property and top-level)

---

## Assumptions & Scope

| Assumption | Confidence | Impact if Wrong |
|------------|------------|-----------------|
| `parametersJsonSchema` accepts standard JSON Schema — confirmed by official README example | HIGH | None — directly documented |
| `response.functionCalls[n].args` is already a parsed JS object (not a JSON string) | HIGH | Would need `JSON.parse()` around args |
| `usageMetadata.inputTokens` / `outputTokens` are the correct field names on response | MEDIUM | Field names might be `promptTokenCount` / `candidatesTokenCount` in some API versions — check at runtime |
| `FunctionCallingConfigMode.ANY` + `allowedFunctionNames` with one name reliably forces one specific function | HIGH | Model might occasionally not comply — wrap in retry/assertion |
| `computeTokens` is Vertex AI only | HIGH | Gemini Developer API does not expose this method |
| `apiVersion: 'v1'` is not required for function calling and `countTokens` | HIGH | These work on the default beta endpoint |

### Explicitly Out of Scope

- Streaming function calls (`generateContentStream` with tools)
- Automatic Function Calling (AFC) — the SDK's experimental auto-invoke feature
- MCP (Model Context Protocol) integration (experimental in this SDK)
- Image/audio/video multimodal input combined with tool use
- Python SDK differences (this document is TypeScript-only)
- Authentication via service account JSON files (covered by `google-auth-library` docs)

---

## References

| # | Source | URL | Information Gathered |
|---|--------|-----|---------------------|
| 1 | js-genai GitHub README | https://github.com/googleapis/js-genai/blob/main/README.md | Vertex AI initialization, function calling pattern, `parametersJsonSchema` usage, `FunctionCallingConfigMode`, multi-turn structure |
| 2 | js-genai Code Generation Instructions | https://github.com/googleapis/js-genai/blob/main/codegen_instructions.md | Canonical code patterns, model naming, correct vs. incorrect API usage, structured output, streaming |
| 3 | Official API Docs (release) | https://googleapis.github.io/js-genai/release_docs/index.html | SDK overview, submodule listing, API version selection |
| 4 | Context7 — /googleapis/js-genai | https://context7.com/googleapis/js-genai | `countTokens` API, `FunctionDeclaration` with both `parameters` and `parametersJsonSchema`, Vertex AI config |
| 5 | Vertex AI Function Calling Reference | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling | REST API type definitions, `FunctionCallingConfigMode` modes documentation |
| 6 | Vertex AI Count Tokens API | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/count-tokens | `countTokens` response shape, `totalBillableCharacters`, `promptTokensDetails` |
| 7 | Vertex AI SDK Migration Guide | https://docs.cloud.google.com/vertex-ai/generative-ai/docs/deprecations/genai-vertexai-sdk | Deprecation timeline for `@google-cloud/vertexai` |
| 8 | Google AI — Function Calling Docs | https://ai.google.dev/gemini-api/docs/function-calling | 4-step function calling workflow, `AUTO`/`ANY`/`NONE` mode descriptions |
| 9 | npm package page | https://www.npmjs.com/package/@google/genai | Package version, download stats, deprecation notices for older packages |

### Recommended for Deep Reading

- **js-genai GitHub README** (https://github.com/googleapis/js-genai/blob/main/README.md): The single most authoritative source for current usage patterns. Read the Function Calling section carefully — the official examples now use `parametersJsonSchema`.
- **codegen_instructions.md** (https://github.com/googleapis/js-genai/blob/main/codegen_instructions.md): Google's own instructions for AI coding assistants. Contains the canonical correct/incorrect pattern list and all current model names.
- **Vertex AI Function Calling Reference** (https://docs.cloud.google.com/vertex-ai/generative-ai/docs/model-reference/function-calling): Detailed REST-level documentation of `FunctionCallingConfig`, mode semantics, and `allowedFunctionNames` behavior.

---

## Clarifying Questions for Follow-up

1. Does the Wiki CLI need to handle multi-turn tool conversations, or is a single forced tool call per document sufficient? (This affects whether `ai.chats` or raw `Content[]` is needed.)
2. What is the target Gemini model? `gemini-2.5-flash` is recommended for speed/cost balance; `gemini-2.5-pro` for complex reasoning tasks.
3. Should `apiVersion: 'v1'` (stable) or the default `v1beta` be used? Beta unlocks preview features but may have breaking changes.
4. Are there JSON Schema features needed beyond basic types (e.g., `$ref`, `oneOf`, `anyOf`, `allOf`)? These may not be supported by the Gemini function calling API.
5. Should `countTokens` be called before every `generateContent` call (pre-flight estimate), or is `response.usageMetadata` post-hoc tracking sufficient?
