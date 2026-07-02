# atlassian-attachments-mcp

A local MCP server for **Jira and Confluence Cloud attachments** — the file operations the official Atlassian MCP server can't do.

The official Atlassian MCP is remote: it runs in Atlassian's cloud and has no access to your filesystem, so it cannot upload, download, or otherwise touch attachments. This server runs locally via `npx`, complements the official MCP in the same client config, and does exactly one job: move files between your disk and Jira issues / Confluence pages.

> **Status: working prototype.** All eight tools are implemented with test coverage; expect rough edges until 1.0.

## Setup

Create an [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens), then add the server to your MCP client:

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

One server instance serves one Atlassian site. Multiple sites? Configure the server multiple times under different names.

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

`ATTACHMENT_MCP_MAX_DOWNLOAD_MB` (optional) caps download size; default 512.

## Security model

Attachment filenames and bodies are untrusted input — anyone who can touch a ticket controls them, and prompt injection in ticket text can steer an agent running auto-approved tools. The design responds asymmetrically:

- **Downloads are sandboxed.** The server only ever writes inside one root directory: `ATTACHMENT_MCP_DIR` if set, else `<cwd>/.claude/attachments/` when launched from a real workspace, else your OS cache dir. The root is self-gitignored, filenames are sanitized, layout is `<site>/<container>/<attachmentId>-<filename>`, containment is realpath-verified, symlinks are refused, and nothing is overwritten without `overwrite: true`.
- **Uploads read from anywhere** the process can read — pasted images land in OS temp dirs, screenshots in `~/Screenshots`, downloads in `~/Downloads`, and your MCP client's permission model governs the session. Run with tool approval on if your threat model includes malicious ticket content steering uploads.
- **File bytes never flow through the protocol.** Downloads return a path and metadata, not content (thumbnails are the one deliberate exception).

Design decisions are recorded in [`docs/adr/`](docs/adr/); project vocabulary in [`CONTEXT.md`](CONTEXT.md).

## License

[MIT](LICENSE)
