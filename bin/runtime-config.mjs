// CLI options must be visible during module initialization, but defaults must wait until dotenv has loaded.
export async function loadRuntimeConfig(options, loadServer, env = process.env) {
  if (options.port !== undefined) env.PORT = options.port;
  if (options.hostname !== undefined) env.HOST = options.hostname;

  const server = await loadServer();

  env.PORT ??= '3000';
  env.HOST ??= '127.0.0.1';
  return server;
}
