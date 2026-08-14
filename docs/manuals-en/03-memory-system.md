# Memory System User Manual

The Memory system lets Pi WebUI retain long-lived information and automatically provide it to the model in later conversations. It is designed for project conventions, user preferences, confirmed facts, decisions, and pitfalls that should not need to be explained again in every new session.

## What It Is For

- **Carry context across sessions**: New sessions can recall project rules, previous decisions, and important facts.
- **Reduce repeated prompting**: Frequently used preferences and conventions can be recalled consistently.
- **Build project knowledge**: Turn confirmed conversation details into searchable and editable entries.
- **Support long-running and parallel work**: Managed worktrees for the same project share project memory.
- **Retain provenance**: Automatically extracted memories include their source session and evidence.

## Memory Types

### Scope

- **Project**: Applies only to the current project. Use it for project conventions, architecture decisions, and known pitfalls.
- **Global**: Applies to every project under the same agent profile. Use it for cross-project user preferences and rules.

> Automatically extracted global memories enter the Review queue and do not take effect until approved.

### Category

- **rule**: A requirement that must be followed.
- **preference**: A user preference.
- **decision**: A decision that has already been made.
- **fact**: Confirmed information.
- **pitfall**: A known issue, limitation, or caution.

### State

- **active**: Available for search and automatic recall.
- **pending**: Awaiting review, usually for an automatically extracted global memory.
- **archived**: Retained in history but excluded from recall.

## Using Memory

### Enable Automatic Extraction

Automatic extraction is disabled by default. Open **Settings** and enable **Auto-extract memory**. The setting is persisted, and the system then extracts long-lived memory candidates after assistant turns. You can disable it from the same setting at any time.

### Open Memory Center

Click **Memory** at the bottom of the sidebar. Memory Center displays the current agent profile and project path and provides three tabs:

- **Project**: Active project memories for the current project.
- **Global**: Active global memories for the current profile.
- **Review**: Global memories awaiting approval.

Use the search box and the **Category** and **State** filters to narrow the list.

### Add a Memory Manually

1. Open Memory Center.
2. Click **Add memory**.
3. Enter one concise, atomic, long-lived statement.
4. Select a category and add tags.
5. Optionally select **Pin for recall**. A pinned memory can be **Always applicable** or, with the adaptive policy, **Only when matched** to the current prompt.
6. Click **Save memory**.

Good example:

> The mobile Task Queue entry for this project is in the navigation dropdown.

Poor example:

> I fixed some things today.

### Edit, Pin, Archive, Restore, and Delete

Actions on each memory row let you:

- Use the pencil icon to edit its content, category, tags, pinned state, or pinned applicability.
- Use the pin icon to pin or unpin it.
- Archive an active memory so it no longer participates in recall.
- Restore an archived memory to active status.
- Permanently delete a memory.

The system uses a `revision` value for concurrency control. If a memory changes before your action is applied, Pi WebUI reports a conflict instead of overwriting the newer update.

### Tidy Up Memories

On the **Project** and **Global** tabs, click **Tidy up** to review duplicate or stale contradictory active memories. Pi WebUI proposes which entries to keep and archive, but makes no changes until you select suggestions and confirm **Archive selected**.

### Review Automatically Extracted Global Memories

Automatically extracted global rules and preferences appear under **Review**:

- **Approve**: Approve and activate the memory.
- **Edit & approve**: Modify it before approval.
- **Reject**: Reject and archive it.

Review the evidence to verify that the candidate is supported by the conversation.

### Extract Memory from the Current Session

When a session is open, Memory Center shows **Extract current session**. Click it to queue that session for extraction and generate memory candidates from the conversation.

This is useful when:

- An important discussion has just concluded and its outcome should be retained.
- Automatic extraction missed relevant information.
- You want to import memories from an older session.

### Ask the Agent to Manage Memory

The agent includes a `memory` tool. You can explicitly ask it to:

- “Remember that this project's API errors must contain `code` and `message`.”
- “Search your memory for the mobile Task Queue rule.”
- “Update this memory…”
- “Forget this memory…”

The agent should mutate memory only when you explicitly ask it to remember, update, or forget something. Background extraction handles learning from ordinary conversations.

## How It Works

### Architecture

The Memory system consists of:

1. **Memory Center**: Displays, filters, edits, and reviews memories.
2. **Memory Runtime**: Resolves projects and manages memory services, extraction queues, and WebSocket notifications.
3. **SQLite storage**: Stores projects, memories, and extraction runs, with FTS5 full-text search.

