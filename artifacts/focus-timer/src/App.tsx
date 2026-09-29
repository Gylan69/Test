import { type CSSProperties, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Bell,
  BellOff,
  Check,
  ChevronRight,
  CircleHelp,
  Coffee,
  Flag,
  Hourglass,
  Keyboard,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Sun,
  Timer,
  Volume2,
  VolumeX,
  Watch,
} from 'lucide-react';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const STORAGE_KEY = 'focus-timer-state-v1';
const THEME_KEY = 'focus-timer-theme';
const DEFAULT_COUNTDOWN = 25 * 60 * 1000;
const POMODORO_DURATIONS = {
  work: 25 * 60 * 1000,
  shortBreak: 5 * 60 * 1000,
  longBreak: 15 * 60 * 1000,
} as const;

type Mode = 'countdown' | 'stopwatch' | 'pomodoro';
type PomodoroPhase = keyof typeof POMODORO_DURATIONS;
type Lap = { id: string; elapsed: number; createdAt: number };

type TimerState = {
  mode: Mode;
  countdownRemainingMs: number;
  countdownDurationMs: number;
  countdownRunning: boolean;
  countdownDeadline: number | null;
  stopwatchElapsedMs: number;
  stopwatchRunning: boolean;
  stopwatchStartedAt: number | null;
  laps: Lap[];
  pomodoroPhase: PomodoroPhase;
  pomodoroRemainingMs: number;
  pomodoroRunning: boolean;
  pomodoroDeadline: number | null;
  autoTransition: boolean;
  cycleCount: number;
  muted: boolean;
  volume: number;
};

const defaultState: TimerState = {
  mode: 'countdown',
  countdownRemainingMs: DEFAULT_COUNTDOWN,
  countdownDurationMs: DEFAULT_COUNTDOWN,
  countdownRunning: false,
  countdownDeadline: null,
  stopwatchElapsedMs: 0,
  stopwatchRunning: false,
  stopwatchStartedAt: null,
  laps: [],
  pomodoroPhase: 'work',
  pomodoroRemainingMs: POMODORO_DURATIONS.work,
  pomodoroRunning: false,
  pomodoroDeadline: null,
  autoTransition: true,
  cycleCount: 0,
  muted: false,
  volume: 0.65,
};

function loadState(): TimerState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<TimerState> | null;
    if (!saved) return defaultState;
    return {
      ...defaultState,
      ...saved,
      laps: Array.isArray(saved.laps) ? saved.laps : [],
      countdownDeadline: typeof saved.countdownDeadline === 'number' ? saved.countdownDeadline : null,
      stopwatchStartedAt: typeof saved.stopwatchStartedAt === 'number' ? saved.stopwatchStartedAt : null,
      pomodoroDeadline: typeof saved.pomodoroDeadline === 'number' ? saved.pomodoroDeadline : null,
    };
  } catch {
    return defaultState;
  }
}

function loadTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem(THEME_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function formatPomodoro(ms: number) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatStopwatch(ms: number) {
  const hundredths = Math.floor(Math.max(0, ms) / 10) % 100;
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

function splitCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  };
}

function phaseLabel(phase: PomodoroPhase) {
  if (phase === 'work') return 'Deep work';
  if (phase === 'shortBreak') return 'Short break';
  return 'Long break';
}

function phaseDuration(phase: PomodoroPhase) {
  return POMODORO_DURATIONS[phase];
}

function isEditableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return element?.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element?.tagName ?? '');
}

function playCompletionChime(volume: number, muted: boolean) {
  if (muted || typeof window === 'undefined') return;
  const AudioCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtor) return;
  const context = new AudioCtor();
  const gain = context.createGain();
  gain.gain.setValueAtTime(Math.max(0.02, volume * 0.14), context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 1.15);
  gain.connect(context.destination);
  [523.25, 659.25, 783.99].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    oscillator.connect(gain);
    oscillator.start(context.currentTime + index * 0.12);
    oscillator.stop(context.currentTime + 0.12 + index * 0.12);
  });
  window.setTimeout(() => void context.close(), 1800);
}

