# 企业微信网关

企业微信网关通过自建应用将 Pi Cloud 接入企业成员。当前版本支持文本消息和斜杠命令；图片支持计划在后续版本提供。

## 配置步骤

1. 在企业微信管理后台创建自建应用，并记录企业 ID（Corp ID）、应用 Agent ID 和 Secret。
2. 在 Pi Cloud 中打开 **设置 > 网关 > 企业微信自建应用**，填写上述信息；也可以填写用英文逗号分隔的成员 User ID 白名单。
3. 点击 **保存并生成回调配置**，复制页面显示的回调 URL、Token 和 EncodingAESKey。
4. 在自建应用的消息回调设置中粘贴这三个值并保存。企业微信完成验证或推送回调后，Pi Cloud 状态会变为 **回调已验证**。
5. 如果企业微信要求可信 IP，请将 Pi Cloud 的出口服务器 IP 加入应用可信 IP 列表，然后点击 **测试连接**。

Pi Cloud 必须能通过公网 HTTPS 被企业微信访问。回调端点是 `/api/gateways/wecom/callback`；Pi Cloud 会先校验签名并进行 AES 解密，再处理消息。成员白名单留空时，所有有权使用该应用的成员都可以访问。

网关使用 **网关默认值** 中配置的 Agent 配置、模型、技能组和允许的文件夹。在企业微信中发送 `/help` 可以查看 `/new`、`/status`、`/profile`、`/cwd` 和 `/skillset` 等命令。

## 环境变量托管

推荐使用 UI 配置。对于集中管理的部署，可以设置 `PI_CLOUD_WECOM_CORP_ID`、`PI_CLOUD_WECOM_CORP_SECRET`、`PI_CLOUD_WECOM_AGENT_ID`、`PI_CLOUD_WECOM_CALLBACK_TOKEN`、`PI_CLOUD_WECOM_ENCODING_AES_KEY`，以及可选的 `PI_CLOUD_WECOM_ALLOWED_USERS`。环境变量会覆盖 UI 中保存的配置，并使设置页面变为只读。具体格式见 `.env.example`。

应用 Secret、回调 Token 和 EncodingAESKey 都属于敏感凭据，请限制对 Pi Cloud 数据库和环境变量文件的访问。
