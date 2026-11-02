# Upstream provenance

Source: [packages/pi-file-context](https://github.com/narumiruna/pi-extensions/tree/a0e0079303415a1eb0eb58f68538a593c58182e5/packages/pi-file-context)
Reviewed commit: `a0e0079303415a1eb0eb58f68538a593c58182e5`
License: MIT; copyright (c) 2026 Narumi.

Actual source files reviewed before implementing the DSH tools:

- [src/file-context.ts](https://github.com/narumiruna/pi-extensions/blob/a0e0079303415a1eb0eb58f68538a593c58182e5/packages/pi-file-context/src/file-context.ts)
- [src/git-context.ts](https://github.com/narumiruna/pi-extensions/blob/a0e0079303415a1eb0eb58f68538a593c58182e5/packages/pi-file-context/src/git-context.ts)

The source and license were retrieved using the GitHub contents API at the pinned commit. This is an independent implementation based on those behaviors, not a runtime adapter. See NOTICE for full upstream attribution and MIT terms.

## Migration differences

- Upstream offers an interactive explorer, search, range selection, Git history/blame/revision browsing, widgets, external editing, and next-prompt quote injection.
- This first DSH version offers `file_context_capture`, `file_context_get`, and `file_context_diff`. It returns immutable data through DSH ToolRuntime instead of integrating Pi UI or automatically changing prompts.
- SHA-256 revisions and bounded line selections preserve the snapshot purpose. Storage is memory-only, scoped to canonical project directory and agent; there is no Pi pending-quote store.
- Git diff supports an existing regular text file against HEAD or a full commit hash. Deleted files, revision file browsing, staging-specific diffs, blame and history are not implemented.

All filesystem access uses host-local Node APIs. Neither upstream Pi execution-world semantics nor DSH remote/sandbox filesystem support is claimed.
