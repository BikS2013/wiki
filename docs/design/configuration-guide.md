# LLM Wiki - Configuration Guide

## Configuration Sources and Priority

LLM Wiki supports three configuration sources, listed from **highest to lowest priority**:

| Priority | Source | Description |
|----------|--------|-------------|
| 1 (highest) | CLI arguments | Passed via `--config`, `--verbose`, `--dry-run`, and programmatic `cliOverrides` |
| 2 | Environment variables | Shell env vars prefixed with `WIKI_` |
| 3 (lowest) | Config file | JSON file at `config.json` (or path specified by `--config`) |

When the same setting is specified at multiple levels, the higher-priority source wins. **There are no default or fallback values** -- every required field must be explicitly provided through one of the three sources, or the application will throw a `ConfigurationError`.

---

## Config File Location

The default config file path is `./config.json` (relative to the working directory). Override with:

```bash
npx tsx src/cli.ts --config /path/to/my-config.json [command]
```

---

## Configuration Variables

### LLM Section (`llm.*`)

#### `llm.provider`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Selects which LLM backend to use |
| **Required** | Yes (all providers) |
| **Env var** | `WIKI_LLM_PROVIDER` |
| **Options** | `anthropic`, `azure`, `vertex` |
| **How to obtain** | Choose based on your LLM service subscription |
| **Recommended storage** | Config file (`config.json`) |

- **`anthropic`** -- Uses the Anthropic Claude API directly. Best for Claude models (Opus, Sonnet, Haiku). Requires an Anthropic API key.
- **`azure`** -- Uses Azure AI Inference REST API. Supports Azure-hosted models (GPT-4o, Mistral, DeepSeek, etc.). Requires an Azure endpoint, deployment name, and API key.
- **`vertex`** -- Uses Google Vertex AI with the `@google/genai` SDK. Supports Gemini models. Authenticates via Application Default Credentials (ADC) -- no API key needed.

---

#### `llm.model`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The model identifier to use for LLM calls |
| **Required** | Yes (all providers) |
| **Env var** | `WIKI_LLM_MODEL` |
| **Options** | Any model name recognized by the selected provider |
| **How to obtain** | Check your provider's model catalog |
| **Recommended storage** | Config file (`config.json`) |

Known models with context limits configured:

| Provider | Model | Context Window |
|----------|-------|---------------|
| Anthropic | `claude-opus-4-5` | 200,000 |
| Anthropic | `claude-sonnet-4-5` | 200,000 |
| Anthropic | `claude-sonnet-4-20250514` | 200,000 |
| Anthropic | `claude-haiku-3-5-20241022` | 200,000 |
| Azure | `gpt-4o` | 128,000 |
| Azure | `gpt-4o-mini` | 128,000 |
| Azure | `mistral-large-latest` | 128,000 |
| Azure | `deepseek-chat` | 128,000 |
| Vertex | `gemini-2.0-flash` | 1,000,000 |
| Vertex | `gemini-2.5-pro` | 1,000,000 |
| Vertex | `gemini-2.5-flash` | 1,000,000 |
| Vertex | `gemini-1.5-pro` | 2,000,000 |

---

#### `llm.apiKey`

| Attribute | Value |
|-----------|-------|
| **Purpose** | API key for authenticating with the LLM provider |
| **Required** | Yes for `anthropic` and `azure`; **Not required** for `vertex` (uses ADC) |
| **Env var** | `WIKI_LLM_API_KEY` |
| **How to obtain** | **Anthropic**: Create at https://console.anthropic.com/settings/keys. **Azure**: Copy from the Azure portal (resource > Keys and Endpoint). |
| **Recommended storage** | Environment variable (`WIKI_LLM_API_KEY`). Never commit API keys to version control. |

---

#### `llm.apiKeyExpiry`

