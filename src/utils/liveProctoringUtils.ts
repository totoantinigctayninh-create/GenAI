import {
  SessionAttemptRecord,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession';
import { doesViolationCountTowardLimit } from './liveExamHelpers';

export const VIOLATION_BEHAVIOR_LABELS: Record<ViolationEventType, string> = {
  tab_switch: 'Chuyển tab / Ẩn trình duyệt',
  window_blur: 'Rời cửa sổ làm bài (Alt+Tab)',
  fullscreen_exit: 'Thoát chế độ toàn màn hình',
  blocked_key: 'Bấm phím tắt bị chặn',
  phim_bi_chan: 'Thao tác / Phím bị chặn',
  window_resize: 'Thu nhỏ / Chia đôi màn hình',
  multi_screen: 'Kết nối nhiều màn hình',
  copy_paste: 'Sao chép / Dán nội dung',
  devtools: 'Mở công cụ lập trình (DevTools)',
  multi_device: 'Đăng nhập nhiều thiết bị',
  other: 'Hành vi bất thường khác',
};

export type ViolationFeedSeverity = 'critical' | 'warning' | 'info';
export type ViolationFeedCategoryFilter =
  | 'all'
  | 'screen_leave'
  | 'blocked_action';

export interface FormattedExactTimestamp {
  time: string;
  date: string;
  full: string;
}

export interface LiveViolationFeedItem {
  id: string;
  attemptId: string;
  studentId: string;
  studentName: string;
  username: string;
  className: string;
  type: ViolationEventType;
  typeLabel: string;
  countsTowardLimit: boolean;
  severity: ViolationFeedSeverity;
  occurredAt: string;
  timestampMs: number;
  timeFormatted: string;
  dateFormatted: string;
  fullTimestamp: string;
  awaySeconds: number;
  currentQuestionOrder: number;
  note?: string;
  studentViolationCount: number;
  maxViolations: number;
  studentStatus: SessionAttemptRecord['status'] | 'unknown';
  isAutoSubmitTrigger: boolean;
}

/**
 * Định dạng mốc thời gian ghi nhận gian lận chính xác đến từng giây (`HH:mm:ss` và `dd/MM/yyyy`).
 */
export function formatExactViolationTimestamp(
  iso: string
): FormattedExactTimestamp {
  const dateObj = new Date(iso);
  if (Number.isNaN(dateObj.getTime())) {
    return { time: '--:--:--', date: '--/--/----', full: '--:--:--' };
  }
  const hh = String(dateObj.getHours()).padStart(2, '0');
  const mm = String(dateObj.getMinutes()).padStart(2, '0');
  const ss = String(dateObj.getSeconds()).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const mo = String(dateObj.getMonth() + 1).padStart(2, '0');
  const yyyy = String(dateObj.getFullYear());
  const time = `${hh}:${mm}:${ss}`;
  const date = `${dd}/${mo}/${yyyy}`;
  return {
    time,
    date,
    full: `${time} · ${date}`,
  };
}

/**
 * Định dạng thời gian rời màn hình bằng tiếng Việt ngắn gọn.
 */
export function formatAwayDurationVietnamese(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  if (safe === 0) return '';
  if (safe < 60) return `${safe} giây`;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return secs > 0 ? `${mins}p ${secs}s` : `${mins} phút`;
}

/**
 * Xây dựng dòng thời gian sự kiện gian lận (mới nhất lên đầu) cho màn hình Giám sát thời gian thực.
 */
export function buildLiveViolationTimeline(
  violations: ViolationEventRecord[],
  attempts: SessionAttemptRecord[],
  maxViolations: number
): LiveViolationFeedItem[] {
  const safeMax = Math.max(1, Math.floor(Number(maxViolations) || 3));
  const attemptById = new Map<string, SessionAttemptRecord>();
  const latestAttemptByStudent = new Map<string, SessionAttemptRecord>();

  for (const att of attempts) {
    attemptById.set(att.id, att);
    const existing = latestAttemptByStudent.get(att.studentId);
    if (
      !existing ||
      new Date(att.startedAt).getTime() >= new Date(existing.startedAt).getTime()
    ) {
      latestAttemptByStudent.set(att.studentId, att);
    }
  }

  const enriched: LiveViolationFeedItem[] = violations.map((v) => {
    const attempt =
      attemptById.get(v.attemptId) || latestAttemptByStudent.get(v.studentId);
    const ts = formatExactViolationTimestamp(v.occurredAt);
    const tsMs = new Date(v.occurredAt).getTime();
    const countsTowardLimit = doesViolationCountTowardLimit(v.type);
    const studentViolationCount = attempt?.violationCount ?? (countsTowardLimit ? 1 : 0);
    const isAutoSubmitTrigger = Boolean(
      countsTowardLimit &&
        attempt?.submitReason === 'violation' &&
        studentViolationCount >= safeMax
    );

    let severity: ViolationFeedSeverity = 'info';
    if (countsTowardLimit) {
      severity = studentViolationCount >= safeMax ? 'critical' : 'warning';
    }

    return {
      id: v.id,
      attemptId: v.attemptId,
      studentId: v.studentId,
      studentName: attempt?.fullName || attempt?.username || v.studentId,
      username: attempt?.username || v.studentId,
      className: attempt?.className || 'Chưa phân lớp',
      type: v.type,
      typeLabel: VIOLATION_BEHAVIOR_LABELS[v.type] || v.type,
      countsTowardLimit,
      severity,
      occurredAt: v.occurredAt,
      timestampMs: Number.isNaN(tsMs) ? 0 : tsMs,
      timeFormatted: ts.time,
      dateFormatted: ts.date,
      fullTimestamp: ts.full,
      awaySeconds: Math.max(0, Math.floor(Number(v.awaySeconds) || 0)),
      currentQuestionOrder: Math.max(
        1,
        Math.floor(Number(v.currentQuestionOrder) || 1)
      ),
      ...(v.note ? { note: v.note } : {}),
      studentViolationCount,
      maxViolations: safeMax,
      studentStatus: attempt?.status ?? 'unknown',
      isAutoSubmitTrigger,
    };
  });

  enriched.sort((a, b) => {
    if (b.timestampMs !== a.timestampMs) {
      return b.timestampMs - a.timestampMs;
    }
    return b.id.localeCompare(a.id);
  });

  return enriched;
}

/**
 * Lọc dòng sự kiện gian lận theo nhóm hành vi và từ khóa tìm kiếm.
 */
export function filterLiveViolationTimeline(
  items: LiveViolationFeedItem[],
  options: {
    category: ViolationFeedCategoryFilter;
    searchQuery?: string;
    studentUsername?: string | null;
  }
): LiveViolationFeedItem[] {
  const q = (options.searchQuery || '').trim().toLowerCase();
  const targetUser = (options.studentUsername || '').trim().toLowerCase();

  return items.filter((item) => {
    if (options.category === 'screen_leave' && !item.countsTowardLimit) {
      return false;
    }
    if (options.category === 'blocked_action' && item.countsTowardLimit) {
      return false;
    }
    if (targetUser && item.username.toLowerCase() !== targetUser) {
      return false;
    }
    if (q) {
      const hay = `${item.studentName} ${item.username} ${item.className} ${item.typeLabel} ${item.note || ''} ${item.timeFormatted}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/**
 * Tạo mô tả ngắn gọn 1 dòng cho hành vi gian lận gần nhất của một học sinh ngay trên hàng bảng giám sát.
 */
export function formatLatestViolationInlineSummary(
  violation: ViolationEventRecord | undefined
): string | null {
  if (!violation) return null;
  const ts = formatExactViolationTimestamp(violation.occurredAt);
  const label = VIOLATION_BEHAVIOR_LABELS[violation.type] || violation.type;
  const awayPart =
    violation.awaySeconds > 0
      ? ` (${formatAwayDurationVietnamese(violation.awaySeconds)})`
      : '';
  return `${ts.time} · ${label}${awayPart}`;
}
