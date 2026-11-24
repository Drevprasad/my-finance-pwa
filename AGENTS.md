<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Experimental Mode Rules (Dad Sharing)
- DO NOT modify, rename, or delete ANY existing files in the repository.
- Only create NEW files under `lib/lite/`, `components/lite/`, `app/lite/`, and `app/dad/`.
- Reuse existing UI primitives from `@/components/ui` and the client from `@/lib/supabase` (read-only).
- Money is always stored and passed as integer paise in `*_minor` columns.
- Run `npx tsc --noEmit` after creating files to verify no build errors.