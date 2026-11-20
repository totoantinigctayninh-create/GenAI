import { ExamSessionRecord, ExamSessionStatus } from '../types/examSession';
import { LiveStudentMonitoringRow } from './liveExamHelpers';

export interface ExamSessionPreset {
  id: string;
  label: string;
  subtitle: string;
  questionCount: number;
  durationMinutes: number;
  passScore: number;
  maxViolations: number;
}

export const EXAM_SESSION_PRESETS: ExamSessionPreset[] = [
  {
    id: 'certiport_standard',
    label: 'Chuẩn Certiport',
    subtitle: '45 câu · 50 phút',
    questionCount: 45,
    durationMinutes: 50,
    passScore: 700,
    maxViolations: 3,
  },
  {
    id: 'midterm_30q',
    label: 'Kiểm tra giữa kỳ',
    subtitle: '30 câu · 35 phút',
    questionCount: 30,
    durationMinutes: 35,
    passScore: 700,
    maxViolations: 3,
  },
  {
    id: 'quiz_15m',
    label: 'Kiểm tra 15 phút',
    subtitle: '15 câu · 15 phút',
    questionCount: 15,
    durationMinutes: 15,
    passScore: 700,
    maxViolations: 2,
  },
  {
    id: 'quick_drill',
    label: 'Luyện nhanh',
    subtitle: '10 câu · 10 phút',
    questionCount: 10,
    durationMinutes: 10,
    passScore: 700,
    maxViolations: 5,
  },
];

export interface ExamSessionsOverviewStats {
  totalSessions: number;
  openCount: number;
  lockedCount: number;
  draftCount: number;
  endedCount: number;
  activeStudentsNow: number;
  totalEnteredStudents: number;
  totalSubmittedScripts: number;
}

export type ExamSessionSortMode = 'newest' | 'active_students' | 'title';

export function computeExamSessionsOverviewStats(
  sessions: ExamSessionRecord[]
): ExamSessionsOverviewStats {
  let openCount = 0;
  let lockedCount = 0;
  let draftCount = 0;
  let endedCount = 0;
  let activeStudentsNow = 0;
  let totalEnteredStudents = 0;
  let totalSubmittedScripts = 0;

  for (const s of sessions) {
    if (s.status === 'open') openCount += 1;
    else if (s.status === 'locked') lockedCount += 1;
    else if (s.status === 'draft') draftCount += 1;
    else if (s.status === 'ended') endedCount += 1;

    activeStudentsNow += Math.max(0, s.inProgressCount ?? 0);
    totalEnteredStudents += Math.max(0, s.enteredCount ?? 0);
    totalSubmittedScripts += Math.max(0, s.submittedCount ?? 0);
  }

  return {
    totalSessions: sessions.length,
    openCount,
    lockedCount,
    draftCount,
    endedCount,
    activeStudentsNow,
    totalEnteredStudents,
    totalSubmittedScripts,
  };
}

export function filterAndSortExamSessions(
  sessions: ExamSessionRecord[],
  options: {
    statusFilter: 'ALL' | ExamSessionStatus;
    classFilter: string;
    searchQuery: string;
    sortBy: ExamSessionSortMode;
  }
): ExamSessionRecord[] {
  const q = options.searchQuery.trim().toLowerCase();

  const filtered = sessions.filter((s) => {
    if (options.statusFilter !== 'ALL' && s.status !== options.statusFilter) {
      return false;
    }
    if (options.classFilter !== 'ALL' && s.targetClass !== options.classFilter) {
      return false;
    }
    if (!q) return true;
    return (
      s.title.toLowerCase().includes(q) ||
      s.code.toLowerCase().includes(q) ||
      s.targetClass.toLowerCase().includes(q)
    );
  });

  return [...filtered].sort((a, b) => {
    if (options.sortBy === 'active_students') {
      const diffActive = (b.inProgressCount ?? 0) - (a.inProgressCount ?? 0);
      if (diffActive !== 0) return diffActive;
      return (b.enteredCount ?? 0) - (a.enteredCount ?? 0);
    }
    if (options.sortBy === 'title') {
      return a.title.localeCompare(b.title, 'vi');
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

export function buildSessionShareMessage(session: ExamSessionRecord): string {
  const targetLabel =
    session.targetClass === 'ALL'
      ? 'Tất cả học sinh có mã'
      : `Lớp ${session.targetClass}`;

  return [
    `THÔNG BÁO VÀO PHÒNG THI CERTIPORT GENAI`,
    `• Ca thi: ${session.title}`,
    `• Mã vào thi: ${session.code}`,
    `• Đối tượng: ${targetLabel}`,
    `• Cấu trúc: ${session.questionCount} câu | Thời gian: ${session.durationMinutes} phút | Điểm đạt: ${session.passScore}/1000`,
    `Hướng dẫn: Học sinh đăng nhập hệ thống, chọn mục "Thi ngay" và nhập mã ${session.code} để bắt đầu làm bài.`,
  ].join('\n');
}

export type LiveMonitoringStatusFilter =
  | 'all'
  | 'in_progress'
  | 'submitted'
  | 'not_entered'
  | 'violations';

export function filterLiveMonitoringRowsByStatus(
  rows: LiveStudentMonitoringRow[],
  statusFilter: LiveMonitoringStatusFilter
): LiveStudentMonitoringRow[] {
  switch (statusFilter) {
    case 'in_progress':
      return rows.filter((r) => r.status === 'in_progress');
    case 'submitted':
      return rows.filter((r) => r.status === 'submitted');
    case 'not_entered':
      return rows.filter((r) => r.status === 'not_entered');
    case 'violations':
      return rows.filter((r) => r.violationCount > 0);
    case 'all':
    default:
      return rows;
  }
}

export function toDatetimeLocalValue(isoString: string | null | undefined): string {
  if (!isoString) return '';
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}
