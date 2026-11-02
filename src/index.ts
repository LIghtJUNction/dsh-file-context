import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { defineTool, type InferValue, type ToolRunContext } from '@deepseek-ai/dsh-tools';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath } from 'node:fs/promises';
import { relative } from 'node:path';
import { digest, lifetime, readText, safePath } from './local.js';
import { workspace } from './support.js';

export const name = 'dsh-file-context';
export const inject = ['tools', 'workingDirectory'];
export const Config = Schema.object({ root: Schema.string() });
export type Config = ReturnType<typeof Config>;
const snapshotSchema = {
  type: 'object', additionalProperties: false, properties: {
    id: { type: 'string', required: true }, kind: { type: 'string', enum: ['file', 'diff'], required: true },
    path: { type: 'string', required: true }, revision: { type: 'string', required: true },
    text: { type: 'string', required: true }, startLine: { type: 'integer', required: true }, endLine: { type: 'integer', required: true },
    base: { type: 'string', required: true },
  },
} satisfies import('@deepseek-ai/dsh-tools').ValueSchemaSpec;
type Snapshot = InferValue<typeof snapshotSchema>;
const command = promisify(execFile);
export function apply(ctx: Context, config: Config) {
  const run = lifetime(ctx);
  const snapshots = new Map<string, Snapshot>();
  ctx.effect(() => () => snapshots.clear());
  ctx.on('agent/disposed', ({ agent }) => {
    for (const key of snapshots.keys()) if (key.split('\0')[1] === agent.id) snapshots.delete(key);
  });
  const scope = async (exec: ToolRunContext) => `${await realpath(workspace(ctx, exec, config.root))}\0${exec.agent?.id ?? 'host'}\0`;
  async function save(exec: ToolRunContext, value: Omit<Snapshot, 'id'>, signal: AbortSignal) {
    const prefix = await scope(exec);
    signal.throwIfAborted();
    const snapshot = { ...value, id: digest(JSON.stringify(value)) };
    if (!snapshots.has(prefix + snapshot.id) && snapshots.size >= 64) throw new Error('Snapshot limit reached (64 per plugin); dispose/reload to clear');
    snapshots.set(prefix + snapshot.id, snapshot);
    return snapshot;
  }
  ctx.tools.register(defineTool({
    name: 'file_context_capture', description: 'Capture an immutable bounded local file excerpt. revision is the SHA-256 of the entire file; expectedRevision rejects stale content.',
    parameters: { path: { type: 'string', required: true }, startLine: { type: 'integer' }, endLine: { type: 'integer' }, expectedRevision: { type: 'string' } },
    output: { schema: snapshotSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec.signal, async signal => {
      const text = await readText(workspace(ctx, exec, config.root), args.path, signal);
      const revision = digest(text);
      if (args.expectedRevision !== undefined && args.expectedRevision !== revision) throw new Error('Stale revision');
      const lines = text.split(/\r?\n/);
      const startLine = args.startLine ?? 1;
      const endLine = args.endLine ?? Math.min(lines.length, startLine + 499);
      if (startLine < 1 || endLine < startLine || endLine > lines.length || endLine - startLine >= 500) throw new Error('Invalid range; maximum 500 lines');
      const excerpt = lines.slice(startLine - 1, endLine).join('\n');
      if (Buffer.byteLength(excerpt) > 50000) throw new Error('Excerpt exceeds 50000 bytes');
      return save(exec, { kind: 'file', path: args.path, revision, text: excerpt, startLine, endLine, base: '' }, signal);
    }),
  }));
  ctx.tools.register(defineTool({
    name: 'file_context_get', description: 'Retrieve a captured snapshot by id, without rereading changing files. Scoped to current root and agent.',
    parameters: { id: { type: 'string', required: true } },
    output: { schema: snapshotSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec.signal, async signal => {
      const value = snapshots.get(await scope(exec) + args.id);
      signal.throwIfAborted();
      if (!value) throw new Error('Unknown snapshot in this workspace/session');
      return { ...value };
    }),
  }));
  ctx.tools.register(defineTool({
    name: 'file_context_diff', description: 'Capture a local Git worktree diff against HEAD or an explicit commit hash. Requires workspace to be the Git root; external diff/textconv disabled.',
    parameters: { path: { type: 'string', required: true }, base: { type: 'string' }, expectedRevision: { type: 'string' } },
    output: { schema: snapshotSchema, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    isConcurrencySafe: () => true,
    execute: (args, exec) => run(exec.signal, async signal => {
      const root = await realpath(workspace(ctx, exec, config.root));
      const target = await safePath(root, args.path);
      await readText(root, args.path, signal);
      const git = async (argv: string[]) => (await command('git', ['--no-optional-locks', ...argv], { cwd: root, signal, timeout: 5000, maxBuffer: 262144, env: { ...process.env, GIT_LITERAL_PATHSPECS: '1', GIT_EXTERNAL_DIFF: '' } })).stdout;
      if (await realpath((await git(['rev-parse', '--show-toplevel'])).trim()) !== root) throw new Error('Workspace must be the Git repository root');
      const base = args.base ?? 'HEAD';
      if (base !== 'HEAD' && !/^[a-fA-F0-9]{40}$/.test(base) && !/^[a-fA-F0-9]{64}$/.test(base)) throw new Error('base must be HEAD or a full commit hash');
      const commit = (await git(['rev-parse', '--verify', `${base}^{commit}`])).trim();
      const text = await git(['diff', '--no-ext-diff', '--no-textconv', '--no-color', '--unified=3', commit, '--', relative(root, target)]);
      if (Buffer.byteLength(text) > 50000) throw new Error('Diff exceeds 50000 bytes');
      const revision = digest(text);
      if (args.expectedRevision !== undefined && revision !== args.expectedRevision) throw new Error('Stale revision');
      return save(exec, { kind: 'diff', path: args.path, revision, text, base: commit, startLine: 0, endLine: 0 }, signal);
    }),
  }));
}
