import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { commentShape, jsonResult, toComment } from "./shapes.js";

export function registerCommentTools(server: McpServer, jira: JiraClient) {
  server.registerTool(
    "get_comments",
    {
      description: "Get comments on a Jira issue, oldest first",
      inputSchema: { issueKey: z.string().describe("The issue key (e.g. PROJ-123)") },
      outputSchema: {
        issueKey: z.string(),
        total: z.number().describe("Number of comments on the issue"),
        comments: z.array(commentShape),
      },
    },
    async ({ issueKey }) => {
      const data = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`
      );
      const comments = data.comments.map(toComment);
      return jsonResult({ issueKey, total: data.total ?? comments.length, comments });
    }
  );

  server.tool(
    "add_comment",
    "Add a comment to a Jira issue",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      body: z.string().describe("Comment text"),
    },
    async ({ issueKey, body }) => {
      const result = await jira.post<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`,
        { body }
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "edit_comment",
    "Edit an existing comment on a Jira issue (replaces its text)",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      commentId: z.string().describe("The comment ID (from get_comments)"),
      body: z.string().describe("New comment text"),
    },
    async ({ issueKey, commentId, body }) => {
      const result = await jira.put<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`,
        { body }
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "delete_comment",
    "Delete a comment from a Jira issue",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      commentId: z.string().describe("The comment ID (from get_comments)"),
    },
    async ({ issueKey, commentId }) => {
      await jira.delete<void>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment/${encodeURIComponent(commentId)}`
      );
      return { content: [{ type: "text", text: `Deleted comment ${commentId} from ${issueKey}` }] };
    }
  );
}
