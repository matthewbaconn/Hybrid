---
name: weekly-review
description: Friday CEO review for HYBRD. Compares this week with last week (sign-ups, active members, email results, Meta Ads spend/CTR/CPC, Instagram engagement), names the #1 bottleneck, updates .claude/MEMORY.md and proposes the top 3 moves for next week. Use when Matthew says /weekly-review or "weekly review".
---
# Weekly review

1. Dispatch in parallel:
   - `vesper-comms`: members total and new this week vs last week, Founding spots left, email sends and
     failures, notable replies or reports.
   - `vesper-ads`: 7-day vs prior 7-day spend, CTR, CPC, frequency, conversions, best/worst ad.
   - `vesper-growth`: posts published this week, reach/likes/saves/follows per post (Buffer analytics if
     connected, otherwise ask Matthew for the Instagram insights screenshot), top format, follower change.
   - `vesper-infra`: uptime incidents, failed deploys or nightly runs this week.
   Also run `git log --since="7 days ago" --oneline` yourself for what shipped.
2. Write the review, at most about 30 lines:
   - **Scoreboard**: a week-over-week table (sign-ups, active, followers, ad spend, CTR, CPC).
   - **What worked / what didn't**: 2 lines each, with numbers.
   - **#1 bottleneck**: one sentence on the single biggest constraint (traffic, conversion, activation,
     retention, reliability) and the evidence for it.
   - **Top 3 moves for next week**: high-leverage, specific, owner + effort. These are the Action Cards.
3. Update `.claude/MEMORY.md` (keep ≤ 50 lines): refresh Bottlenecks, add any proven hook or
   top format (with its number), drop stale lines.
4. Matthew's standing approval covers posts and emails. Anything that spends money stays a card.
