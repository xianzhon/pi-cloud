# 配置

Pi Cloud 从 shell 环境变量和 `.env` 文件中读取配置，shell 变量的优先级更高。源码部署可以使用项目根目录下的 `.env`；全局安装默认使用 `~/.config/pi-cloud/.env`。设置 `XDG_CONFIG_HOME` 可以更改用户配置目录。

全局安装后首次运行时，Pi Cloud 会将完整的示例配置复制到用户配置文件中，把示例凭据替换为用户名 `admin` 和随机密码，并在终端中显示这些凭据。已有的用户配置文件不会被覆盖。

## 身份验证

| 变量 | 必需 | 说明 |
|---|---|---|
| `PI_CLOUD_AUTH_USERNAME` | 是 | 登录用户名 |
| `PI_CLOUD_AUTH_PASSWORD` | 是* | 用于开发或简单部署的明文登录密码 |
| `PI_CLOUD_AUTH_PASSWORD_HASH` | 是* | scrypt 密码哈希，推荐用于生产环境 |

\* `PI_CLOUD_AUTH_PASSWORD` 和 `PI_CLOUD_AUTH_PASSWORD_HASH` 必须且只能提供其中一个。有关生成和配置生产环境密码哈希的方法，请参阅[部署手册](deployment.md#安全地存储密码)。

## 服务器和存储

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端端口 |
| `FRONTEND_PORT` | `5173` | 前端开发服务器端口 |
| `HOST` | `127.0.0.1` | 后端绑定地址 |
| `PI_CLOUD_DB_PATH` | 用户配置目录 | 自定义 SQLite 数据库路径 |
| `PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY` | 自动生成的密钥文件 | 用于加密 SQLite 内凭证的 Base64 编码 32 字节密钥 |
| `PI_CLOUD_ALLOWED_ROOTS` | 用户主目录 | 文件浏览器和终端可以访问的目录，以逗号分隔 |
| `PI_CLOUD_DISABLE_PATH_CHECK` | `false` | 禁用文件、终端初始目录和 Git API 路径的允许根目录检查 |
| `PI_CLOUD_ENABLE_SYSTEM_OPEN` | `false` | 允许通过非 localhost URL（例如本地 nginx 主机名）使用**通过系统工具打开** |
| `PI_CLOUD_TERMINAL_SHELL` | Windows 上为 `COMSPEC`/`cmd.exe`；macOS/Linux 上为 `SHELL`/`bash` | 终端 shell 可执行文件，例如 `powershell.exe`、`pwsh.exe` 或 `/bin/zsh` |
| `PI_CLOUD_LOOP_DETECTION_THRESHOLD` | `5` | 连续出现指定次数的相同工具调用时停止 agent 运行；设为 `0` 可禁用循环检测 |

通过 `localhost`、`127.0.0.1`、`::1` 和 `*.localhost` 访问时，**通过系统工具打开**会自动可用。若通过自定义反向代理主机名访问同一台本地设备，请设置 `PI_CLOUD_ENABLE_SYSTEM_OPEN=true`。该操作会在运行 Pi Cloud 的设备上启动应用程序，因此仅应在可信的本地部署中启用。更改此设置后请重启服务器。

TOTP 密钥、GitHub/Gitea token 和网关凭证使用 AES-256-GCM 加密后存入 SQLite。若未设置 `PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY`，Pi Cloud 会创建仅当前用户可读的 `<数据库路径>.credentials.key`。可用 `openssl rand -base64 32` 生成由环境变量托管的密钥。请在保存凭证前完成配置；数据库中存在加密凭证时不要更换密钥，并将密钥与数据库分开备份。密钥丢失后相关凭证无法恢复。已有明文凭证会在下次启动时自动加密。

当 `PI_CLOUD_DISABLE_PATH_CHECK=true` 时，`PI_CLOUD_ALLOWED_ROOTS` 会被忽略。所有平台默认启用这些检查。在 Windows 上，请显式列出需要访问的其他磁盘或文件夹，例如 `PI_CLOUD_ALLOWED_ROOTS=C:\Users\you,D:\Projects`。禁用检查后，WebUI 文件系统端点可以访问服务器进程有权限访问的任何路径，因此请仅在可信部署中使用。

常用服务器选项对应的 CLI 参数如下：

```bash
pi-cloud --port 8080
pi-cloud --hostname 0.0.0.0 --no-open
```

## 共享技能

在**设置 → 共享技能**中，输入小写字母、数字及单连字符组成的技能名称，填写带有相同 `name` 和非空 `description` 元数据的 `SKILL.md`，即可添加技能。之后可单独编辑 `SKILL.md`，其他文件不受影响。也可以克隆根目录含有 `SKILL.md` 的 HTTPS GitHub 仓库，或使用 `https://github.com/owner/repo/tree/branch/path/to/skill` 克隆技能子目录（分支名不能包含斜杠）。目标目录名须与技能元数据名称一致。克隆不会覆盖已有技能；失败时会显示错误并清除不完整的副本。

托管技能保存在服务器的 `~/.agents/skills/` 下，供所有智能体配置共享。Pi 会在现有技能选择器和预设中发现它们，同时保留已有的项目及配置技能；现有预设不会被修改。选用第三方技能前请检查其指令和脚本。运行中的会话可能需要重启才能加载新增或更新的技能。

## 会话和安全

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_CLOUD_SESSION_TTL_HOURS` | `8` | 会话空闲超时和续期窗口，单位为小时 |
| `PI_CLOUD_SESSION_MAX_HOURS` | `720` | 包括续期在内的最长会话生命周期，单位为小时 |
| `PI_CLOUD_COOKIE_SECURE` | `false` | 将会话 Cookie 限制为仅通过 HTTPS 连接传输；配置 HTTPS 通行密钥访问源时自动启用 |
| `PI_CLOUD_PASSKEY_ORIGIN` | 未设置 | 为此精确 HTTPS 访问源启用通行密钥，开发可用 `http://localhost:<端口>`；不含末尾斜杠 |
| `PI_CLOUD_TRUST_PROXY` | `false` | 信任一层反向代理：使用 `X-Forwarded-For` 的最后一跳作为客户端地址，并接受不含外部端口的 `Host` 请求头 |
| `SKIP_2FA_VERIFY` | `false` | 紧急情况下为登录及已验证密码的恢复操作绕过 TOTP；正常运行时应保持禁用 |

通过网络开放 Pi Cloud 时，请使用可信反向代理提供 HTTPS，并保持身份验证启用。按照[部署手册](deployment.md#反向代理nginx)配置 HTTPS 反向代理时，请设置 `PI_CLOUD_TRUST_PROXY=true` 和 `PI_CLOUD_COOKIE_SECURE=true`。

会修改状态的浏览器请求以及所有 WebSocket 连接，都必须来自与 `Host` 请求头相同的源（协议、主机和端口）。同一台设备上其他端口提供的页面会被拒绝。启动完成后，Pi Cloud 会从终端、agent 工具、MCP 服务器和 Git 继承的环境变量中移除自身的密钥（登录密码、凭据密钥、网关和语音 API 密钥）。

### 通行密钥登录

设置 `PI_CLOUD_PASSKEY_ORIGIN=https://pi.example.com` 并重启，然后通过此精确访问源打开应用。RP ID 为其主机名，不扩大到父域名。开发可用 `http://localhost:5173`（不是 `127.0.0.1`）。不设置此变量则禁用通行密钥。HTTPS 访问源也会自动启用安全会话 Cookie，因此所有登录都应使用 HTTPS。

正常登录后，打开 **设置 → 安全 → 通行密钥** 添加具名凭据。添加和删除均需验证当前密码及已启用的 TOTP，即使开启 `SKIP_2FA_VERIFY` 恢复模式也必须验证。登录页提供 **使用通行密钥登录**；这是要求设备/提供者进行用户验证的独立登录方式，无需额外输入密码或 TOTP。Bitwarden、平台认证器及兼容安全密钥通过标准 WebAuthn 工作。

SQLite 仅保存公钥和凭据元数据。请保留密码 + TOTP 或备用通行密钥作为恢复方式。凭据绑定配置的用户名和 RP ID，更改任意一项均不会转移凭据。开发和生产环境应分别注册。待验证 challenge 五分钟后过期，服务器重启会使其失效。

## 记忆策略

`PI_CLOUD_MEMORY_POLICY` 控制记忆提取和召回。系统默认启用自适应词法策略。如需临时回退到旧版策略：

```env
PI_CLOUD_MEMORY_POLICY=legacy
```

更改此设置后请重启服务器。

## 配置中的扩展包

打开 **Agent 配置 → 扩展**，可以启用或禁用该配置 `settings.json` 中各个包提供的扩展。例如，取消勾选 `npm:pi-subagents` 可禁用子智能体委派，同时保留 `npm:pi-mcp-adapter`。更改会立即保存，在新建或重新打开会话时生效，也影响使用同一配置的 CLI Pi；已运行的会话不受影响。

此功能使用 Pi 原生的包过滤配置：禁用后条目变为 `{ "source": "npm:pi-subagents", "extensions": [] }`。包不会被卸载，技能、提示模板和主题保留原有配置。已有的扩展过滤规则保存在条目的 `piCloudExtensionFilters` 字段中，重新启用时会恢复。开关仅管理配置中的包声明，不管理独立扩展文件或项目级包覆盖配置。

## 智能体代理配置

可以在 WebUI 的配置文件设置中为每个智能体配置文件设置代理。这些设置存储在 Pi Cloud 的 SQLite 数据库中，并且仅应用于智能体和模型请求；内嵌终端不受影响。更改会在智能体下次执行操作时生效，无需重启。

## 本地 LLM 配置

打开 **Agent 配置 → 本地 LLM**，选择 Ollama、LM Studio 或 llama.cpp 预设（也可以输入自定义 OpenAI 兼容服务地址），然后点击**连接并发现模型**。选择需要使用的模型并保存，无需 API 密钥。该地址由 Pi Cloud 服务器访问，因此 `127.0.0.1` 指运行服务器的设备。默认允许访问回环地址。如需使用局域网或远程服务，请将其精确来源（协议、主机名和端口）加入逗号分隔的 `PI_CLOUD_LOCAL_LLM_ALLOWED_ORIGINS`，例如 `http://192.168.1.20:11434,https://llm.example.test`。生成的提供商配置会写入当前 Agent 配置的 `models.json`，不会覆盖其他提供商。发现的模型默认配置为支持文本和图像输入；模型已有的显式能力配置会被保留。

## 自定义 API 提供商

打开 **Agent 配置 → 自定义 API 提供商**，可以添加 OpenAI 兼容的远程服务。输入小写提供商 ID、以 API 根路径结尾的 HTTPS 地址（例如 `https://api.example.com/v1`）及其 API 密钥。点击**连接并发现模型**，选择需要使用的模型，然后保存提供商。提供商及所选模型 ID 存储在当前 Agent 配置的 `models.json` 中；新输入的密钥单独存储在 Pi 受保护的 `auth.json` 中，并且不会返回浏览器。也可以在此选择和编辑 `models.json` 中已有的自定义提供商，例如手动配置的 Agnes。

模型发现依赖提供商的 `GET /models` 响应。大多数 OpenAI 兼容服务只返回模型 ID，不提供上下文窗口、推理或图像能力，因此发现的模型会使用 Pi 默认值；如果 `models.json` 中已经存在这些字段，则会予以保留。

如需使用 Cloudflare Workers AI，请将提供商类型选择为 **Cloudflare Workers AI**，然后输入 Cloudflare 账户 ID 和具有 Workers AI 读取权限的 API Token。Pi Cloud 会自动生成固定地址 `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`，并从 Cloudflare 模型目录加载兼容聊天的模型。选择需要使用的模型，并按需标记图片支持。此配置不会启用 AI Gateway，也不需要网关 ID。

## 语音输入

语音输入是独立的语音转文本层；coding agent 最终只会收到转写后的文本。配置一个兼容 OpenAI `/audio/transcriptions` 的服务，然后重启服务器：

```env
PI_CLOUD_STT_API_KEY=sk-...
PI_CLOUD_STT_BASE_URL=https://api.openai.com/v1
PI_CLOUD_STT_MODEL=gpt-4o-mini-transcribe
PI_CLOUD_STT_LANGUAGE=zh
```

未设置 `PI_CLOUD_STT_API_KEY` 时会使用 `OPENAI_API_KEY`。服务地址和模型默认使用上面的值。`PI_CLOUD_STT_LANGUAGE` 可选；不设置时由 STT 服务自动检测语言。配置后，输入框中的麦克风按钮会在浏览器中录音，将完整音频发送到服务器转写，并把结果插入输入框，不会自动发送。同一个服务也会转写企业微信收到的语音消息；要支持企业微信，STT 提供商必须能够接收 AMR 音频。浏览器只允许通过 HTTPS 或 localhost 访问麦克风。

## 文本转语音

Pi Cloud 可以通过兼容 OpenAI `/audio/speech` 的服务生成音频。使用本地 MLX Audio 服务时可配置：

```env
PI_CLOUD_TTS_BASE_URL=http://127.0.0.1:28081/v1
PI_CLOUD_TTS_MODEL=mlx-community/Qwen3-TTS-12Hz-0.6B-CustomVoice-8bit
PI_CLOUD_TTS_VOICE=Vivian
PI_CLOUD_TTS_LANGUAGE=Chinese
PI_CLOUD_TTS_FORMAT=wav
```

只需设置 `PI_CLOUD_TTS_BASE_URL` 即可启用控件。本地服务不需要 API 密钥；如果提供商要求 Bearer 认证，可设置 `PI_CLOUD_TTS_API_KEY`。对于中英文混合回复，推荐使用 Qwen3-TTS 0.6B CustomVoice 和 `Vivian` 声音。格式默认使用 WAV。`PI_CLOUD_TTS_LANGUAGE` 可选。修改这些变量后需重启 Pi Cloud。

已完成的助手文本回复会显示播放、停止和重播控件。可在**设置 → 聊天 → 朗读助手回复**中开启自动朗读；Pi Cloud 只会在收到 `agent_end` 完成事件后合成语音，不会对每个流式文本增量调用服务。该偏好默认关闭，避免较长的编程回复意外自动播放。

可使用 Python 3.12 和 `uv pip install "mlx-audio[tts,server]" "misaki[zh]"` 安装本地 MLX Audio 服务，然后通过 `make -C local-tts start` 在 `28081` 端口启动。使用 WAV 可避免 MLX Audio 的压缩输出格式依赖 `ffmpeg`。

## 提供商和网关变量

`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等提供商 API 密钥是可选的，因为服务器默认使用 Pi 智能体自身的身份验证。

有关提供商特定的变量，请参阅 `.env.example`；有关消息配置，请参阅专门的[飞书](feishu-gateway.md)、[企业微信](wecom-gateway.md)和[微信](weixin-gateway.md)网关手册。

## MCP 服务器与权限

MCP 支持使用安装在各智能体配置中的 `pi-mcp-adapter` 扩展。在目标 Pi 代理目录（`PI_CODING_AGENT_DIR`）中执行 `pi install npm:pi-mcp-adapter`，然后新建或恢复 Pi Cloud 会话。Pi Cloud 不会自动安装第三方可执行软件包。

打开 **设置 → MCP**，使用可搜索的选择器选择智能体配置。每台服务器显示启用/禁用开关、连接状态和配置来源。工具名称及说明以只读列表显示，默认折叠。**发现 / 刷新工具** 会显式启动临时适配器会话，连接所选服务器、刷新工具缓存，然后释放临时会话。此操作需要适配器的 `mcp` 代理工具；使用 `disableProxyTool: true` 的纯直接工具配置需要先启用代理工具。OAuth 服务器可能需要先在 Pi 中完成认证。缓存列表可能过期；过期或未知的工具身份需要重新发现后才能调用。

通过 **添加 MCP 服务器** 或 **编辑服务器** 打开连接编辑器。选择 **本地命令** 并填写命令及参数（每行一个参数），或选择 **HTTP 服务器** 并填写 URL。**高级设置** 包含工作目录、环境变量/HTTP 请求头及其他 JSON 选项。已有密钥不会显示；添加值会更新或补充现有值，不会移除已存储的值。例如，本地连接对应以下配置：

```json
{ "command": "npx", "args": ["-y", "your-mcp-server"] }
```

HTTP 服务器示例：

```json
{ "url": "https://example.com/mcp" }
```

MCP 命令在**服务端**运行，拥有服务端操作系统权限。请仅配置可信的命令和端点。可选的 `cwd` 和项目路径必须满足 Pi Cloud 的允许根目录检查，包括符号链接和环境变量展开后的路径。建议在 `env`/`headers` 中使用 `${VARIABLE}` 引用，或使用 `bearerTokenEnv`，避免内嵌凭据。已存储的环境变量、请求头、Bearer 令牌和 OAuth 设置不会返回浏览器，编辑界面中显示的连接字段时会保留这些信息。不要在命令参数或 URL 查询字符串中放置密钥。

Pi Cloud 仅向 `<profile>/mcp.json` 写入服务器配置，并保留其他设置。生效优先级保持不变：共享全局配置 → 智能体配置 → 项目 `.mcp.json` → 项目 `.pi/mcp.json`。共享全局或导入的服务器可以创建智能体配置覆盖项。项目覆盖项在面板中只读，需要编辑其来源文件。移除**智能体配置项**后，同名的共享定义可能重新生效；此操作不会删除共享或项目文件。连接配置更改在新建或恢复会话时生效；权限更改在空闲时立即应用于已加载的会话。

服务器开关控制的是**权限**，而不是直接工具/代理工具的展示方式。禁用服务器后，其工具不能通过代理入口或直接调用执行，直接工具会从模型的活动工具列表中移除，显式代理连接请求也会被阻止。限制同样适用于以后发现的工具，无需逐个禁用工具。重新启用服务器会保留适配器排除项和旧有的逐工具权限限制。工具列表不再显示权限复选框。

在聊天中输入 **`/mcp`** 可打开当前会话的 MCP 面板，不会向模型发送提示。会话设置只能进一步限制智能体配置中已启用的服务器，不能重新启用配置中禁用的服务器。限制在恢复会话后仍然有效，并按智能体配置和会话隔离。Pi Cloud 将权限存储在 `<profile>/pi-cloud-mcp.json`，不会改写共享适配器配置。相关会话正在流式处理时不能更改设置。工具权限限制不会阻止适配器的 eager/keep-alive 连接启动，也不属于操作系统沙箱。