function sendCompletionNotification(label: string) {
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(`${label} complete`, {
      body: label === 'Deep work' ? 'A small pause is waiting for you.' : 'Ready when you are.',
      icon: '/favicon.ico',
    });
  }
}

function IconButton({
  label,
  testId,
  children,
  onClick,
  active = false,
}: {
  label: string;
  testId: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      data-active={active}
      onClick={onClick}
      className="utility-button flex h-10 w-10 items-center justify-center rounded-full"
    >
      {children}
    </button>
  );
}

function ModeSelector({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  const modes: Array<{ id: Mode; label: string; icon: ReactNode }> = [
    { id: 'countdown', label: 'Countdown', icon: <Hourglass size={15} strokeWidth={2.2} /> },
    { id: 'stopwatch', label: 'Stopwatch', icon: <Watch size={15} strokeWidth={2.2} /> },
    { id: 'pomodoro', label: 'Pomodoro', icon: <Coffee size={15} strokeWidth={2.2} /> },
  ];
  return (
    <div className="flex w-full max-w-xl items-center justify-center gap-1 rounded-full border border-border/80 bg-secondary/45 p-1.5" role="tablist" aria-label="Timer mode">
      {modes.map((item) => (
        <button
          type="button"
          key={item.id}
          role="tab"
          aria-selected={mode === item.id}
          data-testid={`button-mode-${item.id}`}
          data-active={mode === item.id}
          onClick={() => onChange(item.id)}
          className="mode-button flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-3 py-2 text-xs font-bold tracking-[.02em] text-muted-foreground sm:px-5"
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function CountdownEditor({
  state,
  onChange,
}: {
  state: TimerState;
  onChange: (part: 'hours' | 'minutes' | 'seconds', value: number) => void;
}) {
  const values = splitCountdown(state.countdownRemainingMs);
  return (
    <div className="mt-5 flex items-center justify-center gap-2 sm:gap-3" data-testid="countdown-editor">
      {(['hours', 'minutes', 'seconds'] as const).map((part, index) => (
        <div className="flex items-center gap-2 sm:gap-3" key={part}>
          <label className="relative">
            <span className="sr-only">{part}</span>
            <input
              type="number"
              min={0}
              max={part === 'hours' ? 99 : 59}
              value={String(values[part]).padStart(2, '0')}
              disabled={state.countdownRunning}
              aria-label={`${part} for countdown`}
              data-testid={`input-countdown-${part}`}
              onChange={(event) => onChange(part, Number(event.target.value))}
              className="w-[4.1rem] rounded-xl border border-border/80 bg-background/75 px-2 py-2 text-center font-timer text-sm font-medium text-foreground shadow-sm disabled:cursor-not-allowed disabled:opacity-55 sm:w-[5rem] sm:text-base"
            />
          </label>
          {index < 2 && <span className="font-timer text-lg text-muted-foreground/70">:</span>}
        </div>
      ))}
    </div>
  );
}

function AppHome() {
  const [state, setState] = useState<TimerState>(loadState);
  const [theme, setTheme] = useState<'light' | 'dark'>(loadTheme);
  const [now, setNow] = useState(() => Date.now());
  const [notificationPermission, setNotificationPermission] = useState<string>(
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );
  const completedDeadline = useRef<number | null>(null);

  const updateState = useCallback((updates: Partial<TimerState> | ((previous: TimerState) => TimerState)) => {
    setState((previous) => (typeof updates === 'function' ? updates(previous) : { ...previous, ...updates }));
  }, []);

  const countdownMs = state.countdownRunning && state.countdownDeadline
    ? Math.max(0, state.countdownDeadline - now)
    : state.countdownRemainingMs;
  const stopwatchMs = state.stopwatchRunning && state.stopwatchStartedAt
    ? state.stopwatchElapsedMs + Math.max(0, now - state.stopwatchStartedAt)
    : state.stopwatchElapsedMs;
  const pomodoroMs = state.pomodoroRunning && state.pomodoroDeadline
    ? Math.max(0, state.pomodoroDeadline - now)
    : state.pomodoroRemainingMs;

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  useEffect(() => {
    const tick = () => {
      const current = Date.now();
      setNow(current);
      if (state.countdownRunning && state.countdownDeadline && current >= state.countdownDeadline) {
        if (completedDeadline.current !== state.countdownDeadline) {
          completedDeadline.current = state.countdownDeadline;
          playCompletionChime(state.volume, state.muted);
          sendCompletionNotification('Countdown');
          updateState({ countdownRemainingMs: 0, countdownRunning: false, countdownDeadline: null });
        }
      }
      if (state.pomodoroRunning && state.pomodoroDeadline && current >= state.pomodoroDeadline) {
        if (completedDeadline.current !== state.pomodoroDeadline) {
          completedDeadline.current = state.pomodoroDeadline;
          const finishedPhase = state.pomodoroPhase;
          const nextPhase: PomodoroPhase = finishedPhase === 'work'
            ? (state.cycleCount + 1 >= 4 ? 'longBreak' : 'shortBreak')
            : 'work';
          const nextRemaining = phaseDuration(nextPhase);
          playCompletionChime(state.volume, state.muted);
          sendCompletionNotification(phaseLabel(finishedPhase));
          if (state.autoTransition) {
            updateState((previous) => ({
              ...previous,
              pomodoroPhase: nextPhase,
              pomodoroRemainingMs: nextRemaining,
              pomodoroRunning: true,
              pomodoroDeadline: current + nextRemaining,
              cycleCount: finishedPhase === 'work' ? previous.cycleCount + 1 : previous.cycleCount,
            }));
          } else {
            updateState((previous) => ({
              ...previous,
              pomodoroRemainingMs: 0,
              pomodoroRunning: false,
              pomodoroDeadline: null,
              cycleCount: finishedPhase === 'work' ? previous.cycleCount + 1 : previous.cycleCount,
            }));
          }
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    let frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [
    state.autoTransition,
    state.countdownDeadline,
    state.countdownRunning,
    state.mode,
    state.muted,
    state.pomodoroDeadline,
    state.pomodoroPhase,
    state.pomodoroRunning,
    state.cycleCount,
    state.volume,
    updateState,
  ]);

  useEffect(() => {
    const display = state.mode === 'countdown'
      ? formatCountdown(countdownMs)
      : state.mode === 'stopwatch'
        ? formatStopwatch(stopwatchMs)
        : formatPomodoro(pomodoroMs);
    document.title = `(${display}) Timer`;
  }, [countdownMs, pomodoroMs, state.mode, stopwatchMs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        if (state.mode === 'countdown') toggleCountdown();
        if (state.mode === 'stopwatch') toggleStopwatch();
        if (state.mode === 'pomodoro') togglePomodoro();
      }
      if (event.key.toLowerCase() === 'r') resetActive();
      if (event.key.toLowerCase() === 'l' && state.mode === 'stopwatch') addLap();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  const toggleCountdown = () => {
    const current = Date.now();
    if (state.countdownRunning && state.countdownDeadline) {
      updateState({ countdownRemainingMs: Math.max(0, state.countdownDeadline - current), countdownRunning: false, countdownDeadline: null });
      return;
    }
    const remaining = countdownMs > 0 ? countdownMs : state.countdownDurationMs;
    completedDeadline.current = null;
    updateState({ countdownRemainingMs: remaining, countdownRunning: true, countdownDeadline: current + remaining });
  };

  const resetCountdown = () => updateState({
    countdownRemainingMs: state.countdownDurationMs,
    countdownRunning: false,
    countdownDeadline: null,
  });

  const setCountdownPart = (part: 'hours' | 'minutes' | 'seconds', value: number) => {
    if (state.countdownRunning) return;
    const current = splitCountdown(countdownMs);
    const next = Math.max(0, Number.isFinite(value) ? value : 0);
    const total = (part === 'hours' ? next : current.hours) * 3600000
      + (part === 'minutes' ? Math.min(59, next) : current.minutes) * 60000
      + (part === 'seconds' ? Math.min(59, next) : current.seconds) * 1000;
    updateState({ countdownRemainingMs: total, countdownDurationMs: total, countdownDeadline: null });
  };

  const addCountdownTime = (amount: number) => {
    const next = countdownMs + amount;
    updateState({
      countdownRemainingMs: next,
      countdownDurationMs: state.countdownDurationMs + amount,
      countdownDeadline: state.countdownRunning && state.countdownDeadline ? Date.now() + next : null,
    });
  };

  const toggleStopwatch = () => {
    const current = Date.now();
    if (state.stopwatchRunning && state.stopwatchStartedAt) {
      updateState({
        stopwatchElapsedMs: state.stopwatchElapsedMs + current - state.stopwatchStartedAt,
        stopwatchRunning: false,
        stopwatchStartedAt: null,
      });
    } else {
      updateState({ stopwatchRunning: true, stopwatchStartedAt: current });
    }
  };

  const resetStopwatch = () => updateState({ stopwatchElapsedMs: 0, stopwatchRunning: false, stopwatchStartedAt: null, laps: [] });

  const addLap = () => {
    if (stopwatchMs <= 0) return;
    updateState((previous) => ({
      ...previous,
      laps: [{ id: `${Date.now()}-${previous.laps.length}`, elapsed: stopwatchMs, createdAt: Date.now() }, ...previous.laps].slice(0, 30),
    }));
  };

  const togglePomodoro = () => {
    const current = Date.now();
    if (state.pomodoroRunning && state.pomodoroDeadline) {
      updateState({ pomodoroRemainingMs: Math.max(0, state.pomodoroDeadline - current), pomodoroRunning: false, pomodoroDeadline: null });
    } else {
      const remaining = pomodoroMs > 0 ? pomodoroMs : phaseDuration(state.pomodoroPhase);
      completedDeadline.current = null;
      updateState({ pomodoroRemainingMs: remaining, pomodoroRunning: true, pomodoroDeadline: current + remaining });
    }
  };

  const resetPomodoro = () => updateState({
    pomodoroRemainingMs: phaseDuration(state.pomodoroPhase),
    pomodoroRunning: false,
    pomodoroDeadline: null,
    cycleCount: 0,
  });

  const skipPomodoro = () => {
    const nextPhase: PomodoroPhase = state.pomodoroPhase === 'work'
      ? (state.cycleCount + 1 >= 4 ? 'longBreak' : 'shortBreak')
      : 'work';
    updateState({
      pomodoroPhase: nextPhase,
      pomodoroRemainingMs: phaseDuration(nextPhase),
      pomodoroRunning: false,
      pomodoroDeadline: null,
      cycleCount: state.pomodoroPhase === 'work' ? state.cycleCount + 1 : state.cycleCount,
    });
  };

  const resetActive = () => {
    if (state.mode === 'countdown') resetCountdown();
    if (state.mode === 'stopwatch') resetStopwatch();
    if (state.mode === 'pomodoro') resetPomodoro();
  };

  const requestNotifications = async () => {
    if (typeof Notification === 'undefined') return;
    if (Notification.permission !== 'default') {
      setNotificationPermission(Notification.permission);
      return;
    }
    const permission = await Notification.requestPermission();
    setNotificationPermission(permission);
  };

  const activeRunning = state.mode === 'countdown' ? state.countdownRunning : state.mode === 'stopwatch' ? state.stopwatchRunning : state.pomodoroRunning;
  const activeDisplay = state.mode === 'countdown' ? formatCountdown(countdownMs) : state.mode === 'stopwatch' ? formatStopwatch(stopwatchMs) : formatPomodoro(pomodoroMs);
  const progress = state.mode === 'countdown'
    ? (state.countdownDurationMs > 0 ? countdownMs / state.countdownDurationMs : 0)
    : state.mode === 'pomodoro'
      ? pomodoroMs / phaseDuration(state.pomodoroPhase)
      : 0;
  const ringRadius = 145;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringOffset = ringCircumference * (1 - Math.min(1, Math.max(0, progress)));
  const stopwatchParts = useMemo(() => state.laps.map((lap, index) => ({
    ...lap,
    number: state.laps.length - index,
  })), [state.laps]);

  return (
    <div className="app-shell grain">
      <header className="topbar sticky top-0 z-40">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
          <div className="flex items-center gap-3">
            <div className="brand-mark flex h-9 w-9 items-center justify-center rounded-[13px] bg-accent text-accent-foreground">
              <Sparkles size={17} strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-display text-[1.25rem] font-semibold leading-none tracking-tight">Stillpoint</p>
              <p className="mt-1 hidden text-[10px] font-bold uppercase tracking-[.2em] text-muted-foreground sm:block">A place to begin</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconButton
              label={state.muted ? 'Turn completion sound on' : 'Mute completion sound'}
              testId="button-toggle-sound"
              onClick={() => updateState({ muted: !state.muted })}
            >
              {state.muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
            </IconButton>
            <IconButton
              label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
              testId="button-toggle-theme"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-5 pb-16 pt-9 sm:px-8 sm:pt-14">
        <section className="reveal mb-8 flex flex-col items-start justify-between gap-6 sm:mb-10 sm:flex-row sm:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[.2em] text-primary">
              <span className="h-2 w-2 rounded-full bg-accent" />
              {activeRunning ? 'In session' : 'Ready when you are'}
            </div>
            <h1 className="max-w-xl font-display text-5xl font-medium leading-[.95] tracking-[-.045em] sm:text-7xl">
              Make room for<br /><span className="text-primary">one thing.</span>
            </h1>
          </div>
          <p className="max-w-[17rem] text-sm leading-6 text-muted-foreground sm:pb-1">
            A quiet timer for the work in front of you, and the pause that comes after.
          </p>
        </section>

        <div className="reveal reveal-delay-1">
          <ModeSelector mode={state.mode} onChange={(mode) => updateState({ mode })} />
        </div>

        <section className="timer-panel reveal reveal-delay-2 mt-4 overflow-hidden rounded-[2rem] sm:mt-5">
          <div className="flex flex-col items-center px-5 pb-8 pt-8 sm:px-10 sm:pb-12 sm:pt-10">
            {state.mode === 'pomodoro' && (
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-[.18em] text-muted-foreground" data-testid="status-pomodoro-phase">
                {state.pomodoroPhase === 'work' ? <Timer size={14} className="text-primary" /> : <Coffee size={14} className="text-accent" />}
                {phaseLabel(state.pomodoroPhase)}
              </div>
            )}
            <div
              className="relative mt-2 flex aspect-square w-[min(77vw,25rem)] items-center justify-center sm:w-[27rem]"
              aria-label={`${activeDisplay} remaining`}
              data-testid="display-timer"
            >
              <svg className="timer-ring absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 320 320" aria-hidden="true">
                <circle className="timer-ring-track" cx="160" cy="160" r={ringRadius} fill="none" strokeWidth="10" />
                <circle
                  className={`timer-ring-progress ${state.mode === 'pomodoro' && state.pomodoroPhase !== 'work' ? 'break' : ''}`}
                  cx="160"
                  cy="160"
                  r={ringRadius}
                  fill="none"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={ringCircumference}
                  strokeDashoffset={ringOffset}
                />
              </svg>
              <div className="relative flex flex-col items-center">
                <span className="font-timer text-[clamp(2.5rem,11vw,5.55rem)] font-medium leading-none tracking-[-.075em] text-foreground" data-testid="text-timer-value">
                  {activeDisplay}
                </span>
                <span className="mt-4 text-xs font-bold uppercase tracking-[.2em] text-muted-foreground" data-testid="status-timer">
                  {activeRunning ? 'Running' : countdownMs === 0 || pomodoroMs === 0 ? 'Complete' : 'Paused'}
                </span>
              </div>
            </div>

            {state.mode === 'countdown' && (
              <CountdownEditor state={{ ...state, countdownRemainingMs: countdownMs }} onChange={setCountdownPart} />
            )}

            {state.mode === 'pomodoro' && (
              <div className="mt-5 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-semibold">Cycle {Math.min(state.cycleCount + 1, 4)} of 4</span>
                <span className="h-1 w-1 rounded-full bg-border" />
                <button
                  type="button"
                  data-testid="button-skip-phase"
                  onClick={skipPomodoro}
                  className="flex items-center gap-1 font-bold text-primary transition-colors hover:text-accent"
                >
                  Skip phase <ChevronRight size={14} />
                </button>
              </div>
            )}

            <div className="mt-7 flex items-center gap-3">
              <button
                type="button"
                onClick={resetActive}
                aria-label="Reset active timer"
                data-testid="button-reset-timer"
                className="soft-button flex h-12 w-12 items-center justify-center rounded-full"
              >
                <RotateCcw size={17} />
              </button>
              <button
                type="button"
                onClick={state.mode === 'countdown' ? toggleCountdown : state.mode === 'stopwatch' ? toggleStopwatch : togglePomodoro}
                aria-label={activeRunning ? 'Pause timer' : 'Start timer'}
                data-testid={activeRunning ? 'button-pause-timer' : 'button-start-timer'}
                className="primary-cta flex h-14 min-w-[9.5rem] items-center justify-center gap-2 rounded-full px-7 text-sm font-extrabold"
              >
                {activeRunning ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                {activeRunning ? 'Pause' : 'Start'}
              </button>
              {state.mode === 'stopwatch' ? (
                <button
                  type="button"
                  onClick={addLap}
                  disabled={!activeRunning && stopwatchMs === 0}
                  aria-label="Record stopwatch lap"
                  data-testid="button-lap"
                  className="soft-button flex h-12 w-12 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Flag size={17} />
                </button>
              ) : state.mode === 'countdown' ? (
                <div className="flex gap-2">
                  <button type="button" aria-label="Add one minute" data-testid="button-add-one-minute" onClick={() => addCountdownTime(60000)} className="soft-button rounded-full px-3 py-2 text-xs font-bold">+1m</button>
                  <button type="button" aria-label="Add five minutes" data-testid="button-add-five-minutes" onClick={() => addCountdownTime(300000)} className="soft-button rounded-full px-3 py-2 text-xs font-bold">+5m</button>
                </div>
              ) : (
                <div className="w-12" aria-hidden="true" />
              )}
            </div>
          </div>

          {state.mode === 'pomodoro' && (
            <div className="flex flex-col gap-4 border-t border-border/70 bg-secondary/30 px-6 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-10">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  role="switch"
                  aria-checked={state.autoTransition}
                  data-testid="switch-auto-transition"
                  onClick={() => updateState({ autoTransition: !state.autoTransition })}
                  className={`relative h-6 w-11 rounded-full transition-colors ${state.autoTransition ? 'bg-primary' : 'bg-muted-foreground/35'}`}
                >
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${state.autoTransition ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
                <div>
                  <p className="text-sm font-bold">Auto-transition</p>
                  <p className="text-xs text-muted-foreground">Move to the next phase automatically</p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs font-bold text-muted-foreground">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/25 text-accent-foreground">{state.cycleCount}</span>
                completed cycles
              </div>
            </div>
          )}
        </section>

        <section className="reveal reveal-delay-3 mt-5 grid gap-5 lg:grid-cols-[1fr_1.25fr]">
          <div className="stat-card rounded-[1.65rem] p-5 sm:p-6">
            <div className="mb-7 flex items-start justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[.16em] text-muted-foreground">Sound & focus</p>
                <h2 className="mt-2 font-display text-2xl font-semibold">Make the handoff gentle.</h2>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/20 text-accent-foreground">
                {state.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </div>
            </div>
            <label className="block text-xs font-bold text-muted-foreground" htmlFor="volume-control">
              Chime volume <span className="float-right font-timer">{Math.round(state.volume * 100)}%</span>
            </label>
            <input
              id="volume-control"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={state.volume}
              aria-label="Completion chime volume"
              data-testid="input-volume"
              onChange={(event) => updateState({ volume: Number(event.target.value) })}
              className="mt-3 h-2 w-full cursor-pointer accent-[hsl(var(--primary))]"
            />
            <div className="mt-6 flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/40 p-3">
              <div className="flex items-center gap-3">
                {notificationPermission === 'granted' ? <Bell size={17} className="text-primary" /> : <BellOff size={17} className="text-muted-foreground" />}
                <div>
                  <p className="text-xs font-bold">Desktop notifications</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {notificationPermission === 'granted' ? 'You’ll hear when a phase ends.' : notificationPermission === 'denied' ? 'Blocked by your browser.' : 'Optional, for background focus.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={requestNotifications}
                disabled={notificationPermission === 'granted' || notificationPermission === 'unsupported' || notificationPermission === 'denied'}
                data-testid="button-notification-permission"
                className="shrink-0 rounded-full border border-border bg-card px-3 py-2 text-[11px] font-extrabold text-primary transition-colors hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
              >
                {notificationPermission === 'granted' ? <Check size={14} /> : 'Allow'}
              </button>
            </div>
          </div>

          <div className="stat-card rounded-[1.65rem] p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between">
              <div>
                <p className="text-xs font-extrabold uppercase tracking-[.16em] text-muted-foreground">Session notes</p>
                <h2 className="mt-2 font-display text-2xl font-semibold">Keep your rhythm.</h2>
              </div>
              {state.mode === 'stopwatch' && <span className="rounded-full bg-primary/10 px-3 py-1.5 font-timer text-xs font-medium text-primary" data-testid="text-lap-count">{state.laps.length} laps</span>}
            </div>
            {state.mode === 'stopwatch' && stopwatchParts.length > 0 ? (
              <div className="max-h-44 space-y-2 overflow-auto pr-1" data-testid="list-laps">
                {stopwatchParts.map((lap) => (
                  <div key={lap.id} className="flex items-center justify-between rounded-xl bg-background/45 px-3 py-2.5 text-sm" data-testid={`row-lap-${lap.id}`}>
                    <span className="flex items-center gap-2 text-xs font-bold text-muted-foreground"><Flag size={13} /> Lap {lap.number}</span>
                    <span className="font-timer text-xs font-medium">{formatStopwatch(lap.elapsed)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex min-h-[8.2rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-background/25 px-5 text-center">
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary"><CircleHelp size={16} /></div>
                <p className="text-sm font-bold">Your next checkpoint lives here.</p>
                <p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Switch to the stopwatch and tap the flag whenever you want to mark a moment.</p>
              </div>
            )}
          </div>
        </section>

        <footer className="mt-8 flex flex-col items-center justify-between gap-3 border-t border-border/65 pt-5 text-[11px] font-semibold text-muted-foreground sm:flex-row">
          <p className="flex items-center gap-2"><Keyboard size={13} /> Space start/pause <span className="text-border">·</span> R reset <span className="text-border">·</span> L lap</p>
          <p className="flex items-center gap-1.5"><Plus size={12} /> Everything stays on this device.</p>
        </footer>
      </main>
    </div>
  );
}

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={AppHome} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;