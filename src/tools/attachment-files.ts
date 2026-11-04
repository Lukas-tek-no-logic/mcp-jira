import { mkdir, writeFile } from "fs/promises";
import { basename, extname, isAbsolute, join } from "path";

// Reading text attachments (logs, JSON, CSV...) inline and saving any attachment to disk.
// Used by get_attachment in attachments.ts.

const TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "application/javascript",
  "application/x-sh",
  "application/sql",
  "image/svg+xml",
]);

const BINARY_MIME_TYPES = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/gzip",
  "application/x-gzip",
  "application/x-tar",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
  "application/vnd.rar",
  "application/java-archive",
  "application/x-msdownload",
]);

const BINARY_MIME_PREFIXES = [
  "image/",
  "audio/",
  "video/",
  "font/",
  "application/vnd.openxmlformats-officedocument.",
  "application/vnd.oasis.opendocument.",
];

const BINARY_SNIFF_BYTES = 8192;
export const MAX_INLINE_TEXT_BYTES = 50 * 1024 * 1024;
export const DEFAULT_MAX_LINES = 2000;
export const DEFAULT_CONTEXT_LINES = 2;
export const MAX_OUTPUT_CHARS = 200_000;
const MAX_INVALID_UTF8_RATIO = 0.1;
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i;

export interface TextReadOptions {
  startLine?: number;
  maxLines?: number;
  grep?: string;
  ignoreCase?: boolean;
  contextLines?: number;
}

export interface TextPage {
  encoding: string;
  totalLines: number;
  status: string;
  content: string;
}

interface GrepLine {
  index: number;
  text: string;
  isMatch: boolean;
}

export async function saveAttachment(buffer: Buffer, target: any, directory: string): Promise<string> {
  if (!isAbsolute(directory)) {
    throw new Error(`saveTo must be an absolute directory path, got: ${directory}`);
  } else {
    await mkdir(directory, { recursive: true });
    return writeToFreePath(directory, target, buffer);
  }
}

async function writeToFreePath(directory: string, target: any, buffer: Buffer): Promise<string> {
  const filename = safeFilename(target);
  const extension = extname(filename);
  const stem = filename.slice(0, filename.length - extension.length);
  let attempt = 0;
  while (true) {
    const filePath = join(directory, candidateName(stem, extension, target.id, attempt));
    try {
      await writeFile(filePath, buffer, { flag: "wx" });
      return filePath;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw error;
      }
      attempt++;
    }
  }
}

function candidateName(stem: string, extension: string, id: string, attempt: number): string {
  if (attempt === 0) {
    return `${stem}${extension}`;
  } else if (attempt === 1) {
    return `${stem}-${id}${extension}`;
  } else {
    return `${stem}-${id}-${attempt}${extension}`;
  }
}

