# Awesome Defold link triage

When asked to process the resource inbox, use GitHub issue
[#16](https://github.com/astrochili/awesome-defold/issues/16) unless another
issue is named.

- Add only relevant, non-duplicate links to an existing category; do not create
  a category unless the user explicitly approves it.
- `Examples` are open-source demo projects; `Showcase` is for released games,
  grouped by platform. Articles and videos belong in `Resources`.
- Sort entries by displayed title. Entries with `🌙` sort after ordinary entries;
  use it only for engine-independent Lua modules useful for gamedev.
- Every entry except those in `Showcase` needs `- [Name](URL) — Description.`
  Showcase entries have no descriptions.
- Use direct, stable URLs. Steam links use `https://store.steampowered.com/app/<ID>`.
- Fix clear editorial typos when encountered. Report duplicates; do not remove
  existing entries unless asked.
- Keep the existing heading hierarchy and deliberately compact Contents. Run
  `git diff --check` before handoff and report skipped candidates.

Create a commit only when explicitly asked. For additions, use a subject such
as `Added DataForge, Unity LevelPlay and GUIX`.
