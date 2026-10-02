export class JiraClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = await response.json();
        errorMessage =
          errorBody.errorMessages?.join(", ") ||
          Object.entries(errorBody.errors || {})
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") ||
          response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
      throw new Error(`Jira API error (${response.status}): ${errorMessage}`);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async uploadAttachment(issueKey: string, filePath: string): Promise<any[]> {
    const { readFileSync } = await import("fs");
    const { basename } = await import("path");

    return this.uploadAttachmentData(issueKey, basename(filePath), readFileSync(filePath));
  }

  async uploadAttachmentData(issueKey: string, filename: string, buffer: Buffer): Promise<any[]> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(buffer)]);
    formData.append("file", blob, filename);

    const url = `${this.baseUrl}/rest/api/2/issue/${encodeURIComponent(issueKey)}/attachments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "X-Atlassian-Token": "no-check",
      },
      body: formData,
    });

    if (!response.ok) {
      let errorMessage: string;
      try {
        const errorBody = await response.json();
        errorMessage =
          errorBody.errorMessages?.join(", ") ||
          response.statusText;
      } catch {
        errorMessage = response.statusText;
      }
      throw new Error(`Jira API error (${response.status}): ${errorMessage}`);
    }

    return response.json();
  }

  async getBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!response.ok) {
      throw new Error(`Jira API error (${response.status}): ${response.statusText}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