function safeFilename(target: any): string {
  const name = basename((target.filename || "").replace(/[<>:"|?*\x00-\x1f]/g, "_"))
    .replace(/[. ]+$/, "");
  if (name === "") {
    return `attachment-${target.id}`;
  } else if (WINDOWS_RESERVED_NAME.test(name)) {
    return `_${name}`;
  } else {
    return name;
  }
}

export function isKnownBinary(mimeType: string): boolean {
  const baseType = baseMimeType(mimeType);
  if (TEXT_MIME_TYPES.has(baseType)) {
    return false;
  } else {
    return BINARY_MIME_TYPES.has(baseType) || BINARY_MIME_PREFIXES.some((prefix) => baseType.startsWith(prefix));
  }
}

export function isText(buffer: Buffer, mimeType: string): boolean {
  const baseType = baseMimeType(mimeType);
  if (baseType.startsWith("text/") || TEXT_MIME_TYPES.has(baseType) || utf16Encoding(buffer)) {
    return true;
  } else {
    return !buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
  }
}

function baseMimeType(mimeType: string): string {
  return (mimeType || "").split(";")[0].trim().toLowerCase();
}

// Returns the requested page (or grep result) of a text attachment; throws on an invalid grep pattern.
export function readText(buffer: Buffer, options: TextReadOptions): TextPage {
  const decoded = decodeText(buffer);
  const lines = splitLines(decoded.text);
  let page: { status: string; content: string };
  if (options.grep) {
    const pattern = compilePattern(options.grep, options.ignoreCase);
    if (pattern) {
      page = grepLines(lines, pattern, options);
    } else {
      throw new Error(`Invalid grep pattern: ${options.grep}`);
    }
  } else {
    page = pageLines(lines, options);
  }
  return { encoding: decoded.encoding, totalLines: lines.length, ...page };
}

function decodeText(buffer: Buffer): { text: string; encoding: string } {
  const bomEncoding = utf16Encoding(buffer);
  if (bomEncoding) {
    return { text: new TextDecoder(bomEncoding).decode(buffer), encoding: bomEncoding.toUpperCase() };
  } else {
    try {
      return { text: new TextDecoder("utf-8", { fatal: true }).decode(buffer), encoding: "UTF-8" };
    } catch {
      return decodeInvalidUtf8(buffer);
    }
  }
}

function decodeInvalidUtf8(buffer: Buffer): { text: string; encoding: string } {
  const text = new TextDecoder("utf-8").decode(buffer);
  const invalidCount = text.split(REPLACEMENT_CHARACTER).length - 1;
  if (invalidCount < countHighBytes(buffer) * MAX_INVALID_UTF8_RATIO) {
    return { text, encoding: `UTF-8, ${invalidCount} invalid byte sequences replaced with U+FFFD` };
  } else {
    return { text: new TextDecoder("windows-1250").decode(buffer), encoding: "windows-1250, not valid UTF-8" };
  }
}

function countHighBytes(buffer: Buffer): number {
  let count = 0;
  for (const byte of buffer) {
    if (byte >= 0x80) {
      count++;
    }
  }
  return count;
}

function utf16Encoding(buffer: Buffer): "utf-16le" | "utf-16be" | undefined {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return "utf-16le";
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return "utf-16be";
  } else {
    return undefined;
  }
}

function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function compilePattern(grep: string, ignoreCase: boolean | undefined): RegExp | undefined {
  let flags: string;
  if (ignoreCase) {
    flags = "i";
  } else {
    flags = "";
  }
  try {
    return new RegExp(grep, flags);
  } catch {
    return undefined;
  }
}

function grepLines(lines: string[], pattern: RegExp, options: TextReadOptions): { status: string; content: string } {
  const startLine = options.startLine ?? 1;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;

  const matched = new Set<number>();
  const selected = new Set<number>();
  for (let index = startLine - 1; index < lines.length; index++) {
    if (pattern.test(lines[index])) {
      matched.add(index);
      const from = Math.max(startLine - 1, index - contextLines);
      const to = Math.min(lines.length - 1, index + contextLines);
      for (let contextIndex = from; contextIndex <= to; contextIndex++) {
        selected.add(contextIndex);
      }
    }
  }

  const groups = groupConsecutive([...selected].sort((a, b) => a - b)).map((group) =>
    group.map((index) => ({ index, text: formatGrepLine(index, lines[index], matched.has(index)), isMatch: matched.has(index) }))
  );
  const shownGroups = selectGroups(groups, maxLines);
  const shownLines = shownGroups.flat();

  let status = `${matched.size} matching lines for ${pattern} from line ${startLine}.`;
  if (shownLines.length < selected.size) {
    const lastShownLine = shownLines[shownLines.length - 1].index + 1;
    status += ` Output limited to ${maxLines} lines or ${MAX_OUTPUT_CHARS} characters, last line shown: ${lastShownLine}. Call again with startLine=${lastShownLine + 1} for more.`;
  }
  if (shownLines.length === 1 && exceedsOutputLimit(formatGrepLine(shownLines[0].index, lines[shownLines[0].index], shownLines[0].isMatch))) {
    status += ` ${cutLineNote(shownLines[0].index + 1)}`;
  }
  const content = shownGroups.map((group) => group.map((line) => line.text).join("\n")).join("\n--\n");
  return { status, content };
}

function groupConsecutive(indexes: number[]): number[][] {
  const groups: number[][] = [];
  for (const index of indexes) {
    const current = groups[groups.length - 1];
    if (current && current[current.length - 1] === index - 1) {
      current.push(index);
    } else {
      groups.push([index]);
    }
  }
  return groups;
}

function formatGrepLine(index: number, line: string, isMatch: boolean): string {
  let separator: string;
  if (isMatch) {
    separator = ":";
  } else {
    separator = "-";
  }
  return `${index + 1}${separator}${line}`;
}

function selectGroups(groups: GrepLine[][], maxLines: number): GrepLine[][] {
  const selected: GrepLine[][] = [];
  let lineCount = 0;
  let charCount = 0;
  for (const group of groups) {
    const groupChars = group.reduce((sum, line) => sum + line.text.length + 1, 0) + "--\n".length;
    if (lineCount + group.length > maxLines || charCount + groupChars > MAX_OUTPUT_CHARS) {
      break;
    }
    selected.push(group);
    lineCount += group.length;
    charCount += groupChars;
  }
  if (selected.length === 0 && groups.length > 0) {
    const firstMatch = groups[0].findIndex((line) => line.isMatch);
    const candidates = groups[0].slice(firstMatch, firstMatch + maxLines);
    const fitted = fitToOutputLimit(candidates.map((line) => line.text));
    selected.push(fitted.map((text, position) => ({ ...candidates[position], text })));
  }
  return selected;
}

function pageLines(lines: string[], options: TextReadOptions): { status: string; content: string } {
  const startLine = options.startLine ?? 1;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const requested = lines.slice(startLine - 1, startLine - 1 + maxLines);
  const page = fitToOutputLimit(requested);
  const endLine = startLine + page.length - 1;

  let status: string;
  if (page.length === 0) {
    status = `No lines from line ${startLine}.`;
  } else if (endLine < lines.length) {
    status = `Lines ${startLine}-${endLine} of ${lines.length}. More lines follow: call again with startLine=${endLine + 1}.`;
  } else {
    status = `Lines ${startLine}-${endLine} of ${lines.length}.`;
  }
  if (page.length < requested.length) {
    status += ` Stopped at the ${MAX_OUTPUT_CHARS}-character output limit.`;
  }
  if (page.length === 1 && exceedsOutputLimit(requested[0])) {
    status += ` ${cutLineNote(startLine)}`;
  }
  return { status, content: page.join("\n") };
}

function fitToOutputLimit(outputLines: string[]): string[] {
  const fitted: string[] = [];
  let charCount = 0;
  while (fitted.length < outputLines.length && charCount + outputLines[fitted.length].length + 1 <= MAX_OUTPUT_CHARS) {
    charCount += outputLines[fitted.length].length + 1;
    fitted.push(outputLines[fitted.length]);
  }
  if (fitted.length === 0 && outputLines.length > 0) {
    fitted.push(`${outputLines[0].slice(0, MAX_OUTPUT_CHARS)} [line cut at ${MAX_OUTPUT_CHARS} characters]`);
  }
  return fitted;
}

function exceedsOutputLimit(line: string): boolean {
  return line.length + 1 > MAX_OUTPUT_CHARS;
}

function cutLineNote(lineNumber: number): string {
  return `Line ${lineNumber} is longer than ${MAX_OUTPUT_CHARS} characters and was cut; the rest of it cannot be read inline, use saveTo to read the whole file.`;
}
