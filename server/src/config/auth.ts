import * as os from 'os';
import * as path from 'path';

export interface AuthConfig {
  username: string;
  password?: string;
  passwordHash?: string;
  sessionTtlHours: number;
  sessionMaxHours: number;
  dbPath: string;
  trustProxy: boolean;
  skip2faVerify: boolean;
  cookieSecure: boolean;
  cookieName: string;
}

const DEFAULT_SESSION_TTL_HOURS = 8;
const DEFAULT_SESSION_MAX_HOURS = 24 * 30;
const TRUE_ENV_VALUES = new Set(['true', '1', 'yes']);

function parseBoolean(value: string | undefined): boolean {
  return TRUE_ENV_VALUES.has(value ?? '');
}

function parsePositiveHours(value: string | undefined, name: string, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return parsed;
}

function defaultDbPath(env: NodeJS.ProcessEnv): string {
  const home = env.HOME || os.homedir();
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  return path.join(configHome, 'pi-webui', 'pi-webui.sqlite');
}

export function loadAuthConfig(env: NodeJS.ProcessEnv = process.env): AuthConfig {
  const username = env.PI_WEBUI_AUTH_USERNAME?.trim();
  if (!username) {
    throw new Error('PI_WEBUI_AUTH_USERNAME is required');
  }

  const passwordHash = env.PI_WEBUI_AUTH_PASSWORD_HASH?.trim();
  const password = env.PI_WEBUI_AUTH_PASSWORD;
  if (!passwordHash && !password) {
    throw new Error('PI_WEBUI_AUTH_PASSWORD_HASH or PI_WEBUI_AUTH_PASSWORD is required');
  }

  return {
    username,
    password,
    passwordHash,
    sessionTtlHours: parsePositiveHours(env.PI_WEBUI_SESSION_TTL_HOURS, 'PI_WEBUI_SESSION_TTL_HOURS', DEFAULT_SESSION_TTL_HOURS),
    sessionMaxHours: parsePositiveHours(env.PI_WEBUI_SESSION_MAX_HOURS, 'PI_WEBUI_SESSION_MAX_HOURS', DEFAULT_SESSION_MAX_HOURS),
    dbPath: env.PI_WEBUI_DB_PATH || defaultDbPath(env),
    trustProxy: parseBoolean(env.PI_WEBUI_TRUST_PROXY),
    skip2faVerify: parseBoolean(env.SKIP_2FA_VERIFY),
    cookieSecure: parseBoolean(env.PI_WEBUI_COOKIE_SECURE),
    cookieName: 'piui_session',
  };
}
