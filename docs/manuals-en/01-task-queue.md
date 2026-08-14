# Task Queue User Manual

The Task Queue lets you save work for Pi to do later, then start it as a new Pi session when you are ready. It is useful for capturing ideas, splitting up parallel work, and preparing model, skill, and worktree settings without interrupting your current session.

## What It Is For

- **Keep the current conversation uninterrupted**: Save a task title, prompt, and launch configuration, then start it later.
- **Plan work in batches**: Queue multiple features, fixes, or research tasks and start them in order or by priority.
- **Preserve launch settings**: Each task records its project path, agent profile, model, skill selection, and worktree settings.
- **Isolate code changes**: Create a managed worktree so each task runs in its own branch and directory.
- **View tasks across projects**: Show tasks for the current project or all projects.
- **Return to started sessions**: A started task links to its new Pi session, which you can reopen from the task list.
- **Connect Git hosting work**: Create an issue from a task, optionally polish its content with AI, and follow the linked pull request status.

## Common Use Cases

- Capture a newly discovered issue without switching away from your current work.
- Split a large feature into independent subtasks with separate prompts and worktrees.
- Assign different models, agent profiles, or skill combinations to different work.
- Prepare task descriptions and private notes now, then start the work later.

## Opening the Task Queue

### Desktop

Click **Task queue** at the bottom of the left sidebar. The main area switches from chat to the task queue panel.

### Mobile

Open the top action menu (the three-dot button) and select **Task queue**. While the task queue is open, use the close button at the top to return to the normal single-session chat view.

## Task Statuses

- **Waiting**: Ready to edit, start, or delete.
- **Starting**: A temporary state while a task starts; it is not normally shown as a separate list.
- **Started**: A Pi session has been created and linked. You can open the session, mark the task complete, or delete the task record.
- **Completed**: Manually marked as complete. You can still open the linked session or delete the task record.

> Deleting a task record does not delete a Pi session that has already been created.

## Creating a Task

1. Open the Task Queue.
2. Click **+ New task**.
3. Enter the task details:
   - **Project**: Select an existing project or click **Browse…** to choose a directory.
   - **Title**: The name shown in the task list.
   - **Prompt sent to Pi**: The prompt sent when the task starts. Use **AI polish** to refine the title and prompt before saving.
   - **Private notes — not sent**: Notes stored with the task but not included in the launch prompt.
4. Choose the launch settings:
   - **Agent profile**: The agent profile to use.
   - **Model**: The model to use.
   - **Skills**: Enable all skills, enable selected skills only, or disable selected skills.
   - **Worktree**: Use the current workspace or create/reuse a managed worktree.
5. Click **Save task**.

The task appears in the **Waiting** list.

## Starting a Task

Click **Start** beside a task in the **Waiting** list. To launch it without replacing the current tab, click **Start in new tab** instead. Pi WebUI then:

1. Changes the task from `waiting` to `starting` to prevent duplicate starts.
2. Validates that the project directory, agent profile, model, and skills are still available.
3. Resolves the working directory from the task's worktree settings.
4. Creates a new Pi session.
5. Stores session-to-worktree metadata when a managed worktree is used.
6. Changes the task to `started` and records the new session ID.
7. Returns to chat, opens the new session, and sends the task prompt to Pi.

If the prompt cannot be sent, the session remains available and the prompt stays in the input box so you can retry manually.

## Issues and Pull Requests

Every task offers **Create issue** when GitHub or Gitea integration is configured for its project. Pi WebUI builds a draft from the task title, prompt, and private notes; you can edit the title and body or click **AI polish** before creating it. The resulting issue is linked from the task row.

When a pull request is created from the task's linked session, the task row shows the PR number and whether it is ready or merged. PR generation and creation also append `Close #<issue-number>` when the session belongs to a task with a linked issue.

## Editing, Completing, and Deleting

### Edit

Only **Waiting** tasks can be edited. Configuration for started or completed tasks is locked so it cannot diverge from the linked session.

### Complete

Only **Started** tasks can be marked **Complete**. This changes only the task queue status; it does not close or delete the Pi session.

### Delete

