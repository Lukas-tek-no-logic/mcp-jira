# MCP Jira Server

MCP (Model Context Protocol) server for Jira Server/Data Center integration. Allows Claude to browse and manage Jira projects, issues, boards and sprints through natural language.

## Requirements

- Node.js >= 18
- Jira Server/Data Center instance with REST API enabled
- Jira Personal Access Token (PAT)

## Installation

### From GitHub

```bash
npm install -g git+https://github.com/Lukas-tek-no-logic/mcp-jira.git
```

### From source

```bash
git clone https://github.com/Lukas-tek-no-logic/mcp-jira.git
cd mcp-jira
npm install
npm run build
npm install -g .
```

## Jira Personal Access Token

1. Log in to your Jira instance
2. Go to **Profile** → **Personal Access Tokens**
3. Click **Create token**
4. Give it a name and click **Create**
5. Copy the token - you will need it for configuration

## Configuration

### Windows (Claude Desktop)

Claude Desktop on Windows can run MCP servers through WSL2 or directly via Node.

**Option A: WSL2 (recommended)**

Install Node.js and mcp-jira inside WSL2:

```bash
# In WSL2 terminal
npm install -g git+https://github.com/Lukas-tek-no-logic/mcp-jira.git
```

Open Claude Desktop config file:

```
%APPDATA%\Claude\claude_desktop_config.json
```

Add the following:

