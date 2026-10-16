# 微信网关手册

本指南介绍如何将微信 iLink 机器人账号连接到 Pi Cloud，以便发送微信消息，并接收 Pi 智能体服务器的回复。

## 网关的工作方式

微信网关使用腾讯 iLink 机器人 API。与飞书网关不同，它不提供公开的 Webhook 回调。Pi Cloud 会启动一个后台轮询器：

1. 从 iLink 轮询新的微信消息。
2. 将每个微信私聊映射到持久化的 Pi 会话。
3. 将消息文本发送给 Pi 智能体。
4. 将智能体的最终回复发送回同一个微信聊天。

每个微信私聊都有独立的 Pi 会话。在微信中发送 `/new` 或 `/reset`，可以为该聊天启动新的 Pi 会话。

## 当前支持情况和限制

目前支持：

- 私聊文本消息。
- 当 iLink 提供内嵌图片数据或可下载的图片 URL，且所选网关模型支持图片输入时，支持私聊图片消息。
- 当 iLink 通过 `voice_item.text` 提供语音识别文本时，支持私聊语音消息。
- 从 Web UI 设置页面扫码配对。
- 复用之前保存的配对凭据。
- 微信聊天与 Pi 会话绑定。
- 每个聊天独立设置配置文件、工作目录和技能集的命令。

暂不支持：

- 微信群聊。由于当前实现中的 iLink 群聊消息传递不可靠，网关暂时会有意忽略群聊。
- 文件、表情和视频。
- iLink 消息体中既没有内嵌图片数据，也没有可下载图片 URL 的图片消息。服务器会记录不支持的媒体项结构，以帮助扩展解析器支持。
- 机器人侧下载和转写音频。语音支持依赖 iLink/微信提供识别后的文本。
- 在一台 Pi Cloud 服务器上使用多个微信机器人账号。

## 1. 配置 Pi Cloud 环境

将以下变量添加到项目的 `.env` 文件：

```env
PI_CLOUD_WECHAT_GATEWAY_ENABLED=true

# 可选的私聊访问策略：
# PI_CLOUD_WECHAT_DM_POLICY=pairing
# PI_CLOUD_WECHAT_ALLOWED_USERS=

# 可选，通常不需要：
# PI_CLOUD_WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
```

注意：

- 必须设置 `PI_CLOUD_WECHAT_GATEWAY_ENABLED=true`。仅完成配对只会保存凭据；只有启用网关后，轮询器才会启动。
- 在**设置 > 网关**中配置允许访问的文件夹、默认网关配置文件、模型和技能集。
- 更改 `.env` 后请重启 Pi Cloud 服务器。

## 2. 配对微信机器人账号

1. 在浏览器中打开 Pi Cloud。
2. 打开**设置**。
3. 找到**微信配对**。
4. 单击**开始扫码配对**。
5. 使用微信扫描二维码。
6. 在手机上确认登录/配对提示。
7. 等待 Web UI 显示配对已确认。

确认后，Pi Cloud 会将 iLink 账号凭据保存到本地数据库中。通常无需手动设置 `PI_CLOUD_WECHAT_ACCOUNT_ID` 或 `PI_CLOUD_WECHAT_TOKEN`。

如果已有其他可用配置中的凭据，也可以显式提供：

```env
PI_CLOUD_WECHAT_ACCOUNT_ID=your-ilink-bot-account-id
PI_CLOUD_WECHAT_TOKEN=your-ilink-bot-token
PI_CLOUD_WECHAT_BASE_URL=https://ilinkai.weixin.qq.com
```

环境变量的优先级高于已保存的配对凭据。

## 3. 开始使用机器人

服务器重启且网关启用后：

1. 向已配对的微信机器人账号发送私聊文本消息。
2. 服务器会为该微信聊天创建或恢复 Pi 会话。
3. Pi 智能体完成处理后，机器人会发送回复。

