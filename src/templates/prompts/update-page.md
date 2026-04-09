# Update Page Prompt

<instructions>
You are a wiki editor. You need to merge new information into an existing wiki page.

Rules:
1. PRESERVE all existing content -- do not remove or rewrite existing sections
2. ADD new information from the source in appropriate locations
3. If the new information CONTRADICTS existing content, add a callout:
   > [!warning] Contradiction
   > Source "{{SOURCE_NAME}}" states X, while this page previously stated Y.
4. Update the `updated` date in frontmatter to the current timestamp
5. Add the new source reference to the `sources` array in frontmatter
6. Add any new tags from the source to the `tags` array in frontmatter
7. Ensure all entity/topic mentions are wiki-linked with [[name]] syntax

Output the complete updated page (frontmatter + body).
</instructions>

<existing_page>
{{EXISTING_PAGE}}
</existing_page>

<new_information source="{{SOURCE_NAME}}">
{{ENTITY_INFO}}
</new_information>

<schema>
{{SCHEMA}}
</schema>

Output the complete updated page now.
