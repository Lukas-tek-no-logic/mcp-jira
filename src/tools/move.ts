import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { JiraClient } from "../jira-client.js";

const COPIED_FIELDS = ["description", "priority", "assignee", "reporter", "labels", "duedate", "environment"];
const NOT_COPIED_FIELDS = ["components", "fixVersions", "versions"];

export function registerMoveTools(server: McpServer, jira: JiraClient) {
  server.tool(
    "move_issue",
    "Move a Jira issue to another project. Jira Server has no move API, so this creates a copy in the target project " +
      "(summary, description, priority, assignee, reporter, labels, due date, comments, attachments, issue links), " +
      "links the copy with the original and closes the original. History and worklogs stay on the original issue.",
    {
      issueKey: z.string().describe("The issue key to move (e.g. PROJA-123)"),
      targetProjectKey: z.string().describe("Key of the target project (e.g. PROJB)"),
      issueType: z.string().optional().describe("Issue type in the target project (default: same type as the original)"),
      linkType: z.string().default("Relates").describe(
        "Name of the issue link type between the original and the new issue (e.g. Relates, Duplicate, Cloners). " +
          "The link reads: <original> <outward description> <new issue>, e.g. PROJA-1 duplicates PROJB-7"
      ),
      closeTransition: z.string().optional().describe(
        "Name of the transition that closes the original (default: first transition to a status in the Done category)"
      ),
      resolution: z.string().optional().describe(
        "Resolution set on the original when it is closed (e.g. Duplicate, Done). " +
          "If the transition requires a resolution and none is given, Duplicate is used when available"
      ),
    },
    async ({ issueKey, targetProjectKey, issueType, linkType, closeTransition, resolution }) => {
      const original = await jira.get<any>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}`);
      if (original.fields.issuetype?.subtask) {
        throw new Error(`${issueKey} is a sub-task. Move its parent issue instead.`);
      } else {
        const warnings: string[] = [];
        const created = await createCopy(jira, original, targetProjectKey, issueType ?? original.fields.issuetype.name, warnings);
        const comments = await copyComments(jira, issueKey, created.key, warnings);
        const attachments = await copyAttachments(jira, original, created.key, warnings);
        const links = await copyLinks(jira, original, created.key, warnings);
        const linked = await linkWithOriginal(jira, linkType, issueKey, created.key, warnings);
        const closedWith = await closeOriginal(jira, issueKey, closeTransition, resolution, warnings);

        const result = {
          original: issueKey,
          newIssue: created.key,
          link: linked,
          copiedComments: comments,
          copiedAttachments: attachments,
          copiedLinks: links,
          originalClosedWith: closedWith,
          warnings,
        };
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
    }
  );
}

async function createCopy(
  jira: JiraClient,
  original: any,
  targetProjectKey: string,
  issueTypeName: string,
  warnings: string[]
): Promise<{ id: string; key: string }> {
  const params = new URLSearchParams({
    projectKeys: targetProjectKey,
    issuetypeNames: issueTypeName,
    expand: "projects.issuetypes.fields",
  });
  const meta = await jira.get<any>(`/rest/api/2/issue/createmeta?${params}`);
  const createFields = meta.projects?.[0]?.issuetypes?.[0]?.fields;
  if (!createFields) {
    throw new Error(`Issue type "${issueTypeName}" is not available in project ${targetProjectKey}.`);
  } else {
    const fields: any = {
      project: { key: targetProjectKey },
      issuetype: { name: issueTypeName },
      summary: original.fields.summary,
    };
    for (const name of COPIED_FIELDS) {
      const value = original.fields[name];
      if (hasValue(value)) {
        if (createFields[name]) {
          fields[name] = toFieldValue(name, value);
        } else {
          warnings.push(`Field "${name}" is not on the create screen of ${targetProjectKey} and was not copied.`);
        }
      }
    }
    for (const name of NOT_COPIED_FIELDS) {
      if (hasValue(original.fields[name])) {
        const values = original.fields[name].map((v: any) => v.name).join(", ");
        warnings.push(`Field "${name}" is project-specific and was not copied (${values}).`);
      }
    }
    return jira.post<any>("/rest/api/2/issue", { fields });
  }
}

function hasValue(value: any): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  } else {
    return value !== null && value !== undefined && value !== "";
  }
}

function toFieldValue(name: string, value: any): any {
  switch (name) {
    case "priority":
    case "assignee":
    case "reporter":
      return { name: value.name };
    default:
      return value;
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
  for (const subtask of original.fields.subtasks || []) {
    warnings.push(`Sub-task ${subtask.key} stays in the original project.`);
  }
  return copied;
}

async function linkWithOriginal(
  jira: JiraClient,
  linkType: string,
  originalKey: string,
  newKey: string,
  warnings: string[]
): Promise<string | null> {
  try {
    await createLink(jira, linkType, originalKey, newKey);
    return `${originalKey} -[${linkType}]-> ${newKey}`;
  } catch (e: any) {
    warnings.push(`Link "${linkType}" between ${originalKey} and ${newKey} was not created: ${e.message}`);
    return null;
  }
}

export async function createLink(jira: JiraClient, typeName: string, fromKey: string, toKey: string): Promise<void> {
  await jira.post("/rest/api/2/issueLink", {
    type: { name: typeName },
    inwardIssue: { key: fromKey },
    outwardIssue: { key: toKey },
  });
}

async function closeOriginal(
  jira: JiraClient,
  issueKey: string,
  transitionName: string | undefined,
  resolution: string | undefined,
  warnings: string[]
): Promise<string | null> {
  const data = await jira.get<any>(
    `/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions?expand=transitions.fields`
  );
  const transition = findCloseTransition(data.transitions || [], transitionName);
  if (!transition) {
    warnings.push(`No closing transition found for ${issueKey}; the original issue was left open.`);
    return null;
  } else {
    const body: any = { transition: { id: transition.id } };
    const resolutionName = chooseResolution(transition.fields?.resolution, resolution);
    if (resolutionName) {
      body.fields = { resolution: { name: resolutionName } };
    }
    try {
      await jira.post(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/transitions`, body);
      return transition.name;
    } catch (e: any) {
      warnings.push(`Transition "${transition.name}" on ${issueKey} failed: ${e.message}`);
      return null;
    }
  }
}

function findCloseTransition(transitions: any[], transitionName: string | undefined): any {
  if (transitionName) {
    return transitions.find((t: any) => t.name.toLowerCase() === transitionName.toLowerCase());
  } else {
    return transitions.find((t: any) => t.to?.statusCategory?.key === "done");
  }
}

function chooseResolution(field: any, requested: string | undefined): string | undefined {
  if (!field) {
    return undefined;
  } else if (requested) {
    return requested;
  } else if (field.required) {
    const values: any[] = field.allowedValues || [];
    const preferred = values.find((v: any) => v.name === "Duplicate") || values[0];
    return preferred?.name;
  } else {
    return undefined;
  }
}
