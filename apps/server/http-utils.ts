import type { IncomingMessage, ServerResponse } from 'node:http';
import { RuleError } from '../../packages/rules/src/index.ts';

export function isLoopback(address?: string): boolean {
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}
export function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store' });
  response.end(JSON.stringify(body));
}
export async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 65536) throw new RuleError('请求内容过大');
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString('utf8'); if (!text) return {};
  try {
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('invalid body');
    return body;
  } catch { throw new RuleError('请求体必须为 JSON'); }
}
