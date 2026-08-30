# 部署

本指南介绍如何从源码或 npm 软件包部署 Pi Cloud、访问远程实例，以及配置 nginx 反向代理。

## 方案一：从源码部署

服务器需要安装 Node.js、pnpm 和 Pi 智能体。启动 Pi Cloud 后，可以在智能体配置文件对话框中完成身份验证。

```bash
git clone <repo-url> && cd pi-cloud
cp .env.example .env
# TODO：编辑 .env 并设置身份验证凭据

pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production PORT=3000 pnpm start:prod
```

应用将在 http://localhost:3000 提供服务（包括前端和后端）。

## 方案二：使用 npm 软件包

在开发机器上构建 npm 软件包，然后上传生成的压缩包：

```bash
make package               # 运行 npm pack 并生成 pi-cloud-<version>.tgz
scp pi-cloud-*.tgz user@server:~/release/
```

在远程服务器上，通过文件路径安装压缩包：

```bash
cd ~/release
npm install -g ./pi-cloud-<version>.tgz
pi-cloud
```

在原生 Windows 上，请从 PowerShell（而不是 WSL）运行对应命令：

```powershell
npm install -g .\pi-cloud-<version>.tgz
pi-cloud
```

内嵌终端使用平台专用预构建软件包（包括 Windows x64 和 ARM64），因此不会调用 `node-gyp`。请勿使用 `--omit=optional`，因为 npm 通过可选的平台依赖选择终端二进制文件。

按照[配置手册](configuration.md)设置凭据。必须提供压缩包路径（Unix 使用 `./...`，Windows 使用 `.\...`）；否则 npm 可能会尝试安装当前目录。

## 安全地存储密码

生产环境中，请存储 scrypt 哈希，而不是明文密码。使用 Node.js 生成哈希；此命令仅使用内置的 `node:crypto` 模块：

```bash
node -e 'const { randomBytes, scryptSync } = require("node:crypto"); const s = randomBytes(16); const k = scryptSync(process.argv[1], s, 32, { N: 2**15, r: 8, p: 3, maxmem: 64*1024**2 }); console.log(`$scrypt$ln=15,r=8,p=3$${s.toString("base64")}$${k.toString("base64")}`)' 'change-this-password'
```

使用生成的哈希替换密码设置，并删除 `PI_CLOUD_AUTH_PASSWORD`：

```dotenv
PI_CLOUD_AUTH_USERNAME=admin
PI_CLOUD_AUTH_PASSWORD_HASH=$scrypt$ln=15,r=8,p=3$...
```

确保配置文件仅文件所有者可读：

```bash
chmod 600 ~/.config/pi-cloud/.env
```

`PI_CLOUD_AUTH_PASSWORD` 和 `PI_CLOUD_AUTH_PASSWORD_HASH` 只能提供其中一个。生产环境推荐使用哈希，因为磁盘上不会存储明文密码。为方便使用，首次运行时自动生成的配置采用随机明文密码；部署到生产环境前请将其替换为哈希。

## 系统服务

全局安装后，可以通过 Linux 的 systemd 用户服务、macOS 的 LaunchAgent 或 Windows 任务计划程序将 Pi Cloud 作为开机启动服务运行：

```bash
pi-cloud service install
pi-cloud service start
pi-cloud service stop
pi-cloud service restart
pi-cloud service status
pi-cloud service uninstall
```

服务使用 `--no-open` 运行，并采用常规的用户配置和数据库位置。

在 Windows 上，安装服务会创建一个 `ONLOGON` 计划任务。由于该命令与持久化行为相似，Microsoft Defender 可能会将其识别为 `Trojan:Win32/Commando.A!ml`。如果“保护历史记录”中仅显示 `schtasks.exe /Create /TN pi-cloud ...` 命令，请核对命令并只允许这一项检测，然后重试。请勿禁用 Defender，也不要排除整个 npm 目录。

在 Linux 上，服务会在用户登录时启动。若要让服务在无需交互式登录的情况下随系统启动，请启用用户驻留：

```bash
sudo loginctl enable-linger "$USER"
```

更新全局安装：

```bash
pi-cloud update --check     # 检查更新
pi-cloud update             # 最新版本
pi-cloud update 1.2.3       # 指定版本
```

更新不会自动重启正在运行的服务。请重启服务以使用新版本：

```bash
pi-cloud service restart
```

## 通过 SSH 远程访问

服务器默认绑定到 `127.0.0.1`。若要访问远程服务器上的实例而不将其公开，请在不打开浏览器的情况下启动 Pi Cloud：

```bash
pi-cloud --no-open
```

然后从本地机器建立 SSH 隧道：

```bash
ssh -N -L 3000:127.0.0.1:3000 user@server
```

在本地打开 http://127.0.0.1:3000。按 `Ctrl+C` 停止服务器或隧道。

## 反向代理（nginx）

```nginx
server {
    listen 443 ssl;
    server_name pi.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
```

通过 HTTPS 反向代理部署时，请在 `.env` 中设置 `PI_CLOUD_TRUST_PROXY=true` 和 `PI_CLOUD_COOKIE_SECURE=true`。
