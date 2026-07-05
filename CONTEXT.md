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

**Embed**:
Inserting an already-uploaded Attachment into a Container's body or comment so it displays (image), links (file card), or shows as an inline chip. Distinct from upload, which only stores the file.
_Avoid_: attach, insert, paste

**Media UUID**:
The media-services file identifier a Jira ADF media node needs to render an Attachment. Absent from the upload/list responses; resolved from the Attachment content endpoint's redirect. (Confluence Embeds reference by filename and need no UUID.)
_Avoid_: media id, file id, attachment id

**Sandbox Root**:
The single local directory downloads are confined to; the server never writes outside it.
_Avoid_: workspace, output dir, cache

**Official Atlassian MCP**:
Atlassian's own remote MCP server. This project complements it in the same client config; it never duplicates what that server already does.
_Avoid_: Rovo MCP, Atlassian API
