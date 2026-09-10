import { randomUUID } from 'node:crypto';
import type { PiCloudDatabase } from '../db/database.js';

export interface NotificationChannel {
  id: string;
  type: 'wecom';
  name: string;
  configured: boolean;
}

interface ChannelRow {
  id: string;
  type: string;
  name: string;
  config_json: string;
}

export class NotificationChannelService {
  constructor(private readonly db: PiCloudDatabase) {}

  list(): NotificationChannel[] {
    return (this.db.prepare('SELECT id, type, name, config_json FROM notification_channels ORDER BY created_at').all() as ChannelRow[])
      .map(publicChannel);
  }

  saveWecom(input: { id?: string; name?: string; botKey?: string }): NotificationChannel {
    const existing = input.id ? this.getRow(input.id) : undefined;
    const botKey = input.botKey?.trim() || readBotKey(existing);
    if (!botKey) throw new Error('WeCom bot key is required');
    const id = existing?.id ?? randomUUID();
    const now = new Date().toISOString();
    const name = input.name?.trim() || existing?.name || 'WeCom';
    this.db.prepare(`
      INSERT INTO notification_channels (id, type, name, config_json, created_at, updated_at)
      VALUES (?, 'wecom', ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, config_json = excluded.config_json, updated_at = excluded.updated_at
    `).run(id, name, JSON.stringify({ botKey }), now, now);
    return publicChannel(this.getRow(id)!);
  }

  delete(id: string): void {
    if (this.db.prepare('DELETE FROM notification_channels WHERE id = ?').run(id).changes !== 1) {
      throw new Error('Notification channel not found');
    }
  }

  async send(id: string, message: string): Promise<void> {
    const row = this.getRow(id);
    if (!row) throw new Error('Notification channel not found');
    if (row.type !== 'wecom') throw new Error(`Unsupported notification channel: ${row.type}`);
    const botKey = readBotKey(row);
    if (!botKey) throw new Error('WeCom bot key is not configured');
    const response = await fetch(`https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${encodeURIComponent(botKey)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content: message } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`WeCom returned HTTP ${response.status}`);
    const result = await response.json() as { errcode?: number; errmsg?: string };
    if (result.errcode !== 0) throw new Error(`WeCom notification failed: ${result.errmsg || result.errcode}`);
  }

  private getRow(id: string): ChannelRow | undefined {
    return this.db.prepare('SELECT id, type, name, config_json FROM notification_channels WHERE id = ?').get(id) as ChannelRow | undefined;
  }
}

function readBotKey(row: ChannelRow | undefined): string {
  if (!row) {
    return '';
  }
  try {
    return (JSON.parse(row.config_json) as { botKey?: string }).botKey || '';
  } catch {
    return '';
  }
}

function publicChannel(row: ChannelRow): NotificationChannel {
  return { id: row.id, type: 'wecom', name: row.name, configured: Boolean(readBotKey(row)) };
}
