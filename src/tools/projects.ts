import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { jsonResult } from "./shapes.js";

export function registerProjectTools(server: McpServer, jira: JiraClient) {
  server.registerTool(
    "list_projects",
    {
      description: "List all Jira projects",
      outputSchema: {
        projects: z.array(z.object({ key: z.string(), name: z.string(), lead: z.string().optional() })),
      },
    },
    async () => {
      const projects = await jira.get<any[]>("/rest/api/2/project");
      const result = projects.map((p) => ({
        key: p.key,
        name: p.name,
        lead: p.lead?.displayName,
      }));
      return jsonResult({ projects: result });
    }
  );

  server.tool(
    "get_project",
    "Get details of a specific Jira project",
    { projectKey: z.string().describe("The project key (e.g. PROJ)") },
    async ({ projectKey }) => {
      const project = await jira.get<any>(`/rest/api/2/project/${encodeURIComponent(projectKey)}`);
      return { content: [{ type: "text", text: JSON.stringify(project, null, 2) }] };
    }
  );
}
