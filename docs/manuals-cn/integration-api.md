# AI 会话集成 API

[文档目录](../README.md) | [English](../manuals-en/integration-api.md)

此服务端间 API 可在新 Pi Cloud 会话中提问，或继续已有对话。会话使用所选 Agent 配置的模型凭据、技能、扩展、记忆及已配置的 MCP 工具。

## API 令牌

在 **设置 → 安全 → API 令牌** 中创建带名称和过期时间的令牌。需要输入账户密码；启用 TOTP 时还需输入验证码。请立即复制令牌：完整密钥只显示一次。可在同一面板查看过期时间、最后使用时间并撤销令牌。

每次集成请求均发送 `Authorization: Bearer pic_pat_…`。令牌仅应保存在应用服务端，不能放在前端代码、URL、日志或仓库中。远程访问请使用 HTTPS。Pi Cloud 无需新增环境变量。

令牌仅以哈希形式存储，且只能调用下列集成端点，不能管理账户、创建其他令牌、调用文件系统 REST API 或连接 WebSocket，即使同时提供浏览器 Cookie 也不行。更改配置中的账户用户名、密码或恢复绕过设置会使现有令牌失效。浏览器退出登录不会撤销令牌。过期和撤销会阻止新请求，但不会停止已经接受的运行。

**令牌可使用账户的智能体工具，包括 shell 和 MCP 操作；它不是文件系统沙箱或只读凭据。请仅向可信应用提供令牌。** 工作目录必须通过 Pi Cloud 现有的允许根目录检查，但此检查不会将智能体工具沙箱化。

## 端点

| 方法 | 端点 | 用途 |
| --- | --- | --- |
| GET | `/api/integration/profiles` | 列出 Agent 配置 ID 和默认模型 |
| GET | `/api/integration/profiles/:profileId/models` | 列出指定配置的可用模型 |
| POST | `/api/integration/sessions` | 创建持久化会话并提出第一个问题 |
| POST | `/api/integration/sessions/:id/messages` | 在已有会话中继续提问 |
| GET | `/api/integration/sessions/:id?agentProfileId=default` | 获取状态及最后一条助手回答 |

两个 POST 端点均接受 `prompt`（必填，非空白，最多 200,000 字符）、`agentProfileId`（默认为 `default`）和 `stream`（默认为 `false`）。创建端点还接受 `cwd`（现有目录，默认为 Pi Cloud 的工作目录）及可选的 `modelProvider`/`modelId` 参数对。后续问题沿用会话已有模型和上下文。

应用应保存 **`sessionId` 和 `agentProfileId` 两者**，后续请求继续发送配置 ID。会话 ID 仅在对应配置中解析，不接受调用方指定的会话文件路径。已有持久化历史的会话可在 Pi Cloud 重启后恢复，包括最初在 WebUI 中创建的会话。尚无持久化回答的空 WebUI 会话不能通过此 API 访问。

### 查询可用模型

从 `/api/integration/profiles` 选择配置 ID，再查询该配置的可用模型：

```bash
curl "$PI_CLOUD_URL/api/integration/profiles/default/models" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN"
```

响应为 `{ "models": [...] }`。每个模型包含 `provider`、`id`、`name`、`contextWindow`、`reasoning`、`input` 和 `current`（是否为该配置的默认模型）。可用性依据该配置的凭据和提供商设置确定，不返回凭据。未知配置返回 `400`；没有可用模型时返回空列表。

创建会话时，将返回的 `provider` 和 `id` 分别作为 `modelProvider` 和 `modelId` 发送。省略两者则使用配置的默认模型。后续提问沿用会话的模型。

### 创建会话并提问

例如，在集成应用的服务端环境中设置 `PI_CLOUD_URL` 和 `PI_CLOUD_TOKEN`（它们是示例客户端配置名称，不是 Pi Cloud 服务端设置）：

```bash
curl "$PI_CLOUD_URL/api/integration/sessions" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"cwd":"/path/to/notes-project","agentProfileId":"default","prompt":"解释这篇笔记：..."}'
```

成功的 JSON 响应格式如下：

```json
{
  "sessionId": "019...",
  "agentProfileId": "default",
  "model": { "provider": "openai", "id": "configured-model" },
  "isStreaming": false,
  "answer": "助手最终回答的文本"
}
```

HTTP 请求会等待整个智能体运行结束，包括工具调用和自动恢复。`answer` 仅包含最后一条助手消息的文本，不含思考或工具结果载荷。未产生助手消息的扩展命令会返回空回答。

### 追问及通过 MCP 更新笔记

```bash
curl "$PI_CLOUD_URL/api/integration/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agentProfileId":"default","prompt":"这里是补充笔记：... 请使用 yuque-mcp 将修订后的解释更新到文档 <document-id>。"}'
```

提前在所选 Pi Cloud 配置/项目中配置 `yuque-mcp` 并允许所需工具。API 沿用普通会话的 MCP 配置，不接受通过提示传递 MCP 服务凭据，也不动态配置服务器。请明确提供目标笔记/文档 ID。应用可将一篇笔记或一个问题关联到返回的会话/配置组合。

## 流式响应

在任一 POST 中设置 `"stream": true`，以 **Server-Sent Events（SSE）** 读取响应。使用 `fetch` 或 HTTP 流式客户端，不要使用浏览器 `EventSource`（它无法携带 Bearer 请求头进行 POST）。

```bash
curl -N "$PI_CLOUD_URL/api/integration/sessions/$SESSION_ID/messages" \
  -H "Authorization: Bearer $PI_CLOUD_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"agentProfileId":"default","prompt":"进一步展开解释","stream":true}'
```

每个事件包含 `event: <名称>` 和 `data: <JSON>`，以空行结束：

- `session`：会话、配置和模型元数据；请立即保存会话 ID。
- `text_delta`：`{ "delta": "..." }`，助手文本增量。
- `tool_start`：`{ "toolCallId": "...", "toolName": "..." }`。
- `tool_end`：上述字段加 `isError`。
- `ping`：运行期间每 15 秒发送一次保活事件。
- `done`：上文所示的完整最终 JSON 响应。
- `error`：`{ "sessionId": "...", "error": "...", "statusCode": 502 }`（状态码可能不同）；终止错误，不再发送 `done`。

流式文本可能包含工具调用前的中间消息或重试输出。应以 `done.answer` 为最终回答，而不是直接保存全部增量。流开始前的验证或认证错误使用普通 HTTP JSON 错误；发送响应头后的错误使用 SSE `error` 事件，HTTP 状态仍为 200。

## 错误和生命周期

- `400`：无效请求或未知配置。
- `401`：未认证，或令牌无效、过期、已撤销。
- `403`：令牌权限不允许该操作、浏览器来源被拒绝，或工作目录超出允许根目录。
- `404`：所选配置中不存在该会话。
- `409`：其他集成请求或 WebUI 已在运行此会话；不会自动排队。
- `502`：智能体/模型运行失败。若会话创建成功，响应会包含会话 ID；若首次运行在持久化前失败，历史可能尚不存在。

断开 JSON 或 SSE 提问请求会中止其活动运行，但**不会撤销已经执行的工具操作**。可通过 GET 重新查看最后的回答和状态；请求不具有幂等性，请勿盲目重试会写入笔记的提示。空闲会话将在正常清理间隔后从内存释放，持久化历史仍可恢复。请为长时间工具运行调整反向代理和客户端超时，并关闭 SSE 代理缓冲（API 也会发送 `X-Accel-Buffering: no`）。
