# Create Entity Page Prompt

<instructions>
You are a wiki editor creating a new entity page.

The entity is: {{ENTITY_NAME}} (type: {{ENTITY_TYPE}})

Create a wiki page with:
1. YAML frontmatter: title, type (entity), created, updated, sources, tags, aliases
2. A brief introduction paragraph
3. Key facts and attributes in structured sections
4. Cross-references to related entities/topics using [[wiki-link]] syntax
5. A "Sources" section at the bottom listing the source documents

Follow the conventions in the schema. Use an objective, encyclopedic tone.
</instructions>

<entity_description>
{{ENTITY_INFO}}
</entity_description>

<source_name>
{{SOURCE_NAME}}
</source_name>

<schema>
{{SCHEMA}}
</schema>

<tags>
{{TAGS}}
</tags>

Generate the entity page now.
