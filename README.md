# atlassian-attachments-mcp

A local MCP server for **Jira and Confluence Cloud attachments** — moving real file bytes between your disk and Atlassian, and writing Jira bodies without losing the images already in them.

The official Atlassian MCP runs in Atlassian's cloud and has no access to your filesystem. Its newer [Rovo MCP v2 preview](https://developer.atlassian.com/cloud/rovo-mcp/preview/tools/) does add attachment operations, but three of its four transfer tools return a **curl command for your client to run** rather than moving bytes themselves — which needs a shell, puts short-lived signed URLs into your shell history, and never lets the model actually see the file. This server runs locally, complements the official one in the same client config, and does the parts that genuinely require a local process.

> All ten tools are implemented, unit- and integration-tested, and live-verified against a real Atlassian site.

**See [What this does that the official MCP doesn't](#what-this-does-that-the-official-mcp-doesnt) for the current, verified split** — the official server has closed the Confluence gap, so several tools here are now Jira-first.

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
| `upload_attachment` | Jira + Confluence | reads any local path; Jira also returns the media id + collection |
| `download_attachment` | Jira + Confluence | writes into the sandbox, returns path + metadata |
| `download_all_attachments` | Jira + Confluence | bulk, per issue/page; per-file results |
| `delete_attachment` | Jira + Confluence | permanent |
| `get_attachment_thumbnail` | Jira | returns the image inline for vision models |
| `embed_attachment` | **Jira** + Confluence | displays / links an already-uploaded attachment in a body or comment — append/prepend or at an anchor, with optional replace |
| `embed_attachments` | **Jira** + Confluence | embeds several attachments into a body in one write (one version bump, deterministic order) |
| `get_body` | **Jira** + Confluence | returns the raw current body (Jira ADF / Confluence storage + version) for round-trip edits |
| `set_body` | **Jira** + Confluence | replaces the whole body with your own content, placing images inline anywhere |

**Bold** = the product where the tool is the only correct option. The four body tools still accept Confluence, but the official MCP now round-trips Confluence bodies losslessly — see below.

## What this does that the official MCP doesn't

Verified against the live first-party Atlassian MCP in July 2026. Re-check before relying on it; Atlassian is shipping quickly.

| Capability | Official MCP | Here |
|---|---|---|
| Move attachment bytes | no — Rovo v2 returns a curl command to run yourself | yes, in-process |
| Bulk-download a whole issue/page | no | `download_all_attachments` |
| Delete an attachment | no equivalent published | `delete_attachment` |
| Show the model an image | no | `get_attachment_thumbnail`, or download + Read |
| **Read a Jira description losslessly** | **no** — see below | `get_body` |
| **Write a Jira description without destroying media** | **no** | `set_body`, `embed_attachment(s)` |
| Read/write a Confluence body losslessly | **yes** — `contentFormat: "html"` | `get_body` / `set_body` (storage XML) |
| Reference a Confluence attachment by filename | no — HTML+ needs a media UUID it never exposes | `embed_attachment` |

### The Jira gap, concretely

Ask the official server for ADF and it hands back markdown anyway. Same issue, same moment — `getJiraIssue(responseContentFormat: "adf")`:

```
![](blob:https://media.staging.atl-paas.net/?type=file&localId=null&id=114158ea-…&&collection=&height=480&…)
```

Alt text gone, `mediaSingle` attributes gone, `collection` empty, `localId` null. That is not ADF, and writing it back through `editJiraIssue` destroys the embed. `get_body` on the same issue:

```json
{ "type": "mediaSingle", "attrs": { "width": 561, "widthType": "pixel", "layout": "center" },
  "content": [{ "type": "media", "attrs": { "type": "file", "id": "114158ea-…",
    "alt": "Screenshot 2026-03-26 at 10.59.11 AM.png", "collection": "", "height": 480, "width": 1230 } }] }
```

This matches an [open report on Atlassian's developer community](https://community.developer.atlassian.com/t/rovo-mcp-server-no-attachment-upload-tool-and-description-drops-adf-media-nodes-on-edit/101278) (June 2026, unanswered).

### The Confluence gap has closed

`getConfluencePage(contentFormat: "html")` now returns fully-formed media nodes, and `updateConfluencePage` accepts them back — its own schema calls the format "round-trip safe":

```html
<figure data-type="media-single" data-layout="center" data-width="760" data-width-type="pixel">
  <div data-type="media" data-media-type="file" data-id="0c5f9dfc-…"
       data-collection="contentId-2206531585" data-width="974" data-height="846">screenshot.png</div>
</figure>
```

For Confluence bodies, **prefer the official MCP**. It also places images at arbitrary inline positions, which `embed_attachment` can't. One asymmetry remains: HTML+ references media by UUID and forbids inventing one, and no first-party Confluence tool exposes the UUID of a file you just uploaded. This server's Confluence embeds reference `ri:filename` instead, so upload-then-embed still works here in one step.

### Embedding attachments

Uploading a file only stores it — it won't show up in the description or page until you place it. Two tools do that; upload the file first with `upload_attachment` on the same issue/page, then:

**`embed_attachment`** — drop one image or file reference into a body or comment.

- `target: "body"` — the Jira description / Confluence page body. `target: "comment"` — a new comment.
- `as: "image"` (default) — a displayed image (`width`/`alt` optional); `as: "link"` — a clickable download link / file card for any file type (`linkText` optional); `as: "inline"` — an inline file chip (Jira only).
- **Placement** (body only): by default `position: "append"` (end) or `"prepend"` (start). Or pass `anchor` to insert relative to existing content — set exactly one:
  - `afterHeading: "Step 1"` — right after the heading with that exact text (Confluence: plain headings only; rich/nested headings error — use `replaceToken` or `set_body`).
  - `replaceToken: "{{img:diagram.png}}"` — replace a placeholder paragraph whose only text is that token.
  - `afterBlock: 3` — after the 3rd top-level block (**Jira only**, 1-based).
  - add `occurrence: 2` to pick which match when there are several.
- **Dedupe**: by default re-running adds another copy; pass `dedupe: "replace"` to update an existing embed of the same file in place instead (Jira matches by media UUID, Confluence by the `ri:filename` of an embed this tool created).

| `as` | Jira (v3 ADF) | Confluence (v2 storage) |
|---|---|---|
| `image` | `mediaSingle` | `<ac:image><ri:attachment>` |
| `link` | `mediaGroup` (file card) | `<ac:link><ri:attachment>` |
| `inline` | `mediaInline` | unsupported — throws; use `link` |

**`embed_attachments`** — embed several files into a body in a **single** read-modify-write, applied in list order. Each `items[]` entry is an `embed_attachment` minus `target` (identify by `attachmentId`/`filename`, choose `as`, place with `position`/`anchor`, optional `dedupe`). Use it instead of calling `embed_attachment` in a loop: embedding six images one at a time churns the page through six versions with reorder races; this does it in one version bump, in order.

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

For **Jira** this is the only way to interleave images with text where you want them: `embed_attachment` only appends, prepends, or anchors, and `editJiraIssue` round-trips the description through markdown and drops the media nodes. For **Confluence**, `updateConfluencePage(contentFormat: "html")` does the same job — use `set_body` there when you want to author storage XML or reference an attachment by filename.

**Prefer anchors over re-authoring a large page.** For a big page, don't read the whole body back just to add an image — `embed_attachment` with an `anchor` (or `embed_attachments`) inserts in place without ever fetching the full body, which also sidesteps the first-party page-read hitting an LLM's token limit. `set_body` also **refuses to replace a non-trivial body with one less than half its size** (pass `allowShrink: true` to override) — a guard against overwriting a page from a truncated or partial read.

For a **surgical** edit rather than a full re-author, round-trip it: call `get_body` to read the current storage/ADF (it reports `length` so you can tell how big it is first), splice your change into that exact content, then `set_body` it back. On Jira this is the only lossless round-trip available — the official server's ADF read is markdown in disguise. On Confluence the official `getConfluencePage` / `updateConfluencePage` HTML round-trip is equally lossless; `get_body` is for when you specifically want storage XML.

> **`set_body` is storage/ADF only — not markdown.** Confluence bodies must be storage XML and Jira bodies must be ADF. Don't route body edits through markdown anywhere: Atlassian's markdown conversion strips images and collapses nested lists, which is exactly the loss this tool exists to avoid. (The first-party server's *HTML* path for Confluence is lossless — it's specifically markdown that costs you content, and Jira's ADF read silently goes through it.)

Jira's media nodes need the attachment's *media-services UUID*, which the upload/list APIs never expose. The server resolves it on the fly from the attachment content endpoint's redirect (`GET /rest/api/3/attachment/content/{id}` → `302` to `…/file/<UUID>/binary`). Confluence references attachments by filename, so no UUID is involved there.

## Security model

Attachment filenames and bodies are untrusted input — anyone who can touch a ticket controls them, and prompt injection in ticket text can steer an agent running auto-approved tools. The design responds asymmetrically:

- **Downloads are sandboxed.** The server only ever writes inside one root directory: `ATTACHMENT_MCP_DIR` if set, else `<cwd>/.claude/attachments/` when launched from a real workspace, else your OS cache dir. The root is self-gitignored, filenames are sanitized, layout is `<site>/<container>/<attachmentId>-<filename>`, containment is realpath-verified, symlinks are refused, and nothing is overwritten without `overwrite: true`.
- **Uploads read from anywhere** the process can read — pasted images land in OS temp dirs, screenshots in `~/Screenshots`, downloads in `~/Downloads`, and your MCP client's permission model governs the session. Run with tool approval on if your threat model includes malicious ticket content steering uploads.
- **File bytes never flow through the protocol.** Downloads return a path and metadata, not content (thumbnails are the one deliberate exception).

Release history (what changed and why) is in [`CHANGELOG.md`](CHANGELOG.md); design decisions in [`docs/adr/`](docs/adr/); project vocabulary in [`CONTEXT.md`](CONTEXT.md).

## License

[MIT](LICENSE)
