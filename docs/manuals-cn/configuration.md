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
| `PI_CLOUD_ALLOWED_ROOTS` | 用户主目录 | 文件浏览器和终端可以访问的目录，以逗号分隔 |
| `PI_CLOUD_DISABLE_PATH_CHECK` | Windows 上为 `true`；macOS/Linux 上为 `false` | 禁用文件、终端初始目录和 Git API 路径的允许根目录检查 |
| `PI_CLOUD_ENABLE_SYSTEM_OPEN` | `false` | 允许通过非 localhost URL（例如本地 nginx 主机名）使用**通过系统工具打开** |
| `PI_CLOUD_TERMINAL_SHELL` | Windows 上为 `COMSPEC`/`cmd.exe`；macOS/Linux 上为 `SHELL`/`bash` | 终端 shell 可执行文件，例如 `powershell.exe`、`pwsh.exe` 或 `/bin/zsh` |

通过 `localhost`、`127.0.0.1`、`::1` 和 `*.localhost` 访问时，**通过系统工具打开**会自动可用。若通过自定义反向代理主机名访问同一台本地设备，请设置 `PI_CLOUD_ENABLE_SYSTEM_OPEN=true`。该操作会在运行 Pi Cloud 的设备上启动应用程序，因此仅应在可信的本地部署中启用。更改此设置后请重启服务器。

当 `PI_CLOUD_DISABLE_PATH_CHECK=true` 时，`PI_CLOUD_ALLOWED_ROOTS` 会被忽略。Windows 默认禁用这些检查，以便访问其他磁盘上的路径；如需限制访问，请设置 `PI_CLOUD_DISABLE_PATH_CHECK=false` 并配置 `PI_CLOUD_ALLOWED_ROOTS`。禁用检查后，WebUI 文件系统端点可以访问服务器进程有权限访问的任何路径，因此请仅在可信部署中使用。

常用服务器选项对应的 CLI 参数如下：

```bash
pi-cloud --port 8080
pi-cloud --hostname 0.0.0.0 --no-open
```

## 会话和安全

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_CLOUD_SESSION_TTL_HOURS` | `8` | 会话空闲超时和续期窗口，单位为小时 |
| `PI_CLOUD_SESSION_MAX_HOURS` | `720` | 包括续期在内的最长会话生命周期，单位为小时 |
| `PI_CLOUD_COOKIE_SECURE` | `false` | 将会话 Cookie 限制为仅通过 HTTPS 连接传输 |
| `PI_CLOUD_TRUST_PROXY` | `false` | 信任反向代理发送的 `X-Forwarded-*` 请求头 |
| `SKIP_2FA_VERIFY` | `false` | 紧急情况下绕过双因素验证；正常运行时应保持禁用 |

通过网络开放 Pi Cloud 时，请使用可信反向代理提供 HTTPS，并保持身份验证启用。按照[部署手册](deployment.md#反向代理nginx)配置 HTTPS 反向代理时，请设置 `PI_CLOUD_TRUST_PROXY=true` 和 `PI_CLOUD_COOKIE_SECURE=true`。

## 记忆策略

`PI_CLOUD_MEMORY_POLICY` 控制记忆提取和召回。系统默认启用自适应词法策略。如需临时回退到旧版策略：

```env
PI_CLOUD_MEMORY_POLICY=legacy
```

更改此设置后请重启服务器。

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
PI_CLOUD_TTS_BASE_URL=http://127.0.0.1:8000/v1
PI_CLOUD_TTS_MODEL=mlx-community/Kokoro-82M-bf16
PI_CLOUD_TTS_VOICE=af_heart
PI_CLOUD_TTS_LANGUAGE=zh
PI_CLOUD_TTS_FORMAT=wav
```

只需设置 `PI_CLOUD_TTS_BASE_URL` 即可启用控件。本地服务不需要 API 密钥；如果提供商要求 Bearer 认证，可设置 `PI_CLOUD_TTS_API_KEY`。模型默认使用 Kokoro 82M，声音默认使用 `af_heart`，格式默认使用 WAV。`PI_CLOUD_TTS_LANGUAGE` 可选。修改这些变量后需重启 Pi Cloud。

已完成的助手文本回复会显示播放、停止和重播控件。可在**设置 → 聊天 → 朗读助手回复**中开启自动朗读；Pi Cloud 只会在收到 `agent_end` 完成事件后合成语音，不会对每个流式文本增量调用服务。该偏好默认关闭，避免较长的编程回复意外自动播放。

可使用 Python 3.12 和 `uv pip install "mlx-audio[tts,server]"` 安装本地 MLX Audio 服务，然后通过 `mlx_audio.server --host 127.0.0.1 --port 8000` 启动。使用 WAV 可避免 MLX Audio 的压缩输出格式依赖 `ffmpeg`。

## 提供商和网关变量

`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等提供商 API 密钥是可选的，因为服务器默认使用 Pi 智能体自身的身份验证。

有关提供商特定的变量，请参阅 `.env.example`；有关消息配置，请参阅专门的[飞书](feishu-gateway.md)、[企业微信](wecom-gateway.md)和[微信](weixin-gateway.md)网关手册。
