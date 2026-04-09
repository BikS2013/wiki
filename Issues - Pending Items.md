# Issues - Pending Items

## Pending Items

### High Priority

1. **Dual token estimation functions with different behavior** -- `src/llm/tokens.ts:estimateTokens()` applies a 15% safety margin (chars/4 * 1.15), while `src/source/chunker.ts:estimateTokens()` uses raw chars/4 without margin. The chunker should either import from `tokens.ts` or the discrepancy should be documented as intentional. Risk: chunks may be sized differently than the budget analyzer expects.

2. **`PromptBudgetAnalyzer` throws on unknown models** -- `src/llm/tokens.ts` has a hardcoded `CONTEXT_LIMITS` map. Any model string not in this map (including new Claude models) causes a runtime error. Consider making the context limit configurable or adding a fallback for unknown models with a warning.

3. **Missing `@types/gray-matter` in devDependencies** -- The design plan lists `@types/gray-matter` as a required dev dependency, but `package.json` does not include it. The code works because `gray-matter` ships its own types, but the `as any` cast on line 66 of `frontmatter.ts` suggests the type compatibility is not clean.

4. **`ingest/pipeline.ts` uses sync `existsSync` in async pipeline** -- Multiple calls to `existsSync` in the async `ingest()` method. These should use `access()` from `fs/promises` for consistency, though the functional impact is minimal.

### Medium Priority

5. **`init.ts` generates a log.md in table format but `LogWriter` uses line format** -- The `buildLogContent()` in `init.ts` creates a log with a markdown table header (`| Timestamp | Action | Details |`), but `LogWriter` appends entries in the `[YYYY-MM-DD HH:mm] [ACTION] description` line format. The initial log header will be inconsistent with subsequent entries.

6. **`query/pipeline.ts` creates `wikiDir` path twice** -- The constructor receives dependencies with `wikiDir` already baked into `PageManager` and `LogWriter`, but `query()` re-derives `wikiDir` from config on lines 68-69 and again on lines 223-224 in `saveQueryResult`. This should use a stored reference.

7. **`lint/fixer.ts` broken link fix only handles `[[Target]]` syntax** -- The regex on line 152 replaces `[[brokenTarget]]` but doesn't handle `[[brokenTarget|Display Text]]` pipe syntax. Broken links with display text will not be fixed.

### Low Priority

8. **`wikilinks.ts` uses sync `readdirSync` and `existsSync`** -- The `resolveWikiLinkToPath` and `collectMarkdownFiles` functions use synchronous filesystem operations, which could block the event loop with large wiki directories.

9. **`formatReport` in `lint/report.ts` is redundant** -- It calls `generateReport()` internally and then `formatReportAsMarkdown()`. No caller uses `formatReport()` directly; `commands/lint.ts` calls `generateReport()` and `formatReportAsMarkdown()` separately.

### Notes

10. **Context limit values use round numbers instead of exact powers of 2** -- `src/llm/tokens.ts` uses `1_000_000` for Gemini 2.0 Flash / 2.5 Pro / 2.5 Flash and `2_000_000` for Gemini 1.5 Pro. The refined requirements specified `1_048_576` and `2_097_152` (exact binary values). The round numbers are acceptable since Google's documentation uses approximate values, but this is a known deviation from the spec.

11. **No dedicated test files for Azure and Vertex providers** -- The plan called for `test_scripts/test-azure-ai-provider.ts` and `test_scripts/test-vertex-ai-provider.ts` unit test files. These were not created. Provider correctness can only be verified with live credentials (integration tests). Consider adding unit tests with mocked SDK clients.

12. **Plan file references filenames `azure-ai.ts` and `vertex-ai.ts` but actual files are `azure.ts` and `vertex.ts`** -- The plan document (`plan-002-multi-provider-support.md`) still references the old filenames. The project-design.md has been corrected.

## Completed Items

### Multi-Provider Code Review (2026-04-09)

6. **FIXED: Missing Azure SDK dependencies in package.json** -- `@azure-rest/ai-inference` and `@azure/core-auth` were not listed in `package.json` dependencies, causing TypeScript compilation failure (`TS2307: Cannot find module`). Added both packages to `dependencies`.

7. **FIXED: Anthropic provider missing non-null assertion on `config.apiKey`** -- After `apiKey` was made optional in `LLMConfig`, `AnthropicProvider` constructor passed `string | undefined` to the Anthropic SDK. Added `config.apiKey!` non-null assertion (validator guarantees presence for anthropic provider).

8. **FIXED: `checkApiKeyExpiry` not skipping for Vertex provider** -- The function would check API key expiry even for Vertex configs (which use ADC, not API keys). Added early return when `provider === 'vertex'` per AC-15.

9. **FIXED: Stale project-design.md references** -- Factory section still said "Provider not yet implemented" for azure/vertex. Source file listing was missing `azure.ts`, `vertex.ts`, and `tokens.ts`. File names were listed as `azure-ai.ts`/`vertex-ai.ts` instead of actual `azure.ts`/`vertex.ts`. All corrected.

### Integration Verification (2026-04-09)

5. **FIXED: No test scripts implemented yet** -- All 10 test files have been created in `test_scripts/` and pass (153 total assertions across chunker, config, frontmatter, hasher, index-manager, log, naming, registry, tokens, wikilinks).

### Code Review (2026-04-09)

1. **FIXED: Missing validation for `wiki.sourcesDir`, `wiki.wikiDir`, `wiki.schemaDir`, `obsidian.enabled`** -- `config/validator.ts` did not validate these required fields. If missing from config.json, they would silently be `undefined`, causing incorrect path construction at runtime. Added validation checks that throw `ConfigurationError` with the field name.

2. **FIXED: `IndexManager` lacked `getEntries()` method** -- `lint/structural.ts` was using `findByTitle('')` as a hack to retrieve all entries. Added a proper `getEntries()` method to `IndexManager` and updated `structural.ts` to use it.

3. **FIXED: `ingest/pipeline.ts` used non-standard log and index format** -- The `appendToLog()` helper used `## timestamp` + `- [ACTION]` format, inconsistent with `LogWriter`'s standard `[YYYY-MM-DD HH:mm] [ACTION]` format. The `updateIndexFile()` helper used raw string append instead of the `IndexManager` class. Replaced both with proper `LogWriter` and `IndexManager` usage for consistency across all commands.

4. **FIXED: Misleading "default" comments in `WikiPaths` interface** -- The `sourcesDir`, `wikiDir`, and `schemaDir` field comments said "(default: ...)" but no defaults exist per the no-fallback-values rule. Updated comments to say "(e.g. ...)" instead.
