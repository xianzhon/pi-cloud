# Worktree（托管工作树）用户手册

Worktree 功能让你在创建 Pi 会话时，不一定直接在当前项目目录中工作，而是可以让 WebUI 为这个会话准备一个独立的 Git worktree 目录。这样同一个仓库可以同时有多个分支、多个目录、多个 Pi 会话并行工作，互不覆盖工作区文件。

> 简单理解：普通会话直接在当前目录改代码；托管 worktree 会话会先切到一个单独目录和分支里，再让 Pi 在那里工作。

## 它有什么用

- **隔离代码改动**：每个任务或会话可以在自己的分支和目录中修改文件，避免弄乱主工作区。
- **支持并行开发**：可以同时开多个 Pi 会话处理不同需求，每个会话对应不同分支。
- **降低实验成本**：尝试性修改、重构、模型探索可以放在独立 worktree 中，失败后直接删除 worktree。
- **保护当前工作区**：当前目录未提交的改动不会和 Pi 的改动混在一起。
- **配合 Task Queue**：任务队列可以提前保存 worktree 设置，启动任务时自动创建/复用对应 worktree。
- **便于后续合并**：Pi 在分支上完成改动后，用户可以按普通 Git 流程 commit、push、review、merge。

## 适用场景

- 需要让 Pi 修改代码，但不想影响当前 checkout 的分支。
- 同一仓库里有多个需求、bugfix 或实验要并行推进。
- 想让不同模型或不同技能组合在不同分支上尝试方案。
- 当前工作区有未提交内容，不希望 Pi 误改或混入同一批 diff。
- 需要给任务队列中的每个任务准备独立实现环境。

## 如何使用

### 创建新会话时选择 Worktree

1. 点击新建会话按钮。
2. 选择项目目录。该目录必须位于一个 Git 仓库中。
3. 在启动设置的 **Work location** 区域选择：
   - **Current workspace**：直接使用当前项目目录。
   - **Managed Git worktree**：使用 WebUI 托管的 Git worktree。
4. 如果选择 **Managed Git worktree**，继续选择分支方式：
   - **New branch**：基于一个本地 base branch 创建新分支。
   - **Existing branch**：为已有本地分支创建或复用 worktree。
5. 填写分支名，并按需选择要复制的 root-level ignored file。
6. 点击 **Create session**。

创建成功后，Pi 会话的实际工作目录会变成 worktree 目录，而不是原始项目目录。

### 新分支模式

选择 **New branch** 时，需要填写：

- **Branch name**：要创建的新分支名，例如 `feat/login-refactor`。
- **Base branch**：新分支基于哪个本地分支创建，例如 `main` 或 `develop`。

WebUI 会执行类似下面的 Git 操作：

```bash
git worktree add -b <branch-name> <worktree-path> <base-branch>
```

适合用于新需求、新 bugfix、实验性修改。

### 已有分支模式

选择 **Existing branch** 时，需要选择一个已有本地分支。WebUI 会：

- 如果该分支已经有 worktree，则复用已有 worktree。
- 如果还没有，则为该分支创建新的 worktree。

适合继续处理已经存在的分支，或重新打开之前的独立工作目录。

### 复制 ignored 文件

有些项目需要 `.env`、`.npmrc`、`.python-version` 等本地文件才能运行，但这些文件通常被 Git ignore，不会自动出现在新 worktree 中。

WebUI 会扫描项目根目录下被 Git ignore 的普通文件，并允许你选择其中一个复制到 worktree 根目录。

注意：

- 只能复制项目根目录下的单个 ignored 文件。
- 不支持复制目录或子路径文件。
- 复制动作发生在创建/解析 worktree 后。
- 复制敏感文件前，请确认该 worktree 目录的访问权限符合你的安全要求。

## Worktree 目录在哪里

WebUI 托管的 worktree 默认放在原仓库同级目录下，目录名形如：

```text
<parent>/.<repo-name>-worktrees/<safe-branch-name>
```

例如原仓库是：

```text
/Users/me/code/pi-cloud
```

分支是：

```text
feat/worktree-manual
```

则托管目录可能是：

```text
/Users/me/code/.pi-cloud-worktrees/feat-worktree-manual
```

其中分支名中的特殊字符会被转换成适合目录名的形式。

## 如何结束 Worktree 会话

当托管 worktree 会话完成后，界面会提供 **Finish worktree** 操作。点击后会先展示清理预览，包括：

