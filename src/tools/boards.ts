import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { jsonResult } from "./shapes.js";

export function registerBoardTools(server: McpServer, jira: JiraClient) {
  server.registerTool(
    "list_boards",
    {
      description: "List all Jira boards (Scrum/Kanban)",
      outputSchema: {
        boards: z.array(z.object({ id: z.number(), name: z.string(), type: z.string().optional() })),
      },
    },
    async () => {
      const data = await jira.get<any>("/rest/agile/1.0/board");
      const boards = data.values.map((b: any) => ({
        id: b.id,
        name: b.name,
        type: b.type,
      }));
      return jsonResult({ boards });
    }
  );

  server.registerTool(
    "get_sprints",
    {
      description: "Get sprints for a Jira board",
      inputSchema: { boardId: z.number().describe("The board ID") },
      outputSchema: {
        boardId: z.number(),
        sprints: z.array(z.object({
          id: z.number(),
          name: z.string(),
          state: z.string().optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        })),
      },
    },
    async ({ boardId }) => {
      const data = await jira.get<any>(`/rest/agile/1.0/board/${boardId}/sprint`);
      const sprints = data.values.map((s: any) => ({
        id: s.id,
        name: s.name,
        state: s.state,
        startDate: s.startDate ?? undefined,
        endDate: s.endDate ?? undefined,
      }));
      return jsonResult({ boardId, sprints });
    }
  );
}
