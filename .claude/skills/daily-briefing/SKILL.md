---
name: daily-briefing
description: Vesper's daily executive briefing for HYBRD. Runs vesper-infra, vesper-comms, vesper-ads and vesper-growth in parallel (site health, sign-ups and email, Meta Ads, Instagram/Buffer) and returns one crisp report ending in numbered Action Cards. Use when Matthew says /daily-briefing, "brief me", "morning report" or "what's going on".
---
# Daily briefing

1. Read `.claude/MEMORY.md` (already loaded) for the North Star, open bottlenecks and recent decisions.
2. Dispatch these **in parallel** (one message, four Agent calls), each with a 2–3 line brief:
   - `vesper-infra`: GitHub Actions, live status/latency, event-log failures in the last 24 h.
   - `vesper-comms`: sign-ups and email delivery in the last 24 h, plus follow-up drafts for new members.
   - `vesper-ads`: Meta Ads last 7 days vs the previous 7, fatigue flags, 3 hooks. (If not connected: skip.)
   - `vesper-growth`: Buffer queue (what's scheduled in the next 72 h), gaps in the posting plan, and
     1–2 post drafts built from this week's `git log`. (If Buffer isn't connected: drafts only.)
3. Don't re-run their work. Merge their reports into this format, at most about 25 lines:

```
HYBRD · <date>
Health      ✓/✗ one line (+ the failure, if any)
Members     <total> (+<new>) · Founding spots left <n> · emails ✓/✗
Ads         spend · CTR · CPC · fatigue flags   (or "not running")
Instagram   next post <when> · queue <n> · drafts ready <n>
Bottleneck  the one thing holding growth back right now
```
4. Act on anything green-lit by standing authority (see CLAUDE.md), e.g. fix a broken deploy, queue
   ready posts, send member follow-ups, and say so in one line each.
5. End with **1–3 numbered Action Cards**: concrete, pre-drafted moves Matthew can trigger by replying
   with the number. Anything that spends money must be a card, never done automatically.
