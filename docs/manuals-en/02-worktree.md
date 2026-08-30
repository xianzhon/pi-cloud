# Managed Worktree User Manual

The Worktree feature lets Pi Cloud prepare an isolated Git worktree when you create a Pi session instead of working directly in the current project directory. A single repository can then support multiple branches, directories, and Pi sessions in parallel without overwriting the same workspace files.

> In short: a normal session edits the current directory; a managed worktree session first switches to a separate directory and branch, then lets Pi work there.

## What It Is For

- **Isolate code changes**: Give each task or session its own branch and directory without disturbing the main workspace.
- **Develop in parallel**: Run multiple Pi sessions on separate branches at the same time.
- **Experiment safely**: Put prototypes, refactors, or model experiments in disposable worktrees.
- **Protect the current workspace**: Keep its uncommitted changes separate from Pi's changes.
- **Integrate with Task Queue**: Save worktree settings with a task and create or reuse the worktree when it starts.
- **Use standard Git workflows**: Commit, push, review, and merge the branch after Pi finishes.

## Common Use Cases

- Let Pi change code without affecting the currently checked-out branch.
- Work on multiple features, fixes, or experiments in one repository concurrently.
- Try different models or skill combinations on separate branches.
- Keep Pi's diff separate from uncommitted work in the current workspace.
- Give every queued task an independent implementation environment.

## Using a Worktree

### Select a Worktree for a New Session

1. Click the new-session button.
2. Select a project directory inside a Git repository.
3. Under **Work location**, choose:
   - **Current workspace**: Use the selected project directory directly.
   - **Managed Git worktree**: Use a Git worktree managed by Pi Cloud.
4. For a managed worktree, choose a branch mode:
   - **New branch**: Create a branch from a local base branch.
   - **Existing branch**: Create or reuse a worktree for an existing local branch.
5. Enter or select the branch, then optionally select a root-level ignored file to copy.
6. Click **Create session**.

The new Pi session uses the worktree directory as its actual working directory instead of the original project directory.

### New Branch Mode

For **New branch**, provide:

- **Branch name**: The new branch, such as `feat/login-refactor`.
- **Base branch**: The local branch to use as its starting point, such as `main` or `develop`.

Pi Cloud performs an operation equivalent to:

```bash
git worktree add -b <branch-name> <worktree-path> <base-branch>
```

This mode is suitable for new features, bug fixes, and experiments.

### Existing Branch Mode

For **Existing branch**, select a local branch. Pi Cloud:

- Reuses its worktree if one already exists.
- Creates a worktree for the branch if one does not exist.

Use this mode to continue work on an existing branch or reopen an independent working directory.

### Copying an Ignored File

Some projects need local files such as `.env`, `.npmrc`, or `.python-version`, but ignored files do not automatically appear in a new worktree.

Pi Cloud scans ordinary files at the project root that Git ignores and lets you copy one of them into the worktree root.

Limitations and safety notes:

- Only one ignored file at the project root can be copied.
- Directories and files in subdirectories are not supported.
- Copying happens after the worktree has been created or resolved.
- Before copying secrets, verify that access to the worktree directory is appropriately restricted.

## Worktree Location

Managed worktrees are created beside the original repository by default, using a path such as:

```text
<parent>/.<repo-name>-worktrees/<safe-branch-name>
```

For example, given this repository:

```text
/Users/me/code/pi-cloud
```

and this branch:

```text
feat/worktree-manual
```

the managed directory may be:

```text
/Users/me/code/.pi-cloud-worktrees/feat-worktree-manual
```

Special characters in branch names are converted into a directory-safe form.

## Finishing a Worktree Session

When a managed worktree session is complete, use **Finish worktree**. Pi Cloud first displays a cleanup preview showing:

- The Git worktree directory that will be removed.
- The Pi session history file that will move from the worktree project directory to the base repository project directory.
- The session record whose `cwd` will be rewritten from the worktree path to the base repository path.

After confirmation, the backend:

1. Stops and releases the running session instance.
2. Migrates the Pi session history and rewrites its `cwd` to the base repository path.
3. Runs `git worktree remove --force <worktree-path>`.
4. Runs `git pull --ff-only` in the base repository.
5. Marks the session's worktree status as `finished`.

**Finish does not preserve your code changes for you.** Before finishing, save the work on the worktree branch:

```bash
git status
git add -A
git commit -m "..."
git push
```

Preferably push and merge the branch, confirm the work is safe, and only then finish the worktree.

## How It Works

### Git Worktree

Git worktree is a built-in Git feature that checks out different branches from one repository into multiple working directories. Pi Cloud invokes Git commands rather than copying the entire repository.

The main flow is:

1. Run `git rev-parse --show-toplevel` for the selected project to find the base repository.
2. Validate branch names and reject unsafe input such as empty names, absolute paths, `..`, or backslashes.
3. Read `git worktree list --porcelain` to determine whether the branch already has a worktree.
4. Run `git worktree add` when a new worktree is needed.
5. Set the new session's `cwd` to the worktree path.
6. Store the worktree metadata in the database.

### Session Metadata

Each managed worktree session records:

- `baseRepoPath`: Root of the original repository.
- `worktreePath`: Worktree directory used by the session.
- `branchName`: Branch name.
- `branchMode`: `new` or `existing`.
- `baseBranch`: Base branch in new-branch mode.
- `worktreeManaged`: Identifies a Pi Cloud-managed worktree.
- `worktreeStatus`: `active` or `finished`.

This metadata supports session-list display, project identity, cleanup, history migration, and memory project resolution.

### Project Memory

For managed worktree sessions, Pi Cloud associates project memory with `baseRepoPath`, not the temporary `worktreePath`. The base repository and its managed worktrees therefore share project memory.

Benefits include:

- Project conventions, pitfalls, and decisions learned in the main project are available in worktree sessions.
- Project memory remains after a temporary worktree is removed.
- Separate repository clones can still retain separate project identities.

### Current Workspace vs. Managed Worktree

| Item | Current workspace | Managed Git worktree |
| --- | --- | --- |
| Working directory | Current project directory | Worktree created or reused by Pi Cloud |
| Branch | Currently checked-out branch | Selected new or existing branch |
| Isolation | Low; edits affect the current workspace | High; edits stay in a separate directory |
| Parallel work | Sessions can interfere | Designed for parallel sessions |
| Cleanup | Manage current-directory changes manually | Use **Finish worktree** to remove the managed directory |
| Project memory | Current project path | Base repository path |

## Notes

- Worktrees are available only for Git repositories. If branches cannot be loaded, Pi Cloud hides the managed worktree option.
- The branch list contains local branches only. Fetch and check out a remote branch locally before selecting it.
- Git normally prevents one branch from being checked out in multiple worktrees; Pi Cloud reuses an existing worktree when possible.
- Managed worktrees do not automatically commit, push, or merge changes.
- **Finish worktree** forcibly removes the directory. Uncommitted or unpushed changes may be lost.
- If a session is streaming output, the backend rejects **Finish worktree** until streaming ends.
- Ignored files may contain credentials or local configuration; copy them carefully.

## Recommended Workflow

1. Select **Managed Git worktree** for work that will modify code.
2. Use a clear branch name such as `feat/payment-retry` or `fix/login-timeout`.
3. Copy a required ignored file such as `.env` when necessary.
4. Let Pi implement, test, and fix the change in that session.
5. Review the diff, then commit and push manually.
6. After confirming the code is safely stored, use **Finish worktree** to clean up the managed directory.
