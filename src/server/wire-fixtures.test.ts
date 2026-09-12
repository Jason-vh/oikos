import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { deflateRawSync, inflateRawSync, constants } from 'node:zlib';
import type { ServerPacket } from './protocol';

export class WirePeer {
  readonly socket;
  readonly closed: Promise<void>;
  readonly packets: ServerPacket[] = [];
  readonly frames: Array<{ compressed: boolean; bytes: number }> = [];
  private buffer = Buffer.alloc(0);
  private upgraded = false;
  private listeners = new Set<() => void>();
  constructor(base: string, origin: string, cookie: string, compression = false) {
    const url = new URL(base);
    this.socket = createConnection({ host: url.hostname, port: Number(url.port) });
    this.closed = new Promise((resolve) => { this.socket.once('close', () => resolve()); });
    this.socket.on('error', () => {});
    this.socket.once('connect', () => {
      const headers = [`GET /api/world HTTP/1.1`, `Host: ${url.host}`, `Origin: ${origin}`, `Cookie: ${cookie}`, 'Connection: Upgrade', 'Upgrade: websocket', 'Sec-WebSocket-Version: 13', `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`];
      if (compression) headers.push('Sec-WebSocket-Extensions: permessage-deflate; server_no_context_takeover; client_no_context_takeover');
      this.socket.write(`${headers.join('\r\n')}\r\n\r\n`);
    });
    this.socket.on('data', (chunk) => {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      this.buffer = Buffer.concat([this.buffer, bytes]);
      if (!this.upgraded) {
        const end = this.buffer.indexOf('\r\n\r\n');
        if (end < 0) return;
        if (!this.buffer.subarray(0, end).toString().startsWith('HTTP/1.1 101')) { this.socket.destroy(); return; }
        this.buffer = this.buffer.subarray(end + 4);
        this.upgraded = true;
      }
      this.readFrames();
    });
  }
  private readFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      let length = this.buffer[1] & 127;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2); offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        length = Number(this.buffer.readBigUInt64BE(2)); offset = 10;
      }
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if ((first & 15) === 8) { this.socket.destroy(); return; }
      if ((first & 15) !== 1) continue;
      const compressed = (first & 64) !== 0;
      if (compressed) payload = inflateRawSync(Buffer.concat([payload, Buffer.from([0, 0, 255, 255])]), { finishFlush: constants.Z_SYNC_FLUSH });
      this.frames.push({ compressed, bytes: length });
      this.packets.push(JSON.parse(payload.toString()) as ServerPacket);
      for (const notify of this.listeners) notify();
    }
  }
  send(text: string, compress = false) {
    let payload = Buffer.from(text);
    if (compress) payload = deflateRawSync(payload, { flush: constants.Z_SYNC_FLUSH, finishFlush: constants.Z_SYNC_FLUSH }).subarray(0, -4);
    const lengthBytes = payload.length < 126 ? 0 : 2;
    const header = Buffer.alloc(2 + lengthBytes + 4);
    header[0] = compress ? 193 : 129;
    header[1] = 128 | (lengthBytes ? 126 : payload.length);
    if (lengthBytes) header.writeUInt16BE(payload.length, 2);
    const mask = randomBytes(4);
    mask.copy(header, 2 + lengthBytes);
    payload = Buffer.from(payload);
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    this.socket.write(Buffer.concat([header, payload]));
  }
  async waitFor(predicate: () => boolean): Promise<void> {
    if (predicate()) return;
    await new Promise<void>((resolve, reject) => {
      const notify = () => {
        if (!predicate()) return;
        clearTimeout(timer); this.listeners.delete(notify); resolve();
      };
      const timer = setTimeout(() => { this.listeners.delete(notify); reject(new Error('Wire packet deadline.')); }, 3000);
      this.listeners.add(notify);
    });
  }
  async waitClosed() {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([this.closed, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Wire close deadline.')), 3000);
      })]);
    } finally { clearTimeout(timer); }
  }
  async close() { this.socket.destroy(); await this.waitClosed(); }
}
