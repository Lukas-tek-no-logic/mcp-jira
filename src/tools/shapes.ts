import { z } from "zod";

// Read tools declare an outputSchema and return structuredContent, so MCP clients get a typed
// object instead of guessing the shape of a JSON string (opencode Code Mode turns the
// outputSchema into the tool's return type). The text block carries the same JSON for clients
// that only read text.

export const IMAGE_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

export function jsonResult<T extends Record<string, unknown>>(data: T, extra: any[] = []) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }, ...extra],
    structuredContent: data,
  };
}

export const issueSummaryShape = z.object({
  key: z.string(),
  summary: z.string(),
  status: z.string().optional(),
  assignee: z.string().optional(),
  priority: z.string().optional(),
  updated: z.string().optional(),
});

export function toIssueSummary(issue: any) {
  return {
    key: issue.key,
    summary: issue.fields.summary ?? "",
    status: issue.fields.status?.name,
    assignee: issue.fields.assignee?.displayName,
    priority: issue.fields.priority?.name,
    updated: issue.fields.updated ?? undefined,
  };
}

export const commentShape = z.object({
  id: z.string(),
  author: z.string().optional(),
  body: z.string(),
  created: z.string(),
  updated: z.string().optional(),
});

export function toComment(comment: any) {
  return {
    id: comment.id,
    author: comment.author?.displayName,
    body: comment.body ?? "",
    created: comment.created,
    updated: comment.updated ?? undefined,
  };
}

export const linkShape = z.object({
  id: z.string(),
  type: z.string(),
  direction: z.enum(["outward", "inward"]),
  relation: z.string().describe("How the linked issue relates to this one, e.g. \"is cloned by\""),
  key: z.string().describe("Key of the linked issue"),
  summary: z.string().optional(),
  status: z.string().optional(),
});

export function toLink(link: any) {
  const outward = link.outwardIssue !== undefined;
  const other = outward ? link.outwardIssue : link.inwardIssue;
  return {
    id: link.id,
    type: link.type.name,
    direction: outward ? ("outward" as const) : ("inward" as const),
    relation: outward ? link.type.outward : link.type.inward,
    key: other.key,
    summary: other.fields?.summary,
    status: other.fields?.status?.name,
  };
}

export const attachmentShape = z.object({
  id: z.string(),
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().describe("Size in bytes"),
  created: z.string(),
  author: z.string().optional(),
  isImage: z.boolean().describe("Shown as an image by get_attachment"),
});

export function toAttachment(attachment: any) {
  return {
    id: attachment.id,
    filename: attachment.filename,
    mimeType: attachment.mimeType,
    size: attachment.size,
    created: attachment.created,
    author: attachment.author?.displayName,
    isImage: IMAGE_MIME_TYPES.has(attachment.mimeType),
  };
}

export function sortByCreation(attachments: any[]): any[] {
  return [...attachments].sort((a: any, b: any) => {
    const timeDifference = Date.parse(a.created) - Date.parse(b.created);
    if (timeDifference !== 0 && !Number.isNaN(timeDifference)) {
      return timeDifference;
    } else {
      return Number(a.id) - Number(b.id);
    }
  });
}