Tasks in any state can be deleted. Deleting a task removes only its task record; a linked Pi session remains available.

## Filters and Scope

The task queue provides two filters:

- **Scope**
  - **Current project**: Show tasks whose project path matches the current project.
  - **All projects**: Show tasks from every project.
- **Status**
  - **Waiting**
  - **Started**
  - **Completed**

In **All projects** mode, each task also displays its project path.

## Worktree Guidance

When creating a task, choose one of these work locations:

- **Workspace / none**: Start the session directly in the project directory.
- **Managed worktree**: Prepare an isolated worktree for the task.
  - Create a new branch from a base branch.
  - Reuse an existing branch.
  - Optionally copy a selected file into the worktree.

Use a managed worktree for tasks that modify code, especially parallel or experimental work. The current workspace is usually sufficient for read-only research, questions, or lightweight operations.

## How It Works

### Architecture

The Task Queue has three main parts:

1. **Task queue panel**: `TaskQueuePanel` displays and filters tasks and provides create, edit, start, complete, and delete actions.
2. **Task editor dialog**: `TaskEditorDialog` reuses the new-session launch controls to collect project, model, skill, and worktree settings.
3. **Backend task service**: The `/api/tasks` REST API persists tasks and creates a new Pi session when a task starts.

Simplified flow:

```text
Create task
  ↓
POST /api/tasks
  ↓
Store waiting task in SQLite project_tasks table
  ↓
Click Start
  ↓
POST /api/tasks/:id/start
  ↓
Validate settings, resolve worktree, create Pi session
  ↓
Mark task started, open session, send prompt
```

### Data Storage

Tasks are stored in the SQLite `project_tasks` table. Important fields include:

- `project_path`: Project associated with the task.
- `title`, `prompt`, `notes`: Task content and private notes.
- `status`: `waiting`, `starting`, `started`, or `completed`.
- `agent_profile_id`, `model_provider`, `model_id`: Agent and model used at launch.
- `skill_mode`, `skills_json`: Skill policy.
- `worktree_json`: Worktree launch configuration.
- `session_id`: Linked Pi session after the task starts.
- `gitea_issue_owner`, `gitea_issue_repo`, `gitea_issue_number`, `gitea_issue_url`, `gitea_issue_created_at`: Linked issue metadata. The historical column names are also used for GitHub issues.
- `created_at`, `updated_at`, `started_at`, `completed_at`: Timestamps.

List queries are ordered by `created_at ASC, id ASC` and can be filtered by project path and status.

### State Transitions

```text
waiting ──Start──▶ starting ──Session created──▶ started ──Complete──▶ completed
   ▲                    │
   └────Restore if start fails before session creation────┘
```

Constraints:

- Only `waiting` tasks can be edited or started.
- Only `started` tasks can be completed.
- `starting` prevents the same task from being started concurrently.
- On server startup, any leftover `starting` tasks are restored to `waiting`.

### Launch Validation

Before starting a task, the server verifies that:

- The project path exists and is a directory.
- The agent profile is still available.
- The selected model still belongs to that profile.
- The selected skills are still available to that profile and project.

If validation fails before a session is created, the task returns to `waiting` so it can be edited and retried.

### Sessions and Project Lists

Starting a task creates a normal Pi session, so it also appears in the session list. The task record stores a link to the session; it does not replace the session itself.

Project choices combine paths from session history with paths previously used by tasks. A project can therefore remain available in the task editor even if it has no session yet.

When a project path is changed through the WebUI project migration or relocation feature, task `project_path` values are updated as well.

## Notes

- Private notes are not sent in the task's launch prompt. They are included in a generated issue draft, however, and clicking **AI polish** on that issue sends the draft to the configured model.
- Starting a task creates a new session instead of reusing the current chat. **Start in new tab** delegates the start to a newly opened browser tab.
- A started task's prompt and launch configuration do not follow later changes to its session.
- Deleting a task does not delete its session, and deleting a session does not automatically delete its task.
- If a referenced profile, model, or skill is later removed, starting the task fails until its configuration is updated.
- Prefer a managed worktree for tasks that may make risky code changes.
