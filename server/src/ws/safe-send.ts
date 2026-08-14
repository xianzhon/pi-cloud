interface JsonSocket {
  readonly OPEN: number;
  readonly readyState: number;
  send(data: string): void;
}

export function sendJson(socket: JsonSocket, message: unknown): void {
  if (socket.readyState !== socket.OPEN) return;

  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A socket can close after the ready-state check. Never let client delivery affect an agent run.
  }
}
