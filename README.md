# atlassian-attachments-mcp

A local MCP server for **Jira and Confluence Cloud attachments** — the file operations the official Atlassian MCP server can't do.

The official Atlassian MCP is remote: it runs in Atlassian's cloud and has no access to your filesystem, so it cannot upload, download, or otherwise touch attachments. This server runs locally via `npx`, complements the official MCP in the same client config, and does exactly one job: move files between your disk and Jira issues / Confluence pages.

> **Status: working prototype.** All nine tools are implemented with test coverage; expect rough edges until 1.0.

## Setup

Runs via `npx` (needs Node ≥ 20) — nothing to clone, install, or build. First create an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens), then register the server in whichever client(s) you use below. Everywhere, the command is `npx -y atlassian-attachments-mcp` with your three env vars.

One server instance serves one Atlassian site. Multiple sites? Register it multiple times under different names.

### Claude Code

```bash
claude mcp add atlassian-attachments \
  -e ATLASSIAN_SITE_URL=https://your-site.atlassian.net \
  -e ATLASSIAN_EMAIL=you@example.com \
  -e ATLASSIAN_API_TOKEN=your-api-token \
  -- npx -y atlassian-attachments-mcp
```

Add `-s user` to make it available in every project instead of just the current one.

### Codex CLI

```bash
codex mcp add atlassian-attachments \
  --env ATLASSIAN_SITE_URL=https://your-site.atlassian.net \
  --env ATLASSIAN_EMAIL=you@example.com \
  --env ATLASSIAN_API_TOKEN=your-api-token \
  -- npx -y atlassian-attachments-mcp
```

Or add it to `~/.codex/config.toml` by hand:

```toml
[mcp_servers.atlassian-attachments]
command = "npx"
args = ["-y", "atlassian-attachments-mcp"]
env = { ATLASSIAN_SITE_URL = "https://your-site.atlassian.net", ATLASSIAN_EMAIL = "you@example.com", ATLASSIAN_API_TOKEN = "your-api-token" }
```

### Gemini CLI

```bash
gemini mcp add atlassian-attachments \
  -e ATLASSIAN_SITE_URL=https://your-site.atlassian.net \
  -e ATLASSIAN_EMAIL=you@example.com \
  -e ATLASSIAN_API_TOKEN=your-api-token \
  npx -y atlassian-attachments-mcp
```

### Claude Desktop, Cursor, Windsurf, and other `mcpServers` clients

These read a JSON config with an `mcpServers` object — paste this block into it (merge if the object already exists):

```json
{
  "mcpServers": {
    "atlassian-attachments": {
      "command": "npx",
      "args": ["-y", "atlassian-attachments-mcp"],
      "env": {
        "ATLASSIAN_SITE_URL": "https://your-site.atlassian.net",
        "ATLASSIAN_EMAIL": "you@example.com",
        "ATLASSIAN_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

| Client | Config file |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project) |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

In Claude Desktop, **Settings → Developer → Edit Config** opens that file for you. Restart the client after editing.

### VS Code (GitHub Copilot)

VS Code uses a `servers` key with an explicit `type`. Add to `.vscode/mcp.json` (per workspace) or your user `mcp.json`:

```json
{
  "servers": {
    "atlassian-attachments": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "atlassian-attachments-mcp"],
      "env": {
        "ATLASSIAN_SITE_URL": "https://your-site.atlassian.net",
        "ATLASSIAN_EMAIL": "you@example.com",
        "ATLASSIAN_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

Any other MCP client works too: the shape is always command `npx`, args `["-y", "atlassian-attachments-mcp"]`, plus the three env vars.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ATLASSIAN_SITE_URL` | yes | Your site, e.g. `https://your-site.atlassian.net` |
| `ATLASSIAN_EMAIL` | yes | The account email the API token belongs to |
| `ATLASSIAN_API_TOKEN` | yes | API token (acts with that account's permissions) |
| `ATTACHMENT_MCP_DIR` | no | Absolute path overriding the download sandbox root |

## Tools

| Tool | Products | Notes |
|---|---|---|
| `list_attachments` | Jira + Confluence | id, filename, size, MIME type, author |
| `upload_attachment` | Jira + Confluence | reads any local path |
| `download_attachment` | Jira + Confluence | writes into the sandbox, returns path + metadata |
| `download_all_attachments` | Jira + Confluence | bulk, per issue/page; per-file results |
| `delete_attachment` | Jira + Confluence | permanent |
| `peek_archive_attachment` | Jira | list zip contents without downloading |
| `get_attachment_thumbnail` | Jira | returns the image inline for vision models |
| `get_attachment_limits` | Jira | attachment enabled/max-size settings |
| `embed_attachment` | Jira + Confluence | displays / links an already-uploaded attachment in a body or comment |

`ATTACHMENT_MCP_MAX_DOWNLOAD_MB` (optional) caps download size; default 512.

### Embedding attachments

`embed_attachment` inserts an *already-uploaded* attachment into a container so it renders — the one thing the official Atlassian MCP's description/page update can't do. Upload the file first (`upload_attachment` on the same container), then embed it, identifying it by `attachmentId` (preferred, authoritative) or exact `filename`.

Two knobs: **where** (`target`) and **how** (`as`).

- `target: "body"` — the Jira description / Confluence page body. `target: "comment"` — a new comment on the issue/page.
- `as: "image"` (default) — a displayed image (`width`/`alt` optional); `as: "link"` — a clickable download link / file card for any file type (`linkText` optional); `as: "inline"` — an inline file chip (Jira only).

| `as` | Jira (v3 ADF) | Confluence (v2 storage) |
|---|---|---|
| `image` | `mediaSingle` | `<ac:image><ri:attachment>` |
| `link` | `mediaGroup` (file card) | `<ac:link><ri:attachment>` |
| `inline` | `mediaInline` | unsupported — throws; use `link` |

Body embeds are a read-modify-write that appends (or `position: "prepend"`) without disturbing existing content; re-running appends another copy (no dedupe).

Jira's media nodes need the attachment's *media-services UUID*, which the upload/list APIs never expose. The server resolves it on the fly from the attachment content endpoint's redirect (`GET /rest/api/3/attachment/content/{id}` → `302` to `…/file/<UUID>/binary`). Confluence references attachments by filename, so no UUID is involved there.

## Security model

Attachment filenames and bodies are untrusted input — anyone who can touch a ticket controls them, and prompt injection in ticket text can steer an agent running auto-approved tools. The design responds asymmetrically:

- **Downloads are sandboxed.** The server only ever writes inside one root directory: `ATTACHMENT_MCP_DIR` if set, else `<cwd>/.claude/attachments/` when launched from a real workspace, else your OS cache dir. The root is self-gitignored, filenames are sanitized, layout is `<site>/<container>/<attachmentId>-<filename>`, containment is realpath-verified, symlinks are refused, and nothing is overwritten without `overwrite: true`.
- **Uploads read from anywhere** the process can read — pasted images land in OS temp dirs, screenshots in `~/Screenshots`, downloads in `~/Downloads`, and your MCP client's permission model governs the session. Run with tool approval on if your threat model includes malicious ticket content steering uploads.
- **File bytes never flow through the protocol.** Downloads return a path and metadata, not content (thumbnails are the one deliberate exception).

Design decisions are recorded in [`docs/adr/`](docs/adr/); project vocabulary in [`CONTEXT.md`](CONTEXT.md).

## License

[MIT](LICENSE)
