# Deployment

This guide covers deploying Pi WebUI from source or as an npm package, accessing a remote instance, and configuring an nginx reverse proxy.

## Option 1: From Source

Requires Node.js, pnpm, and the Pi agent installed on the server. After starting Pi WebUI, authenticate from the agent profile dialog.

```bash
git clone <repo-url> && cd pi-webui
cp .env.example .env
# TODO: edit .env with your auth credentials

pnpm install --frozen-lockfile
pnpm build
NODE_ENV=production PORT=3000 pnpm start:prod
```

The app is served at http://localhost:3000 (both frontend and backend).

## Option 2: npm Package

Build the npm package on your development machine and upload the generated tarball:

```bash
make package               # runs npm pack and produces xianzhon-pi-webui-<version>.tgz
scp xianzhon-pi-webui-*.tgz user@server:~/release/
```

On the remote server, install the tarball by path:

```bash
cd ~/release
npm install -g ./xianzhon-pi-webui-<version>.tgz
pi-webui
```

On native Windows, run the equivalent command from PowerShell (not WSL):

```powershell
npm install -g .\xianzhon-pi-webui-<version>.tgz
pi-webui
```

The embedded terminal uses a platform-specific prebuilt package, including Windows x64 and ARM64, so it does not invoke `node-gyp`. Do not use `--omit=optional`, because npm selects the terminal binary through optional platform dependencies.

Configure credentials as described in the [configuration manual](configuration.md). The tarball path (`./...` on Unix or `.\...` on Windows) is required; without it, npm may try to install the current directory instead.

## Store the Password Securely

For production, store a scrypt hash instead of the plaintext password. Generate one with Node.js; this uses only the built-in `node:crypto` module:

```bash
node -e 'const { randomBytes, scryptSync } = require("node:crypto"); const s = randomBytes(16); const k = scryptSync(process.argv[1], s, 32, { N: 2**15, r: 8, p: 3, maxmem: 64*1024**2 }); console.log(`$scrypt$ln=15,r=8,p=3$${s.toString("base64")}$${k.toString("base64")}`)' 'change-this-password'
```

Replace the password setting with the generated hash and remove `PI_WEBUI_AUTH_PASSWORD`:

```dotenv
PI_WEBUI_AUTH_USERNAME=admin
PI_WEBUI_AUTH_PASSWORD_HASH=$scrypt$ln=15,r=8,p=3$...
```

Keep the configuration file owner-readable only:

```bash
chmod 600 ~/.config/pi-webui/.env
```

Provide either `PI_WEBUI_AUTH_PASSWORD` or `PI_WEBUI_AUTH_PASSWORD_HASH`, not both. The hash option is recommended for production because the plaintext password is not stored on disk. The automatically generated first-run configuration uses a random plaintext password for convenience; replace it with a hash before deploying to production.

## System Service

A global installation can run as a startup service using systemd user services on Linux, LaunchAgents on macOS, or Windows Task Scheduler:

```bash
pi-webui service install
pi-webui service start
pi-webui service stop
pi-webui service restart
pi-webui service status
pi-webui service uninstall
```

The service runs with `--no-open` and uses the normal user configuration and database locations.

On Windows, service installation creates an `ONLOGON` scheduled task. Microsoft Defender may classify that task-creation command as `Trojan:Win32/Commando.A!ml` because it resembles persistence behavior. If Protection History shows only the `schtasks.exe /Create /TN pi-webui ...` command, verify the command and allow that specific detection before retrying. Do not disable Defender or exclude the entire npm directory.

On Linux, the service starts when the user logs in. To start it at boot without an interactive login, enable user lingering:

```bash
sudo loginctl enable-linger "$USER"
```

Update a global installation with:

```bash
pi-webui update --check     # check for updates
pi-webui update             # latest release
pi-webui update 1.2.3       # specific version
```

An update does not restart a running service automatically. Restart it to use the new version:

```bash
pi-webui service restart
```

## Remote Access with SSH

The server binds to `127.0.0.1` by default. To access an instance on a remote server without exposing it publicly, start Pi WebUI without opening a browser:

```bash
pi-webui --no-open
```

Then create an SSH tunnel from your local machine:

```bash
ssh -N -L 3000:127.0.0.1:3000 user@server
```

Open http://127.0.0.1:3000 locally. Press `Ctrl+C` to stop the server or tunnel.

## Reverse Proxy (nginx)

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

Set `PI_WEBUI_TRUST_PROXY=true` and `PI_WEBUI_COOKIE_SECURE=true` in `.env` when behind HTTPS.
