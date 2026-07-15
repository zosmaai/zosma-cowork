# #328 — Close the failure-branch gap (callback must propagate failure)

**Date:** 2026-07-10
**Branch:** `fix/328-cron-oneshot` (continues the two-PR #328 work)
**Issue:** https://github.com/zosmaai/zosma-cowork/issues/328

## Problem

pi-routines PR #2 correctly reorders one-shot removal in `cronScheduler.ts`
`fireTask()` so a one-shot is removed **only** on a successful fire, and kept +
retried (+60s) on failure. But that failure branch is **dead code on the Cowork
path**:

- The scheduler keys everything off the `onFireCallback` promise:
  `resolve → removeTask(one-shot)`, `reject → keep + retry`.
- The Cowork callback is `runTaskFire` (`agent-sidecar/src/task-fire.ts`), whose
  contract is *"Never throws — failures are recorded on the run."* Every failure
  (`createSession` throws, `session.prompt` throws) is caught internally,
  records `status: "failed"`, and **resolves normally**.

So from the scheduler's view every fire looks like success → the one-shot is
removed regardless of whether the prompt was delivered. The #328 symptom (task
vanishes when due, prompt never delivered) still reproduces whenever the
isolated session fails to spawn or the prompt errors.

**Key distinction:** a task whose *content* fails (e.g. a doomed DB fetch) still
`resolve`s `session.prompt()` → recorded as **completed** with the error inside →
correctly removed. That is NOT #328. #328 is a failure of the *fire mechanism*
(`createSession`/`prompt` reject).

## Fix (Part A — code)

1. **`agent-sidecar/src/index.ts`** — in the `__PI_ROUTINES_ON_FIRE` wrapper,
   after `await runTaskFire(...)`, read the run's final status from the store; if
   `"failed"`, `throw` so the scheduler's **reject** branch fires. Keeps
   `runTaskFire`'s "never throws" contract intact (tests depend on it).
2. **`agent-sidecar/src/vendor/pi-routines/src/cronScheduler.ts`** — bound the
   retry: **max 5 attempts**, then give up (leave the run `failed`, stop
   rescheduling). Prevents an endless 60s churn for a permanently broken task.
3. **Test** — unit test driving a *rejecting* `onFireCallback`: assert task is
   **not** removed, run is `failed`, `nextRunAt` bumped by ~60s; and after the
   5th failed attempt the task is no longer rescheduled. This is the coverage the
   PR#2 happy-path E2E was missing.

## Reproduce + screenshot (Part B — libvirt VM via virt-manager)

Reuse the prior clean-VM setup. Traps to avoid (from prior runs):
- Stale `.pi/cowork_tasks.lock` after `pkill` cycles → `tick()` early-returns on
  `!lock.getIsOwner()`. Use a fresh boot / clean lock between builds.
- pi-routines logs go to sidecar **stdout** (JSON protocol), NOT `/tmp/zc.log`.
  Absence of "Firing task" lines is not proof it didn't fire — check
  `.pi/task_runs/*.jsonl`.
- Seed the task via **chat** (AI schedules it) — do not vncdotool-type prompts
  (char mangling).

Order: **before-shots first (today's build), then fix + rebuild, then
after-shots.**

| Shot | Build | Sabotage | Expected |
|---|---|---|---|
| `before-invalidkey-vanish` | HEAD | AI schedules 1-shot → swap API key invalid | task **gone** from Tasks list |
| `before-nomodel-vanish` | HEAD | AI schedules → disconnect model | task **gone** |
| `after-invalidkey-kept` | HEAD+fix | same | task **stays**, `failed` badge, retry ~60s |
| `after-nomodel-kept` | HEAD+fix | same | task **stays**, actionable reason, retry |

Assets → `.pr-assets/328-cron-oneshot/`.

## Done when
- Fix + retry cap + unit test landed, `npx tsc --noEmit` + tests green.
- Both before/after screenshot pairs captured and embedded in the PR.
