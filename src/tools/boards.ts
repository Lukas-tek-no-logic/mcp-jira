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

  server.tool(
    "move_to_sprint",
    "Move issues to a sprint (active or future), taking them out of the sprint they were in. Get the sprint ID from get_sprints",
    {
      issueKeys: z.array(z.string()).min(1).max(MAX_ISSUES_PER_CALL).describe(`Issue keys (e.g. ["PROJ-1", "PROJ-2"]), max ${MAX_ISSUES_PER_CALL}`),
      sprintId: z.number().describe("The sprint ID (from get_sprints)"),
    },
    async ({ issueKeys, sprintId }) => {
      const sprint = await jira.get<any>(`/rest/agile/1.0/sprint/${sprintId}`);
      if (sprint.state === "closed") {
        return {
          content: [{ type: "text", text: `Sprint "${sprint.name}" (id: ${sprintId}) is closed; issues cannot be added to it. Nothing was moved.` }],
          isError: true,
        };
      } else {
        await jira.post<void>(`/rest/agile/1.0/sprint/${sprintId}/issue`, { issues: issueKeys });
        return {
          content: [{ type: "text", text: `Moved ${issueKeys.join(", ")} to sprint "${sprint.name}" (id: ${sprintId}, ${sprint.state})` }],
        };
      }
    }
  );

  server.tool(
    "move_to_backlog",
    "Move issues to the backlog: takes them out of their active or future sprint. Issues in closed sprints keep that history",
    {
      issueKeys: z.array(z.string()).min(1).max(MAX_ISSUES_PER_CALL).describe(`Issue keys (e.g. ["PROJ-1", "PROJ-2"]), max ${MAX_ISSUES_PER_CALL}`),
    },
    async ({ issueKeys }) => {
      await jira.post<void>("/rest/agile/1.0/backlog/issue", { issues: issueKeys });
      return { content: [{ type: "text", text: `Moved ${issueKeys.join(", ")} to the backlog` }] };
    }
  );
}

// Limit of the Jira Agile API for moving issues in one request
const MAX_ISSUES_PER_CALL = 50;
