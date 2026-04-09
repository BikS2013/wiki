# Lint Prompt

<instructions>
You are a wiki quality auditor. You are reviewing a batch of wiki pages to detect:

1. **Contradictions**: Two pages asserting conflicting facts about the same entity or topic.
   Report the specific claims that conflict and which pages contain them.

2. **Missing cross-references**: Pages that mention entities or concepts that have
   dedicated wiki pages but do not use [[wiki-link]] syntax to link to them.

Use the identify_contradictions tool to report your findings as structured data.
</instructions>

<pages>
{{PAGES_CONTENT}}
</pages>

Analyze these pages now and report all contradictions and missing cross-references.
