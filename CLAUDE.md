# Project instructions

## Keep the codebase lean

These rules apply to every change, however small.

- Before writing a new function, component or file, search the repo for one that already does the job. Reuse or extend it instead.
- Never copy code from one part of the app to another. Move shared logic into a shared module (e.g. `lib/`) and import it.
- When fixing a bug, look for the same pattern elsewhere in the codebase and fix every occurrence, not just the one reported.
- Prefer editing existing files over creating new ones. If a file grows past ~400 lines, propose splitting it.
- Delete code, files and dependencies that are no longer used as part of the change that made them unused.
- For any change touching more than 2–3 files, outline the plan first and say which existing code it reuses.
- After finishing a change, review the diff and ask: could this be smaller? Remove anything that isn't needed.
