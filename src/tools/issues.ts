import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";

const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function registerIssueTools(server: McpServer, jira: JiraClient) {
  server.tool(
    "search_issues",
    "Search Jira issues using JQL",
    {
      jql: z.string().describe("JQL query string"),
      maxResults: z.number().default(20).describe("Maximum number of results (default 20)"),
    },
    async ({ jql, maxResults }) => {
      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
      });
      const data = await jira.get<any>(`/rest/api/2/search?${params}`);
      const issues = data.issues.map((i: any) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name,
        assignee: i.fields.assignee?.displayName,
        priority: i.fields.priority?.name,
      }));
      return { content: [{ type: "text", text: JSON.stringify(issues, null, 2) }] };
    }
  );

  server.tool(
    "get_issue",
    "Get full details of a Jira issue",
    { issueKey: z.string().describe("The issue key (e.g. PROJ-123)") },
    async ({ issueKey }) => {
      const issue = await jira.get<any>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`);
      const content: any[] = [{ type: "text", text: JSON.stringify(issue, null, 2) }];

      const attachments: any[] = issue.fields?.attachment || [];
      const images = attachments.filter((a: any) => IMAGE_MIME_TYPES.has(a.mimeType));

      for (const img of images) {
        try {
          const buffer = await jira.getBuffer(img.content);
          content.push(
            { type: "text", text: `\n--- Attachment: ${img.filename} ---` },
            { type: "image", data: buffer.toString("base64"), mimeType: img.mimeType },
          );
        } catch {
          content.push({ type: "text", text: `\n--- Failed to download: ${img.filename} ---` });
        }
      }

      return { content };
    }
  );

  server.tool(
    "find_issues",
    "Full-text search across Jira issues (searches summary, description, comments, attachments). Simpler than JQL - just type what you're looking for.",
    {
      query: z.string().describe("Text to search for (e.g. 'login timeout', 'NullPointerException')"),
      projectKey: z.string().optional().describe("Limit search to a specific project (e.g. MYAPP)"),
      maxResults: z.number().default(20).describe("Maximum number of results (default 20)"),
    },
    async ({ query, projectKey, maxResults }) => {
      let jql = `text ~ "${query.replace(/"/g, '\\"')}"`;
      if (projectKey) jql += ` AND project = ${projectKey}`;
      jql += " ORDER BY updated DESC";
      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
      });
      const data = await jira.get<any>(`/rest/api/2/search?${params}`);
      const issues = data.issues.map((i: any) => ({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status?.name,
        assignee: i.fields.assignee?.displayName,
        priority: i.fields.priority?.name,
        updated: i.fields.updated,
      }));
      return {
        content: [{
          type: "text",
          text: issues.length
            ? JSON.stringify(issues, null, 2)
            : `No issues found for "${query}"`,
        }],
      };
    }
  );

  server.tool(
    "create_issue",
    "Create a new Jira issue",
    {
      projectKey: z.string().describe("The project key"),
      summary: z.string().describe("Issue summary/title"),
      issueType: z.string().default("Task").describe("Issue type (default: Task)"),
      description: z.string().optional().describe("Issue description"),
      assignee: z.string().optional().describe("Assignee username"),
      priority: z.string().optional().describe("Priority name (e.g. High, Medium, Low)"),
      labels: z.array(z.string()).optional().describe("Labels (e.g. [\"backend\", \"urgent\"])"),
      dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    },
    async ({ projectKey, summary, issueType, description, assignee, priority, labels, dueDate }) => {
      const fields: any = {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType },
      };
      if (description) fields.description = description;
      if (assignee) fields.assignee = { name: assignee };
      if (priority) fields.priority = { name: priority };
      if (labels) fields.labels = labels;
      if (dueDate) fields.duedate = dueDate;

      const result = await jira.post<any>("/rest/api/2/issue", { fields });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    "update_issue",
    "Update an existing Jira issue",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      summary: z.string().optional().describe("New summary"),
      description: z.string().optional().describe("New description"),
      assignee: z.string().optional().describe("New assignee username"),
      priority: z.string().optional().describe("New priority name"),
      labels: z.array(z.string()).optional().describe("New labels. Replaces all current labels; an empty list removes them"),
      dueDate: z.string().optional().describe("New due date in YYYY-MM-DD format"),
    },
    async ({ issueKey, summary, description, assignee, priority, labels, dueDate }) => {
      const fields: any = {};
      if (summary) fields.summary = summary;
      if (description) fields.description = description;
      if (assignee) fields.assignee = { name: assignee };
      if (priority) fields.priority = { name: priority };
      if (labels) fields.labels = labels;
      if (dueDate) fields.duedate = dueDate;

      await jira.put(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { fields });
      return { content: [{ type: "text", text: `Issue ${issueKey} updated successfully.` }] };
    }
  );
}
