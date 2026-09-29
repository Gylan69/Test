# Stillpoint

A responsive single-page app for countdowns, stopwatch laps, and Pomodoro focus sessions.

## Run & Operate

- `pnpm --filter @workspace/focus-timer run typecheck` — check the timer app
- Start or restart its existing `artifacts/focus-timer: web` workflow for the preview.
- No database, API, or secrets are required for the timer app.

## Stack

- React, TypeScript, Vite, Tailwind CSS in a pnpm workspace
- Browser Web Audio API and Notification API; localStorage for persistence

## Where things live

- `artifacts/focus-timer/src/App.tsx` — timer state, interaction logic, and UI
- `artifacts/focus-timer/src/index.css` — theme and responsive styling
- `artifacts/focus-timer/index.html` — page metadata

## Architecture decisions

- Timing is derived from wall-clock timestamps, not interval tick counts. This keeps running timers accurate after background throttling and refresh.
- Timer state stays local to this browser; it is not synced across devices.

## Product

Countdown with quick-add and progress ring; hundredths stopwatch with laps; Pomodoro presets, automatic transitions and completed-session count. Includes chime volume/mute, optional desktop notifications, theme persistence, keyboard shortcuts and live tab title.

## User preferences

- Keep this a modern, responsive single-page timer. Preserve all three modes and local persistence.

## Gotchas

- Browser notifications need permission and a secure context. Sound may require a user interaction before browsers allow playback.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
