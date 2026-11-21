import {
  CERTIPORT_PASS_SCORE,
  CERTIPORT_TOPICS,
  ExamAttempt,
  Question,
  UserAccount,
  UserAnswer,
} from '../types/exam';
import { loadXlsx } from './loadXlsx';

export type PracticeAttemptSource = 'practice' | 'live_session';
export type PracticeResultFilter = 'ALL' | 'PASS' | 'FAIL';
export type PracticeDateRangeFilter = 'ALL' | 'TODAY' | '7D' | '30D';
export type PracticeSortField =
  | 'completedAt'
  | 'score'
  | 'percentage'
  | 'duration'
  | 'name';

export interface EnrichedPracticeAttempt {
  attempt: ExamAttempt;
  id: string;
  username: string;
  fullName: string;
  className: string;
  examSet: string;
  modeLabel: string;
  source: PracticeAttemptSource;
  correctCount: number;
  totalQuestions: number;
  percentage: number;
  certiportScore: number;
  passed: boolean;
  durationSeconds: number;
  completedAt: string;
  completedAtMs: number;
}

export interface PracticeFilterOptions {
  searchQuery: string;
  classFilter: string;
  sourceFilter: 'ALL' | PracticeAttemptSource;
  examSetFilter: string;
  resultFilter: PracticeResultFilter;
  dateRangeFilter: PracticeDateRangeFilter;
  scoreBinIndex: number | null;
  sortField: PracticeSortField;
  sortDirection: 'asc' | 'desc';
  nowMs?: number;
}

export interface PracticeScoreBin {
  binIndex: number;
  label: string;
  min: number;
  max: number;
  count: number;
  percent: number;
  isPassZone: boolean;
}

export interface PracticeTopicAggregate {
  topic: string;
  correct: number;
  total: number;
  accuracyPercent: number;
  isWeakest: boolean;
}

export interface PracticeStudentLeaderboardRow {
  username: string;
  fullName: string;
  className: string;
  attemptCount: number;
  passCount: number;
  passRatePercent: number;
  bestScore: number;
  avgScore: number;
  latestScore: number;
  firstScore: number;
  improvementDelta: number;
  totalDurationSeconds: number;
  latestCompletedAt: string;
}

export interface PracticeAnalyticsSummary {
  totalAttempts: number;
  uniqueStudents: number;
  passCount: number;
  failCount: number;
  passRatePercent: number;
  avgScore: number;
  medianScore: number;
  maxScore: number;
  minScore: number;
  avgDurationSeconds: number;
  histogram: PracticeScoreBin[];
  topicAggregates: PracticeTopicAggregate[];
  weakestTopic: PracticeTopicAggregate | null;
  leaderboard: PracticeStudentLeaderboardRow[];
}

export function resolveAttemptCertiportScore(att: ExamAttempt): number {
  if (typeof att.certiportScore === 'number' && Number.isFinite(att.certiportScore)) {
    return Math.max(0, Math.min(1000, Math.round(att.certiportScore)));
  }
  const correct = att.score ?? att.correctCount ?? 0;
  const total = Math.max(1, att.totalQuestions || 1);
  return Math.max(0, Math.min(1000, Math.round((correct / total) * 1000)));
}

export function detectAttemptSource(att: ExamAttempt): PracticeAttemptSource {
  const mode = (att.mode || '').toLowerCase();
  if (mode.startsWith('ca thi:') || mode.includes('phòng thi trực tiếp')) {
    return 'live_session';
  }
  return 'practice';
}