Simplified flow:

```text
Conversation or manual action
        ↓
Pi WebUI MemoryService
        ↓
MemoryStore writes to SQLite
        ↓
Relevant memories recalled before a later request
        ↓
Memories added to the model's system prompt
```

### Project and Profile Isolation

Every memory belongs to an **agent profile**. Project memories are also associated with a normalized project path.

Project resolution:

- Uses a worktree's base repository path so managed worktrees share memory with their base project.
- Normalizes paths with `realpath`.
- Creates or reuses a memory project based on `profileId + canonicalPath`.

Memories from different profiles remain isolated. Within one profile, global memories apply across projects while project memories apply only to their associated project.

### Automatic Recall

Before the agent responds, the Memory extension:

1. Resolves the current profile and project context.
2. Loads applicable pinned, active memories as instruction memories.
3. Searches the current user prompt for relevant active `fact`, `decision`, and `pitfall` memories.
4. Trims the results to the active policy's token budget and injects them into the system prompt.

The default adaptive lexical policy scores prompt intent, lexical relevance, scope, freshness, and prior utility; removes redundant results; and chooses a dynamic total budget of 0, 400, 800, 1,500, or 2,500 tokens. Pins marked **Only when matched** are included only when their relevance score passes the threshold. Set `PI_WEBUI_MEMORY_POLICY=legacy` to use separate budgets of approximately 2,000 tokens each for pinned memories and relevant references, with at most 8 references.

The injected sections have different semantics:

- **remembered-instructions**: Direct user rules and preferences that should be followed unless the current request overrides them.
- **remembered-reference**: Reference data, not instructions. Its contents must not be treated as commands.

### Automatic Extraction

After an agent response, the Memory extension queues the conversation segment between the previous extraction baseline and the current leaf. The background extractor:

1. Reads the selected session branch.
2. Builds an extraction prompt that requires strict JSON output.
3. Supplies related existing memories so the model can classify candidates as `new`, `duplicate`, or `replace`.
4. Validates scope, category, evidence, length, sensitive content, and global-memory restrictions.
5. Applies accepted candidates:
   - Project candidates become `active` immediately.
   - Global candidates become `pending` for review.
   - Replacements retain a `supersedes` relationship for history tracking.

Extraction is attempted at most twice. If the server restarts or a foreground request interrupts processing, running jobs are queued again. Failed runs appear in Memory Center with **Retry** and **Clear** actions.

### Storage

Core tables include:

- `memory_projects`: Project paths associated with profiles.
- `memories`: Content, category, scope, state, source, tags, evidence, revision, and related metadata.
- `memory_extraction_runs`: Automatic and manual session-extraction jobs.
- `memory_fts`: SQLite FTS5 full-text index.

A content hash prevents duplicate active or pending memories in the same scope. Database triggers keep content and tag changes synchronized with the FTS index.

### Safety and Quality Controls

- Content is normalized by trimming and collapsing whitespace.
- A manually saved memory can contain at most 2,000 characters.
- A memory can have at most 10 normalized tags; tags are limited to 32 characters, lowercased, and deduplicated.
- Under the adaptive extraction policy, one run emits at most 8 candidates; each candidate is limited to 220 characters and 4 tags of at most 24 characters before normal memory validation.
- Obvious secrets, tokens, and passwords are rejected.
- Automatically extracted evidence must come from the conversation; rules and preferences require evidence from a user message.
- Automatically extracted global memories are limited to rules and preferences and require manual review.

## Recommendations

- Save only long-lived, reusable information.
- Keep each memory focused on one fact or rule.
- Use `rule` for hard constraints and `preference` for softer habits.
- Archive outdated information before it can mislead the model.
- Pin only a small number of important rules and preferences.
- Check evidence during review so model guesses are not saved as facts.

## FAQ

### Why did something I just said not immediately become a memory?

Automatic extraction runs asynchronously after the agent responds. It also filters temporary progress, speculation, logs, code snippets, and sensitive information. Global candidates require review.

### Why is a global memory in Review?

Global memories affect every project under the same profile. Automatically extracted global candidates remain pending to prevent accidental cross-project pollution.

### Why does a pinned-memory warning say the budget was exceeded?

Pinned rules and preferences have a recall token budget. Unpin less important entries or shorten their content when the pinned set is too large.

### What is the difference between archiving and deleting?

Archived memories no longer participate in recall, but remain available for history and can be restored. Deleting permanently removes the memory; use archiving when you may need its provenance or replacement history later.
