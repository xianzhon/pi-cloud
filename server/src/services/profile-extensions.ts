import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

interface PackageEntry {
  source: string;
  extensions?: string[];
  piCloudExtensionFilters?: string[];
  [key: string]: unknown;
}
interface ProfileSettings {
  packages?: Array<string | PackageEntry>;
  [key: string]: unknown;
}

function readSettings(profilePath: string): ProfileSettings {
  const path = join(profilePath, 'settings.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
}

function inventory(settings: ProfileSettings) {
  return (settings.packages || []).map(entry => ({
    source: typeof entry === 'string' ? entry : entry.source,
    enabled: typeof entry === 'string' || entry.extensions?.length !== 0,
  }));
}

export function listProfileExtensions(profilePath: string) {
  return inventory(readSettings(profilePath));
}

// Use Pi's native package filters so CLI and Cloud behave consistently.
export function setProfileExtension(profilePath: string, source: string, enabled: boolean) {
  const settings = readSettings(profilePath);
  if (typeof source !== 'string' || typeof enabled !== 'boolean') throw new Error('source and enabled are required');
  if (!inventory(settings).some(entry => entry.source === source)) throw new Error('Unknown extension package');
  settings.packages = settings.packages!.map(entry => {
    if ((typeof entry === 'string' ? entry : entry.source) !== source) return entry;
    const updated: PackageEntry = typeof entry === 'string' ? { source: entry } : { ...entry };
    if (enabled) {
      if (updated.extensions?.length === 0) {
        if (updated.piCloudExtensionFilters) updated.extensions = updated.piCloudExtensionFilters;
        else delete updated.extensions;
        delete updated.piCloudExtensionFilters;
      }
    } else if (updated.extensions?.length !== 0) {
      if (updated.extensions) updated.piCloudExtensionFilters = updated.extensions;
      updated.extensions = [];
    }
    return updated;
  });
  const path = join(profilePath, 'settings.json');
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return inventory(settings);
}
