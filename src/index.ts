#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { JiraClient } from "./jira-client.js";
import { registerProjectTools } from "./tools/projects.js";
import { registerIssueTools } from "./tools/issues.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerTransitionTools } from "./tools/transitions.js";
import { registerBoardTools } from "./tools/boards.js";
import { registerAttachmentTools } from "./tools/attachments.js";
import { registerTempoTools } from "./tools/tempo.js";
import { registerMoveTools } from "./tools/move.js";
import { registerLinkTools } from "./tools/links.js";

const baseUrl = process.env.JIRA_BASE_URL;
const token = process.env.JIRA_TOKEN;

if (!baseUrl || !token) {
  console.error("Missing required environment variables: JIRA_BASE_URL, JIRA_TOKEN");
  process.exit(1);
}

const jira = new JiraClient(baseUrl, token);

const server = new McpServer({
  name: "jira",
  version: "1.0.0",
});

registerProjectTools(server, jira);
registerIssueTools(server, jira);
registerCommentTools(server, jira);
registerTransitionTools(server, jira);
registerBoardTools(server, jira);
registerAttachmentTools(server, jira);
registerTempoTools(server, jira);
registerMoveTools(server, jira);
registerLinkTools(server, jira);

const transport = new StdioServerTransport();
await server.connect(transport);
