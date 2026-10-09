import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import {
  attachmentShape,
  commentShape,
  issueSummaryShape,
  jsonResult,
  linkShape,
  sortByCreation,
  toAttachment,
  toComment,
  toIssueSummary,
  toLink,
} from "./shapes.js";

// Fields get_issue returns at the top level; everything else goes to otherFields
const MAIN_FIELDS = new Set([
  "summary", "issuetype", "status", "resolution", "priority", "assignee", "reporter",
  "created", "updated", "resolutiondate", "duedate", "labels", "description",
  "comment", "attachment", "issuelinks",
]);

// Keys that only add noise for a model reading the issue
const NOISE_KEYS = new Set(["avatarUrls", "iconUrl", "self"]);

const searchOutput = {
  total: z.number().describe("Number of matching issues in Jira; can be larger than issues.length"),
  issues: z.array(issueSummaryShape),
};

export function registerIssueTools(server: McpServer, jira: JiraClient) {
  server.registerTool(
    "search_issues",
    {
      description: "Search Jira issues using JQL",
      inputSchema: {
        jql: z.string().describe("JQL query string"),
        maxResults: z.number().default(20).describe("Maximum number of results (default 20)"),
      },
      outputSchema: searchOutput,
    },
    async ({ jql, maxResults }) => {
      const params = new URLSearchParams({
        jql,
        maxResults: String(maxResults),
      });
      const data = await jira.get<any>(`/rest/api/2/search?${params}`);
      return jsonResult({ total: data.total, issues: data.issues.map(toIssueSummary) });
    }
  );

  server.registerTool(
    "get_issue",
    {
      description:
        "Get a Jira issue: main fields, description, all comments, links and the attachment list. " +
        "Image attachments are not downloaded unless includeImages is set; to view chosen ones, " +
        "call get_attachment with attachmentIds",
      inputSchema: {
        issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
        includeImages: z.boolean().default(false).describe("Download image attachments into the result (default false)"),
        maxImages: z.number().int().min(1).max(10).default(5).describe("With includeImages: how many images to download, newest first (default 5, max 10)"),
      },
      outputSchema: {
        key: z.string(),
        summary: z.string(),
        type: z.string().optional(),
        status: z.string().optional(),
        resolution: z.string().optional(),
        priority: z.string().optional(),
        assignee: z.string().optional(),
        reporter: z.string().optional(),
        created: z.string().optional(),
        updated: z.string().optional(),
        resolved: z.string().optional(),
        dueDate: z.string().optional(),
        labels: z.array(z.string()),
        description: z.string().describe("Issue description in Jira wiki markup; empty when the issue has none"),
        comments: z.object({
          total: z.number().describe("Number of comments on the issue"),
          items: z.array(commentShape),
        }),
        links: z.array(linkShape),
        attachments: z.array(attachmentShape.extend({
          downloaded: z.boolean().describe("The image is included in this result"),
        })).describe("Oldest first"),
        note: z.string().optional().describe("Present when image attachments were left out"),
        otherFields: z.record(z.string(), z.unknown()).describe(
          "All other non-empty Jira fields by name; custom fields as \"Field name [customfield_N]\""),
      },
    },
    async ({ issueKey, includeImages, maxImages }) => {
      const issue = await jira.get<any>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=names`);
      const f = issue.fields ?? {};

      const attachments: any[] = sortByCreation(f.attachment || []);
      // Newest first, so a capped download keeps the most recent screenshots
      const images = includeImages
        ? attachments.filter((a: any) => toAttachment(a).isImage).reverse().slice(0, maxImages)
        : [];

      const extra: any[] = [];
      const downloaded = new Set<string>();
      for (const img of images) {
        try {
          const buffer = await jira.getBuffer(img.content);
          extra.push(
            { type: "text", text: `Attachment: ${img.filename} (id: ${img.id})` },
            { type: "image", data: buffer.toString("base64"), mimeType: img.mimeType },
          );
          downloaded.add(img.id);
        } catch {
          // Reported through downloaded: false
        }
      }

      const attachmentList = attachments.map((a: any) => ({ ...toAttachment(a), downloaded: downloaded.has(a.id) }));
      const skipped = attachmentList.filter((a) => a.isImage && !a.downloaded).length;
      const comments = (f.comment?.comments || []).map(toComment);

      return jsonResult({
        key: issue.key,
        summary: f.summary ?? "",
        type: f.issuetype?.name,
        status: f.status?.name,
        resolution: f.resolution?.name,
        priority: f.priority?.name,
        assignee: f.assignee?.displayName,
        reporter: f.reporter?.displayName,
        created: f.created ?? undefined,
        updated: f.updated ?? undefined,
        resolved: f.resolutiondate ?? undefined,
        dueDate: f.duedate ?? undefined,
        labels: f.labels || [],
        description: f.description ?? "",
        comments: { total: f.comment?.total ?? comments.length, items: comments },
        links: (f.issuelinks || []).map(toLink),
        attachments: attachmentList,
        note: skipped
          ? `${skipped} image attachment(s) not downloaded. To view chosen ones, call get_attachment with attachmentIds (max 10 per call).`
          : undefined,
        otherFields: otherFields(f, issue.names ?? {}),
      }, extra);
    }
  );

  server.registerTool(
    "find_issues",
    {
      description: "Full-text search across Jira issues (searches summary, description, comments, attachments). Simpler than JQL - just type what you're looking for.",
      inputSchema: {
        query: z.string().describe("Text to search for (e.g. 'login timeout', 'NullPointerException')"),
        projectKey: z.string().optional().describe("Limit search to a specific project (e.g. MYAPP)"),
        maxResults: z.number().default(20).describe("Maximum number of results (default 20)"),
      },
      outputSchema: searchOutput,
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
      return jsonResult({ total: data.total, issues: data.issues.map(toIssueSummary) });
    }
  );

  server.tool(
    "create_issue",
    "Create a new Jira issue, or a sub-task when parentKey is given",
    {
      projectKey: z.string().describe("The project key"),
      summary: z.string().describe("Issue summary/title"),
      issueType: z.string().optional().describe(
        "Issue type (default: Task, or the first sub-task type of the project when parentKey is given)"
      ),
      parentKey: z.string().optional().describe(
        "Key of the parent issue (e.g. PROJ-123). Creates a sub-task; the parent must be in projectKey"
      ),
      description: z.string().optional().describe("Issue description"),
      assignee: z.string().optional().describe("Assignee username"),
      priority: z.string().optional().describe("Priority name (e.g. High, Medium, Low)"),
      labels: z.array(z.string()).optional().describe("Labels (e.g. [\"backend\", \"urgent\"])"),
      dueDate: z.string().optional().describe("Due date in YYYY-MM-DD format"),
    },
    async ({ projectKey, summary, issueType, parentKey, description, assignee, priority, labels, dueDate }) => {
      const fields: any = {
        project: { key: projectKey },
        summary,
        issuetype: { name: issueType ?? await defaultIssueType(jira, projectKey, parentKey) },
      };
      if (parentKey) fields.parent = { key: parentKey };
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
      dueDate: z.string().optional().describe("New due date in YYYY-MM-DD format; an empty string clears it"),
    },
    async ({ issueKey, summary, description, assignee, priority, labels, dueDate }) => {
      const fields: any = {};
      if (summary) fields.summary = summary;
      if (description) fields.description = description;
      if (assignee) fields.assignee = { name: assignee };
      if (priority) fields.priority = { name: priority };
      if (labels) fields.labels = labels;
      if (dueDate === "") {
        fields.duedate = null;
      } else if (dueDate) {
        fields.duedate = dueDate;
      }

      await jira.put(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`, { fields });
      return { content: [{ type: "text", text: `Issue ${issueKey} updated successfully.` }] };
    }
  );
}

