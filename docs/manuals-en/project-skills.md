# Project Skills in Pi Cloud

Project skills let a repository provide task-specific instructions that are available when you start a Pi Cloud session in that repository.

## Where Pi Cloud looks for project skills

Pi Cloud uses the same skill discovery as the Pi coding agent. For a selected project directory, project skills are discovered from:

- `.pi/skills/` in the selected project directory
- `.agents/skills/` in the selected project directory and its ancestor directories, up to the Git repository root
- Additional paths listed in the project's `.pi/settings.json` `skills` array

A plain top-level `skills/` directory is **not** auto-loaded unless you explicitly add it in `.pi/settings.json`.

## Option 1: Use `.pi/skills/` (recommended for Pi-only projects)

Create one directory per skill, with a `SKILL.md` file inside:

```text
my-project/
└── .pi/
    └── skills/
        └── repo-release-helper/
            └── SKILL.md
```

Example `SKILL.md`:

```markdown
---
name: repo-release-helper
description: Helps prepare releases for this repository. Use when updating changelogs, tagging versions, or checking release readiness.
---

# Repo Release Helper

When preparing a release:

1. Read CHANGELOG.md and package metadata.
2. Check whether tests and build commands have been run.
3. Summarize any risky or unverified changes before suggesting a tag.
```

## Option 2: Use `.agents/skills/` (shared with other Agent Skills-compatible tools)

Use this layout when you want the same project skills to be usable by multiple agent harnesses:

```text
my-project/
└── .agents/
    └── skills/
        └── repo-release-helper/
            └── SKILL.md
```

Pi Cloud also checks `.agents/skills/` in ancestor directories up to the Git repository root. This is useful for monorepos where several packages share the same skills.

## Option 3: Keep an existing `skills/` directory

If your project already has a top-level `skills/` directory, add it explicitly to `.pi/settings.json`:

```text
my-project/
├── skills/
│   └── repo-release-helper/
│       └── SKILL.md
└── .pi/
    └── settings.json
```

`.pi/settings.json`:

```json
{
  "skills": ["../skills"]
}
```

Paths in `.pi/settings.json` are resolved relative to the `.pi` directory, so `../skills` points to the project's top-level `skills/` directory.

## Skill file requirements

Each skill directory must contain `SKILL.md` with YAML frontmatter:

```markdown
---
name: my-skill-name
description: What this skill does and when to use it.
---

# My Skill Name

Skill instructions go here.
```

Rules to remember:

- `SKILL.md` must start with YAML frontmatter between `---` lines.
- `name` is required and should use lowercase letters, numbers, and hyphens.
- `description` is required. Pi will not load a skill with a missing description.
- A Markdown title alone, such as `# My Skill`, is not enough.
- The description should be specific, because the agent uses it to decide when to load the skill.
- Extra scripts or reference files can live beside `SKILL.md`; refer to them with paths relative to the skill directory.

## Using the skill in Pi Cloud

1. Put the skill under one of the supported locations above.
2. In Pi Cloud, select the project directory in the sidebar or when creating a new session.
3. Open **New session**.
4. In the skill selector, confirm the project skill appears.
5. Start the session.

If Pi Cloud is already open and the skill list looks stale, use the launch-cache clear action if available, or refresh the page. If the backend was running before you added project trust/settings changes, restart it manually.

## Troubleshooting

### The skill does not appear

Check these common causes:

- The session project path is not the repository where the skill lives.
- The skill is in `skills/` but no `.pi/settings.json` entry points to it.
- `SKILL.md` does not start with YAML frontmatter.
- `SKILL.md` is missing the `name` or `description` field.
- The skill name has invalid characters.
- Another skill with the same `name` was discovered earlier; the first one wins.
- Project resources may require the project to be trusted.

### Do I need `.skills_store_lock.json`?

No. `.skills_store_lock.json` is metadata used by skill-store tooling. Pi Cloud does not require a manually-created skill to be registered there.

If a skill installed from a store appears but a manually-created skill does not, compare their `SKILL.md` files first. Store-installed skills usually include valid frontmatter; a hand-written skill that starts directly with `# Title` will not be discovered.

### I can see global skills but not project skills

Make sure the new session is being opened for the intended project path, not for the Pi Cloud repository or your home directory. Project skill discovery depends on the session cwd.

### Which layout should I choose?

- Use `.pi/skills/` for Pi-specific project skills.
- Use `.agents/skills/` if you want compatibility with other Agent Skills tools.
- Use `.pi/settings.json` if you already have a different directory layout, such as `skills/`.
