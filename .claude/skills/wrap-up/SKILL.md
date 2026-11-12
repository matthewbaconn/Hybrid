---
name: wrap-up
description: Quick end-of-session routine for HYBRD. Saves the session's lasting technical and marketing takeaways and decisions to .claude/MEMORY.md (kept under 50 lines) and lists anything left open. Use when Matthew says /wrap-up, "wrap up", "save this" or is ending a session.
---
# Wrap-up

1. Review this session: decisions made, things shipped (commits/deploys), what was learned
   (a hook that worked, a bug cause, an architecture rule), and anything still open.
2. Update `.claude/MEMORY.md`, which is gitignored. **Never commit it.**
   - Edit the right section: North Star, Rules, Proven hooks, Top formats, Bottlenecks,
     Recent decisions (dated, newest first, keep about the last 6).
   - Replace or merge stale lines instead of appending. Stay at or under 50 lines total.
   - Save only durable facts. Skip play-by-play, secrets and member emails or names.
3. If there are uncommitted code changes, list them and ask whether to ship or park them.
4. Reply in at most 6 lines: what you saved, what's still open, and 1–2 numbered Action Cards for next time.
   Suggest `/clear` if the next task is a different kind of work.
