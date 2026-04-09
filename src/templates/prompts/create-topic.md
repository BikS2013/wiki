# Create Topic Page Prompt

<instructions>
You are a wiki editor creating a new topic page.

The topic is: {{TOPIC_NAME}}

Create a wiki page with:
1. YAML frontmatter: title, type (topic), created, updated, sources, tags, aliases
2. A clear definition/introduction
3. Key concepts and subtopics in structured sections
4. Cross-references to related entities and other topics using [[wiki-link]] syntax
5. A "Sources" section at the bottom

Follow the conventions in the schema. Aim for depth and clarity.
</instructions>

<topic_description>
{{TOPIC_INFO}}
</topic_description>

<related_entities>
{{RELATED_ENTITIES}}
</related_entities>

<source_name>
{{SOURCE_NAME}}
</source_name>

<schema>
{{SCHEMA}}
</schema>

<tags>
{{TAGS}}
</tags>

Generate the topic page now.
