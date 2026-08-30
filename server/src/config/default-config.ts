export function renderDefaultConfig(sample: string, username: string, password: string): string {
  return sample
    .replace(/^PI_CLOUD_AUTH_USERNAME=.*$/m, `PI_CLOUD_AUTH_USERNAME=${username}`)
    .replace(/^PI_CLOUD_AUTH_PASSWORD=.*$/m, `PI_CLOUD_AUTH_PASSWORD=${password}`);
}
