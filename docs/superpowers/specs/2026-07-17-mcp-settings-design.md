# MCP settings redesign

## Scope

Simplify MCP settings around servers rather than individual tool permissions. Reuse existing Settings UI patterns. Keep tool inventories available as read-only details.

## Profile selection

Replace the native profile select with the existing searchable `CustomSelect`. Changing profiles clears the editor and loads that profile's server inventory. Disable selection while saving.

## Server inventory and permissions

Each server displays its name, connection type, configuration source, status, and a single enable/disable toggle. Retain edit/override, remove, and discovery actions where supported.

Tool lists are collapsed by default. Expanding a server's tools shows read-only tool names and descriptions, without checkboxes or per-tool controls. Keep empty and undiscovered states clear.

Store server-level disabled state explicitly, independently of discovered tools. Disabling a server must deny every tool from that server, including tools discovered later and proxy calls; it must not implement the toggle by enumerating disabled tools. Enabling restores server access without modifying existing tool exclusions or legacy per-tool policies.

Profile-disabled servers cannot be enabled by session settings. Sessions may additionally disable servers for themselves. Refresh active tool exposure after permission changes and preserve existing streaming guards, authentication, and allowed-project-path checks.

## Add and edit

Replace the inline raw-JSON form with a focused modal using existing modal conventions:

- Server name; immutable for existing entries.
- Connection type: local command (stdio) or HTTP.
- Command and arguments for local connections, URL for HTTP.
- Optional environment variables for local connections and headers for HTTP.
- Collapsed advanced configuration for remaining supported options.
- Clear Save and Cancel actions; inline validation; existing toast feedback.

Preserve stored credentials and unedited options when saving. Do not expose existing secret values in inventory responses. Changing connection type must not retain conflicting command/URL fields. Respect shared and project configuration ownership: retain supported profile overrides and do not allow editing project-owned entries through this form.

## Error handling and accessibility

Keep errors visible without discarding editor input. Prevent duplicate submissions. Use accessible labels, modal keyboard/focus behavior, and expandable tool sections. Keep loading, disabled, empty, and failed states explicit. Match current theme tokens and responsive Settings styling.

## Verification

Add focused client tests covering custom profile selection, collapsed read-only tool lists, server toggles, and add/edit modal behavior and validation. Add server tests proving disabled servers deny all calls, including newly discovered tools, session/profile precedence, persistence, and preservation of existing exclusions. Verify secret-preserving edits and connection-type changes. Run relevant tests and workspace build; run broader tests as warranted.

Update affected user-facing labels and the corresponding English and Chinese MCP manual sections to describe server-level controls and the new editor.

## Non-goals

No new per-tool editing UI, connection protocol, credential storage scheme, or unrelated Settings refactor. Existing tool permission data remains compatible.