export function enrichPracticeAttempts(
  attempts: ExamAttempt[],
  users: UserAccount[]
): EnrichedPracticeAttempt[] {
  const userById = new Map<string, UserAccount>();
  const userByUsername = new Map<string, UserAccount>();
  for (const u of users) {
    if (u.id) userById.set(u.id, u);
    if (u.username) userByUsername.set(u.username.toLowerCase(), u);
  }

  return attempts.map((att) => {
    const matchedUser =
      (att.userId ? userById.get(att.userId) : undefined) ??
      userByUsername.get((att.username || '').toLowerCase());

    const totalQuestions = Math.max(1, att.totalQuestions || att.questionResults?.length || 1);
    const correctCount = Math.max(
      0,
      Math.min(totalQuestions, att.correctCount ?? att.score ?? 0)
    );
    const certiportScore = resolveAttemptCertiportScore(att);
    const percentage =
      typeof att.percentage === 'number' && Number.isFinite(att.percentage)
        ? Math.max(0, Math.min(100, Math.round(att.percentage)))
        : Math.round((correctCount / totalQuestions) * 100);
    const passed =
      typeof att.passed === 'boolean'
        ? att.passed
        : certiportScore >= CERTIPORT_PASS_SCORE;
    const completedAtMs = new Date(att.completedAt).getTime();

    return {
      attempt: att,
      id: att.id,
      username: att.username || matchedUser?.username || 'unknown',
      fullName: att.fullName || matchedUser?.fullName || att.username || 'Học sinh',
      className: matchedUser?.className?.trim() || 'Chưa phân lớp',
      examSet: att.examSet || 'Đề tổng hợp',
      modeLabel: att.mode || att.examSet || 'Thi thử Certiport',
      source: detectAttemptSource(att),
      correctCount,
      totalQuestions,
      percentage,
      certiportScore,
      passed,
      durationSeconds: Math.max(0, Math.round(att.durationSeconds || 0)),
      completedAt: att.completedAt,
      completedAtMs: Number.isFinite(completedAtMs) ? completedAtMs : 0,
    };
  });
}

export function getScoreBinIndex(score: number): number {
  const clamped = Math.max(0, Math.min(1000, Math.round(score)));
  if (clamped >= 900) return 9;
  return Math.floor(clamped / 100);
}