| Attribute | Value |
|-----------|-------|
| **Purpose** | ISO 8601 date string indicating when the API key expires |
| **Required** | No (optional) |
| **Env var** | N/A (config file only) |
| **How to obtain** | Check your provider's key management console for expiry dates |
| **Recommended storage** | Config file (`config.json`) |

When set, the application checks the expiry date at startup:
- If the key has **already expired**, an `[ERROR]` message is written to stderr.
- If the key expires **within 7 days**, a `[WARN]` message is written to stderr.
- If the key is valid for more than 7 days, no message is emitted.

**Recommendation**: Always set this field for API keys that have expiration dates. This provides proactive warnings so you can renew keys before they expire and disrupt service.

---

#### `llm.maxTokens`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Maximum number of output tokens per LLM call |
| **Required** | Yes (all providers) |
| **Env var** | `WIKI_LLM_MAX_TOKENS` |
| **How to obtain** | Choose based on expected output length. 4096 is a good starting point. |
| **Recommended storage** | Config file (`config.json`) |
| **Constraints** | Must be a positive integer |

---

#### `llm.azureEndpoint`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The Azure AI Inference endpoint URL |
| **Required** | Yes when `provider = 'azure'` |
| **Env var** | `WIKI_AZURE_ENDPOINT` |
| **How to obtain** | Azure Portal > your AI resource > Keys and Endpoint. Typically `https://<resource-name>.openai.azure.com` |
| **Recommended storage** | Config file or environment variable |

---

#### `llm.azureDeployment`

| Attribute | Value |
|-----------|-------|
| **Purpose** | The deployment name within your Azure AI resource |
| **Required** | Yes when `provider = 'azure'` |
| **Env var** | `WIKI_AZURE_DEPLOYMENT` |
| **How to obtain** | Azure Portal > your AI resource > Model deployments. This is the name you gave to your deployment. |
| **Recommended storage** | Config file (`config.json`) |

---

#### `llm.vertexProjectId`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Google Cloud project ID for Vertex AI |
| **Required** | Yes when `provider = 'vertex'` |
| **Env var** | `WIKI_VERTEX_PROJECT_ID` |
| **How to obtain** | Google Cloud Console > Project selector (top bar). The project ID is shown below the project name. |
| **Recommended storage** | Config file or environment variable |

---

#### `llm.vertexLocation`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Google Cloud region for Vertex AI API calls |
| **Required** | Yes when `provider = 'vertex'` |
| **Env var** | `WIKI_VERTEX_LOCATION` |
| **Options** | `us-central1`, `europe-west4`, `asia-northeast1`, etc. |
| **How to obtain** | Choose a region that supports Gemini models. See https://cloud.google.com/vertex-ai/generative-ai/docs/learn/locations |
| **Recommended storage** | Config file or environment variable |

---

### Wiki Section (`wiki.*`)

