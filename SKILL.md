---
name: xiaohongshu-data-review
description: Review how already-published Xiaohongshu (小红书) notes are performing by reading the creator dashboard from the user's logged-in Chrome, then turn the numbers into a prioritized improvement plan with measurable targets. Use when the user asks why posted notes are underperforming, how to raise cover CTR, watch time, or follower conversion, or wants a data review before the next batch. Not for writing new notes or drawing covers.
---

# Xiaohongshu Data Review

Turn a posted-notes dataset into a diagnosis: which funnel stage is losing people, what most likely caused it, and what to change next with a threshold that proves it worked.

## Access is read-only, through the user's own browser

The numbers sit behind a login on `creator.xiaohongshu.com`. The collector attaches to the Chrome window the user is already signed into; it never logs in on its own.

- **Sandbox blocks loopback.** A connection to `127.0.0.1:9222` fails with `Operation not permitted` until network permission is granted. Request it before the first run of a session, then retry.
- **Enabling debugging is a user action.** On Chrome 144+ the user switches on Remote Debugging at `chrome://inspect/#remote-debugging`, with the creator tab left open. Chrome may also show an allow prompt on connect.
- **Do not relaunch Chrome with `--remote-debugging-port` on the default profile**, and do not ask the user to quit the browser: current Chrome refuses to open a debug port on the default profile, and losing the session costs more than the connection.
- **Never write to the account.** No publishing, editing, deleting, or comment replies. Read pages and inspect the DOM; nothing else.

## Collect

Run from this skill's directory. The first call may take ~10s while the page renders.

```bash
node scripts/xhs.mjs doctor    # is a debuggable Chrome reachable, and is a creator tab open?
node scripts/xhs.mjs notes     # per-note table as JSON  (primary dataset)
node scripts/xhs.mjs account   # 账号诊断 + 近7/30日 totals: exposure, views, CTR, watch time
node scripts/xhs.mjs fans      # follower total, net change, gender/age/interest profile
```

`notes` returns one object per published note with `exposure`, `views`, `coverCtrPercent`, `likes`, `comments`, `saves`, `follows`, `shares`, `avgViewSeconds`, plus computed `rates` (all relative to that note's views). `null` means the platform shows `-`: not yet counted, or still under review.

Use `eval "<expression>"` only for read-only inspection when a specific field is missing from the collector output.

## Before concluding anything, check the source copy

Published titles often drift from the version that was written. If the notes were drafted locally, find those drafts and compare:

```bash
rg -l "<note title or a distinctive ingredient>" <likely workspace dirs>
```

Then diff draft title/caption against what was actually published. Replacing a title that carried a concrete promise ("香槟最后再加", "这版不加蛋清") with a flat category label ("调酒｜法式75") removes the only reason a stranger has to tap, and it shows up directly in cover CTR. This comparison explains more variance than anything else in the dashboard, so do it before writing the report.

## Diagnose, then report

Read [references/metrics.md](references/metrics.md) for what each metric can and cannot prove, the funnel order to walk, and the report shape. Read [references/troubleshooting.md](references/troubleshooting.md) only when the collector fails or a page comes back empty or stale.

Two rules that decide whether the review is credible:

- **Exposure is cumulative and ages at different rates.** A six-day-old note and a two-hour-old note cannot be compared on exposure. Compare rates — cover CTR, watch seconds, engagement per view — and treat raw exposure as context.
- **Do not judge a note inside its first 72 hours.** Xiaohongshu keeps distributing, and both CTR and watch time move for days. Say so instead of ranking a fresh note as a failure.

Close with the smallest set of changes that addresses the actual bottleneck, each with a number that would confirm it worked (for example "next note's cover CTR ≥ 9%, the current best"). If the fix needs new titles or covers, stop there and let the user decide before generating assets.
