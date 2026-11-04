import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";
import { createLink } from "./links.js";

// Standard fields copied as they are (users and priority by name)
const STANDARD_FIELDS = ["description", "priority", "assignee", "reporter", "labels", "duedate", "environment"];
// Values defined per project: copied by name when the target project has a value with that name
const PROJECT_FIELDS = ["components", "fixVersions", "versions"];
// Never copied: set by Jira, by the clone itself, or meaningless on a new issue
const SKIPPED_FIELDS = new Set([
  "summary", "project", "issuetype", "parent", "attachment", "issuelinks", "subtasks", "comment", "worklog",
  "timetracking", "status", "resolution", "resolutiondate", "created", "updated", "creator", "votes", "watches",
  "lastViewed", "aggregateprogress", "progress", "aggregatetimespent", "timespent", "aggregatetimeestimate",
  "timeestimate", "aggregatetimeoriginalestimate", "timeoriginalestimate", "workratio", "security", "thumbnail",
]);
const SPRINT_FIELD_TYPE = "com.pyxis.greenhopper.jira:gh-sprint";

export function registerCloneTools(server: McpServer, jira: JiraClient) {
  server.tool(
    "clone_issue",
    "Clone a Jira issue, in the same or another project: a new issue with the summary, description, priority, " +
      "assignee, reporter, labels, due date, original estimate and the custom fields that the target create screen " +
      "has, linked to the original with Cloners (\"<clone> is clone of <original>\"). Attachments and issue links are " +
      "copied by default, comments and sub-tasks on request. Sprint, worklogs and history are not copied. " +
      "To move an issue to another project keeping its history and worklogs, use move_issue instead",
    {
      issueKey: z.string().describe("The issue to clone (e.g. PROJ-123)"),
      targetProjectKey: z.string().optional().describe("Project of the clone (default: the project of the original)"),
      issueType: z.string().optional().describe("Issue type of the clone (default: the type of the original)"),
      summary: z.string().optional().describe("Summary of the clone (default: the summary of the original)"),
      includeAttachments: z.boolean().default(true).describe("Copy the attachments (default true)"),
      includeLinks: z.boolean().default(true).describe("Copy the issue links (default true)"),
      includeComments: z.boolean().default(false).describe("Copy the comments, each prefixed with its author and date (default false)"),
      includeSubtasks: z.boolean().default(false).describe("Clone the sub-tasks under the clone (default false)"),
    },
    async ({ issueKey, targetProjectKey, issueType, summary, includeAttachments, includeLinks, includeComments, includeSubtasks }) => {
      const original = await getFullIssue(jira, issueKey);
      const projectKey = targetProjectKey ?? original.fields.project.key;
      if (original.fields.issuetype?.subtask && projectKey !== original.fields.project.key) {
        throw new Error(`${issueKey} is a sub-task; it can only be cloned within project ${original.fields.project.key}.`);
      }
      const warnings: string[] = [];
      const clone = await createCopy(jira, original, {
        projectKey,
        issueType: issueType ?? original.fields.issuetype.name,
        summary: summary ?? original.fields.summary,
        parentKey: original.fields.issuetype?.subtask ? original.fields.parent.key : undefined,
      }, warnings);

      const linked = await tryStep(warnings, `Cloners link between ${clone.key} and ${issueKey}`, async () => {
        await createLink(jira, "Cloners", clone.key, issueKey);
        return `${clone.key} is clone of ${issueKey}`;
      });
      const attachments = includeAttachments ? await copyAttachments(jira, original, clone.key, warnings) : 0;
      const links = includeLinks ? await copyLinks(jira, original, clone.key, warnings) : 0;
      const comments = includeComments ? await copyComments(jira, issueKey, clone.key, warnings) : 0;

      const subtasks: string[] = [];
      if (includeSubtasks) {
        for (const subtask of original.fields.subtasks || []) {
          await tryStep(warnings, `Sub-task ${subtask.key}`, async () => {
            const full = await getFullIssue(jira, subtask.key);
            const copy = await createCopy(jira, full, {
              projectKey,
              issueType: full.fields.issuetype.name,
              summary: full.fields.summary,
              parentKey: clone.key,
            }, warnings);
            await createLink(jira, "Cloners", copy.key, subtask.key);
            if (includeAttachments) {
              await copyAttachments(jira, full, copy.key, warnings);
            }
            subtasks.push(`${subtask.key} -> ${copy.key}`);
          });
        }
      } else if ((original.fields.subtasks || []).length > 0) {
        warnings.push(`${original.fields.subtasks.length} sub-task(s) were not cloned (includeSubtasks: true clones them).`);
      }

      const result = {
        original: issueKey,
        clone: clone.key,
        link: linked,
        copiedAttachments: attachments,
        copiedLinks: links,
        copiedComments: comments,
        clonedSubtasks: subtasks,
        warnings,
      };
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
  );
}

async function getFullIssue(jira: JiraClient, issueKey: string): Promise<any> {
  return jira.get<any>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=names,schema`);
}

async function tryStep<T>(warnings: string[], what: string, step: () => Promise<T>): Promise<T | null> {
  try {
    return await step();
  } catch (e: any) {
    warnings.push(`${what} failed: ${e.message}`);
    return null;
  }
}

interface CopyTarget {
  projectKey: string;
  issueType: string;
  summary: string;
  parentKey?: string;
}

async function createCopy(jira: JiraClient, original: any, target: CopyTarget, warnings: string[]): Promise<{ id: string; key: string }> {
  const params = new URLSearchParams({
    projectKeys: target.projectKey,
    issuetypeNames: target.issueType,
    expand: "projects.issuetypes.fields",
  });
  const meta = await jira.get<any>(`/rest/api/2/issue/createmeta?${params}`);
  const createFields = meta.projects?.[0]?.issuetypes?.[0]?.fields;
  if (!createFields) {
    throw new Error(`Issue type "${target.issueType}" is not available in project ${target.projectKey}.`);
  }

  const fields: any = {
    project: { key: target.projectKey },
    issuetype: { name: target.issueType },
    summary: target.summary,
  };
  if (target.parentKey) {
    fields.parent = { key: target.parentKey };
  }
  const label = (id: string) => original.names?.[id] ?? id;
  // Custom fields off the edit screen (Rank, hidden defaults) are not something the user set
  const editable = (await jira.get<any>(`/rest/api/2/issue/${encodeURIComponent(original.key)}/editmeta`)).fields || {};
  const notOnCreateScreen: string[] = [];

  for (const [id, value] of Object.entries<any>(original.fields)) {
    if (SKIPPED_FIELDS.has(id) || !hasValue(value) || (id.startsWith("customfield_") && !editable[id])) {
      continue;
    }
    const createField = createFields[id];
    const schema = original.schema?.[id];
    if (schema?.custom === SPRINT_FIELD_TYPE) {
      warnings.push(`${label(id)} was not copied; use move_to_sprint to put the clone in a sprint.`);
    } else if (!createField) {
      if (STANDARD_FIELDS.includes(id) || PROJECT_FIELDS.includes(id) || id.startsWith("customfield_")) {
        notOnCreateScreen.push(label(id));
      }
    } else if (PROJECT_FIELDS.includes(id)) {
      const { values, missing } = matchByName(value, createField.allowedValues || []);
      if (values.length > 0) {
        fields[id] = values;
      }
      if (missing.length > 0) {
        warnings.push(`${label(id)} ${missing.join(", ")} do not exist in ${target.projectKey} and were not copied.`);
      }
    } else {
      const converted = toCreateValue(value, createField);
      if (converted.ok) {
        fields[id] = converted.value;
      } else {
        warnings.push(`${label(id)} was not copied: ${converted.reason}.`);
      }
    }
  }
  if (original.fields.timetracking?.originalEstimate && createFields.timetracking) {
    fields.timetracking = { originalEstimate: original.fields.timetracking.originalEstimate };
  }
  if (notOnCreateScreen.length > 0) {
    warnings.push(`Not on the create screen of ${target.projectKey}, not copied: ${notOnCreateScreen.join(", ")}.`);
  }

  try {
    return await jira.post<any>("/rest/api/2/issue", { fields });
  } catch (e: any) {
    if (fields.reporter && /reporter/i.test(e.message)) {
      delete fields.reporter;
      warnings.push(`Reporter was not copied (${e.message}); you are the reporter of the clone.`);
      return jira.post<any>("/rest/api/2/issue", { fields });
    } else {
      throw e;
    }
  }
}

function hasValue(value: any): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  } else {
    return value !== null && value !== undefined && value !== "";
  }
}

function matchByName(value: any[], allowed: any[]): { values: any[]; missing: string[] } {
  const values: any[] = [];
  const missing: string[] = [];
  for (const item of value) {
    const match = allowed.find((a: any) => a.name === item.name);
    if (match) {
      values.push({ id: match.id });
    } else {
      missing.push(item.name);
    }
  }
  return { values, missing };
}

// Turns a value read from an issue into what the create API expects for that field
function toCreateValue(value: any, createField: any): { ok: true; value: any } | { ok: false; reason: string } {
  const schema = createField.schema || {};
  const allowed: any[] = createField.allowedValues || [];
  switch (schema.type) {
    case "string":
    case "number":
    case "date":
    case "datetime":
      return { ok: true, value };
    case "user":
      return { ok: true, value: { name: value.name } };
    case "priority":
      return { ok: true, value: { name: value.name } };
    case "option": {
      if (schema.custom?.endsWith(":cascadingselect")) {
        return { ok: false, reason: "cascading select fields are not supported" };
      }
      const match = allowed.find((a: any) => a.value === value.value);
      return match ? { ok: true, value: { id: match.id } } : { ok: false, reason: `option "${value.value}" does not exist there` };
    }
    case "array":
      switch (schema.items) {
        case "string":
          return { ok: true, value };
        case "user":
          return { ok: true, value: value.map((u: any) => ({ name: u.name })) };
        case "option": {
          const matched = value.map((v: any) => allowed.find((a: any) => a.value === v.value));
          return matched.every(Boolean)
            ? { ok: true, value: matched.map((m: any) => ({ id: m.id })) }
            : { ok: false, reason: "some options do not exist there" };
        }
        default:
          return { ok: false, reason: `fields with lists of ${schema.items} are not supported` };
      }
    case "any":
      return typeof value === "string" ? { ok: true, value } : { ok: false, reason: "field type is not supported" };
    default:
      return { ok: false, reason: `fields of type ${schema.type} are not supported` };
  }
}

async function copyComments(jira: JiraClient, fromKey: string, toKey: string, warnings: string[]): Promise<number> {
  const data = await jira.get<any>(`/rest/api/2/issue/${encodeURIComponent(fromKey)}/comment`);
  let copied = 0;
  for (const comment of data.comments || []) {
    const body: any = { body: `*${comment.author?.displayName}*, ${comment.created}:\n\n${comment.body}` };
    if (comment.visibility) {
      body.visibility = comment.visibility;
    }
    try {
      await jira.post(`/rest/api/2/issue/${encodeURIComponent(toKey)}/comment`, body);
      copied++;
    } catch (e: any) {
      warnings.push(`Comment ${comment.id} was not copied: ${e.message}`);
    }
  }
  return copied;
}

async function copyAttachments(jira: JiraClient, original: any, toKey: string, warnings: string[]): Promise<number> {
  let copied = 0;
  for (const attachment of original.fields.attachment || []) {
    try {
      const buffer = await jira.getBuffer(attachment.content);
      await jira.uploadAttachmentData(toKey, attachment.filename, buffer);
      copied++;
    } catch (e: any) {
      warnings.push(`Attachment "${attachment.filename}" was not copied: ${e.message}`);
    }
  }
  return copied;
}

async function copyLinks(jira: JiraClient, original: any, toKey: string, warnings: string[]): Promise<number> {
  let copied = 0;
  for (const link of original.fields.issuelinks || []) {
    if (link.type.name === "Cloners") {
      // The original's own clone relations; copied, they would claim the new clone is a clone of them
      continue;
    }
    try {
      if (link.outwardIssue) {
        await createLink(jira, link.type.name, toKey, link.outwardIssue.key);
      } else {
        await createLink(jira, link.type.name, link.inwardIssue.key, toKey);
      }
      copied++;
    } catch (e: any) {
      warnings.push(`Link "${link.type.name}" was not copied: ${e.message}`);
    }
  }
  return copied;
}
