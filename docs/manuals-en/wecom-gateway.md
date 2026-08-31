# WeCom Gateway

The WeCom gateway connects Pi Cloud to organization members through a self-built WeCom application. This version supports text messages, image messages, and slash commands. WeCom does not include accompanying text with voice messages, so Pi Cloud does not currently support voice messages.

## Setup

1. Open the [WeCom administration console](https://work.weixin.qq.com/wework_admin/frame#apps), create or select a self-built application, and note its Corp ID, Agent ID, and Secret.
2. In Pi Cloud, open **Settings > Gateway > WeCom self-built app**. Enter those values and, optionally, a comma-separated allowlist of member User IDs.
3. Select **Save and generate callback**. Copy the displayed callback URL, Token, and EncodingAESKey.
4. In the application's administration page, open **Features (功能) > Receive Messages (接收消息) > Set API Receiving (设置 API 接收)**. Paste all three callback values and save. The Pi Cloud status changes to **Callback verified** after WeCom verifies or delivers a callback.
5. Add Pi Cloud's outbound server IP to the application's trusted IP list if WeCom requires it, then use **Test connection**.

Pi Cloud must be reachable from WeCom over public HTTPS. The callback endpoint is `/api/gateways/wecom/callback`. Callback requests are signature-checked and AES-decrypted before processing. An empty member allowlist permits every member who can access the application.

The gateway uses the profile, model, skillset, and allowed folders configured under **Gateway defaults**. In WeCom, send `/help` to list commands such as `/new`, `/status`, `/profile`, `/cwd`, and `/skillset`.

## Environment-managed setup

The UI setup is recommended. For managed deployments, configure `PI_CLOUD_WECOM_CORP_ID`, `PI_CLOUD_WECOM_CORP_SECRET`, `PI_CLOUD_WECOM_AGENT_ID`, `PI_CLOUD_WECOM_CALLBACK_TOKEN`, `PI_CLOUD_WECOM_ENCODING_AES_KEY`, and optionally `PI_CLOUD_WECOM_ALLOWED_USERS`. Environment values override saved UI configuration and make the connection read-only in Settings. See `.env.example` for the exact format.

Treat the application Secret, callback Token, and EncodingAESKey as credentials. Restrict access to the Pi Cloud database and environment files.
