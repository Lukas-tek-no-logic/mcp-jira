# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

MCP (Model Context Protocol) server for Jira Server/Data Center integration. Exposes 17 tools that let Claude browse and manage Jira projects, issues, boards, sprints, and time tracking via natural language.

## Build & Run

```bash
npm install          # install dependencies
npm run build        # tsc → dist/
npm start            # node dist/index.js (stdio transport)
npm install -g .     # install globally as `mcp-jira` CLI
```

There are no tests or linting configured.

## Required Environment Variables

- `JIRA_BASE_URL` – Jira instance URL (e.g. `https://jira.company.com`)
- `JIRA_TOKEN` – Personal Access Token (Bearer auth)

## Architecture

TypeScript, compiled to ES2022 with NodeNext module resolution. Two runtime dependencies: `@modelcontextprotocol/sdk` and `zod`.

### Entry point

`src/index.ts` – validates env vars, creates a `JiraClient`, instantiates `McpServer`, registers all tool modules, then connects via `StdioServerTransport`.

### JiraClient (`src/jira-client.ts`)

Generic HTTP wrapper around Jira REST API. Provides typed `get/post/put/delete` methods plus `getBuffer()` for binary downloads (images). All auth is Bearer token.

### Tool modules (`src/tools/`)

Each file exports a `register*Tools(server, jira)` function that registers related MCP tools:

| Module | Tools |
|---|---|
| `projects.ts` | `list_projects`, `get_project` |
| `issues.ts` | `search_issues` (JQL), `find_issues` (full-text), `get_issue`, `create_issue`, `update_issue` |
| `comments.ts` | `get_comments`, `add_comment`, `edit_comment`, `delete_comment` |
| `transitions.ts` | `get_transitions`, `transition_issue` |
| `boards.ts` | `list_boards`, `get_sprints`, `move_to_sprint`, `move_to_backlog` |
| `attachments.ts` | `list_attachments`, `get_attachment`, `upload_attachment`, `delete_attachment` |
| `tempo.ts` | `log_work`, `get_worklogs`, `delete_worklog` |
| `move.ts` | `move_issue` (clone to another project, link, close original) |
| `links.ts` | `link_issues`, `get_issue_links`, `delete_issue_link` |

### Patterns

- Tool inputs are validated with Zod schemas at the MCP boundary.
- All tools return `{ content: [{ type: "text"|"image", ... }] }`.
- Read tools (`get_*`, `list_*`, `search_issues`, `find_issues`) are registered with `server.registerTool` and an `outputSchema`, and return `structuredContent` via `jsonResult()` (`src/tools/shapes.ts`, shared shapes and mappers). The result is always one top-level object (wrap lists: `{ issueKey, comments: [...] }`), never a bare array, and its shape does not change when images are attached. Clients turn the schema into a return type (opencode Code Mode shows it in the tool signature and passes `structuredContent` to the code), so models stop guessing the shape. Without a schema, opencode joins all text blocks and parses them as JSON only if the whole text is valid JSON; an extra text block turns the result into a plain string.
- `get_issue` returns curated fields (status, description, `comments.total` + `comments.items`, `links`, `attachments`) and `otherFields` with the remaining non-empty fields, custom fields named "Name [customfield_N]".
- `get_issue` lists image attachments by ID without downloading them; `includeImages: true` downloads up to `maxImages` (default 5, newest first). Images are opt-in because one issue with dozens of screenshots overflows the per-request image limit of the model (GLM: 50).
- `get_attachment` supports retrieval by ID, filename, or "latest image" default.
- Tempo module parses natural time formats ("1h 30m") and resolves issue IDs to keys.

### Adding a new tool

1. Create `src/tools/<domain>.ts` exporting `register<Domain>Tools(server: McpServer, jira: JiraClient)`.
2. Define write tools with `server.tool(name, description, zodSchema, handler)`; read tools with `server.registerTool(name, { description, inputSchema, outputSchema }, handler)` returning `jsonResult(...)`.
3. Import and call the register function in `src/index.ts`.
