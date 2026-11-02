# dsh-file-context

DSH 0.2.1-rc.2 plugin. Node >=24; developed and tested locally with Node 26 / TypeScript 5.9.3. Release CI is configured for Node 24; that CI run is separate from local verification.

## Install from a GitHub Release

After a release is published, install its built archive into your DSH profile:

```sh
dsh plugin --profile headless add https://github.com/LIghtJUNction/dsh-file-context/releases/download/v0.1.0/lightjunction-dsh-file-context-0.1.0.tgz
dsh headless --dump-config
```

The release URL is the expected v0.1.0 asset location, not a claim that it has already been published. Use the archive and SHA256SUMS attached to the same GitHub Release. The package includes a DSH bundle patch and built JavaScript; no Pi dependency is needed. Restart DSH after installation. Substitute your existing profile for `headless` if needed.

## Configuration

The default bundle config is `{}`: each tool uses the invoking agent's working directory. A host call without an agent requires an explicit `root`. To pin a host-local workspace, add an override in your profile's `cordis.patch.yml`:

```yaml
- id: dsh-file-context
  config:
    root: /absolute/local/project
```

The root must already exist. It is interpreted on the DSH host, using Node filesystem APIs. A remote DSH world or sandbox does not redirect these operations: only enable this plugin for a host-local project. This is not a remote-world adapter or a security sandbox.

## Tools and examples

- `file_context_capture({path:"src/index.ts",startLine:1,endLine:30})` returns an immutable file excerpt plus `id`, full-file `revision`, range and text. Omit the range for up to the first 500 lines. Supplying `expectedRevision` rejects a changed file.
- `file_context_get({id:"<returned id>"})` retrieves those original bytes of excerpt text even after the source changes. Captures are isolated by canonical workspace and agent identity; host calls use their own scope.
- `file_context_diff({path:"src/index.ts",base:"HEAD"})` captures a real Git worktree diff and the resolved base commit. `base` also accepts a full 40/64-character commit hash; `expectedRevision` checks the SHA-256 of the resulting diff.

Ask DSH: “Capture lines 1–30 of src/index.ts, then compare the current diff against HEAD.” Results are tool content available to the model; file content remains untrusted data.

## Limits and behavior

Reads reject traversal, absolute paths, `.git` segments, symlink files/ancestors, nonregular files, invalid UTF-8, binary data and files over 256 KiB. The canonical configured root itself may resolve a symlink. File revisions hash the full original UTF-8 text (including BOM); excerpts normalize CRLF line endings. Excerpts are limited to 500 lines and 50,000 UTF-8 bytes. The plugin holds at most 64 snapshots total in memory, with no disk spill or eviction; unload/reload clears them. Disposing an agent clears its snapshots; restarting DSH loses all snapshots. Calls that reach the cap fail explicitly.

Git diffs require the workspace to equal the Git repository root and the file to exist as bounded regular text. External diff drivers and textconv are disabled, pathspecs are literal, and subprocesses have cancellation, a five-second timeout and a bounded output buffer. Deleted files and untracked-file diffs are not supported. Diff snapshots hash diff text, not the worktree file.

There is no Pi file browser, menu, preview widget, external editor, blame/history viewer or automatic next-prompt injection. No file writes are provided. Concurrent capture calls preserve immutable snapshots. Dispose aborts and drains active work and unregisters tools.

## Filesystem boundary and verification

Path checks reject ordinary symlink redirection; regular-file opens use no-follow flags and inode checks, bounded reads and cancellation. These checks are not a sandbox against a malicious process concurrently replacing ancestor directories; use a trusted local workspace. Linux/macOS-style filesystem semantics are the intended target; Windows behavior has not been verified.

```sh
npm run check
```

The suite uses real Cordis, DSH ToolRuntime, agent-loop and an offline scripted model; it verifies actual model tool dispatch and results in the following model request, plus limits, revision/path checks, cancellation and unregistration. It requires no live model credentials. `check` includes TypeScript checks for source/tests, behavior tests and a build. See [UPSTREAM.md](UPSTREAM.md) for pinned source and migration differences and [NOTICE](NOTICE) for upstream MIT attribution.