- 将要删除的 Git worktree 目录。
- Pi session 历史文件从 worktree 项目目录移动回 base repo 项目目录。
- session 记录中的 cwd 从 worktree 路径改写为 base repo 路径。

确认后，后端会：

1. 停止并释放该 session 的运行实例。
2. 迁移 Pi 会话历史，并把历史中的 cwd 改为 base repo 路径。
3. 执行 `git worktree remove --force <worktree-path>` 删除 worktree。
4. 在 base repo 上执行 `git pull --ff-only`。
5. 将该 session 的 worktree 状态标记为 `finished`。

重要：Finish 只负责清理 WebUI 托管的 worktree，不会替你保存代码成果。建议在 Finish 前先在 worktree 分支中完成：

```bash
git status
git add -A
git commit -m "..."
git push
```

最好先 push，再合并分支，确认代码已经安全保存后再 Finish。

## 实现原理

### 基于 Git worktree

Git worktree 是 Git 自带能力，允许同一个仓库在多个工作目录中同时 checkout 不同分支。WebUI 没有复制一整份仓库，而是调用 Git 命令创建额外工作树。

核心流程是：

1. 根据用户选择的项目目录执行 `git rev-parse --show-toplevel` 找到 base repo。
2. 校验分支名，避免空分支名、绝对路径、`..`、反斜杠等不安全输入。
3. 查询 `git worktree list --porcelain`，判断目标分支是否已有 worktree。
4. 没有现成 worktree 时，执行 `git worktree add` 创建目录。
5. 把新会话的 `cwd` 设置为 worktree 路径。
6. 将 worktree 元数据保存到数据库。

### 会话元数据

每个托管 worktree session 会保存一组元数据：

- `baseRepoPath`：原始仓库根目录。
- `worktreePath`：会话实际工作的 worktree 目录。
- `branchName`：分支名。
- `branchMode`：`new` 或 `existing`。
- `baseBranch`：新分支模式下的基准分支。
- `worktreeManaged`：标记这是 WebUI 托管 worktree。
- `worktreeStatus`：`active` 或 `finished`。

这些元数据用于会话列表展示、项目归属判断、Finish 清理、历史迁移和记忆系统的项目解析。

### 与项目记忆的关系

对于托管 worktree session，WebUI 会把项目记忆归属解析到 `baseRepoPath`，而不是临时的 `worktreePath`。因此同一个 base repo 和它的托管 worktree 会共享同一份项目记忆。

这样做的好处是：

- Pi 在主项目中学到的约定、坑点和决策，在 worktree 会话中也能复用。
- worktree 清理后，项目记忆不会跟随临时目录丢失。
- 不同真实克隆目录仍然可以保持独立项目身份。

### 与普通 workspace 的区别

| 项目 | Current workspace | Managed Git worktree |
| --- | --- | --- |
| 工作目录 | 当前项目目录 | WebUI 创建/复用的 worktree 目录 |
| 分支 | 当前 checkout 分支 | 指定新分支或已有分支 |
| 隔离性 | 低，直接修改当前工作区 | 高，修改落在独立目录 |
| 并行性 | 容易互相干扰 | 适合多个会话并行 |
| 清理 | 手动处理当前目录改动 | 可用 Finish worktree 清理托管目录 |
| 项目记忆 | 当前项目路径 | base repo 路径 |

## 注意事项

- Worktree 功能只在 Git 仓库中可用；如果无法加载分支列表，界面会隐藏托管 worktree 选项。
- 分支列表来自本地 Git 分支，不会自动展示远端分支；需要先在本地创建或 fetch/checkout。
- Git 同一个分支通常不能同时被多个 worktree checkout；WebUI 会优先复用已有分支 worktree。
- 托管 worktree 不会自动 commit、push 或 merge。代码成果仍需按 Git 流程保存。
- Finish 会强制删除 worktree 目录；未提交或未 push 的改动可能丢失。
- 如果 Finish 时 session 正在输出，后端会拒绝操作，需要等流式响应结束后再执行。
- 复制 ignored 文件可能包含密钥或本地配置，请谨慎选择。

## 推荐工作流

1. 为会改代码的任务选择 **Managed Git worktree**。
2. 使用清晰分支名，例如 `feat/payment-retry`、`fix/login-timeout`。
3. 如项目运行依赖 `.env`，创建时复制需要的 ignored 文件。
4. 让 Pi 在该会话中实现、测试和修复。
5. 检查 diff，手动 commit 和 push。
6. 在代码确认已保存后，点击 **Finish worktree** 清理托管目录。
