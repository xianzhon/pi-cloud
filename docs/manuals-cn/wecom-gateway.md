# 企业微信网关

企业微信网关通过自建应用将 Pi Cloud 接入企业成员。当前版本支持文本消息、图片消息、语音消息和斜杠命令。语音消息需要先配置 Pi Cloud 的语音转文本服务。

## 配置步骤

1. 打开[企业微信管理后台](https://work.weixin.qq.com/wework_admin/frame#apps)，创建或选择一个自建应用，并记录企业 ID（Corp ID）、应用 Agent ID 和 Secret。
2. 在 Pi Cloud 中打开 **设置 > 网关 > 企业微信自建应用**，填写上述信息；也可以填写用英文逗号分隔的成员 User ID 白名单。
3. 点击 **保存并生成回调配置**，复制页面显示的回调 URL、Token 和 EncodingAESKey。
4. 在自建应用管理页面中，进入 **功能 > 接收消息 > 设置 API 接收**，粘贴这三个回调配置值并保存。企业微信完成验证或推送回调后，Pi Cloud 状态会变为 **回调已验证**。
5. 如果企业微信要求可信 IP，请将 Pi Cloud 的出口服务器 IP 加入应用可信 IP 列表，然后点击 **测试连接**。

Pi Cloud 必须能通过公网 HTTPS 被企业微信访问。回调端点是 `/api/gateways/wecom/callback`；Pi Cloud 会先校验签名并进行 AES 解密，再处理消息。成员白名单留空时，所有有权使用该应用的成员都可以访问。

网关使用 **网关默认值** 中配置的 Agent 配置、模型、技能组和允许的文件夹。在企业微信中发送 `/help` 可以查看 `/new`、`/status`、`/profile`、`/cwd` 和 `/skillset` 等命令。

收到语音消息后，Pi Cloud 会从企业微信下载 AMR 媒体，将其发送到已配置的 OpenAI 兼容语音转文本端点，并且只把转写结果发送给 coding agent。请按照[配置说明](configuration.md#语音输入)设置 `PI_CLOUD_STT_*` 环境变量。如果转写服务不可用或转写失败，网关会返回错误提示，而不会发送空白消息。

## 环境变量托管

推荐使用 UI 配置。对于集中管理的部署，可以设置 `PI_CLOUD_WECOM_CORP_ID`、`PI_CLOUD_WECOM_CORP_SECRET`、`PI_CLOUD_WECOM_AGENT_ID`、`PI_CLOUD_WECOM_CALLBACK_TOKEN`、`PI_CLOUD_WECOM_ENCODING_AES_KEY`，以及可选的 `PI_CLOUD_WECOM_ALLOWED_USERS`。环境变量会覆盖 UI 中保存的配置，并使设置页面变为只读。具体格式见 `.env.example`。

应用 Secret、回调 Token 和 EncodingAESKey 都属于敏感凭据，请限制对 Pi Cloud 数据库和环境变量文件的访问。
