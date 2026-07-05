import { AtlassianApiError } from "./errors.js";
import type { Config } from "./config.js";

/**
 * Thin authenticated HTTP client for one Atlassian Cloud site.
 * Jira lives under /rest/api/3, Confluence under /wiki — callers pass
 * site-relative paths and this class only handles auth + error mapping.
 */
export class AtlassianClient {
  readonly #base: string;
  readonly #auth: string;

  constructor(config: Config) {
    this.#base = config.siteUrl;
    this.#auth =
      "Basic " +
      Buffer.from(`${config.email}:${config.apiToken}`).toString("base64");
  }

  /** JSON request; throws AtlassianApiError on any non-2xx. */
  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", this.#auth);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const res = await fetch(this.#url(path), { ...init, headers });
    if (!res.ok) throw await this.#toError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Authenticated request that does NOT follow redirects; returns the Location
   * header. Used to resolve a Jira attachment's media-services UUID from the
   * content endpoint's 302 to api.media.atlassian.com — the UUID an ADF media
   * node needs but the upload/list responses never expose.
   */
  async redirectLocation(path: string): Promise<string> {
    const res = await fetch(this.#url(path), {
      headers: { Authorization: this.#auth },
      redirect: "manual",
    });
    if (res.status < 300 || res.status >= 400) {
      if (!res.ok) throw await this.#toError(res);
      throw new AtlassianApiError(
        res.status,
        `Expected a redirect for ${path}, got status ${res.status}`,
      );
    }
    const location = res.headers.get("location");
    if (!location) {
      throw new AtlassianApiError(
        res.status,
        `Redirect for ${path} had no Location header`,
      );
    }
    return location;
  }

  /**
   * Binary GET for attachment bodies. Follows the content redirect to
   * Atlassian's media host (fetch strips Authorization on cross-origin
   * redirects, which is what the signed media URL expects).
   */
  async download(path: string): Promise<Response> {
    const res = await fetch(this.#url(path), {
      headers: { Authorization: this.#auth },
      redirect: "follow",
    });
    if (!res.ok) throw await this.#toError(res);
    return res;
  }

  /** Multipart POST for attachment uploads. */
  async uploadMultipart<T>(path: string, form: FormData): Promise<T> {
    const res = await fetch(this.#url(path), {
      method: "POST",
      headers: {
        Authorization: this.#auth,
        Accept: "application/json",
        "X-Atlassian-Token": "no-check",
      },
      body: form,
    });
    if (!res.ok) throw await this.#toError(res);
    return (await res.json()) as T;
  }

  #url(path: string): string {
    if (!path.startsWith("/")) {
      throw new Error(`API path must start with "/": ${path}`);
    }
    return this.#base + path;
  }

  async #toError(res: Response): Promise<AtlassianApiError> {
    let detail = "";
    try {
      const text = await res.text();
      try {
        const body = JSON.parse(text) as {
          errorMessages?: string[];
          errors?: Record<string, string>;
          message?: string;
        };
        detail = [
          ...(body.errorMessages ?? []),
          ...Object.values(body.errors ?? {}),
          ...(body.message ? [body.message] : []),
        ].join("; ");
      } catch {
        detail = text.slice(0, 200);
      }
    } catch {
      // body unreadable; status hint alone will have to do
    }

    const hint = HINTS[res.status];
    if (res.status === 429) {
      const retryAfter = res.headers.get("retry-after");
      detail = [detail, retryAfter ? `Retry after ${retryAfter}s.` : ""]
        .filter(Boolean)
        .join(" ");
    }
    const message = [`Atlassian API ${res.status}`, hint, detail]
      .filter(Boolean)
      .join(": ");
    return new AtlassianApiError(res.status, message);
  }
}

const HINTS: Record<number, string> = {
  401: "authentication failed — check ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN",
  403: "permission denied — your account lacks access to this resource",
  404: "not found — check the issue key / page id / attachment id",
  413: "attachment exceeds this site's upload size limit",
  429: "rate limited",
};
