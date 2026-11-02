import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';

export const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
export function validPath(path: string): void {
  if (!path || isAbsolute(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(p => p === '..' || p === '.git')) throw new Error('Expected a relative workspace path without traversal or .git');
}
export async function safePath(root: string, path: string): Promise<string> {
  validPath(path);
  const base = await realpath(root);
  let target = base;
  for (const part of path.split('/').filter(p => p && p !== '.')) {
    target = resolve(target, part);
    if ((await lstat(target)).isSymbolicLink()) throw new Error('Symbolic links are not supported');
  }
  const rel = relative(base, target);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('Path escapes workspace');
  return target;
}
export async function readText(root: string, path: string, signal: AbortSignal, maxBytes = 262144): Promise<string> {
  signal.throwIfAborted();
  const target = await safePath(root, path);
  const before = await lstat(target);
  if (!before.isFile() || before.size > maxBytes) throw new Error('Expected a bounded regular text file');
  const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev) throw new Error('File changed during open');
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      signal.throwIfAborted();
      const read = await handle.read(buffer, size, buffer.length - size, size);
      if (!read.bytesRead) break;
      size += read.bytesRead;
    }
    signal.throwIfAborted();
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error('File changed during read');
    if (size > maxBytes || buffer.subarray(0, size).includes(0)) throw new Error('File too large or binary');
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer.subarray(0, size));
  } finally { await handle.close(); }
}
export function lifetime(ctx: Context) {
  const controller = new AbortController();
  const pending = new Set<Promise<unknown>>();
  ctx.effect(() => async () => {
    controller.abort(new Error('Plugin disposed'));
    await Promise.allSettled([...pending]);
  });
  return function run<T>(signal: AbortSignal, operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const combined = AbortSignal.any([signal, controller.signal]);
    combined.throwIfAborted();
    const task = operation(combined);
    pending.add(task);
    void task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
}
