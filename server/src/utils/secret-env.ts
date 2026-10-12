// Pi Cloud secrets must not leak into processes started by the server: the
// terminal, the agent's shell tools, MCP servers, and git all inherit
// `process.env`, and the agent can print it back to the model provider.
const SECRET_ENV_NAMES = [
  'PI_CLOUD_AUTH_PASSWORD',
  'PI_CLOUD_AUTH_PASSWORD_HASH',
  'PI_CLOUD_CREDENTIAL_ENCRYPTION_KEY',
  'PI_CLOUD_FEISHU_APP_SECRET',
  'PI_CLOUD_FEISHU_VERIFICATION_TOKEN',
  'PI_CLOUD_FEISHU_ENCRYPT_KEY',
  'PI_CLOUD_WECOM_CORP_SECRET',
  'PI_CLOUD_WECOM_CALLBACK_TOKEN',
  'PI_CLOUD_WECOM_ENCODING_AES_KEY',
  'PI_CLOUD_WECHAT_TOKEN',
  'PI_CLOUD_STT_API_KEY',
  'PI_CLOUD_TTS_API_KEY',
] as const;

export type SecretEnvName = typeof SECRET_ENV_NAMES[number];

const isolated = new Map<SecretEnvName, string>();

/** Read a secret that may have been moved out of `process.env` at startup. */
export function secretEnv(name: SecretEnvName): string | undefined {
  return process.env[name] ?? isolated.get(name);
}

/** Move secrets out of `process.env` after startup configuration has been read. */
export function isolateSecretEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name];
    if (value === undefined) continue;
    isolated.set(name, value);
    delete env[name];
  }
}
