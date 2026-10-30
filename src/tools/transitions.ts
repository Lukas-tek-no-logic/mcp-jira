import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { jsonResult } from "./shapes.js";

export function registerTransitionTools(server: McpServer, jira: JiraClient) {
  server.registerTool(
    "get_transitions",
    {
      description: "Get available transitions for a Jira issue",
      inputSchema: { issueKey: z.string().describe("The issue key (e.g. PROJ-123)") },
      outputSchema: {
        issueKey: z.string(),
        transitions: z.array(z.object({
          id: z.string(),
          name: z.string(),
          to: z.string().optional().describe("Status after the transition"),
        })),
      },
    },
    async ({ issueKey }) => {
      const data = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`
      );
      const transitions = data.transitions.map((t: any) => ({
        id: t.id,
        name: t.name,
        to: t.to?.name,
      }));
      return jsonResult({ issueKey, transitions });
    }
  );

  server.tool(
    "transition_issue",
    "Transition a Jira issue to a new status",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      transitionId: z.string().describe("The transition ID (use get_transitions to find available IDs)"),
    },
    async ({ issueKey, transitionId }) => {
      await jira.post(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`,
        { transition: { id: transitionId } }
      );
      return { content: [{ type: "text", text: `Issue ${issueKey} transitioned successfully.` }] };
    }
  );
}
