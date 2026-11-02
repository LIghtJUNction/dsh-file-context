import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as plugin from '../src/index.js';
import { createHost } from './host.js';
import { modelCall } from './util.js';
test('default config resolves real agent working directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-default-'));
  const host = await createHost(root);
  try {
    await writeFile(`${root}/main.ts`, 'export function hello() {}');
    await host.ctx.plugin(plugin, {});
    await modelCall(host, 'file_context_capture', { path: 'main.ts' });
    assert.match(JSON.stringify(host.model.requests[1]), /main.ts/);
    const request = host.model.requests[1];
    assert.ok(request);
    assert.ok(!JSON.stringify(request).includes('requires an agent'));
  } finally { await host.close(); await rm(root, { recursive: true, force: true }); }
});
