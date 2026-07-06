# atlassian-attachments-mcp

A local MCP server for **Jira and Confluence Cloud attachments** — the file operations the official Atlassian MCP server can't do.

The official Atlassian MCP is remote: it runs in Atlassian's cloud and has no access to your filesystem, so it cannot upload, download, or otherwise touch attachments. This server runs locally on your own machine, complements the official MCP in the same client config, and does one job: move files between your disk and Jira issues / Confluence pages — and place them into the page.

> All ten tools are implemented, unit- and integration-tested, and live-verified against a real Atlassian site.

## Setup

You need two things before you start:

1. **Node.js 20 or newer** — check with `node --version`. ([Download](https://nodejs.org) if you don't have it.)
2. **An Atlassian API token** — create one at [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). The token acts with your own account's permissions.

**In short: pick your app below, paste the block it shows, fill in three values (site URL, email, API token), and restart.** There's nothing to download, install, or build — every client launches the server the same way, with the command `npx -y atlassian-attachments-mcp` plus those three values.

One server instance connects to one Atlassian site. If you use more than one site, add the server more than once under different names.

> **Which apps can use this?** This is a *local* tool — it runs on your computer. It works in desktop apps (Claude Desktop) and coding tools (Claude Code, Cursor, VS Code, Codex, Gemini). It does **not** work in the **ChatGPT** or **Claude.ai** websites: those only connect to *remote* servers over the internet, not local ones. If you need it there, you'd have to host it yourself with a bridge such as [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) — most people should just use one of the apps below.

---

### Claude Desktop

1. Open **Settings → Developer → Edit Config** (this opens the config file for you).
2. Paste the block below into it. If the file already has an `mcpServers` section, add `atlassian-attachments` inside it rather than duplicating the section.
3. Fill in your site URL, email, and API token.
4. Save the file and **restart Claude Desktop**.

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

If you don't see the config file, it lives here:

| Platform | Config file |
|---|---|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

---

### Cursor

**One click:** open this link (Cursor will ask to install, then let you fill in your token):

```
cursor://anysphere.cursor-deeplink/mcp/install?name=atlassian-attachments&config=eyJjb21tYW5kIjoibnB4IiwiYXJncyI6WyIteSIsImF0bGFzc2lhbi1hdHRhY2htZW50cy1tY3AiXSwiZW52Ijp7IkFUTEFTU0lBTl9TSVRFX1VSTCI6Imh0dHBzOi8veW91ci1zaXRlLmF0bGFzc2lhbi5uZXQiLCJBVExBU1NJQU5fRU1BSUwiOiJ5b3VAZXhhbXBsZS5jb20iLCJBVExBU1NJQU5fQVBJX1RPS0VOIjoieW91ci1hcGktdG9rZW4ifX0=
```

**Or by hand:** open **Settings → MCP → Add new MCP server** and paste the same `mcpServers` block shown under Claude Desktop (Cursor uses the identical format). Its config file is `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).

---

### VS Code (GitHub Copilot)

**One command** in a terminal:

```bash
code --add-mcp '{"name":"atlassian-attachments","command":"npx","args":["-y","atlassian-attachments-mcp"],"env":{"ATLASSIAN_SITE_URL":"https://your-site.atlassian.net","ATLASSIAN_EMAIL":"you@example.com","ATLASSIAN_API_TOKEN":"your-api-token"}}'
```

**Or from the UI:** open the Command Palette (`⇧⌘P` / `Ctrl+Shift+P`), run **MCP: Add Server**, and follow the prompts. VS Code writes a `servers` entry to `.vscode/mcp.json` (or your user `mcp.json`):

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

---

### Claude Code

```bash
claude mcp add atlassian-attachments \
  -e ATLASSIAN_SITE_URL=https://your-site.atlassian.net \
  -e ATLASSIAN_EMAIL=you@example.com \
  -e ATLASSIAN_API_TOKEN=your-api-token \
  -- npx -y atlassian-attachments-mcp
```

Add `-s user` to make it available in every project instead of just the current one.

---

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

---

### Gemini CLI

```bash
gemini mcp add atlassian-attachments \
  -e ATLASSIAN_SITE_URL=https://your-site.atlassian.net \
  -e ATLASSIAN_EMAIL=you@example.com \
  -e ATLASSIAN_API_TOKEN=your-api-token \
  npx -y atlassian-attachments-mcp
```

---

### Any other MCP client

Most clients read a JSON config with an `mcpServers` object — paste the block shown under [Claude Desktop](#claude-desktop) and merge it in. The shape is always the same: command `npx`, args `["-y", "atlassian-attachments-mcp"]`, plus the three environment variables below.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `ATLASSIAN_SITE_URL` | yes | Your site, e.g. `https://your-site.atlassian.net` |
| `ATLASSIAN_EMAIL` | yes | The account email the API token belongs to |
| `ATLASSIAN_API_TOKEN` | yes | API token (acts with that account's permissions) |
| `ATTACHMENT_MCP_DIR` | no | Absolute path overriding the download sandbox root |
| `ATTACHMENT_MCP_MAX_DOWNLOAD_MB` | no | Cap on download size (default 512) |

## Updating

New versions publish to npm automatically — you don't reinstall anything. Each time your client starts, it relaunches the server with `npx`, which picks up the latest release.

- **Normally:** just **restart your client** (quit and reopen the app, or restart the CLI). That's it.
- **If it's still on an old version:** `npx` may be reusing a cached copy. Force the newest release by changing the args from `["-y", "atlassian-attachments-mcp"]` to `["-y", "atlassian-attachments-mcp@latest"]`, then restart.

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
| `embed_attachment` | Jira + Confluence | displays / links an already-uploaded attachment at the top or bottom of a body or comment |
| `set_body` | Jira + Confluence | replaces the whole body with your own content, placing images inline anywhere |

### Embedding attachments

Uploading a file only stores it — it won't show up in the description or page until you place it. Two tools do that; upload the file first with `upload_attachment` on the same issue/page, then:

**`embed_attachment`** — the quick way to drop one image or file reference into a body or comment. It adds at the **top or bottom** only.

- `target: "body"` — the Jira description / Confluence page body. `target: "comment"` — a new comment.
- `as: "image"` (default) — a displayed image (`width`/`alt` optional); `as: "link"` — a clickable download link / file card for any file type (`linkText` optional); `as: "inline"` — an inline file chip (Jira only).
- `position: "append"` (default, end) or `"prepend"` (start). Re-running appends another copy (no dedupe).

| `as` | Jira (v3 ADF) | Confluence (v2 storage) |
|---|---|---|
| `image` | `mediaSingle` | `<ac:image><ri:attachment>` |
| `link` | `mediaGroup` (file card) | `<ac:link><ri:attachment>` |
| `inline` | `mediaInline` | unsupported — throws; use `link` |

**`set_body`** — for precise placement: put an image **next to a specific step, mid-paragraph, anywhere**. You author the *entire* body and it overwrites what was there, so include everything you want to keep.

- **Confluence:** `body` is v2 storage XML. Reference an uploaded attachment inline with `<ac:image><ri:attachment ri:filename="diagram.png" /></ac:image>` (or `<ac:link>` for a download).
- **Jira:** `body` is an ADF document (`type: "doc"`) as a JSON string. Reference an uploaded attachment inside a `media` node by putting its **filename or attachment id** in `attrs.id` (with `attrs.type: "file"`) — the server resolves it to the media UUID and fills in `collection` for you. A minimal body with one step and an inline screenshot:

  ```json
  {
    "type": "doc",
    "version": 1,
    "content": [
      { "type": "paragraph", "content": [{ "type": "text", "text": "Step 1: open the panel." }] },
      {
        "type": "mediaSingle",
        "attrs": { "layout": "center" },
        "content": [{ "type": "media", "attrs": { "type": "file", "id": "screenshot.png" } }]
      }
    ]
  }
  ```

This is the only way to interleave images with text where you want them — `embed_attachment` can't, and the official Atlassian MCP's page/description update strips images entirely.

Jira's media nodes need the attachment's *media-services UUID*, which the upload/list APIs never expose. The server resolves it on the fly from the attachment content endpoint's redirect (`GET /rest/api/3/attachment/content/{id}` → `302` to `…/file/<UUID>/binary`). Confluence references attachments by filename, so no UUID is involved there.

## Security model

Attachment filenames and bodies are untrusted input — anyone who can touch a ticket controls them, and prompt injection in ticket text can steer an agent running auto-approved tools. The design responds asymmetrically:

- **Downloads are sandboxed.** The server only ever writes inside one root directory: `ATTACHMENT_MCP_DIR` if set, else `<cwd>/.claude/attachments/` when launched from a real workspace, else your OS cache dir. The root is self-gitignored, filenames are sanitized, layout is `<site>/<container>/<attachmentId>-<filename>`, containment is realpath-verified, symlinks are refused, and nothing is overwritten without `overwrite: true`.
- **Uploads read from anywhere** the process can read — pasted images land in OS temp dirs, screenshots in `~/Screenshots`, downloads in `~/Downloads`, and your MCP client's permission model governs the session. Run with tool approval on if your threat model includes malicious ticket content steering uploads.
- **File bytes never flow through the protocol.** Downloads return a path and metadata, not content (thumbnails are the one deliberate exception).

Design decisions are recorded in [`docs/adr/`](docs/adr/); project vocabulary in [`CONTEXT.md`](CONTEXT.md).

## License

[MIT](LICENSE)