当微信/iLink 在 `voice_item.text` 中包含语音识别文本时，也支持语音消息。在这种情况下，Pi Cloud 会像处理输入的文本消息一样，将识别出的文本发送给智能体。

## 命令

在微信聊天中发送以下命令：

```text
/status
/help
/profiles
/profile <profile-id>
/cwds
/cwd [number]
/skillsets
/skillset <all|preset-name>
/reset
/new
/clear-config
```

注意：

- `/status` 显示当前微信聊天的配置文件、工作目录、配置文件默认模型、技能集和会话状态。
- `/profiles`、`/cwds` 和 `/skillsets` 列出当前配置中的有效选项。
- `/profile`、`/cwd` 和 `/skillset` 会持久保存该微信聊天的设置，并启动新的 Pi 会话。
- `/skillset all` 使用所有可用技能。`least`、`least-skills`、`debug` 等其他技能集是在 Web 中配置的技能预设。
- `/clear-config` 删除该聊天的覆盖设置，并恢复 `PI_CLOUD_WECHAT_*` 环境变量中的默认值。
- `/new` 和 `/reset` 会释放该微信聊天当前的内存中 Pi 会话，并将下一条消息绑定到新的 Pi 会话。

## 执行控制和任务查询

```text
/stop                         # 别名 /abort
/status
/task list
/task status <编号或唯一标题>
/task result <编号或唯一标题>
/task stop <编号或唯一标题>
```

- 这些 slash 控制命令不进入普通消息队列，当前对话执行中也能使用。`/status` 增加执行中/停止中/空闲、已用秒数、排队消息数。
- `/stop` 请求中断当前对话，取消此前排队的消息，保留历史，不影响独立任务。停止是协作式请求，外部工具或不响应取消的模型不保证立即终止；后续普通消息会等待当前执行真正结束。
- `/task list` 列出当前允许项目的所有任务及状态；自然语言“列出未开始的任务”仍只列待办。编号始终对应本聊天最近一次任务列表，重新列出会更新编号，服务重启后须重新列出。标题支持无歧义的部分匹配。
- `/task status` 区分任务持久化状态与实时执行状态。`started` 不代表仍在运行或执行成功，执行结束也不会自动标记任务为 `completed`。
- `/task result` 返回会话最近一条助手文本，不包含 thinking 或工具输出；长内容截断，可凭返回的会话 ID 在 WebUI 查看完整记录。重启后仍可读取持久化会话，但不会恢复执行或猜测执行成功。
- `/task stop` 只停止当前服务中由网关启动的任务；WebUI 或自动队列执行须到对应入口停止。重复请求安全，不删除记录、不标记完成；启动准备中的任务请稍后重试。
- 支持“小助理，查看任务 2 的状态 / 结果”和“小助理，停止任务 <标题>”。自然语言指令仍会排队，执行中需要即时控制请使用上面的 slash 命令。

## 自然语言管理指令

以“小助理”开头发送文本或现有语音转写指令，例如“小助理，帮我开一个新对话”“小助理，我现在在哪个项目？”或“小助理，把工作目录切到 pi-cloud”。可通过 `PI_CLOUD_GATEWAY_COMMAND_PREFIX` 修改前缀。

- 支持新建对话、查询状态、查看帮助、切换允许的工作目录、Profile 和技能集。每条消息只处理一个操作；切换配置会沿用现有逻辑重置会话。
- 使用网关配置的模型；未指定时使用当前 Profile 的默认模型（未设置默认模型时使用第一个可用模型）。这会产生独立的模型调用费用，不写入聊天历史，也不会给解析模型提供工具。
- 参数必须来自已配置的选项。指令有歧义、不支持或包含多个操作时不执行；请以指令前缀开头重新发送完整指令，不要只回复选项名称。
- 模型出错或超时时不执行，也不会转为普通聊天。原有 `/命令` 不经过模型，其他消息仍作为普通聊天。语音转写能力不变。

## 私聊访问策略

`PI_CLOUD_WECHAT_DM_POLICY` 控制哪些用户可以与机器人聊天：

