# Task Queue（任务队列）用户手册

Task Queue 用来把“以后要让 Pi 做的事”先保存成任务，再在合适的时候一键启动为新的 Pi 会话。它适合记录临时想法、拆分并行工作、提前准备模型/技能/worktree 设置，而不打断当前正在进行的会话。

## 它有什么用

- **不打断当前对话**：先把任务标题、Prompt 和启动配置保存下来，稍后再开始。
- **批量规划工作**：把多个需求、修复、调研任务放进队列，按顺序或按优先级启动。
- **保存完整启动参数**：任务会记录项目路径、Agent Profile、模型、技能选择和 worktree 设置。
- **隔离代码改动**：可为任务创建托管 worktree，让每个任务在独立分支/目录中执行。
- **跨项目查看**：既可以只看当前项目任务，也可以查看所有项目任务。
- **回到已启动会话**：任务启动后会关联新建的 Pi session，之后可从任务列表打开对应会话。
- **关联 Git 托管工作**：从任务创建 issue，可选择使用 AI 润色内容，并跟踪关联拉取请求的状态。

## 适用场景

- 正在处理 A 问题时，突然想到 B 问题：先建任务，避免切换上下文。
- 想把一个大需求拆成多个独立子任务，让每个子任务有自己的 Prompt 和 worktree。
- 需要让不同模型、不同 Agent Profile 或不同技能组合处理不同工作。
- 想提前整理任务描述和私有备注，等空闲时再启动。

## 如何进入

### 桌面端

在左侧边栏底部点击 **Task queue** 按钮进入任务队列。进入后，主区域会从聊天面板切换为任务队列面板。

### 移动端

点击顶部操作菜单（三点按钮），选择 **Task queue**。在任务队列模式下，顶部会显示关闭按钮，点击后返回普通单会话聊天模式。

## 任务状态

任务有以下状态：

- **Waiting**：等待启动。可以编辑、启动或删除。
- **Starting**：正在启动中的临时状态，通常不会在列表中单独展示。
- **Started**：已创建并关联 Pi 会话。可以打开会话、标记完成或删除任务记录。
- **Completed**：已手动标记完成。可以打开关联会话或删除任务记录。

> 注意：删除任务记录不会删除已经创建的 Pi 会话。

## 创建任务

1. 打开 Task Queue。
2. 点击 **+ New task**。
3. 填写任务内容：
   - **Project**：任务所属项目。可从已有项目中选择，也可以点击 **Browse…** 选择目录。
   - **Title**：任务标题，用于列表展示。
   - **Prompt sent to Pi**：任务启动后发送给 Pi 的 Prompt。保存前可使用 **AI polish** 润色标题和 Prompt。
   - **Private notes — not sent**：私有备注，只保存在任务记录中，不会发送给模型。
4. 选择启动配置：
   - **Agent profile**：要使用的 Agent Profile。
   - **Model**：要使用的模型。
   - **Skills**：全部启用、只启用指定技能，或禁用指定技能。
   - **Worktree**：使用当前 workspace，或创建/复用托管 worktree。
5. 点击 **Save task**。

保存后任务进入 **Waiting** 列表。

## 启动任务

在 **Waiting** 列表中点击任务右侧的 **Start**。如果不想替换当前标签页，请改用 **Start in new tab**。随后 Pi Cloud 会：

1. 后端先把任务从 `waiting` 标记为 `starting`，防止重复启动。
2. 校验项目目录、Agent Profile、模型和技能是否仍然可用。
3. 根据任务中的 worktree 设置解析实际工作目录。
4. 创建一个新的 Pi session。
5. 如果使用托管 worktree，会保存 session 与 worktree 的关联元数据。
6. 任务状态变为 `started`，并记录新 session id。
7. 前端自动切回聊天模式，打开新 session，并把任务 Prompt 发送给 Pi。

如果 Prompt 没能成功发送，界面会提示：session 已创建，Prompt 会保留在输入框中，可手动重试。

## Issue 和拉取请求

为任务所属项目配置 GitHub 或 Gitea 集成后，每个任务都会提供 **Create issue**。Pi Cloud 会根据任务标题、Prompt 和私有备注生成草稿；创建前可以编辑标题和正文，也可以点击 **AI polish**。创建后的 issue 会显示在任务行中。

从任务关联的会话创建拉取请求后，任务行会显示 PR 编号及其是否就绪或已合并。为关联了 issue 的任务生成和创建 PR 时，正文还会追加 `Close #<issue-number>`。

## 编辑、完成和删除

### 编辑任务

只有 **Waiting** 任务可以编辑。已启动或已完成的任务配置不会再被修改，以避免和已有 session 状态不一致。

### 标记完成

只有 **Started** 任务可以点击 **Complete** 标记为完成。标记完成只是任务队列中的状态变化，不会自动关闭或删除对应 Pi session。

