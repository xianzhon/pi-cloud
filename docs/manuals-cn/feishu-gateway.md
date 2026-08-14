# 飞书/Lark 机器人网关手册

本指南介绍如何将飞书/Lark 机器人连接到 Pi WebUI，以便在飞书中发送消息，并接收 Pi 智能体服务器的回复。

## 网关的工作方式

飞书网关提供一个回调端点：

```text
POST /api/gateways/feishu/events
```

当飞书向此端点发送文本消息事件时，Pi WebUI 会：

1. 解析飞书消息。
2. 将飞书聊天映射到持久化的 Pi 会话。
3. 将文本发送给 Pi 智能体。
4. 使用智能体的最终回复答复原始飞书消息。

每个飞书聊天都有独立的 Pi 会话。在飞书中发送 `/new` 或 `/reset`，可以为该聊天启动新的 Pi 会话。

## 当前 MVP 的限制

目前支持：

- 文本消息
- 飞书 URL 验证回调
- 可选的 verification token 检查
- 飞书聊天与 Pi 会话绑定
- `/new` 和 `/reset`

暂不支持：

- 飞书长连接回调模式
- 图片、文件、音频或视频
- 音频转写。飞书音频消息接收事件目前只提供 `duration`、`file_key` 等音频元数据，不包含客户端语音转文字结果。
- 交互式卡片
- 群聊中的用户白名单

## 1. 配置 Pi WebUI 环境

将以下变量添加到项目的 `.env` 文件：

```env
PI_WEBUI_FEISHU_APP_ID=cli_xxx
PI_WEBUI_FEISHU_APP_SECRET=your-app-secret
PI_WEBUI_FEISHU_DOMAIN=feishu
# 可选，仅在飞书事件订阅安全设置中配置后才需要：
# PI_WEBUI_FEISHU_VERIFICATION_TOKEN=your-verification-token
# 如果启用了飞书加密策略，则为必填：
# PI_WEBUI_FEISHU_ENCRYPT_KEY=your-encrypt-key
```

注意：

- 中国区飞书使用 `PI_WEBUI_FEISHU_DOMAIN=feishu`。
- 国际版 Lark 使用 `PI_WEBUI_FEISHU_DOMAIN=lark`。
- 在**设置 > 网关**中配置允许访问的文件夹、默认网关配置文件、模型和技能集。
- 更改 `.env` 后请重启 Pi WebUI 服务器。

## 2. 让飞书能够访问回调 URL

飞书必须能够从公网访问 Pi WebUI 服务器。

如果后端运行在端口 `3200`，回调 URL 应类似：

```text
https://your-public-domain/api/gateways/feishu/events
```

仅限本地测试时，可以使用 ngrok、Cloudflare Tunnel 或带 HTTPS 的反向代理将后端公开。

如果使用 nginx，请将该路径代理到后端服务器，例如：