| 值 | 行为 |
|---|---|
| `pairing` | 默认值。接受扫描配对二维码的微信用户以及 `PI_CLOUD_WECHAT_ALLOWED_USERS` 中列出的用户。其他发送者的消息会被忽略，并在日志中记录其发送者 ID。 |
| `allowlist` | 仅接受 `PI_CLOUD_WECHAT_ALLOWED_USERS` 中列出的用户。 |
| `open` | 只有同时设置 `PI_CLOUD_WECHAT_ALLOW_ALL_USERS=true` 或 `GATEWAY_ALLOW_ALL_USERS=true` 时，才接受所有用户。 |
| `disabled` | 忽略所有私聊消息。 |

白名单模式配置示例：

```env
PI_CLOUD_WECHAT_DM_POLICY=allowlist
PI_CLOUD_WECHAT_ALLOWED_USERS=user-id-1,user-id-2
```

网关用户可以在 Pi Cloud 主机上运行 coding agent 的工具。如需授权其他用户，请在服务器日志 `ignored direct message from unauthorized sender` 中找到其发送者 ID，并加入 `PI_CLOUD_WECHAT_ALLOWED_USERS`。如果凭据来自 `PI_CLOUD_WECHAT_ACCOUNT_ID`/`PI_CLOUD_WECHAT_TOKEN`，系统无法识别配对用户，请显式列出所有允许的发送者。

## 网络说明

网关会向以下地址发出请求：

```text
https://ilinkai.weixin.qq.com
```

无需公开的入站 URL。

如果服务器无法连接 iLink，请检查代理环境变量是否影响服务器进程。对于微信/iLink，建议使用直连，或为服务器环境设置适当的 `NO_PROXY`/代理配置。

## 故障排除

### 设置页面显示已配对，但微信提示“暂无法连接”

检查服务器日志中是否存在 `[weixin-gateway]` 错误。正常启动时应包含类似以下日志：

```text
[weixin-gateway] started
```

常见原因：

- `PI_CLOUD_WECHAT_GATEWAY_ENABLED` 未设置为 `true`。
- 更改 `.env` 后未重启服务器。
- 保存的配对凭据已失效；请从设置页面重新配对。
- 服务器无法访问 `https://ilinkai.weixin.qq.com`。
- 代理设置导致 iLink 请求失败。

### 轮询因 `invalid content-length header` 失败

请使用允许 `fetch` 为 iLink POST 请求计算 `Content-Length` 的版本。手动设置 `content-length` 可能导致 `undici/fetch` 在发送请求前拒绝该请求。

### 文本消息可用，但语音消息不可用

语音支持依赖微信/iLink 在 `voice_item.text` 中返回识别文本。

检查服务器日志中是否出现：

```text
[weixin-gateway] unsupported inbound message
```

如果日志中的 `voice_item` 包含 `text` 字段，但值为空，说明微信/iLink 没有为该语音消息提供转写。Pi Cloud 目前不会自行下载音频和执行 ASR。

### 机器人收到消息但不回复

检查服务器日志中是否存在 `[weixin-gateway] message handling failed` 或 `sendmessage failed`。常见原因包括：

- Pi 智能体配置文件或其默认模型无效。
- 未配置允许网关访问的文件夹，或所选文件夹不存在或无法访问。
- 耗时较长的工具调用延迟了智能体回复。
- iLink Token 已过期或被撤销；请重新配对。

### 命令已更改配置文件或 cwd，但仍保留旧上下文

更改聊天配置的命令会重置映射的 Pi 会话。如果行为看起来仍未更新，请发送：

```text
/reset
```

然后发送下一条普通消息。

## 安全说明

- 不要提交 `.env`，其中可能包含网关凭据。
- 保存的微信配对凭据存储在本地 Pi Cloud 数据库中。
- 默认 `pairing` 策略只接受配对用户和白名单用户；如需仅允许白名单用户，请使用 `PI_CLOUD_WECHAT_DM_POLICY=allowlist`。