### 删除任务

任何状态的任务都可以删除。删除只移除任务记录；如果任务已经启动，关联的 Pi session 会保留。

## 筛选和查看范围

任务队列顶部提供两个筛选维度：

- **范围**
  - **Current project**：只显示当前项目路径下的任务。
  - **All projects**：显示所有项目的任务。
- **状态**
  - **Waiting**
  - **Started**
  - **Completed**

在 **All projects** 模式下，任务行会额外显示所属项目路径。

## Worktree 使用建议

创建任务时可以选择：

- **Workspace / none**：直接在项目目录中启动 session。
- **Managed worktree**：为任务准备独立 worktree。
  - 可基于某个 base branch 创建新分支。
  - 也可复用已有分支。
  - 可选择复制指定文件到 worktree。

建议对会改代码的任务使用托管 worktree，尤其是并行任务或实验性修改；只读调研、问答或轻量操作可以直接使用当前 workspace。

## 实现原理

### 总体架构

Task Queue 由三部分组成：

1. **前端任务队列面板**：`TaskQueuePanel` 展示任务、筛选状态、触发创建/编辑/启动/完成/删除。
2. **任务编辑弹窗**：`TaskEditorDialog` 复用新建 session 的启动设置组件，收集项目、模型、技能和 worktree 配置。
3. **后端任务服务**：`/api/tasks` REST API 负责持久化任务，并在启动时创建新的 Pi session。

简化流程：

```text
创建任务
  ↓
POST /api/tasks
  ↓
SQLite project_tasks 表保存 waiting 任务
  ↓
点击 Start
  ↓
POST /api/tasks/:id/start
  ↓
校验配置、解析 worktree、创建 Pi session
  ↓
任务变为 started，前端打开 session 并发送 Prompt
```

### 数据存储

任务保存在 SQLite 的 `project_tasks` 表中。核心字段包括：

- `project_path`：任务所属项目路径。
- `title` / `prompt` / `notes`：任务内容和私有备注。
- `status`：`waiting`、`starting`、`started` 或 `completed`。
- `agent_profile_id`、`model_provider`、`model_id`：启动时使用的 Agent 和模型。
- `skill_mode`、`skills_json`：技能策略。
- `worktree_json`：worktree 启动配置。
- `session_id`：任务启动后关联的 Pi session。
- `gitea_issue_owner`、`gitea_issue_repo`、`gitea_issue_number`、`gitea_issue_url`、`gitea_issue_created_at`：关联 issue 的元数据。因历史原因，这些列名也用于 GitHub issue。
- `created_at`、`updated_at`、`started_at`、`completed_at`：时间戳。

列表查询按 `created_at ASC, id ASC` 排序，并支持按项目路径和状态筛选。

### 状态流转

```text
waiting ──Start──▶ starting ──Session 创建成功──▶ started ──Complete──▶ completed
   ▲                    │
   └────启动失败且尚未创建 session 时恢复────┘
```

关键约束：

- 只有 `waiting` 任务可以编辑。
- 只有 `waiting` 任务可以启动。
- 只有 `started` 任务可以标记完成。
- `starting` 是并发保护状态，防止同一个任务被重复启动。
- 服务器启动时会把残留的 `starting` 任务恢复为 `waiting`。

### 启动校验

任务启动前会检查：

- 项目路径存在且是目录。
- Agent Profile 仍然可用。
- 任务指定的模型仍然属于该 Profile。
- 任务指定的技能在该 Profile 和项目下仍然可用。

如果校验失败，且 session 尚未创建，任务会恢复为 `waiting`，用户可以编辑后重新启动。

### 与 Session 和项目列表的关系

任务启动后会创建普通 Pi session，因此它会出现在左侧 session 列表中。任务记录只保存和 session 的关联，不替代 session 本身。

项目选择列表会合并历史 session 路径和任务中出现过的项目路径。因此，即使某个项目还没有 session，只要创建过任务，也可以在任务编辑器中再次选择它。

当项目路径通过 WebUI 的项目迁移/重定位功能改变时，任务记录中的 `project_path` 也会一起更新。

## 注意事项

- 私有备注不会包含在任务的启动 Prompt 中，但会包含在生成的 issue 草稿中；点击 issue 的 **AI polish** 还会将草稿发送给配置的模型。
- 启动任务会创建新 session，不会复用当前聊天。**Start in new tab** 会将启动操作交给新打开的浏览器标签页。
- 已启动任务的 Prompt 和启动配置不会自动跟随后续 session 变化。
- 删除任务不删除 session；删除 session 也不会自动删除任务记录。
- 如果任务使用的 Profile、模型或技能后来被移除，启动时会失败，需要编辑任务后重试。
- 对有代码改动风险的任务，优先选择托管 worktree。