import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import { JiraClient } from "../jira-client.js";
import { IMAGE_MIME_TYPES, attachmentShape, jsonResult, sortByCreation, toAttachment } from "./shapes.js";

// Keeps one call well under the per-request image limit of vision models (GLM: 50)
const MAX_IMAGES_PER_CALL = 10;

export function registerAttachmentTools(server: McpServer, jira: JiraClient) {
  server.registerTool(
    "list_attachments",
    {
      description: "List attachments on a Jira issue, oldest first",
      inputSchema: { issueKey: z.string().describe("The issue key (e.g. PROJ-123)") },
      outputSchema: { issueKey: z.string(), attachments: z.array(attachmentShape) },
    },
    async ({ issueKey }) => {
      const issue = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=attachment`
      );
      const attachments = sortByCreation(issue.fields.attachment || []).map(toAttachment);
      return jsonResult({ issueKey, attachments });
    }
  );

  server.registerTool(
    "get_attachment",
    {
      description:
        "Download and display image attachments from a Jira issue. Pick them by ID from the attachment list " +
        "returned by get_issue or list_attachments; only the chosen images are downloaded",
      inputSchema: {
        issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
        attachmentId: z.string().optional().describe("Specific attachment ID. If no ID or filename is given, returns the latest image attachment."),
        attachmentIds: z.array(z.string()).optional().describe(`Several attachment IDs to download in one call (max ${MAX_IMAGES_PER_CALL})`),
        filename: z.string().optional().describe("Attachment filename to find. If no ID or filename is given, returns the latest image attachment."),
      },
      outputSchema: {
        issueKey: z.string(),
        results: z.array(z.object({
          requested: z.string().describe("The ID or filename asked for, or \"latest image\""),
          id: z.string().optional(),
          filename: z.string().optional(),
          mimeType: z.string().optional(),
          downloaded: z.boolean().describe("The image is included in this result"),
          error: z.string().optional(),
        })),
        available: z.array(attachmentShape).optional().describe("All attachments on the issue, when a requested one was not found"),
      },
    },
    async ({ issueKey, attachmentId, attachmentIds, filename }) => {
      if (attachmentIds && attachmentIds.length > MAX_IMAGES_PER_CALL) {
        return {
          content: [{ type: "text", text: `At most ${MAX_IMAGES_PER_CALL} attachments per call. Nothing was downloaded.` }],
          isError: true,
        };
      }

      const issue = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=attachment`
      );
      const attachments: any[] = sortByCreation(issue.fields.attachment || []);

      let requests: Array<{ requested: string; target: any }>;
      if (attachmentIds?.length) {
        requests = attachmentIds.map((id) => ({ requested: id, target: attachments.find((a: any) => a.id === id) }));
      } else if (attachmentId) {
        requests = [{ requested: attachmentId, target: attachments.find((a: any) => a.id === attachmentId) }];
      } else if (filename) {
        requests = [{ requested: filename, target: attachments.find((a: any) => a.filename === filename) }];
      } else {
        const latest = [...attachments].reverse().find((a: any) => IMAGE_MIME_TYPES.has(a.mimeType));
        requests = [{ requested: "latest image", target: latest }];
      }

      const results: any[] = [];
      const images: any[] = [];
      for (const { requested, target } of requests) {
        if (!target) {
          results.push({ requested, downloaded: false, error: "Not found on this issue" });
          continue;
        }
        const result = { requested, id: target.id, filename: target.filename, mimeType: target.mimeType };
        if (!IMAGE_MIME_TYPES.has(target.mimeType)) {
          results.push({ ...result, downloaded: false, error: "Not an image, cannot display" });
          continue;
        }
        try {
          const buffer = await jira.getBuffer(target.content);
          images.push(
            { type: "text", text: `Attachment: ${target.filename} (id: ${target.id}, ${target.mimeType})` },
            { type: "image", data: buffer.toString("base64"), mimeType: target.mimeType },
          );
          results.push({ ...result, downloaded: true });
        } catch {
          results.push({ ...result, downloaded: false, error: "Download failed" });
        }
      }

      const missing = results.some((r) => r.error === "Not found on this issue");
      return jsonResult({
        issueKey,
        results,
        available: missing ? attachments.map(toAttachment) : undefined,
      }, images);
    }
  );

  server.tool(
    "upload_attachment",
    "Upload a local file as an attachment to a Jira issue",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      filePath: z.string().describe("Absolute path to the local file to upload"),
    },
    async ({ issueKey, filePath }) => {
      if (!existsSync(filePath)) {
        return { content: [{ type: "text", text: `File not found: ${filePath}` }] };
      }

      const result = await jira.uploadAttachment(issueKey, filePath);
      const uploaded = Array.isArray(result) ? result : [result];
      const names = uploaded.map((a: any) => `${a.filename} (id: ${a.id})`).join(", ");
      return { content: [{ type: "text", text: `Uploaded: ${names}` }] };
    }
  );

  server.tool(
    "delete_attachment",
    "Delete an attachment from a Jira issue, by attachment ID or by filename",
    {
      issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
      attachmentId: z.string().optional().describe("The attachment ID (from list_attachments)"),
      filename: z.string().optional().describe("Attachment filename. Must match exactly one attachment on the issue."),
    },
    async ({ issueKey, attachmentId, filename }) => {
      if (!attachmentId && !filename) {
        return { content: [{ type: "text", text: "Provide attachmentId or filename. Nothing was deleted." }], isError: true };
      }

      const issue = await jira.get<any>(
        `/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=attachment`
      );
      const attachments: any[] = issue.fields.attachment || [];

      let matches: any[];
      if (attachmentId) {
        matches = attachments.filter((a: any) => a.id === attachmentId);
      } else {
        matches = attachments.filter((a: any) => a.filename === filename);
      }

      if (matches.length === 1) {
        const target = matches[0];
        await jira.delete<void>(`/rest/api/2/attachment/${encodeURIComponent(target.id)}`);
        return {
          content: [{ type: "text", text: `Deleted attachment ${target.filename} (id: ${target.id}) from ${issueKey}` }],
        };
      } else {
        let reason: string;
        if (matches.length === 0) {
          reason = "Attachment not found on this issue.";
        } else {
          reason = `Several attachments are named "${filename}". Use attachmentId.`;
        }
        const names = sortByCreation(attachments).map((a: any) => `${a.filename} (id: ${a.id}, created: ${a.created})`);
        return {
          content: [{ type: "text", text: `${reason} Nothing was deleted. Available:\n${names.join("\n")}` }],
          isError: true,
        };
      }
    }
  );
}