```json
{
  "mcpServers": {
    "jira": {
      "command": "wsl",
      "args": ["mcp-jira"],
      "env": {
        "JIRA_BASE_URL": "https://jira.your-company.com",
        "JIRA_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

**Option B: Windows native (Node.js for Windows)**

Install Node.js for Windows from https://nodejs.org, then in PowerShell:

```powershell
npm install -g git+https://github.com/Lukas-tek-no-logic/mcp-jira.git
```

Config:

```json
{
  "mcpServers": {
    "jira": {
      "command": "mcp-jira",
      "env": {
        "JIRA_BASE_URL": "https://jira.your-company.com",
        "JIRA_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

### Linux / macOS

```bash
npm install -g git+https://github.com/Lukas-tek-no-logic/mcp-jira.git
```

Config location:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jira": {
      "command": "mcp-jira",
      "env": {
        "JIRA_BASE_URL": "https://jira.your-company.com",
        "JIRA_TOKEN": "your-personal-access-token"
      }
    }
  }
}
```

### Codex CLI

Codex CLI supports local STDIO MCP servers. First install `mcp-jira` globally:

```bash
npm install -g git+https://github.com/Lukas-tek-no-logic/mcp-jira.git
```

Then add the server. Replace the example values with your Jira URL and Personal
Access Token:

```bash
codex mcp add jira \
  --env JIRA_BASE_URL="https://jira.your-company.com" \
  --env JIRA_TOKEN="your-personal-access-token" \
  -- mcp-jira
```

Verify that Codex can see the configuration:

```bash
codex mcp list
```

Inside an interactive Codex CLI session, use `/mcp` to view the active server.

Alternatively, add this configuration directly to `~/.codex/config.toml`:

```toml
[mcp_servers.jira]
command = "mcp-jira"

[mcp_servers.jira.env]
JIRA_BASE_URL = "https://jira.your-company.com"
JIRA_TOKEN = "your-personal-access-token"
```

### Codex Desktop

Codex Desktop uses the same MCP configuration as Codex CLI. You can therefore
configure the server with the CLI command or `config.toml` shown above, then
restart Codex Desktop.

You can also configure it in the app:

1. Install the package globally with the `npm install -g` command above.
2. Open **Settings** → **MCP servers** and select **Add server**.
3. Choose **STDIO**, name the server `jira`, and set the command to `mcp-jira`.
4. Add the environment variables `JIRA_BASE_URL` and `JIRA_TOKEN` with your
   Jira URL and Personal Access Token.
5. Save and restart Codex Desktop.

After restart, type `/mcp` in the composer to confirm that `jira` is connected.

## Available Tools

| Tool | Description |
|------|-------------|
| `list_projects` | List all Jira projects |
| `get_project` | Get project details |
| `search_issues` | Search issues using JQL |
| `find_issues` | Full-text search across issues (summary, description, comments) |
| `get_issue` | Get full issue details + auto-downloads image attachments |
| `create_issue` | Create a new issue |
| `update_issue` | Update an existing issue |
| `get_comments` | Get comments on an issue |
| `add_comment` | Add a comment to an issue |
| `get_transitions` | Get available status transitions |
| `transition_issue` | Change issue status |
| `list_attachments` | List attachments on an issue |
| `get_attachment` | Download and display a specific image attachment |
| `list_boards` | List Scrum/Kanban boards |
| `get_sprints` | Get sprints for a board |
| `log_work` | Log time on an issue via Tempo (e.g. "2h 30m") |
| `get_worklogs` | Get Tempo worklogs for a date range |
| `delete_worklog` | Delete a Tempo worklog entry |

## Usage Examples

After configuring Claude Desktop, restart it and try:

- "Show me all Jira projects"
- "Search for open bugs in project MYAPP"
- "Create a task in MYAPP: Fix login page timeout"
- "What are the comments on MYAPP-42?"
- "Move MYAPP-42 to In Progress"
- "Show me active sprints on board 1"
- "Find issues about login timeout in project MYAPP"
- "Analyze bug MYAPP-99" (Claude automatically sees attached screenshots)
- "What attachments are on MYAPP-42?"
- "Log 2h on MYAPP-42 for today - code review"
- "Show my worklogs for this week"

## Installation Guide for Claude Code

If a user asks you (Claude) to install this MCP server, follow these steps:

### 1. Check prerequisites

```bash
node --version   # must be >= 18
```

If Node.js is missing, tell the user to install it first.

### 2. Install the package globally

```bash
npm install -g git+https://github.com/Lukas-tek-no-logic/mcp-jira.git
```

### 3. Ask the user for credentials

You need two values:
- **JIRA_BASE_URL** - their Jira instance URL (e.g. `https://jira.company.com`)
- **JIRA_TOKEN** - their Personal Access Token (generated in Jira: Profile → Personal Access Tokens)

Do NOT proceed without both values.

### 4. Detect OS and configure Claude Desktop

Find the config file:
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

Read the existing config (it may already have other MCP servers). Add the `jira` entry to `mcpServers`, preserving existing entries.

**On Linux/macOS or WSL2:**
```json
{
  "mcpServers": {
    "jira": {
      "command": "mcp-jira",
      "env": {
        "JIRA_BASE_URL": "<user's URL>",
        "JIRA_TOKEN": "<user's token>"
      }
    }
  }
}
```

**On Windows native (no WSL2):**
```json
{
  "mcpServers": {
    "jira": {
      "command": "mcp-jira",
      "env": {
        "JIRA_BASE_URL": "<user's URL>",
        "JIRA_TOKEN": "<user's token>"
      }
    }
  }
}
```

**On Windows with WSL2 (if mcp-jira was installed inside WSL2):**
```json
{
  "mcpServers": {
    "jira": {
      "command": "wsl",
      "args": ["mcp-jira"],
      "env": {
        "JIRA_BASE_URL": "<user's URL>",
        "JIRA_TOKEN": "<user's token>"
      }
    }
  }
}
```

### 5. Verify

```bash
mcp-jira  # should hang waiting for STDIO input - that means it works, Ctrl+C to stop
```

Tell the user to restart Claude Desktop to load the new MCP server.

## Troubleshooting

**Server not showing up in Claude Desktop**
- Make sure you restarted Claude Desktop after editing the config
- Verify the config JSON is valid (no trailing commas)
- Check that `mcp-jira` is accessible from the command line

**Authentication errors**
- Verify your PAT is valid and not expired
- Make sure `JIRA_BASE_URL` has no trailing slash
- Ensure your Jira instance allows REST API access

**WSL2 issues on Windows**
- Run `wsl mcp-jira` in PowerShell to verify it works
- Make sure Node.js is installed inside WSL2, not just on Windows