#### `wiki.rootDir`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Absolute path to the wiki root directory |
| **Required** | Yes |
| **Env var** | `WIKI_ROOT_DIR` |
| **Constraints** | Must be an absolute path (starts with `/` on Unix or `C:\` on Windows) |
| **How to obtain** | Choose a directory on your filesystem. Typically your Obsidian vault root. |
| **Recommended storage** | Config file (`config.json`) |

---

#### `wiki.sourcesDir`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Directory for source files, relative to `rootDir` |
| **Required** | Yes |
| **How to obtain** | Choose a subdirectory name (e.g., `sources`) |
| **Recommended storage** | Config file (`config.json`) |

---

#### `wiki.wikiDir`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Directory for generated wiki pages, relative to `rootDir` |
| **Required** | Yes |
| **How to obtain** | Choose a subdirectory name (e.g., `wiki`) |
| **Recommended storage** | Config file (`config.json`) |

---

#### `wiki.schemaDir`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Directory for schema/template files, relative to `rootDir` |
| **Required** | Yes |
| **How to obtain** | Choose a subdirectory name (e.g., `schema`) |
| **Recommended storage** | Config file (`config.json`) |

---

### Obsidian Section (`obsidian.*`)

#### `obsidian.enabled`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Whether Obsidian integration features are enabled |
| **Required** | Yes |
| **Options** | `true`, `false` |
| **Recommended storage** | Config file (`config.json`) |

---

#### `obsidian.vaultPath`

| Attribute | Value |
|-----------|-------|
| **Purpose** | Path to the Obsidian vault if different from `wiki.rootDir` |
| **Required** | No (optional) |
| **Recommended storage** | Config file (`config.json`) |

---

## Provider-Specific Requirements Summary

| Field | Anthropic | Azure | Vertex |
|-------|-----------|-------|--------|
| `llm.provider` | Required | Required | Required |
| `llm.model` | Required | Required | Required |
| `llm.apiKey` | **Required** | **Required** | Not needed (uses ADC) |
| `llm.maxTokens` | Required | Required | Required |
| `llm.azureEndpoint` | -- | **Required** | -- |
| `llm.azureDeployment` | -- | **Required** | -- |
| `llm.vertexProjectId` | -- | -- | **Required** |
| `llm.vertexLocation` | -- | -- | **Required** |

---

## Example Configurations

### Anthropic (Claude)

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "apiKey": "sk-ant-api03-...",
    "apiKeyExpiry": "2026-12-31",
    "maxTokens": 4096
  },
  "wiki": {
    "rootDir": "/Users/me/my-wiki",
    "sourcesDir": "sources",
    "wikiDir": "wiki",
    "schemaDir": "schema"
  },
  "obsidian": {
    "enabled": true
  }
}
```

### Azure AI

```json
{
  "llm": {
    "provider": "azure",
    "model": "gpt-4o",
    "apiKey": "abc123...",
    "apiKeyExpiry": "2026-06-30",
    "azureEndpoint": "https://my-resource.openai.azure.com",
    "azureDeployment": "my-gpt4o-deployment",
    "maxTokens": 4096
  },
  "wiki": {
    "rootDir": "/Users/me/my-wiki",
    "sourcesDir": "sources",
    "wikiDir": "wiki",
    "schemaDir": "schema"
  },
  "obsidian": {
    "enabled": false
  }
}
```

### Vertex AI (Gemini)

```json
{
  "llm": {
    "provider": "vertex",
    "model": "gemini-2.5-pro",
    "vertexProjectId": "my-gcp-project-123",
    "vertexLocation": "us-central1",
    "maxTokens": 8192
  },
  "wiki": {
    "rootDir": "/Users/me/my-wiki",
    "sourcesDir": "sources",
    "wikiDir": "wiki",
    "schemaDir": "schema"
  },
  "obsidian": {
    "enabled": true
  }
}
```

**Note for Vertex AI**: Authentication uses Google Application Default Credentials (ADC). Before running, ensure you have authenticated:

```bash
gcloud auth application-default login
```

Or set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to a service account key file.

---

## Environment Variable Reference

| Env Var | Config Path | Notes |
|---------|-------------|-------|
| `WIKI_LLM_PROVIDER` | `llm.provider` | `anthropic`, `azure`, or `vertex` |
| `WIKI_LLM_MODEL` | `llm.model` | Model identifier |
| `WIKI_LLM_API_KEY` | `llm.apiKey` | API key (not needed for vertex) |
| `WIKI_LLM_MAX_TOKENS` | `llm.maxTokens` | Positive integer |
| `WIKI_ROOT_DIR` | `wiki.rootDir` | Absolute path |
| `WIKI_AZURE_ENDPOINT` | `llm.azureEndpoint` | Azure-only |
| `WIKI_AZURE_DEPLOYMENT` | `llm.azureDeployment` | Azure-only |
| `WIKI_VERTEX_PROJECT_ID` | `llm.vertexProjectId` | Vertex-only |
| `WIKI_VERTEX_LOCATION` | `llm.vertexLocation` | Vertex-only |