```nginx
location /api/gateways/feishu/events {
    proxy_pass http://127.0.0.1:3200;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 3. 配置飞书应用

在飞书开发者控制台中：

1. 打开你的应用。
2. 确认已启用机器人能力。
3. 将机器人添加到目标聊天，或允许用户直接向机器人发送消息。
4. 进入事件订阅设置。
5. 订阅方式选择**将事件发送至开发者服务器**。当前 Pi WebUI 网关使用飞书 HTTP 回调模式，而不是**使用长连接接收事件**。
6. 将请求地址设置为：

   ```text
   https://your-public-domain/api/gateways/feishu/events
   ```

7. 订阅接收消息事件：

   ```text
   im.message.receive_v1
   ```

8. 如果在飞书中配置了 Verification Token，请在环境中设置相同的值：

   ```env
   PI_WEBUI_FEISHU_VERIFICATION_TOKEN=...
   ```

9. 如果启用了飞书加密策略，请设置 Encrypt Key：

   ```env
   PI_WEBUI_FEISHU_ENCRYPT_KEY=...
   ```

10. 保存事件订阅。飞书应调用 URL 验证端点，并收到预期的 `challenge` 响应。

## 4. 所需的飞书权限

应用需要以下权限：

- 接收消息/事件
- 发送消息或回复消息

不同版本的飞书/Lark 控制台中，具体权限名称可能不同。请搜索 IM 消息接收、发送或回复相关权限；如飞书有要求，请发布应用的权限变更。

## 5. 使用机器人

服务器重启且飞书事件订阅生效后：

1. 向飞书机器人发送私聊消息，或在已安装机器人的聊天中提及它。
2. 服务器会为该飞书聊天创建或恢复 Pi 会话。
3. Pi 智能体完成处理后，机器人会发送回复。

命令：

```text
/status
/help
/profiles
/profile <profile-id>
/cwd [absolute-path]
/skillsets
/skillset <all|preset-name>
/reset
/new
/clear-config
```

注意：

- `/status` 显示当前飞书聊天的配置文件、工作目录、配置文件默认模型、技能集和会话状态。
- `/profiles` 和 `/skillsets` 列出当前配置中的有效选项。
- `/profile`、`/cwd` 和 `/skillset` 会持久保存该飞书聊天/话题的设置，并启动新的 Pi 会话。
- `/skillset all` 使用所有可用技能。`least`、`debug` 等其他技能集是在 Web 中配置的技能预设。
- `/clear-config` 删除该聊天的覆盖设置，并恢复 `PI_WEBUI_FEISHU_*` 环境变量中的默认值。
- `/new` 和 `/reset` 会释放该飞书聊天当前的内存中 Pi 会话，并将下一条消息绑定到新的 Pi 会话。

## 故障排除

### 飞书 URL 验证失败

请检查：

- 公网 URL 使用 HTTPS，并且飞书可以访问。
- 后端服务器正在运行。
- 反向代理已将 `POST /api/gateways/feishu/events` 转发到后端。
- 如果配置了 Token，`PI_WEBUI_FEISHU_VERIFICATION_TOKEN` 与飞书中的值一致。
- 如果启用了加密回调，`PI_WEBUI_FEISHU_ENCRYPT_KEY` 与飞书中的值一致。

### 机器人收到音频消息但不处理

目前不支持音频消息。服务器日志可能会显示类似以下内容的不支持入站消息：

```text
[feishu-gateway] unsupported inbound message ... messageType: 'audio' ... contentKeys: [ 'duration', 'file_key' ]
```

这表示飞书提供了音频元数据，但没有语音转文字结果。若要支持音频，需要通过 `file_key` 下载音频，并在将文本发送给 Pi 前执行单独的转写/ASR 步骤。

### 机器人收到消息但不回复

检查服务器日志中是否存在 `[feishu-gateway]` 错误。常见原因包括：

- 缺少飞书发送/回复消息权限。
- `PI_WEBUI_FEISHU_APP_ID` 或 `PI_WEBUI_FEISHU_APP_SECRET` 无效。
- Pi 智能体配置文件或 Web 中配置的默认模型无效。
- 未配置允许网关访问的文件夹，或所选文件夹不存在或无法访问。

### 消息处理时间很长

在**将事件发送至开发者服务器**模式下，回调会快速确认飞书事件，但机器人只有在 Pi 智能体完成后才会回复。耗时较长的工具调用会延迟飞书回复。

### 已有 Hermes 飞书机器人凭据

如果已有可用的 Hermes 飞书机器人，可以复制以下设置以复用相同的飞书应用凭据：

```text
FEISHU_APP_ID      -> PI_WEBUI_FEISHU_APP_ID
FEISHU_APP_SECRET  -> PI_WEBUI_FEISHU_APP_SECRET
FEISHU_DOMAIN      -> PI_WEBUI_FEISHU_DOMAIN
```

不要提交 `.env`，因为其中包含密钥。
