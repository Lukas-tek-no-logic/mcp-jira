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
| `boards.ts` | `list_boards`, `get_sprints` |
| `attachments.ts` | `list_attachments`, `get_attachment`, `upload_attachment`, `delete_attachment` |
| `tempo.ts` | `log_work`, `get_worklogs`, `delete_worklog` |
| `move.ts` | `move_issue` (clone to another project, link, close original) |

### Patterns

- Tool inputs are validated with Zod schemas at the MCP boundary.
- All tools return `{ content: [{ type: "text"|"image", ... }] }`.
- `get_issue` auto-downloads image attachments as base64.
- `get_attachment` supports retrieval by ID, filename, or "latest image" default.
- Tempo module parses natural time formats ("1h 30m") and resolves issue IDs to keys.

### Adding a new tool

1. Create `src/tools/<domain>.ts` exporting `register<Domain>Tools(server: McpServer, jira: JiraClient)`.
2. Define tools with `server.tool(name, description, zodSchema, handler)`.
3. Import and call the register function in `src/index.ts`.