export function filterAndSortPracticeAttempts(
  rows: EnrichedPracticeAttempt[],
  options: PracticeFilterOptions
): EnrichedPracticeAttempt[] {
  const query = options.searchQuery.trim().toLowerCase();
  const nowMs = options.nowMs ?? Date.now();

  let minTimestampMs = 0;
  if (options.dateRangeFilter === 'TODAY') {
    const today = new Date(nowMs);
    today.setHours(0, 0, 0, 0);
    minTimestampMs = today.getTime();
  } else if (options.dateRangeFilter === '7D') {
    minTimestampMs = nowMs - 7 * 24 * 60 * 60 * 1000;
  } else if (options.dateRangeFilter === '30D') {
    minTimestampMs = nowMs - 30 * 24 * 60 * 60 * 1000;
  }

  const filtered = rows.filter((row) => {
    if (options.classFilter !== 'ALL' && row.className !== options.classFilter) {
      return false;
    }
    if (options.sourceFilter !== 'ALL' && row.source !== options.sourceFilter) {
      return false;
    }
    if (options.examSetFilter !== 'ALL' && row.examSet !== options.examSetFilter) {
      return false;
    }
    if (options.resultFilter === 'PASS' && !row.passed) {
      return false;
    }
    if (options.resultFilter === 'FAIL' && row.passed) {
      return false;
    }
    if (minTimestampMs > 0 && row.completedAtMs < minTimestampMs) {
      return false;
    }
    if (
      options.scoreBinIndex !== null &&
      getScoreBinIndex(row.certiportScore) !== options.scoreBinIndex
    ) {
      return false;
    }
    if (query) {
      const hay = `${row.fullName} ${row.username} ${row.className} ${row.modeLabel} ${row.examSet}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  });

  const dir = options.sortDirection === 'asc' ? 1 : -1;
  return [...filtered].sort((a, b) => {
    switch (options.sortField) {
      case 'score':
        if (a.certiportScore !== b.certiportScore) {
          return (a.certiportScore - b.certiportScore) * dir;
        }
        return b.completedAtMs - a.completedAtMs;
      case 'percentage':
        if (a.percentage !== b.percentage) {
          return (a.percentage - b.percentage) * dir;
        }
        return b.completedAtMs - a.completedAtMs;
      case 'duration':
        if (a.durationSeconds !== b.durationSeconds) {
          return (a.durationSeconds - b.durationSeconds) * dir;
        }
        return b.completedAtMs - a.completedAtMs;
      case 'name':
        return a.fullName.localeCompare(b.fullName, 'vi') * dir;
      case 'completedAt':
      default:
        return (a.completedAtMs - b.completedAtMs) * dir;
    }
  });
}

export function computePracticeAnalytics(
  rows: EnrichedPracticeAttempt[],
  questions: Question[]
): PracticeAnalyticsSummary {
  const totalAttempts = rows.length;
  const questionById = new Map<string, Question>();
  for (const q of questions) {
    questionById.set(q.id, q);
  }

  const histogram: PracticeScoreBin[] = Array.from({ length: 10 }, (_, idx) => {
    const min = idx * 100;
    const max = idx === 9 ? 1000 : min + 99;
    return {
      binIndex: idx,
      label: idx === 9 ? '900–1000' : `${min}–${max}`,
      min,
      max,
      count: 0,
      percent: 0,
      isPassZone: min >= CERTIPORT_PASS_SCORE,
    };
  });

  const topicMap = new Map<string, { correct: number; total: number }>();
  for (const t of CERTIPORT_TOPICS) {
    topicMap.set(t, { correct: 0, total: 0 });
  }

  const studentGroups = new Map<string, EnrichedPracticeAttempt[]>();

  let passCount = 0;
  let scoreSum = 0;
  let durationSum = 0;
  const sortedScores: number[] = [];

  for (const row of rows) {
    if (row.passed) passCount += 1;
    scoreSum += row.certiportScore;
    durationSum += row.durationSeconds;
    sortedScores.push(row.certiportScore);

    const binIdx = getScoreBinIndex(row.certiportScore);
    histogram[binIdx].count += 1;

    const studentKey = row.username.toLowerCase();
    const list = studentGroups.get(studentKey) ?? [];
    list.push(row);
    studentGroups.set(studentKey, list);

    // Aggregate topic accuracy
    const att = row.attempt;
    if (Array.isArray(att.topicBreakdown) && att.topicBreakdown.length > 0) {
      for (const tb of att.topicBreakdown) {
        const key = tb.label || tb.key;
        const entry = topicMap.get(key) ?? { correct: 0, total: 0 };
        entry.correct += tb.correct || 0;
        entry.total += tb.total || 0;
        topicMap.set(key, entry);
      }
    } else if (Array.isArray(att.questionResults) && att.questionResults.length > 0) {
      for (const qr of att.questionResults) {
        const topic = qr.topic || questionById.get(qr.questionId)?.topic;
        if (!topic) continue;
        const entry = topicMap.get(topic) ?? { correct: 0, total: 0 };
        entry.total += 1;
        if (qr.isCorrect) entry.correct += 1;
        topicMap.set(topic, entry);
      }
    }
  }

  sortedScores.sort((a, b) => a - b);
  const medianScore =
    totalAttempts === 0
      ? 0
      : totalAttempts % 2 === 1
        ? sortedScores[Math.floor(totalAttempts / 2)]
        : Math.round(
            (sortedScores[totalAttempts / 2 - 1] + sortedScores[totalAttempts / 2]) / 2
          );

  for (const bin of histogram) {
    bin.percent = totalAttempts > 0 ? Math.round((bin.count / totalAttempts) * 100) : 0;
  }

  const rawTopics: PracticeTopicAggregate[] = Array.from(topicMap.entries()).map(
    ([topic, stat]) => ({
      topic,
      correct: stat.correct,
      total: stat.total,
      accuracyPercent:
        stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
      isWeakest: false,
    })
  );

  const topicsWithData = rawTopics.filter((t) => t.total > 0);
  let weakestTopic: PracticeTopicAggregate | null = null;
  if (topicsWithData.length > 0) {
    weakestTopic = topicsWithData.reduce((prev, cur) =>
      cur.accuracyPercent < prev.accuracyPercent ? cur : prev
    );
    weakestTopic.isWeakest = true;
  }

  const leaderboard: PracticeStudentLeaderboardRow[] = Array.from(
    studentGroups.values()
  )
    .map((group) => {
      const chronological = [...group].sort(
        (a, b) => a.completedAtMs - b.completedAtMs
      );
      const first = chronological[0];
      const latest = chronological[chronological.length - 1];
      const bestScore = Math.max(...group.map((g) => g.certiportScore));
      const avgScore = Math.round(
        group.reduce((acc, g) => acc + g.certiportScore, 0) / group.length
      );
      const stPassCount = group.filter((g) => g.passed).length;
      const totalDurationSeconds = group.reduce(
        (acc, g) => acc + g.durationSeconds,
        0
      );

      return {
        username: latest.username,
        fullName: latest.fullName,
        className: latest.className,
        attemptCount: group.length,
        passCount: stPassCount,
        passRatePercent: Math.round((stPassCount / group.length) * 100),
        bestScore,
        avgScore,
        latestScore: latest.certiportScore,
        firstScore: first.certiportScore,
        improvementDelta:
          group.length >= 2 ? latest.certiportScore - first.certiportScore : 0,
        totalDurationSeconds,
        latestCompletedAt: latest.completedAt,
      };
    })
    .sort((a, b) => {
      if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
      return b.attemptCount - a.attemptCount;
    });

  return {
    totalAttempts,
    uniqueStudents: studentGroups.size,
    passCount,
    failCount: totalAttempts - passCount,
    passRatePercent:
      totalAttempts > 0 ? Math.round((passCount / totalAttempts) * 100) : 0,
    avgScore: totalAttempts > 0 ? Math.round(scoreSum / totalAttempts) : 0,
    medianScore,
    maxScore: totalAttempts > 0 ? sortedScores[sortedScores.length - 1] : 0,
    minScore: totalAttempts > 0 ? sortedScores[0] : 0,
    avgDurationSeconds:
      totalAttempts > 0 ? Math.round(durationSum / totalAttempts) : 0,
    histogram,
    topicAggregates: rawTopics,
    weakestTopic,
    leaderboard,
  };
}

function resolveOptionLabel(
  optId: string,
  options?: { id: string; text: string }[]
): string {
  if (!options || options.length === 0) return optId;
  const idx = options.findIndex((o) => o.id === optId);
  if (idx < 0) return optId;
  const opt = options[idx];
  const letter =
    opt.id.length <= 2
      ? opt.id.toUpperCase()
      : String.fromCharCode(65 + (idx % 26));
  return `${letter}. ${opt.text}`;
}

export function formatAnswerReadable(
  answer: UserAnswer | null | undefined,
  question?: Question
): string {
  if (answer === null || answer === undefined) return 'Chưa trả lời';

  if (typeof answer === 'string') {
    if (!answer.trim()) return 'Chưa trả lời';
    if (question?.options?.length) {
      return resolveOptionLabel(answer, question.options);
    }
    return answer;
  }

  if (Array.isArray(answer)) {
    if (answer.length === 0) return 'Chưa trả lời';
    if (question?.type === 'ordering' && question.steps?.length) {
      return answer
        .map((id, idx) => {
          const st = question.steps?.find((s) => s.id === id);
          return `${idx + 1}. ${st ? st.text : id}`;
        })
        .join(' → ');
    }
    if (question?.options?.length) {
      return answer
        .map((id) => resolveOptionLabel(id, question.options))
        .join('\n');
    }
    return answer.join(', ');
  }

  if (typeof answer === 'object') {
    const entries = Object.entries(answer);
    if (entries.length === 0) return 'Chưa trả lời';
    return entries
      .map(([k, v]) => {
        if (question?.subItems?.length) {
          const sub = question.subItems.find((s) => s.id === k);
          return `${sub ? sub.statement : k}: ${v || '—'}`;
        }
        if (question?.pairs?.length) {
          const pair = question.pairs.find((p) => p.id === k);
          return `${pair ? pair.left : k} → ${v || '—'}`;
        }
        return `${k}: ${v}`;
      })
      .join(' | ');
  }

  return String(answer);
}

export function formatPracticeDuration(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}p ${String(secs).padStart(2, '0')}s`;
}

export async function buildPracticeResultsExcelBytes(
  rows: EnrichedPracticeAttempt[],
  analytics: PracticeAnalyticsSummary
): Promise<Uint8Array> {
  const XLSX = await loadXlsx();
  const wb = XLSX.utils.book_new();

  // Sheet 1: Chi tiết các lượt thi theo bộ lọc
  const sheet1Data = rows.map((row, idx) => ({
    STT: idx + 1,
    'Thời gian nộp': new Date(row.completedAt).toLocaleString('vi-VN'),
    'Mã học sinh': row.username,
    'Họ và tên': row.fullName,
    Lớp: row.className,
    Nguồn: row.source === 'live_session' ? 'Ca thi trực tuyến' : 'Thi thử tự do',
    'Chế độ / Bộ đề': row.modeLabel,
    'Số câu đúng': `${row.correctCount}/${row.totalQuestions}`,
    'Tỉ lệ đúng (%)': row.percentage,
    'Điểm Certiport (/1000)': row.certiportScore,
    'Thời gian làm': formatPracticeDuration(row.durationSeconds),
    'Đánh giá': row.passed ? 'ĐẠT (PASS)' : 'CHƯA ĐẠT (FAIL)',
  }));

  const ws1 = XLSX.utils.json_to_sheet(
    sheet1Data.length > 0
      ? sheet1Data
      : [{ 'Thông báo': 'Không có dữ liệu khớp bộ lọc hiện tại' }]
  );
  ws1['!cols'] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 15 },
    { wch: 24 },
    { wch: 12 },
    { wch: 18 },
    { wch: 28 },
    { wch: 14 },
    { wch: 15 },
    { wch: 20 },
    { wch: 14 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Lich_Su_Luot_Thi');

  // Sheet 2: Tổng hợp theo học sinh
  const sheet2Data = analytics.leaderboard.map((st, idx) => ({
    Hạng: idx + 1,
    'Mã học sinh': st.username,
    'Họ và tên': st.fullName,
    Lớp: st.className,
    'Tổng lượt thi': st.attemptCount,
    'Số lượt Đạt': st.passCount,
    'Tỉ lệ Đạt (%)': st.passRatePercent,
    'Điểm cao nhất': st.bestScore,
    'Điểm trung bình': st.avgScore,
    'Điểm gần nhất': st.latestScore,
    'Tiến bộ (so lần đầu)':
      st.attemptCount >= 2
        ? `${st.improvementDelta >= 0 ? '+' : ''}${st.improvementDelta}`
        : '—',
    'Tổng thời gian làm': formatPracticeDuration(st.totalDurationSeconds),
  }));

  const ws2 = XLSX.utils.json_to_sheet(
    sheet2Data.length > 0
      ? sheet2Data
      : [{ 'Thông báo': 'Chưa có học sinh nào trong bộ lọc' }]
  );
  ws2['!cols'] = [
    { wch: 6 },
    { wch: 15 },
    { wch: 24 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 15 },
    { wch: 16 },
    { wch: 15 },
    { wch: 20 },
    { wch: 18 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'Tong_Hop_Hoc_Sinh');

  // Sheet 3: Phân tích chuyên đề
  const sheet3Data = analytics.topicAggregates.map((tp) => ({
    'Chuyên đề Certiport': tp.topic,
    'Số lượt đúng': tp.correct,
    'Tổng câu đã làm': tp.total,
    'Tỉ lệ đúng (%)': tp.accuracyPercent,
    'Nhận xét':
      tp.total === 0
        ? 'Chưa có dữ liệu'
        : tp.isWeakest
          ? 'Chuyên đề yếu nhất - Cần ôn bổ sung'
          : tp.accuracyPercent >= 80
            ? 'Nắm vững'
            : tp.accuracyPercent >= 65
              ? 'Đạt yêu cầu'
              : 'Cần củng cố',
  }));

  const ws3 = XLSX.utils.json_to_sheet(sheet3Data);
  ws3['!cols'] = [
    { wch: 36 },
    { wch: 14 },
    { wch: 16 },
    { wch: 15 },
    { wch: 34 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'Phan_Tich_Chuyen_De');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new Uint8Array(out);
}
