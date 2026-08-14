# Slash command input/output safety audit

The browser must not receive unbounded locally generated command output. Git and session-history commands are guarded before large payloads are serialized or rendered.

## Limits

- Git-backed slash command output: **256 KiB per Git process**.
- Combined staged + unstaged diff: **256 KiB cumulative**.
- Changed-file previews: **1,000 files**.
- Session tree: **1,000 entries**, with message labels clipped to 500 characters.
- Changelog: **256 KiB**, checked from file metadata before reading.

An exceeded limit returns a small message asking the user to use the terminal, another Git client, the session file, or the source file as appropriate. The client also refuses to render an unexpectedly large `/diff` response, which protects users connected to an older or misconfigured backend.

## Command audit

| Command | Potential large data | Mitigation |
| --- | --- | --- |
| `/diff` | Full staged and unstaged patch plus stat | Cumulative 256 KiB backend cap; Git is stopped when the cap is crossed; oversized response contains no patch; frontend response-size/render guard. |
| `/status` | One line per changed/untracked file | Git output cap and 1,000-file preview cap. |
| `/commit`, `/amend` | Changed-file preview; AI-generated message uses the full diff | Status/file caps; AI input diff uses the same cumulative 256 KiB cap. The operation is not offered when its preview cannot be produced safely. |
| `/pr` | Changed-file preview, commit list, and AI input diff | 256 KiB Git cap and 1,000-file preview cap in `GitHostingService`; generated PR output is model-token bounded. |
| `/push`, `/pull` | Git progress, hooks, and error output | 256 KiB child-process output cap; excess output returns the standard terminal/Git-client fallback. |
| `/branch` | Local branch list, status preview, and Git output | 256 KiB Git cap and 1,000 changed-file cap. |
| `/tree` | Entire session tree and message content | Responses over 1,000 entries are replaced by a small fallback; accepted trees contain only 500-character message previews. |
| `/changelog` | `CHANGELOG.md` | File size is checked before reading; files over 256 KiB produce a direct-file fallback. |
| `/session` | Session metadata and numeric aggregate statistics | Fixed-size scalar response; message bodies are not returned. |
| `/model` | Configured model catalog | Configuration metadata only, not model output; UI filtering renders the matching selector list. |
| `/skills` | Installed skill catalog | Metadata only; skill bodies and command output are not returned. Slash suggestions render at most eight matches. |
| `/copy` | Existing assistant response text | Client-only; it copies messages already present in browser memory and does not create or render a second large response. |
| `/summary` | Session context and generated summary | Runs through Pi's context compaction/model token limits; output is streamed through the existing chat path rather than buffered as a local command payload. |
| `/compact`, `/help` | Agent input/output | Canonical Pi commands use the normal context-window, model output-token, WebSocket streaming, and tool-output limits; no local bulk payload is assembled. |
| Extension, prompt, and skill commands | Extension-defined behavior | Sent through Pi's normal streamed command path. Local command discovery returns metadata only and the menu renders at most eight suggestions. |

## Boundary behavior

Normal output at or below the limit is returned unchanged. Once output crosses a limit, no partial diff or partial changed-file preview is rendered because partial data could be mistaken for a complete review. The fallback explicitly directs the user to a complete inspection method.
