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

## Alternative: Docker MCP Toolkit with MCP Atlassian

Instead of installing this package directly, you can run the
[MCP Atlassian](https://github.com/sooperset/mcp-atlassian) server through
Docker Desktop's **MCP Toolkit**. This option centralizes server configuration
in Docker, then lets you connect the same profile to Codex or Claude Code.

> **Note:** MCP Toolkit is a Docker Desktop beta feature. The current Toolkit
> interface described below requires Docker Desktop 4.62 or later.

1. Install and open Docker Desktop.
2. In **Settings** → **Beta features**, enable **Docker MCP Toolkit** and
   select **Apply**.
3. Open **MCP Toolkit** → **Profiles** and create or select a profile for your
   Jira integration.
4. Open the **Catalog**, search for **MCP Atlassian** (the server from
   `sooperset/mcp-atlassian`), and add it to the profile.
5. Open the server configuration and set the variables for your Jira deployment.

For Jira Cloud, configure:

```text
JIRA_URL=https://your-company.atlassian.net
JIRA_USERNAME=your.email@company.com
JIRA_API_TOKEN=your-api-token
```

For Jira Server or Data Center, configure:

```text
JIRA_URL=https://jira.your-company.com
JIRA_PERSONAL_TOKEN=your-personal-access-token
```

Keep tokens private: do not commit them to a repository or put them in project
configuration files. If you use a self-signed Jira certificate, consult the
MCP Atlassian documentation before disabling SSL verification.

After saving the server configuration, restart Docker Desktop so that the
Toolkit reloads the profile and server configuration.

### Connect the Docker profile to Codex or Claude Code

1. In Docker Desktop, open **MCP Toolkit** → **Clients**.
2. Find **Codex** or **Claude Code** and select **Connect** for the profile.
3. Restart the client after Docker has added the `MCP_DOCKER` gateway.

Verify the connection with one of these commands:

```bash
# Codex
codex mcp list

# Claude Code
claude mcp list
```

Both clients connect to the Docker gateway instead of directly to the
Atlassian server. This makes the Docker profile reusable across clients and
keeps the server setup in one place.

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
