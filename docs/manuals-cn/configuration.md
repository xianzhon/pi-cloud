# 配置

Pi WebUI 从 shell 环境变量和 `.env` 文件中读取配置，shell 变量的优先级更高。源码部署可以使用项目根目录下的 `.env`；全局安装默认使用 `~/.config/pi-webui/.env`。设置 `XDG_CONFIG_HOME` 可以更改用户配置目录。

全局安装后首次运行时，Pi WebUI 会将完整的示例配置复制到用户配置文件中，把示例凭据替换为用户名 `admin` 和随机密码，并在终端中显示这些凭据。已有的用户配置文件不会被覆盖。

## 身份验证

| 变量 | 必需 | 说明 |
|---|---|---|
| `PI_WEBUI_AUTH_USERNAME` | 是 | 登录用户名 |
| `PI_WEBUI_AUTH_PASSWORD` | 是* | 用于开发或简单部署的明文登录密码 |
| `PI_WEBUI_AUTH_PASSWORD_HASH` | 是* | scrypt 密码哈希，推荐用于生产环境 |

\* `PI_WEBUI_AUTH_PASSWORD` 和 `PI_WEBUI_AUTH_PASSWORD_HASH` 必须且只能提供其中一个。有关生成和配置生产环境密码哈希的方法，请参阅[部署手册](deployment.md#安全地存储密码)。

## 服务器和存储

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 后端端口 |
| `FRONTEND_PORT` | `5173` | 前端开发服务器端口 |
| `HOST` | `127.0.0.1` | 后端绑定地址 |
| `PI_WEBUI_DB_PATH` | 用户配置目录 | 自定义 SQLite 数据库路径 |
| `PI_WEBUI_ALLOWED_ROOTS` | 用户主目录 | 文件浏览器和终端可以访问的目录，以逗号分隔 |
| `PI_WEBUI_DISABLE_PATH_CHECK` | Windows 上为 `true`；macOS/Linux 上为 `false` | 禁用文件、终端初始目录和 Git API 路径的允许根目录检查 |
| `PI_WEBUI_TERMINAL_SHELL` | Windows 上为 `COMSPEC`/`cmd.exe`；macOS/Linux 上为 `SHELL`/`bash` | 终端 shell 可执行文件，例如 `powershell.exe`、`pwsh.exe` 或 `/bin/zsh` |

当 `PI_WEBUI_DISABLE_PATH_CHECK=true` 时，`PI_WEBUI_ALLOWED_ROOTS` 会被忽略。Windows 默认禁用这些检查，以便访问其他磁盘上的路径；如需限制访问，请设置 `PI_WEBUI_DISABLE_PATH_CHECK=false` 并配置 `PI_WEBUI_ALLOWED_ROOTS`。禁用检查后，WebUI 文件系统端点可以访问服务器进程有权限访问的任何路径，因此请仅在可信部署中使用。

常用服务器选项对应的 CLI 参数如下：

```bash
pi-webui --port 8080
pi-webui --hostname 0.0.0.0 --no-open
```

## 会话和安全

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PI_WEBUI_SESSION_TTL_HOURS` | `8` | 会话空闲超时和续期窗口，单位为小时 |
| `PI_WEBUI_SESSION_MAX_HOURS` | `720` | 包括续期在内的最长会话生命周期，单位为小时 |
| `PI_WEBUI_COOKIE_SECURE` | `false` | 将会话 Cookie 限制为仅通过 HTTPS 连接传输 |
| `PI_WEBUI_TRUST_PROXY` | `false` | 信任反向代理发送的 `X-Forwarded-*` 请求头 |
| `SKIP_2FA_VERIFY` | `false` | 紧急情况下绕过双因素验证；正常运行时应保持禁用 |

通过网络开放 Pi WebUI 时，请使用可信反向代理提供 HTTPS，并保持身份验证启用。按照[部署手册](deployment.md#反向代理nginx)配置 HTTPS 反向代理时，请设置 `PI_WEBUI_TRUST_PROXY=true` 和 `PI_WEBUI_COOKIE_SECURE=true`。

## 记忆策略

`PI_WEBUI_MEMORY_POLICY` 控制记忆提取和召回。系统默认启用自适应词法策略。如需临时回退到旧版策略：

```env
PI_WEBUI_MEMORY_POLICY=legacy
```

更改此设置后请重启服务器。

## 智能体代理配置

可以在 WebUI 的配置文件设置中为每个智能体配置文件设置代理。这些设置存储在 Pi WebUI 的 SQLite 数据库中，并且仅应用于智能体和模型请求；内嵌终端不受影响。更改会在智能体下次执行操作时生效，无需重启。

## 提供商和网关变量

`ANTHROPIC_API_KEY`、`OPENAI_API_KEY` 等提供商 API 密钥是可选的，因为服务器默认使用 Pi 智能体自身的身份验证。

有关提供商特定的变量，请参阅 `.env.example`；有关消息配置，请参阅专门的[飞书](feishu-gateway.md)和[微信](weixin-gateway.md)网关手册。