function otherFields(fields: Record<string, any>, names: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(fields)) {
    if (MAIN_FIELDS.has(id)) continue;
    const cleaned = withoutNoise(value);
    if (isEmpty(cleaned)) continue;
    const name = id.startsWith("customfield_") && names[id] ? `${names[id]} [${id}]` : id;
    result[name] = cleaned;
  }
  return result;
}

function withoutNoise(value: any): any {
  if (Array.isArray(value)) return value.map(withoutNoise);
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, any> = {};
  for (const [key, inner] of Object.entries(value)) {
    if (!NOISE_KEYS.has(key)) result[key] = withoutNoise(inner);
  }
  return result;
}

function isEmpty(value: any): boolean {
  return value === null || value === undefined || value === "" ||
    (Array.isArray(value) && value.length === 0);
}

async function defaultIssueType(jira: JiraClient, projectKey: string, parentKey: string | undefined): Promise<string> {
  if (!parentKey) {
    return "Task";
  } else {
    const project = await jira.get<any>(`/rest/api/2/project/${encodeURIComponent(projectKey)}`);
    const subtaskType = (project.issueTypes || []).find((t: any) => t.subtask);
    if (!subtaskType) {
      throw new Error(`Project ${projectKey} has no sub-task issue type.`);
    } else {
      return subtaskType.name;
    }
  }
}
