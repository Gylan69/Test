import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';

const STORAGE_KEY = 'focus-timer-state-v1';
const minute = 60_000;
const second = 1_000;

let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;

function runFrame() {
  act(() => {
    const pending = [...frames.values()];
    frames.clear();
    pending.forEach((callback) => callback(Date.now()));
  });
}

function advanceBy(milliseconds: number) {
  vi.setSystemTime(Date.now() + milliseconds);
  runFrame();
}

function reload() {
  cleanup();
  render(<App />);
  runFrame();
}

function display() {
  return screen.getByTestId('text-timer-value').textContent;
}

function savedState() {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null');
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));
  localStorage.clear();
  frames = new Map();
  nextFrame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('timer session persistence', () => {
  it('restores a running countdown from its deadline, and keeps a paused countdown fixed across reloads', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('button-start-timer'));
    const deadline = savedState().countdownDeadline;
    expect(deadline).toBe(Date.now() + 25 * minute);

    vi.setSystemTime(Date.now() + 90 * second);
    reload();
    expect(display()).toBe('00:23:30');
    expect(screen.getByTestId('status-timer').textContent).toBe('Running');
    expect(savedState().countdownDeadline).toBe(deadline);

    fireEvent.click(screen.getByTestId('button-pause-timer'));
    expect(savedState()).toMatchObject({ countdownRemainingMs: 23.5 * minute, countdownRunning: false, countdownDeadline: null });
    vi.setSystemTime(Date.now() + 10 * minute);
    reload();
    expect(display()).toBe('00:23:30');
    fireEvent.click(screen.getByTestId('button-start-timer'));
    advanceBy(30 * second);
    expect(display()).toBe('00:23:00');

    vi.setSystemTime(Date.now() + 24 * minute);
    reload();
    expect(display()).toBe('00:00:00');
    expect(screen.getByTestId('status-timer').textContent).toBe('Complete');
    expect(savedState()).toMatchObject({ countdownRunning: false, countdownRemainingMs: 0, countdownDeadline: null });
  });

  it('restores stopwatch elapsed time and lap history, including while running', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('button-mode-stopwatch'));
    fireEvent.click(screen.getByTestId('button-start-timer'));
    const startedAt = savedState().stopwatchStartedAt;
    advanceBy(12_340);
    fireEvent.click(screen.getByTestId('button-lap'));
    advanceBy(7_660);
    fireEvent.click(screen.getByTestId('button-lap'));
    expect(savedState().laps.map((lap: { elapsed: number }) => lap.elapsed)).toEqual([20_000, 12_340]);

    vi.setSystemTime(Date.now() + 5 * minute);
    reload();
    expect(display()).toBe('05:20.00');
    expect(screen.getByTestId('text-lap-count').textContent).toBe('2 laps');
    expect(screen.getByTestId('list-laps').textContent).toContain('00:20.00');
    expect(screen.getByTestId('list-laps').textContent).toContain('00:12.34');
    expect(savedState().stopwatchStartedAt).toBe(startedAt);

    fireEvent.click(screen.getByTestId('button-pause-timer'));
    expect(savedState()).toMatchObject({ stopwatchElapsedMs: 320_000, stopwatchRunning: false, stopwatchStartedAt: null });
    vi.setSystemTime(Date.now() + minute);
    reload();
    expect(display()).toBe('05:20.00');
    expect(screen.getByTestId('text-lap-count').textContent).toBe('2 laps');
  });

  it('moves to a long break after the fourth completed work session, then starts the next cycle', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('button-mode-pomodoro'));
    fireEvent.click(screen.getByTestId('button-start-timer'));

    for (let work = 1; work <= 4; work++) {
      advanceBy(25 * minute);
      expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe(work === 4 ? 'Long break' : 'Short break');
      expect(savedState()).toMatchObject({
        cycleCount: work,
        pomodoroRunning: true,
        pomodoroPhase: work === 4 ? 'longBreak' : 'shortBreak',
      });
      if (work < 4) {
        advanceBy(5 * minute);
        expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Deep work');
      }
    }

    vi.setSystemTime(Date.now() + 15 * minute);
    reload();
    expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Deep work');
    expect(screen.getByTestId('status-timer').textContent).toBe('Running');
    expect(savedState()).toMatchObject({ cycleCount: 4, pomodoroPhase: 'work' });
    advanceBy(25 * minute);
    expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Short break');
    expect(savedState().cycleCount).toBe(5);
  });

  it('catches up across several Pomodoro phases after a backgrounded tab or reload', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('button-mode-pomodoro'));
    fireEvent.click(screen.getByTestId('button-start-timer'));
    const originalDeadline = savedState().pomodoroDeadline;

    // No animation frames are delivered while the tab is away.
    vi.setSystemTime(Date.now() + 25 * minute + 5 * minute + 25 * minute + 2 * minute);
    runFrame();
    expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Short break');
    expect(display()).toBe('03:00');
    expect(savedState()).toMatchObject({
      cycleCount: 2,
      pomodoroRemainingMs: 3 * minute,
      pomodoroDeadline: originalDeadline + 5 * minute + 25 * minute + 5 * minute,
    });

    // Miss the rest of that break and the following work session during a reload.
    vi.setSystemTime(Date.now() + 3 * minute + 25 * minute + minute);
    reload();
    expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Short break');
    expect(display()).toBe('04:00');
    expect(savedState()).toMatchObject({ cycleCount: 3, pomodoroRunning: true, pomodoroRemainingMs: 4 * minute });
  });

  it('keeps an expired Pomodoro phase complete after reload when auto-transition is off', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('button-mode-pomodoro'));
    fireEvent.click(screen.getByTestId('switch-auto-transition'));
    fireEvent.click(screen.getByTestId('button-start-timer'));
    vi.setSystemTime(Date.now() + 26 * minute);
    reload();

    expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Deep work');
    expect(display()).toBe('00:00');
    expect(screen.getByTestId('status-timer').textContent).toBe('Complete');
    expect(savedState()).toMatchObject({
      pomodoroPhase: 'work',
      pomodoroRemainingMs: 0,
      pomodoroRunning: false,
      pomodoroDeadline: null,
      cycleCount: 1,
      autoTransition: false,
    });
    advanceBy(10 * minute);
    expect(savedState().cycleCount).toBe(1);
    expect(display()).toBe('00:00');
  });

  it('selects the long break only after four completed manual work sessions, including after reload', () => {
    render(<App />);
    fireEvent.click(screen.getByTestId('button-mode-pomodoro'));
    fireEvent.click(screen.getByTestId('switch-auto-transition'));

    for (let work = 1; work <= 4; work++) {
      fireEvent.click(screen.getByTestId('button-start-timer'));
      vi.setSystemTime(Date.now() + 25 * minute);
      reload();
      expect(display()).toBe('00:00');
      expect(savedState().cycleCount).toBe(work);
      fireEvent.click(screen.getByTestId('button-skip-phase'));
      expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe(work === 4 ? 'Long break' : 'Short break');
      expect(savedState().cycleCount).toBe(work);
      if (work < 4) {
        fireEvent.click(screen.getByTestId('button-skip-phase'));
        expect(screen.getByTestId('status-pomodoro-phase').textContent).toBe('Deep work');
      }
    }
  });
});