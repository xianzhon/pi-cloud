# Pi WebUI 中的项目技能

项目技能允许仓库提供特定任务的指令；在该仓库中启动 Pi WebUI 会话时，这些指令即可供智能体使用。

## Pi WebUI 从何处查找项目技能

Pi WebUI 使用与 Pi 编程智能体相同的技能发现机制。对于选定的项目目录，会从以下位置发现项目技能：

- 所选项目目录中的 `.pi/skills/`
- 所选项目目录及其祖先目录中的 `.agents/skills/`，查找范围截至 Git 仓库根目录
- 项目 `.pi/settings.json` 的 `skills` 数组中列出的其他路径

除非在 `.pi/settings.json` 中明确添加，否则普通的顶层 `skills/` 目录**不会**被自动加载。

## 方案一：使用 `.pi/skills/`（推荐用于仅面向 Pi 的项目）

为每个技能创建一个目录，并在其中放置 `SKILL.md` 文件：

```text
my-project/
└── .pi/
    └── skills/
        └── repo-release-helper/
            └── SKILL.md
```

`SKILL.md` 示例：

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

## 方案二：使用 `.agents/skills/`（与其他兼容 Agent Skills 的工具共享）

如果希望多个智能体工具共用相同的项目技能，请使用以下目录结构：

```text
my-project/
└── .agents/
    └── skills/
        └── repo-release-helper/
            └── SKILL.md
```

Pi WebUI 还会检查祖先目录中的 `.agents/skills/`，直至 Git 仓库根目录。这适用于多个软件包共享相同技能的 monorepo。

## 方案三：保留现有的 `skills/` 目录

如果项目已有顶层 `skills/` 目录，请在 `.pi/settings.json` 中明确添加：

```text
my-project/
├── skills/
│   └── repo-release-helper/
│       └── SKILL.md
└── .pi/
    └── settings.json
```

`.pi/settings.json`：

```json
{
  "skills": ["../skills"]
}
```

`.pi/settings.json` 中的路径以 `.pi` 目录为基准解析，因此 `../skills` 指向项目的顶层 `skills/` 目录。

## 技能文件要求

每个技能目录必须包含带 YAML frontmatter 的 `SKILL.md`：

```markdown
---
name: my-skill-name
description: What this skill does and when to use it.
---

# My Skill Name

Skill instructions go here.
```

请牢记以下规则：

- `SKILL.md` 必须以两行 `---` 之间的 YAML frontmatter 开头。
- `name` 为必填项，应仅使用小写字母、数字和连字符。
- `description` 为必填项。缺少说明时，Pi 不会加载该技能。
- 仅有 Markdown 标题（如 `# My Skill`）并不够。
- 说明应当具体，因为智能体会据此决定何时加载技能。
- 其他脚本或参考文件可以与 `SKILL.md` 放在同一目录中；请使用相对于技能目录的路径引用它们。

## 在 Pi WebUI 中使用技能

1. 将技能放在上述任一受支持的位置。
2. 在 Pi WebUI 侧边栏中或创建新会话时选择项目目录。
3. 打开**新建会话**。
4. 在技能选择器中确认项目技能已显示。
5. 启动会话。

如果 Pi WebUI 已打开且技能列表似乎未更新，请使用清除启动缓存的操作（如果可用），或刷新页面。如果后端在添加项目信任/设置更改之前已经运行，请手动重启后端。

## 故障排除

### 技能没有显示

请检查以下常见原因：

- 会话项目路径不是技能所在的仓库。
- 技能位于 `skills/`，但 `.pi/settings.json` 中没有指向它的条目。
- `SKILL.md` 未以 YAML frontmatter 开头。
- `SKILL.md` 缺少 `name` 或 `description` 字段。
- 技能名称包含无效字符。
- 已先发现另一个具有相同 `name` 的技能；第一个技能会优先使用。
- 项目资源可能要求先信任该项目。

### 是否需要 `.skills_store_lock.json`？

不需要。`.skills_store_lock.json` 是技能商店工具使用的元数据。Pi WebUI 不要求手动创建的技能在其中注册。

如果从商店安装的技能可以显示，而手动创建的技能不显示，请先比较它们的 `SKILL.md`。商店安装的技能通常包含有效的 frontmatter；直接以 `# Title` 开头的手写技能不会被发现。

### 可以看到全局技能，但看不到项目技能

请确保新会话针对预期的项目路径打开，而不是 Pi WebUI 仓库或主目录。项目技能发现取决于会话的当前工作目录（cwd）。

### 应该选择哪种目录结构？

- Pi 专用的项目技能使用 `.pi/skills/`。
- 如需兼容其他 Agent Skills 工具，请使用 `.agents/skills/`。
- 如果已有其他目录结构（例如 `skills/`），请使用 `.pi/settings.json`。
