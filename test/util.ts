import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools';
import { MessageId } from '@deepseek-ai/dsh-llm';
import * as plugin from '../src/index.js';
import { createHost, toolResponse, textResponse } from './host.js';
export function value(result: ToolExecutionResult) {
  assert.ok(!result.isError, JSON.stringify(result.content));
  return result.value;
}
export function object(result: ToolExecutionResult) {
  const output = value(result);
  assert.ok(output && typeof output === 'object' && !Array.isArray(output));
  return output;
}
export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-plugin-'));
  const host = await createHost(root);
  const fiber = await host.ctx.plugin(plugin, { root });
  return { root, host, fiber, close: async () => { await host.close(); await rm(root, { recursive: true, force: true }); } };
}
export async function modelCall(host: Awaited<ReturnType<typeof createHost>>, name: string, args: object) {
  host.model.responses.push(toolResponse(name, args), textResponse());
  const handle = await host.create();
  handle.agent.followup({ id: MessageId('test-input'), role: 'user', content: [{ type: 'text', text: 'Use the tool.' }], source: { kind: 'user' } });
  await handle.agent.whenIdle();
  assert.deepEqual(host.errors, []);
  assert.equal(host.model.requests.length, 2);
  const second = host.model.requests[1];
  assert.ok(second);
  const toolResult = second.messages.find(message => message.role === 'tool');
  assert.ok(toolResult?.role === 'tool', 'next request must include an actual tool result');
  assert.notEqual(toolResult.isError, true, JSON.stringify(toolResult.content));
  return handle;
}
