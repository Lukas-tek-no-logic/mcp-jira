import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { jsonResult, linkShape, toLink } from "./shapes.js";
import { createLink } from "./move.js";

export function registerLinkTools(server: McpServer, jira: JiraClient) {
  server.tool(
    "link_issues",
    "Create a link between two Jira issues (same as More → Link in the Jira UI). " +
      "The link reads: <inwardIssue> <outward description> <outwardIssue>, e.g. PROJ-2 blocks PROJ-1. " +
      "For symmetric link types such as Relates, an existing link in either direction counts as already linked",
    {
      inwardIssue: z.string().describe("Key of the inward issue (e.g. PROJ-2)"),
      outwardIssue: z.string().describe("Key of the outward issue (e.g. PROJ-1)"),
      linkType: z.string().default("Relates").describe("Name of the issue link type (e.g. Relates, Blocks, Duplicate)"),
    },
    async ({ inwardIssue, outwardIssue, linkType }) => {
      const existing = await findLink(jira, inwardIssue, outwardIssue, linkType);
      if (existing) {
        return {
          content: [{
            type: "text",
            text: `Already linked ${describeLink(inwardIssue, existing)} (link id: ${existing.id}). No new link created.`,
          }],
        };
      } else {
        await createLink(jira, linkType, inwardIssue, outwardIssue);
        return { content: [{ type: "text", text: `Linked ${inwardIssue} -[${linkType}]-> ${outwardIssue}` }] };
      }
    }
  );

  server.tool(
    "delete_issue_link",
    "Delete a link between two Jira issues, by link ID (from get_issue_links)",
    { linkId: z.string().describe("The issue link ID (from get_issue_links)") },
    async ({ linkId }) => {
      await jira.delete<void>(`/rest/api/2/issueLink/${encodeURIComponent(linkId)}`);
      return { content: [{ type: "text", text: `Deleted issue link ${linkId}` }] };
    }
  );

  server.registerTool(
    "get_issue_links",
    {
      description: "Get only the issue links of a Jira issue: linked issue key, link type and direction. " +
        "Much smaller than get_issue",
      inputSchema: { issueKey: z.string().describe("The issue key (e.g. PROJ-123)") },
      outputSchema: { issueKey: z.string(), links: z.array(linkShape) },
    },
    async ({ issueKey }) => {
      const issue = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=issuelinks`
      );
      return jsonResult({ issueKey, links: (issue.fields.issuelinks || []).map(toLink) });
    }
  );
}

async function findLink(jira: JiraClient, inwardIssue: string, outwardIssue: string, linkType: string): Promise<any> {
  const issue = await jira.get<any>(
    `/rest/api/2/issue/${encodeURIComponent(inwardIssue)}?fields=issuelinks`
  );
  return (issue.fields.issuelinks || []).find(
    (link: any) =>
      link.type.name.toLowerCase() === linkType.toLowerCase() &&
      (link.outwardIssue?.key.toLowerCase() === outwardIssue.toLowerCase() ||
        (isSymmetric(link.type) && link.inwardIssue?.key.toLowerCase() === outwardIssue.toLowerCase()))
  );
}

function isSymmetric(linkType: any): boolean {
  return linkType.inward?.toLowerCase() === linkType.outward?.toLowerCase();
}

function describeLink(issueKey: string, link: any): string {
  if (link.outwardIssue) {
    return `${issueKey} -[${link.type.name}]-> ${link.outwardIssue.key}`;
  } else {
    return `${link.inwardIssue.key} -[${link.type.name}]-> ${issueKey}`;
  }
}
