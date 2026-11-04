import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { existsSync } from "fs";
import { isAbsolute } from "path";
import { JiraClient } from "../jira-client.js";
import { IMAGE_MIME_TYPES, attachmentShape, jsonResult, sortByCreation, toAttachment } from "./shapes.js";
import {
  DEFAULT_CONTEXT_LINES,
  DEFAULT_MAX_LINES,
  MAX_INLINE_TEXT_BYTES,
  isKnownBinary,
  isText,
  readText,
  saveAttachment,
} from "./attachment-files.js";

// Keeps one call well under the per-request image limit of vision models (GLM: 50)
const MAX_IMAGES_PER_CALL = 10;

// Why a non-image attachment cannot be read inline, decided before the download; undefined = try as text
function textRefusal(target: any, requestCount: number): string | undefined {
  if (isKnownBinary(target.mimeType)) {
    return notTextError(target);
  } else if (target.size > MAX_INLINE_TEXT_BYTES) {
    return `Has ${target.size} bytes, more than the ${MAX_INLINE_TEXT_BYTES} bytes that can be read inline. Use saveTo to download it to a local directory.`;
  } else if (requestCount > 1) {
    return "Not an image. When several attachments are requested only images are shown: request this one alone to read it as text, or use saveTo.";
  } else {
    return undefined;
  }
}

function notTextError(target: any): string {
  return `${target.mimeType} is not a text file and cannot be shown. Use saveTo to download it to a local directory.`;
}

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
        "Read attachments of a Jira issue. Pick them by ID from the attachment list returned by get_issue or " +
        "list_attachments; only the chosen ones are downloaded. Images are shown as images. Text files (logs, JSON, XML, " +
        `CSV...) up to ${MAX_INLINE_TEXT_BYTES / 1024 / 1024} MB are returned as text (UTF-8, UTF-16 by BOM, or ` +
        "windows-1250 if not valid UTF-8), in pages of lines or filtered with a regex (grep); read one text file per call. " +
        "Any file, including binary or larger ones (zip, pdf, docx), can be saved to a local directory with saveTo",
      inputSchema: {
        issueKey: z.string().describe("The issue key (e.g. PROJ-123)"),
        attachmentId: z.string().optional().describe("Specific attachment ID. If no ID or filename is given, returns the latest image attachment."),
        attachmentIds: z.array(z.string()).optional().describe(`Several attachment IDs in one call (max ${MAX_IMAGES_PER_CALL}): images, or files to save with saveTo`),
        filename: z.string().optional().describe("Attachment filename to find. If no ID or filename is given, returns the latest image attachment."),
        startLine: z.number().int().min(1).optional().describe("Text files only: first line to read (1-based). Default 1. With grep, the line where the search starts."),
        maxLines: z.number().int().min(1).optional().describe(`Text files only: maximum number of lines to return. Default ${DEFAULT_MAX_LINES}.`),
        grep: z.string().optional().describe("Text files only: regular expression (JavaScript syntax). Returns only matching lines, with line numbers and context, e.g. \"ERROR|Exception\"."),
        ignoreCase: z.boolean().optional().describe("Text files only, with grep: match regardless of letter case. Default false."),
        contextLines: z.number().int().min(0).optional().describe(`Text files only, with grep: lines of context before and after each match. Default ${DEFAULT_CONTEXT_LINES}.`),
        saveTo: z.string().optional().describe("Absolute path of a local directory. If given, the attachments are saved there (the directory is created if needed) and the file paths are returned instead of the content. An existing file is never overwritten: the attachment ID is added to the name."),
      },
      outputSchema: {
        issueKey: z.string(),
        results: z.array(z.object({
          requested: z.string().describe("The ID or filename asked for, or \"latest image\""),
          id: z.string().optional(),
          filename: z.string().optional(),
          mimeType: z.string().optional(),
          size: z.number().optional().describe("Size in bytes"),
          downloaded: z.boolean().describe("The image or text is included in this result, or the file was saved to savedTo"),
          savedTo: z.string().optional().describe("Local path of the saved file (with saveTo)"),
          text: z.object({
            encoding: z.string(),
            totalLines: z.number(),
            status: z.string().describe("Which lines are shown and how to get more (call again with startLine)"),
            content: z.string().describe("The lines; with grep, \"N:line\" for matches, \"N-line\" for context, groups separated by \"--\""),
          }).optional().describe("Content of a text attachment"),
          error: z.string().optional(),
        })),
        available: z.array(attachmentShape).optional().describe("All attachments on the issue, when a requested one was not found"),
      },
    },
    async ({ issueKey, attachmentId, attachmentIds, filename, startLine, maxLines, grep, ignoreCase, contextLines, saveTo }) => {
      if (saveTo && !isAbsolute(saveTo)) {
        return {
          content: [{ type: "text", text: `saveTo must be an absolute directory path, got: ${saveTo}. Nothing was downloaded.` }],
          isError: true,
        };
      }
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
      const textOptions = { startLine, maxLines, grep, ignoreCase, contextLines };
      for (const { requested, target } of requests) {
        if (!target) {
          results.push({ requested, downloaded: false, error: "Not found on this issue" });
          continue;
        }
        const result = { requested, id: target.id, filename: target.filename, mimeType: target.mimeType, size: target.size };
        const isImage = IMAGE_MIME_TYPES.has(target.mimeType);
        if (!saveTo && !isImage) {
          const refusal = textRefusal(target, requests.length);
          if (refusal) {
            results.push({ ...result, downloaded: false, error: refusal });
            continue;
          }
        }

        let buffer: Buffer;
        try {
          buffer = await jira.getBuffer(target.content);
        } catch {
          results.push({ ...result, downloaded: false, error: "Download failed" });
          continue;
        }

        if (saveTo) {
          try {
            results.push({ ...result, downloaded: true, savedTo: await saveAttachment(buffer, target, saveTo) });
          } catch (error) {
            results.push({ ...result, downloaded: false, error: `Saving failed: ${(error as Error).message}` });
          }
        } else if (isImage) {
          images.push(
            { type: "text", text: `Attachment: ${target.filename} (id: ${target.id}, ${target.mimeType})` },
            { type: "image", data: buffer.toString("base64"), mimeType: target.mimeType },
          );
          results.push({ ...result, downloaded: true });
        } else if (isText(buffer, target.mimeType)) {
          try {
            results.push({ ...result, downloaded: true, text: readText(buffer, textOptions) });
          } catch (error) {
            results.push({ ...result, downloaded: false, error: (error as Error).message });
          }
        } else {
          results.push({ ...result, downloaded: false, error: notTextError(target) });
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
