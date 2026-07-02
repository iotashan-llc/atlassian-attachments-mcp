# Atlassian Attachments

A local MCP server for attachment operations on Jira issues and Confluence pages — the file I/O the official (remote) Atlassian MCP server cannot do.

## Language

**Attachment**:
A file stored on a Jira issue or a Confluence page.
_Avoid_: file, upload, document

**Site**:
A single Atlassian Cloud tenant (`<name>.atlassian.net`) hosting both Jira and Confluence.
_Avoid_: instance, workspace, host

**Container**:
The thing an Attachment belongs to — a Jira issue or a Confluence page.
_Avoid_: parent, target

**Archive Peek**:
Listing the contents of an archive Attachment server-side, without downloading it.
_Avoid_: expand, unzip, extract

**Thumbnail**:
The server-generated reduced-size preview of an image Attachment.
_Avoid_: preview, icon

**Bulk Download**:
Downloading every Attachment on one Container into a local directory.
_Avoid_: export, sync, mirror

**Official Atlassian MCP**:
Atlassian's own remote MCP server. This project complements it in the same client config; it never duplicates what that server already does.
_Avoid_: Rovo MCP, Atlassian API
