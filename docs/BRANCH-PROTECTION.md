# main is protected (Nov 17, 2026)

Every change reaches `main` through a pull request that passed its tests. Nobody pushes to `main` directly:
not Vesper, not the scheduled Claude roles, not Matthew's own account (they all use that account, so the rule
applies to admins too).

## The rule on `main`
| Setting | Value | Why |
|---|---|---|
| Require a pull request before merging | on, 0 approvals | Everyone is the same GitHub account, so an approval proves nothing; the required checks do the work. |
| Required status checks | `checks` (PR checks) and `protected-files` (Protected files), both from GitHub Actions only | Tests must pass. Pinned to GitHub Actions so a hand-posted "success" status can't stand in for a real run. |
| Require branches to be up to date | off | The ship gate already merges `main` into a branch before testing it. |
| Do not allow bypassing (include administrators) | on | Without it every agent could skip the rule. |
| Force pushes / deletion of `main` | blocked | |

`checks` is `.github/workflows/pr-checks.yml`: syntax, plan logic, push/webhook/ask tests and the full phone-browser
test against a local copy (about 11 minutes). `protected-files` is `.github/workflows/protect-guard.yml`: it runs
from `main`'s copy and fails if a pull request edits `pr-checks.yml`, `protect-guard.yml`, `ship-gate-guard.yml` or
`CODEOWNERS`, so no pull request can weaken the checks that judge it.

## How work reaches main now
- **App changes** (`index.html`, `plan.js`, `sw.js`, `api/`): the hourly ship gate tests the pull request and squash-merges
  it once `checks` is green. A merge refused because checks are still running is retried on the next run.
- **Website, images, the member email, docs** (`home/`, `brand/`, `mail/`, `README.md`): the role that made the change
  opens a pull request, waits for the checks, then squash-merges it itself.
- **Rollbacks**: the ship gate opens a revert pull request; it merges once its checks pass (about 11 minutes).
- **Deploys are unchanged**: a merge to `main` still triggers Pages (app and site) and `api.yml` (Worker + migrations).

## Owner emergency procedure (Matthew only)
Use this only if something urgent can't wait for the checks (GitHub Actions is down, the site is broken and a
revert is stuck, or a guard file itself needs changing).
1. On github.com, signed in as matthewbaconn: **Hybrid → Settings → Branches → the `main` rule → Edit**.
2. Untick **Do not allow bypassing the above settings**, then **Save changes**. Admins can now merge without the checks.
3. Make the one fix (merge the pull request, or push the revert). Prefer a pull request even now.
4. Go back to the same rule, tick **Do not allow bypassing the above settings** again, **Save changes**.
5. Tell Vesper "branch protection back on". The nightly audit also checks the rule every night and reports if
   bypassing is still allowed or a required check is missing.

The previous settings are backed up in vesper-relay `ceo/backups/2026-11-17-branch-protection/`. To undo step 5
entirely, Matthew deletes the `main` rule in the same Settings page (and restores the role instructions from that
backup so the roles push directly again).

Live verification of this rule (Nov 17, 2026): see vesper-relay ceo/backups/2026-11-17-branch-protection/VERIFICATION.md.
