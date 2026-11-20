import type {
  ExamSessionStatus,
  SessionRealtimeEvent,
} from '../types/examSession.ts';

export const DEFAULT_SSE_THROTTLE_WINDOW_MS = 1500;

export function isCriticalSessionRealtimeEvent(
  event: SessionRealtimeEvent,
  sessionStatus?: ExamSessionStatus
): boolean {
  if (
    event.type === 'student:submitted' ||
    event.type === 'student:violation' ||
    event.type === 'student:violation_updated'
  ) {
    return true;
  }
  if (
    event.type === 'session:updated' &&
    (sessionStatus === 'locked' || sessionStatus === 'ended')
  ) {
    return true;
  }
  return false;
}

export interface ThrottledSseDispatcher {
  enqueue: (event: SessionRealtimeEvent) => void;
  dispose: () => void;
  hasPending: () => boolean;
}

export interface ThrottledSseDispatcherOptions {
  windowMs?: number;
  onFlush: (latestEvent: SessionRealtimeEvent) => void;
  isCritical?: (event: SessionRealtimeEvent) => boolean;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * Gộp (trailing-edge coalesce) các sự kiện SSE dày đặc trong cửa sổ `windowMs` (mặc định 1500ms)
 * để tránh tính toán lại `getTeacherSessionDetail` hàng trăm lần/giây khi 150+ học sinh đang làm bài.
 * Các sự kiện trọng yếu (khóa/kết thúc ca thi, học sinh nộp bài, tự nộp do vi phạm) được đẩy đi ngay lập tức.
 */
export function createThrottledSseDispatcher(
  options: ThrottledSseDispatcherOptions
): ThrottledSseDispatcher {
  const windowMs = Math.max(50, options.windowMs ?? DEFAULT_SSE_THROTTLE_WINDOW_MS);
  const setTimer = options.setTimer ?? ((cb, ms) => setTimeout(cb, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pendingEvent: SessionRealtimeEvent | null = null;

  const clearPendingTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const flushNow = (event: SessionRealtimeEvent) => {
    clearPendingTimer();
    pendingEvent = null;
    if (disposed) return;
    options.onFlush(event);
  };

  return {
    enqueue(event: SessionRealtimeEvent) {
      if (disposed) return;

      if (options.isCritical?.(event)) {
        flushNow(event);
        return;
      }

      pendingEvent = event;
      if (timer !== null) {
        return;
      }

      timer = setTimer(() => {
        timer = null;
        if (disposed || !pendingEvent) return;
        const latest = pendingEvent;
        pendingEvent = null;
        options.onFlush(latest);
      }, windowMs);
    },

    dispose() {
      disposed = true;
      clearPendingTimer();
      pendingEvent = null;
    },

    hasPending() {
      return pendingEvent !== null || timer !== null;
    },
  };
}
