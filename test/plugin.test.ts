import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, symlink, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ToolCallId } from '@deepseek-ai/dsh-llm';
import { fixture, object, modelCall } from './util.js';
const command = promisify(execFile);
test('immutable excerpt, full-file stale revision and concurrent capture', async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.root}/a.ts`, 'first\nsecond\n');
    const first = object(await f.host.execute('file_context_capture', { path: 'a.ts', startLine: 2, endLine: 2 }));
    assert.equal(first.text, 'second');
    await writeFile(`${f.root}/a.ts`, 'changed\n');
    assert.equal(object(await f.host.execute('file_context_get', { id: first.id })).text, 'second');
    assert.ok((await f.host.execute('file_context_capture', { path: 'a.ts', expectedRevision: first.revision })).isError);
    const results = await Promise.all(Array.from({ length: 8 }, () => f.host.execute('file_context_capture', { path: 'a.ts' })));
    for (const result of results) assert.equal(object(result).text, 'changed\n');
  } finally { await f.close(); }
});
test('rejects traversal, symlink files/ancestors, binary, directories and bad ranges', async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.root}/a`, 'ok');
    await writeFile(`${f.root}/binary`, Buffer.from([0, 1]));
    await mkdir(`${f.root}/dir`);
    await symlink('a', `${f.root}/link`);
    await symlink('dir', `${f.root}/linked-dir`);
    for (const path of ['../anything', '/etc/passwd', 'link', 'linked-dir/a', 'binary', 'dir']) assert.ok((await f.host.execute('file_context_capture', { path })).isError, path);
    assert.ok((await f.host.execute('file_context_capture', { path: 'a', startLine: 0 })).isError);
    assert.ok((await f.host.execute('file_context_capture', { path: 'a', endLine: 1000 })).isError);
  } finally { await f.close(); }
});
test('captures a real Git diff and keeps immutable revision provenance', async () => {
  const f = await fixture();
  try {
    await command('git', ['init', '-q', f.root]);
    await writeFile(`${f.root}/a`, 'old\n');
    await command('git', ['-C', f.root, 'add', 'a']);
    await command('git', ['-C', f.root, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial']);
    await writeFile(`${f.root}/a`, 'new\n');
    const diff = object(await f.host.execute('file_context_diff', { path: 'a' }));
    assert.match(String(diff.text), /-old\n\+new/);
    assert.match(String(diff.base), /^[a-f0-9]{40,64}$/);
    assert.ok((await f.host.execute('file_context_diff', { path: 'a', base: '--bad' })).isError);
    assert.ok((await f.host.execute('file_context_diff', { path: 'a', expectedRevision: 'stale' })).isError);
  } finally { await f.close(); }
});
test('offline model calls actual ToolRuntime; session isolation and unload', async () => {
  const f = await fixture();
  try {
    await writeFile(`${f.root}/a`, 'host-only');
    const snapshot = object(await f.host.execute('file_context_capture', { path: 'a' }));
    await writeFile(`${f.root}/a`, 'model-visible');
    const handle = await modelCall(f.host, 'file_context_capture', { path: 'a' });
    const signal = new AbortController().signal;
    const isolated = await f.host.ctx.tools.execute({ callId: ToolCallId('isolated'), name: 'file_context_get', arguments: { id: snapshot.id }, signal, agent: handle.agent });
    assert.ok(isolated.isError, 'host snapshots must not cross into agent scope');
    const own = object(await f.host.ctx.tools.execute({ callId: ToolCallId('own'), name: 'file_context_capture', arguments: { path: 'a' }, signal, agent: handle.agent }));
    const second = await f.host.create('other-agent');
    assert.ok((await f.host.ctx.tools.execute({ callId: ToolCallId('other'), name: 'file_context_get', arguments: { id: own.id }, signal, agent: second.agent })).isError);

    assert.match(JSON.stringify(f.host.model.requests[1]), /model-visible/);
    await handle.dispose();
    const recreated = await f.host.create('test-agent');
    assert.ok((await f.host.ctx.tools.execute({ callId: ToolCallId('recreated'), name: 'file_context_get', arguments: { id: own.id }, signal, agent: recreated.agent })).isError, 'disposed agent snapshots must not survive identity reuse');
    const controller = new AbortController(); controller.abort();
    assert.ok((await f.host.execute('file_context_capture', { path: 'a' }, controller.signal)).isError);
    await f.fiber.dispose();
    assert.equal(f.host.ctx.tools.get('file_context_capture'), undefined);
    assert.ok((await f.host.execute('file_context_get', { id: snapshot.id })).isError);
  } finally { await f.close(); }
});
