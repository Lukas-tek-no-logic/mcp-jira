import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { jsonResult } from "./shapes.js";

export function registerTempoTools(server: McpServer, jira: JiraClient) {
  // Tempo 4 requires an explicit worker key; resolve the token owner once and cache it.
  let selfKey: string | undefined;
  async function resolveSelfKey(): Promise<string> {
    if (!selfKey) {
      const me = await jira.get<any>("/rest/api/2/myself");
      selfKey = me.key || me.name;
    }
    return selfKey!;
  }

  server.tool(
    "log_work",
    "Log time spent on a Jira issue via Tempo Timesheets",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      timeSpent: z.string().describe("Time spent (e.g. '1h', '30m', '1h 30m', '2h 15m')"),
      date: z.string().describe("Date of work (YYYY-MM-DD)"),
      comment: z.string().optional().describe("Work description"),
      worker: z.string().optional().describe("Username of worker (defaults to token owner)"),
    },
    async ({ issueKey, timeSpent, date, comment, worker }) => {
      const seconds = parseTimeToSeconds(timeSpent);
      if (seconds <= 0) {
        return { content: [{ type: "text", text: `Invalid time format: "${timeSpent}". Use e.g. "1h", "30m", "1h 30m".` }] };
      }

      const body: any = {
        originTaskId: issueKey,
        started: date,
        timeSpentSeconds: seconds,
        worker: worker || (await resolveSelfKey()),
      };
      if (comment) body.comment = comment;

      // Tempo 4 returns an array containing the created worklog.
      const raw = await jira.post<any>("/rest/tempo-timesheets/4/worklogs", body);
      const result = Array.isArray(raw) ? raw[0] : raw;
      if (!result || typeof result.timeSpentSeconds !== "number") {
        return { content: [{ type: "text", text: `Worklog request sent, but response was unexpected: ${JSON.stringify(raw).slice(0, 500)}` }] };
      }
      const issue = result.issue?.key || issueKey;
      return {
        content: [{
          type: "text",
          text: `Logged ${formatSeconds(result.timeSpentSeconds)} on ${issue} (${date}) as ${result.worker || body.worker}, worklog id ${result.tempoWorklogId}${result.comment ? ` - "${result.comment}"` : ""}`,
        }],
      };
    }
  );

  server.registerTool(
    "get_worklogs",
    {
      description: "Get Tempo worklogs for a date range (defaults to the token owner's worklogs; set allWorkers=true for everyone)",
      inputSchema: {
        from: z.string().describe("Start date (YYYY-MM-DD)"),
        to: z.string().describe("End date (YYYY-MM-DD)"),
        worker: z.string().optional().describe("Username to filter by (defaults to token owner)"),
        allWorkers: z.boolean().optional().describe("Return worklogs of all users (can be very large)"),
        projectKey: z.string().optional().describe("Project key to filter by"),
        issueKey: z.string().optional().describe("Issue key to filter by"),
      },
      outputSchema: {
        from: z.string(),
        to: z.string(),
        worklogs: z.array(z.object({
          id: z.number().describe("Tempo worklog ID, for delete_worklog"),
          issue: z.string().describe("Issue key"),
          date: z.string(),
          timeSpent: z.string().describe("e.g. \"1h 30m\""),
          worker: z.string(),
          comment: z.string().optional(),
        })),
      },
    },
    async ({ from, to, worker, allWorkers, projectKey, issueKey }) => {
      const body: any = { from, to };
      if (worker) body.worker = [worker];
      else if (!allWorkers) body.worker = [await resolveSelfKey()];
      if (projectKey) body.projectKey = [projectKey];
      if (issueKey) body.taskKey = [issueKey];

      const data = await jira.post<any>("/rest/tempo-timesheets/4/worklogs/search", body);
      const results: any[] = data.results || data;

      // Collect unique issue IDs and resolve to keys
      const issueIds = [...new Set(results.map((w: any) => String(w.originTaskId)))];
      const idToKey: Record<string, string> = {};
      await Promise.all(
        issueIds.map(async (id) => {
          try {
            const issue = await jira.get<any>(`/rest/api/2/issue/${id}?fields=summary`);
            idToKey[id] = issue.key;
          } catch {
            idToKey[id] = id;
          }
        })
      );

      const worklogs = results.map((w: any) => ({
        id: w.tempoWorklogId,
        issue: idToKey[String(w.originTaskId)] || String(w.originTaskId),
        date: w.started,
        timeSpent: formatSeconds(w.timeSpentSeconds),
        worker: w.worker,
        comment: w.comment ?? undefined,
      }));
      return jsonResult({ from, to, worklogs });
    }
  );

  server.tool(
    "delete_worklog",
    "Delete a Tempo worklog entry",
    {
      worklogId: z.number().describe("The worklog ID (get it from get_worklogs)"),
    },
    async ({ worklogId }) => {
      await jira.delete(`/rest/tempo-timesheets/4/worklogs/${worklogId}`);
      return { content: [{ type: "text", text: `Worklog ${worklogId} deleted.` }] };
    }
  );
}

function parseTimeToSeconds(input: string): number {
  let total = 0;
  const hours = input.match(/(\d+)\s*h/i);
  const minutes = input.match(/(\d+)\s*m/i);
  if (hours) total += parseInt(hours[1]) * 3600;
  if (minutes) total += parseInt(minutes[1]) * 60;
  return total;
}

function formatSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
}
