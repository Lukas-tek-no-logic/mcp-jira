import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";

export function registerCommentTools(server: McpServer, jira: JiraClient) {
  server.tool(
    "get_comments",
    "Get comments on a Jira issue",
    { issueKey: z.string().describe("The issue key (e.g. PROJ-123)") },
    async ({ issueKey }) => {
      const data = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`
      );
      const comments = data.comments.map((c: any) => ({
        id: c.id,
        author: c.author?.displayName,
        body: c.body,
        created: c.created,
        updated: c.updated,
      }));
      return { content: [{ type: "text", text: JSON.stringify(comments, null, 2) }] };
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
