import * as XLSX from 'xlsx';
import {
  CERTIPORT_PASS_SCORE,
  CERTIPORT_TOPICS,
  QuestionOption,
  QuestionType,
} from '../types/exam';
import {
  ExamSessionRecord,
  SessionAttemptRecord,
  TeacherAttemptQuestionDetail,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession';

export interface TopicShortDefinition {
  canonicalTopic: string;
  shortLabel: string;
  codeLabel: string;
}

export const CERTIPORT_TOPIC_DEFINITIONS: TopicShortDefinition[] = [
  {
    canonicalTopic: CERTIPORT_TOPICS[0],
    shortLabel: 'Tổng quan & Mô hình GenAI',
    codeLabel: 'Chuyên đề 1',
  },
  {
    canonicalTopic: CERTIPORT_TOPICS[1],
    shortLabel: 'Kỹ thuật viết Prompt',
    codeLabel: 'Chuyên đề 2',
  },
  {
    canonicalTopic: CERTIPORT_TOPICS[2],
    shortLabel: 'Đạo đức và bảo mật',
    codeLabel: 'Chuyên đề 3',
  },
  {
    canonicalTopic: CERTIPORT_TOPICS[3],
    shortLabel: 'Ứng dụng & Công cụ thực tế',
    codeLabel: 'Chuyên đề 4',
  },
];

export const SUBMIT_REASON_DISPLAY_LABELS: Record<string, string> = {
  voluntary: 'Tự nguyện',
  timeout: 'Hết giờ',
  violation: 'Tự nộp do vi phạm',
  teacher_forced: 'GV nộp giúp',
  in_progress: 'Đang làm',
};

export const VIOLATION_EVENT_DISPLAY_LABELS: Record<ViolationEventType, string> = {
  tab_switch: 'Đổi tab trình duyệt',
  window_blur: 'Rời cửa sổ làm bài',
  fullscreen_exit: 'Thoát toàn màn hình',
  window_resize: 'Thu nhỏ / chia đôi màn hình',
  blocked_key: 'Chạm phím bị chặn',
  phim_bi_chan: 'Chạm phím bị chặn',
  devtools: 'Mở công cụ kiểm tra (DevTools)',
  copy_paste: 'Sao chép / Dán / Chuột phải',
  multi_screen: 'Phát hiện màn hình phụ',
  multi_device: 'Đăng nhập từ thiết bị khác',
  other: 'Sự kiện bất thường khác',
};

export interface RawScoreTableRow {
  rank: number;
  attemptId: string;
  studentId: string;
  username: string;
  fullName: string;
  className: string;
  status: 'in_progress' | 'submitted';
  submitReason: SessionAttemptRecord['submitReason'];
  submitReasonLabel: string;
  score: number;
  correctCount: number;
  totalQuestions: number;
  passed: boolean;
  durationSeconds: number;
  durationMinutes: number;
  violationCount: number;
  scoreBinIndex: number;
  scoreBinLabel: string;
  topicStats: Record<string, { correct: number; total: number }>;
  questionDetails: TeacherAttemptQuestionDetail[];
}

export interface ScoreHistogramBin {
  binIndex: number;
  minScore: number;
  maxScore: number;
  label: string;
  rangeText: string;
  count: number;
  percentage: number;
  containsPassScore: boolean;
  containsAverageScore: boolean;
  isPassZone: boolean;
  studentIds: string[];
}

export interface TopicOverviewBar {
  topic: string;
  shortLabel: string;
  codeLabel: string;
  correctCount: number;
  totalCount: number;
  accuracyPercent: number;
  isWeakest: boolean;
}

export type ScatterPointCategory =
  | 'fast_low_score'
  | 'near_timeout'
  | 'normal_pass'
  | 'normal_fail';

export interface TimeVsScoreScatterPoint {
  attemptId: string;
  studentId: string;
  username: string;
  fullName: string;
  className: string;
  score: number;
  durationSeconds: number;
  durationMinutes: number;
  passed: boolean;
  status: 'in_progress' | 'submitted';
  category: ScatterPointCategory;
  categoryLabel: string;
}

export interface SessionClassAnalytics {
  isProvisional: boolean;
  provisionalReason: string | null;
  passScore: number;
  durationMinutes: number;
  kpis: {
    participantCount: number;
    averageScore: number;
    medianScore: number;
    highestScore: number;
    lowestScore: number;
    passCount: number;
    failCount: number;
    passRatePercent: number;
    failRatePercent: number;
  };
  histogram: {
    bins: ScoreHistogramBin[];
    maxBinCount: number;
    passScoreLinePercent: number;
    averageScoreLinePercent: number;
  };
  passFailBar: {
    passCount: number;
    failCount: number;
    passRatePercent: number;
    failRatePercent: number;
  };
  topics: {
    bars: TopicOverviewBar[];
    weakestTopic: TopicOverviewBar | null;
    weakestSummaryLine: string;
  };
  scatter: {
    points: TimeVsScoreScatterPoint[];
    maxDurationMinutes: number;
    fastThresholdMinutes: number;
    timeoutThresholdMinutes: number;
    fastLowScoreCount: number;
    nearTimeoutCount: number;
  };
}

export interface AnalyticsReconciliationReport {
  matches: boolean;
  discrepancies: string[];
  rawRowCount: number;
  reconciledMetrics: {
    participantCount: number;
    averageScore: number;
    medianScore: number;
    highestScore: number;
    lowestScore: number;
    passRatePercent: number;
    histogramSum: number;
    scatterCount: number;
  };
}

// ============================================================================
// CẤU TRÚC DỮ LIỆU BƯỚC 7B/8: PHÂN TÍCH CÂU HỎI, DRAWER HỌC SINH, EXCEL & SO SÁNH
// ============================================================================

export type QuestionDifficultyGroup = 'hard' | 'medium' | 'easy';

export interface QuestionOptionSelectionStat {
  optionKey: string;
  optionText: string;
  count: number;
  percentage: number;
  isCorrectOption: boolean;
  isTopDistractor: boolean;
}

export interface QuestionWrongStudentItem {
  attemptId: string;
  studentId: string;
  username: string;
  fullName: string;
  className: string;
  selectedAnswerDisplay: string;
  timeSpentSeconds: number;
  answered: boolean;
}

export interface SessionQuestionAnalysisItem {
  questionId: string;
  orderNumber: number;
  topic: string;
  shortTopicLabel: string;
  type: QuestionType;
  prompt: string;
  options?: QuestionOption[];
  correctAnswerDisplay: string;
  explanation: string;
  totalStudents: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  accuracyPercent: number;
  difficultyGroup: QuestionDifficultyGroup;
  difficultyLabel: string;
  topDistractorLabel: string | null;
  optionDistribution: QuestionOptionSelectionStat[];
  wrongStudents: QuestionWrongStudentItem[];
}

export type StudentTableStatusFilter =
  | 'all'
  | 'passed'
  | 'failed'
  | 'violation_submitted';

export type StudentTableSortField =
  | 'rank'
  | 'name'
  | 'className'
  | 'score'
  | 'correctCount'
  | 'duration'
  | 'violations';

export interface StudentTopicComparisonItem {
  topic: string;
  shortLabel: string;
  studentCorrect: number;
  studentTotal: number;
  studentAccuracyPercent: number;
  classAccuracyPercent: number;
  deltaPercent: number;
}

export interface StudentViolationTimelineItem {
  id: string;
  type: ViolationEventType;
  typeLabel: string;
  occurredAt: string;
  awaySeconds: number;
  currentQuestionOrder: number;
  note?: string;
}

export interface StudentDrawerDetailData {
  student: RawScoreTableRow;
  classAverageScore: number;
  scoreDeltaVsClass: number;
  topicComparisons: StudentTopicComparisonItem[];
  questions: TeacherAttemptQuestionDetail[];
  violationTimeline: StudentViolationTimelineItem[];
}

export interface SessionComparisonSummary {
  currentSessionId: string;
  currentTitle: string;
  currentCode: string;
  currentParticipantCount: number;
  currentAverageScore: number;
  currentMedianScore: number;
  currentPassRatePercent: number;
  targetSessionId: string;
  targetTitle: string;
  targetCode: string;
  targetParticipantCount: number;
  targetAverageScore: number;
  targetMedianScore: number;
  targetPassRatePercent: number;
  averageScoreDelta: number;
  medianScoreDelta: number;
  passRateDelta: number;
}

export function getScoreBinIndex(score: number): number {
  const clamped = Math.max(0, Math.min(1000, Math.round(Number(score) || 0)));
  if (clamped >= 900) return 9;
  return Math.min(9, Math.max(0, Math.floor(clamped / 100)));
}

export function getScoreBinLabel(binIndex: number): string {
  const safeIdx = Math.max(0, Math.min(9, binIndex));
  const min = safeIdx * 100;
  const max = (safeIdx + 1) * 100;
  return `${min}–${max}`;
}

export function matchCanonicalTopic(rawTopic: string): string {
  const trimmed = String(rawTopic || '').trim();
  for (const def of CERTIPORT_TOPIC_DEFINITIONS) {
    if (
      trimmed === def.canonicalTopic ||
      trimmed.toLowerCase().includes(def.shortLabel.toLowerCase())
    ) {
      return def.canonicalTopic;
    }
  }
  if (trimmed.startsWith('1.') || trimmed.includes('Tổng quan')) {
    return CERTIPORT_TOPICS[0];
  }
  if (trimmed.startsWith('2.') || trimmed.includes('Prompt')) {
    return CERTIPORT_TOPICS[1];
  }
  if (trimmed.startsWith('3.') || trimmed.includes('Đạo đức')) {
    return CERTIPORT_TOPICS[2];
  }
  if (trimmed.startsWith('4.') || trimmed.includes('Ứng dụng')) {
    return CERTIPORT_TOPICS[3];
  }
  return CERTIPORT_TOPICS[0];
}

export function getShortTopicLabel(rawTopic: string): string {
  const canonical = matchCanonicalTopic(rawTopic);
  const found = CERTIPORT_TOPIC_DEFINITIONS.find(
    (d) => d.canonicalTopic === canonical
  );
  return found ? found.shortLabel : rawTopic;
}

export function getSubmitReasonLabel(
  status: 'in_progress' | 'submitted',
  submitReason: SessionAttemptRecord['submitReason']
): string {
  if (status === 'in_progress') {
    return SUBMIT_REASON_DISPLAY_LABELS.in_progress;
  }
  if (!submitReason) {
    return SUBMIT_REASON_DISPLAY_LABELS.voluntary;
  }
  return SUBMIT_REASON_DISPLAY_LABELS[submitReason] || submitReason;
}

/**
 * Xây dựng bảng điểm gốc (1 dòng chuẩn hóa cho mỗi học sinh đã vào thi,
 * loại bỏ các bản ghi cũ đã bị thay thế bởi lượt thi mới `supersededByAttemptId`,
 * kèm thứ hạng `rank`, `submitReasonLabel` và `questionDetails`).
 */
export function buildRawScoreTableRows(
  attempts: SessionAttemptRecord[],
  session: Pick<
    ExamSessionRecord,
    'passScore' | 'durationMinutes' | 'questionCount'
  >,
  serverNowIso?: string
): RawScoreTableRow[] {
  const passScore = session.passScore ?? CERTIPORT_PASS_SCORE;
  const nowMs = serverNowIso ? new Date(serverNowIso).getTime() : Date.now();

  const activeByStudent = new Map<string, SessionAttemptRecord>();
  for (const att of attempts) {
    if (att.supersededByAttemptId) continue;
    const key = att.studentId.toLowerCase();
    const prev = activeByStudent.get(key);
    if (
      !prev ||
      (att.status === 'in_progress' && prev.status !== 'in_progress') ||
      att.startedAt > prev.startedAt
    ) {
      activeByStudent.set(key, att);
    }
  }

  const rows: RawScoreTableRow[] = [];

  for (const att of activeByStudent.values()) {
    const score = Math.max(0, Math.min(1000, Math.round(Number(att.score ?? 0))));
    const totalQuestions = Math.max(
      1,
      att.totalQuestions || att.generatedQuestions?.length || session.questionCount || 1
    );
    const correctCount =
      att.correctCount !== null && att.correctCount !== undefined
        ? Math.max(0, Math.min(totalQuestions, Math.round(att.correctCount)))
        : Math.round((score / 1000) * totalQuestions);
    const passed = score >= passScore;

    let durationSeconds = Number(att.durationSeconds ?? 0);
    if (!durationSeconds || durationSeconds <= 0) {
      const startMs = new Date(att.startedAt).getTime();
      const endMs =
        att.status === 'submitted' && att.submittedAt
          ? new Date(att.submittedAt).getTime()
          : nowMs;
      if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
        durationSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
      }
    }
    const durationMinutes = Math.max(
      0.5,
      Math.round((durationSeconds / 60) * 10) / 10
    );

    const topicStats: Record<string, { correct: number; total: number }> = {};
    for (const def of CERTIPORT_TOPIC_DEFINITIONS) {
      topicStats[def.canonicalTopic] = { correct: 0, total: 0 };
    }

    if (Array.isArray(att.topicBreakdown) && att.topicBreakdown.length > 0) {
      for (const tb of att.topicBreakdown) {
        const canonical = matchCanonicalTopic(tb.key || tb.label);
        topicStats[canonical].correct += Math.max(0, Number(tb.correct) || 0);
        topicStats[canonical].total += Math.max(0, Number(tb.total) || 0);
      }
    } else if (
      Array.isArray(att.questionResults) &&
      att.questionResults.length > 0
    ) {
      for (const qr of att.questionResults) {
        const canonical = matchCanonicalTopic(qr.topic);
        topicStats[canonical].total += 1;
        if (qr.isCorrect) {
          topicStats[canonical].correct += 1;
        }
      }
    } else if (
      Array.isArray(att.generatedQuestions) &&
      att.generatedQuestions.length > 0
    ) {
      for (const gq of att.generatedQuestions) {
        const canonical = matchCanonicalTopic(gq.topic);
        topicStats[canonical].total += 1;
      }
    }

    let questionDetails: TeacherAttemptQuestionDetail[] = [];
    if (
      Array.isArray(att.teacherQuestionDetails) &&
      att.teacherQuestionDetails.length > 0
    ) {
      questionDetails = [...att.teacherQuestionDetails].sort(
        (a, b) => a.orderNumber - b.orderNumber
      );
    } else if (
      Array.isArray(att.questionResults) &&
      att.questionResults.length > 0
    ) {
      questionDetails = att.questionResults.map((qr, idx) => ({
        questionId: qr.questionId,
        orderNumber: qr.orderNumber || idx + 1,
        topic: qr.topic,
        type: qr.type,
        prompt: qr.prompt,
        answered: qr.answered,
        flagged: qr.flagged,
        isCorrect: qr.isCorrect,
        userAnswer: qr.userAnswer,
        userAnswerDisplay: qr.answered
          ? String(qr.userAnswer ?? '')
          : 'Chưa trả lời',
        correctAnswer: 'A',
        correctAnswerDisplay: 'A',
        explanation: '',
        timeSpentSeconds: Math.max(
          5,
          Math.round(durationSeconds / Math.max(1, totalQuestions))
        ),
      }));
    }

    const binIdx = getScoreBinIndex(score);

    rows.push({
      rank: 0,
      attemptId: att.id,
      studentId: att.studentId,
      username: att.username,
      fullName: att.fullName,
      className: att.className,
      status: att.status,
      submitReason: att.submitReason,
      submitReasonLabel: getSubmitReasonLabel(att.status, att.submitReason),
      score,
      correctCount,
      totalQuestions,
      passed,
      durationSeconds,
      durationMinutes,
      violationCount: att.violationCount || 0,
      scoreBinIndex: binIdx,
      scoreBinLabel: getScoreBinLabel(binIdx),
      topicStats,
      questionDetails,
    });
  }

  rows.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.durationSeconds !== b.durationSeconds) {
      return a.durationSeconds - b.durationSeconds;
    }
    return a.fullName.localeCompare(b.fullName, 'vi');
  });

  rows.forEach((row, idx) => {
    row.rank = idx + 1;
  });

  return rows;
}

/**
 * Lọc bảng học sinh (7B) khi giáo viên bấm vào một cột trên biểu đồ Phổ điểm (7A)
 */
export function filterRawRowsByScoreBin(
  rows: RawScoreTableRow[],
  selectedBinIndex: number | null
): RawScoreTableRow[] {
  if (selectedBinIndex === null || selectedBinIndex === undefined) {
    return rows;
  }
  return rows.filter((row) => row.scoreBinIndex === selectedBinIndex);
}

/**
 * Lọc và sắp xếp bảng học sinh chính ở Bước 7B/8
 */
export function filterAndSortStudentScoreRows(params: {
  rows: RawScoreTableRow[];
  selectedBinIndex: number | null;
  statusFilter: StudentTableStatusFilter;
  searchQuery: string;
  sortField: StudentTableSortField;
  sortDirection: 'asc' | 'desc';
}): RawScoreTableRow[] {
  let result = filterRawRowsByScoreBin(params.rows, params.selectedBinIndex);

  if (params.statusFilter === 'passed') {
    result = result.filter((r) => r.passed);
  } else if (params.statusFilter === 'failed') {
    result = result.filter((r) => !r.passed);
  } else if (params.statusFilter === 'violation_submitted') {
    result = result.filter((r) => r.submitReason === 'violation');
  }

  const q = params.searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        r.username.toLowerCase().includes(q) ||
        r.className.toLowerCase().includes(q)
    );
  }

  const dir = params.sortDirection === 'asc' ? 1 : -1;
  const sorted = [...result].sort((a, b) => {
    switch (params.sortField) {
      case 'rank':
        return (a.rank - b.rank) * dir;
      case 'name':
        return a.fullName.localeCompare(b.fullName, 'vi') * dir;
      case 'className':
        return a.className.localeCompare(b.className, 'vi') * dir;
      case 'score':
        return (a.score - b.score) * dir || a.rank - b.rank;
      case 'correctCount':
        return (a.correctCount - b.correctCount) * dir || a.rank - b.rank;
      case 'duration':
        return (a.durationSeconds - b.durationSeconds) * dir || a.rank - b.rank;
      case 'violations':
        return (a.violationCount - b.violationCount) * dir || a.rank - b.rank;
      default:
        return a.rank - b.rank;
    }
  });

  return sorted;
}

/**
 * 1) Phân tích từng câu hỏi (Item Analysis):
 * - Danh sách sắp theo tỉ lệ đúng từ thấp đến cao (`accuracyPercent` tăng dần).
 * - Nhóm theo độ khó: dễ trên 80%, vừa 40–80%, khó dưới 40%.
 * - Tính tỉ lệ học sinh chọn từng đáp án (đánh dấu đáp án đúng và đáp án gây nhiễu nhiều nhất).
 * - Liệt kê danh sách học sinh làm sai từng câu.
 */
export function buildSessionQuestionAnalysis(
  rawRows: RawScoreTableRow[]
): SessionQuestionAnalysisItem[] {
  const questionMap = new Map<
    string,
    {
      questionId: string;
      orderNumber: number;
      topic: string;
      type: QuestionType;
      prompt: string;
      options?: QuestionOption[];
      correctAnswer: unknown;
      correctAnswerDisplay: string;
      explanation: string;
      records: Array<{
        row: RawScoreTableRow;
        detail: TeacherAttemptQuestionDetail;
      }>;
    }
  >();

  for (const row of rawRows) {
    for (const qd of row.questionDetails) {
      let entry = questionMap.get(qd.questionId);
      if (!entry) {
        entry = {
          questionId: qd.questionId,
          orderNumber: qd.orderNumber,
          topic: qd.topic,
          type: qd.type,
          prompt: qd.prompt,
          options: qd.options,
          correctAnswer: qd.correctAnswer,
          correctAnswerDisplay: qd.correctAnswerDisplay,
          explanation: qd.explanation,
          records: [],
        };
        questionMap.set(qd.questionId, entry);
      }
      entry.records.push({ row, detail: qd });
    }
  }

  const items: SessionQuestionAnalysisItem[] = [];

  for (const entry of questionMap.values()) {
    const totalStudents = entry.records.length;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;
    const wrongStudents: QuestionWrongStudentItem[] = [];

    const optionCounts = new Map<
      string,
      { optionKey: string; optionText: string; count: number; isCorrectOption: boolean }
    >();

    if (entry.options && entry.options.length > 0) {
      const correctSet = new Set(
        Array.isArray(entry.correctAnswer)
          ? entry.correctAnswer.map(String)
          : [String(entry.correctAnswer ?? '')]
      );
      for (const opt of entry.options) {
        optionCounts.set(opt.id, {
          optionKey: opt.id,
          optionText: `${opt.id}. ${opt.text}`,
          count: 0,
          isCorrectOption: correctSet.has(opt.id),
        });
      }
    }

    for (const { row, detail } of entry.records) {
      if (detail.isCorrect) {
        correctCount += 1;
      } else {
        wrongCount += 1;
        if (!detail.answered) {
          unansweredCount += 1;
        }
        wrongStudents.push({
          attemptId: row.attemptId,
          studentId: row.studentId,
          username: row.username,
          fullName: row.fullName,
          className: row.className,
          selectedAnswerDisplay: detail.answered
            ? detail.userAnswerDisplay
            : 'Chưa trả lời',
          timeSpentSeconds: detail.timeSpentSeconds,
          answered: detail.answered,
        });
      }

      if (!detail.answered || detail.userAnswer === null || detail.userAnswer === undefined) {
        const unans = optionCounts.get('UNANSWERED') ?? {
          optionKey: 'UNANSWERED',
          optionText: 'Chưa trả lời',
          count: 0,
          isCorrectOption: false,
        };
        unans.count += 1;
        optionCounts.set('UNANSWERED', unans);
      } else if (typeof detail.userAnswer === 'string' && optionCounts.has(detail.userAnswer)) {
        const found = optionCounts.get(detail.userAnswer)!;
        found.count += 1;
      } else if (Array.isArray(detail.userAnswer)) {
        const key = detail.userAnswer.join(', ') || detail.userAnswerDisplay;
        const existing = optionCounts.get(key) ?? {
          optionKey: key,
          optionText: detail.userAnswerDisplay || key,
          count: 0,
          isCorrectOption: detail.isCorrect,
        };
        existing.count += 1;
        optionCounts.set(key, existing);
      } else {
        const key = detail.userAnswerDisplay || String(detail.userAnswer);
        const existing = optionCounts.get(key) ?? {
          optionKey: key,
          optionText: key,
          count: 0,
          isCorrectOption: detail.isCorrect,
        };
        existing.count += 1;
        optionCounts.set(key, existing);
      }
    }

    const accuracyPercent =
      totalStudents > 0
        ? Math.round((correctCount / totalStudents) * 1000) / 10
        : 0;

    let difficultyGroup: QuestionDifficultyGroup;
    let difficultyLabel: string;
    if (accuracyPercent < 40) {
      difficultyGroup = 'hard';
      difficultyLabel = 'Khó (<40%)';
    } else if (accuracyPercent <= 80) {
      difficultyGroup = 'medium';
      difficultyLabel = 'Vừa (40–80%)';
    } else {
      difficultyGroup = 'easy';
      difficultyLabel = 'Dễ (>80%)';
    }

    const rawOptionsList = Array.from(optionCounts.values());
    let maxWrongOptionCount = 0;
    for (const opt of rawOptionsList) {
      if (!opt.isCorrectOption && opt.optionKey !== 'UNANSWERED' && opt.count > maxWrongOptionCount) {
        maxWrongOptionCount = opt.count;
      }
    }

    let topDistractorLabel: string | null = null;
    const optionDistribution: QuestionOptionSelectionStat[] = rawOptionsList.map(
      (opt) => {
        const isTopDistractor =
          !opt.isCorrectOption &&
          opt.optionKey !== 'UNANSWERED' &&
          maxWrongOptionCount > 0 &&
          opt.count === maxWrongOptionCount &&
          topDistractorLabel === null;
        if (isTopDistractor) {
          topDistractorLabel = opt.optionText;
        }
        return {
          optionKey: opt.optionKey,
          optionText: opt.optionText,
          count: opt.count,
          percentage:
            totalStudents > 0
              ? Math.round((opt.count / totalStudents) * 1000) / 10
              : 0,
          isCorrectOption: opt.isCorrectOption,
          isTopDistractor,
        };
      }
    );

    wrongStudents.sort((a, b) => a.fullName.localeCompare(b.fullName, 'vi'));

    items.push({
      questionId: entry.questionId,
      orderNumber: entry.orderNumber,
      topic: entry.topic,
      shortTopicLabel: getShortTopicLabel(entry.topic),
      type: entry.type,
      prompt: entry.prompt,
      ...(entry.options ? { options: entry.options } : {}),
      correctAnswerDisplay: entry.correctAnswerDisplay,
      explanation: entry.explanation,
      totalStudents,
      correctCount,
      wrongCount,
      unansweredCount,
      accuracyPercent,
      difficultyGroup,
      difficultyLabel,
      topDistractorLabel,
      optionDistribution,
      wrongStudents,
    });
  }

  // Sắp xếp theo tỉ lệ đúng từ thấp đến cao (câu khó nhất lên đầu)
  items.sort((a, b) => {
    if (a.accuracyPercent !== b.accuracyPercent) {
      return a.accuracyPercent - b.accuracyPercent;
    }
    if (b.wrongCount !== a.wrongCount) {
      return b.wrongCount - a.wrongCount;
    }
    return a.orderNumber - b.orderNumber;
  });

  return items;
}

/**
 * 3) Xây dựng dữ liệu chi tiết cho Drawer của 1 học sinh
 */
export function buildStudentDrawerDetail(
  student: RawScoreTableRow,
  analytics: SessionClassAnalytics,
  allSessionViolations: ViolationEventRecord[]
): StudentDrawerDetailData {
  const classAverageScore = analytics.kpis.averageScore;
  const scoreDeltaVsClass = student.score - classAverageScore;

  const topicComparisons: StudentTopicComparisonItem[] =
    CERTIPORT_TOPIC_DEFINITIONS.map((def) => {
      const st = student.topicStats[def.canonicalTopic] ?? {
        correct: 0,
        total: 0,
      };
      const studentAccuracyPercent =
        st.total > 0 ? Math.round((st.correct / st.total) * 100) : 0;
      const classBar = analytics.topics.bars.find(
        (b) => b.topic === def.canonicalTopic
      );
      const classAccuracyPercent = classBar?.accuracyPercent ?? 0;
      return {
        topic: def.canonicalTopic,
        shortLabel: def.shortLabel,
        studentCorrect: st.correct,
        studentTotal: st.total,
        studentAccuracyPercent,
        classAccuracyPercent,
        deltaPercent: studentAccuracyPercent - classAccuracyPercent,
      };
    });

  const violationTimeline: StudentViolationTimelineItem[] = allSessionViolations
    .filter(
      (v) =>
        v.attemptId === student.attemptId ||
        v.studentId.toLowerCase() === student.studentId.toLowerCase()
    )
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .map((v) => ({
      id: v.id,
      type: v.type,
      typeLabel: VIOLATION_EVENT_DISPLAY_LABELS[v.type] || v.type,
      occurredAt: v.occurredAt,
      awaySeconds: v.awaySeconds,
      currentQuestionOrder: v.currentQuestionOrder,
      ...(v.note ? { note: v.note } : {}),
    }));

  return {
    student,
    classAverageScore,
    scoreDeltaVsClass,
    topicComparisons,
    questions: student.questionDetails,
    violationTimeline,
  };
}

/**
 * 4) Xuất dữ liệu Excel (.xlsx) gồm đúng 3 Sheet:
 * - Sheet 1: "Bảng điểm"
 * - Sheet 2: "Phân tích câu hỏi"
 * - Sheet 3: "Nhật ký vi phạm"
 */
export function buildSessionResultsExcelBytes(params: {
  session: ExamSessionRecord;
  rawRows: RawScoreTableRow[];
  questionAnalysis: SessionQuestionAnalysisItem[];
  violations: ViolationEventRecord[];
}): Uint8Array {
  const wb = XLSX.utils.book_new();

  // Sheet 1: Bảng điểm
  const scoreSheetRows = params.rawRows.map((r) => ({
    Hạng: r.rank,
    'Tài khoản': r.username,
    'Họ và tên': r.fullName,
    Lớp: r.className,
    'Điểm (/1000)': r.score,
    'Số câu đúng': r.correctCount,
    'Tổng số câu': r.totalQuestions,
    'Kết quả': r.passed ? 'Đạt' : 'Chưa đạt',
    'Thời gian (phút)': r.durationMinutes,
    'Thời gian (giây)': r.durationSeconds,
    'Số vi phạm': r.violationCount,
    'Kiểu nộp': r.submitReasonLabel,
  }));
  const wsScores = XLSX.utils.json_to_sheet(
    scoreSheetRows.length > 0
      ? scoreSheetRows
      : [
          {
            Hạng: '',
            'Tài khoản': '',
            'Họ và tên': 'Chưa có thí sinh',
            Lớp: '',
            'Điểm (/1000)': 0,
            'Số câu đúng': 0,
            'Tổng số câu': params.session.questionCount,
            'Kết quả': '',
            'Thời gian (phút)': 0,
            'Thời gian (giây)': 0,
            'Số vi phạm': 0,
            'Kiểu nộp': '',
          },
        ]
  );
  XLSX.utils.book_append_sheet(wb, wsScores, 'Bảng điểm');

  // Sheet 2: Phân tích câu hỏi
  const questionSheetRows = params.questionAnalysis.map((q, idx) => ({
    STT: idx + 1,
    'Câu số': q.orderNumber,
    'Mã câu hỏi': q.questionId,
    'Chuyên đề': q.shortTopicLabel,
    'Nội dung câu hỏi': q.prompt,
    'Độ khó': q.difficultyLabel,
    'Tỉ lệ đúng (%)': q.accuracyPercent,
    'Số HS đúng': q.correctCount,
    'Số HS sai': q.wrongCount,
    'Tổng số HS': q.totalStudents,
    'Đáp án đúng': q.correctAnswerDisplay,
    'Phân bố đáp án': q.optionDistribution
      .map((o) => `${o.optionKey}: ${o.count} (${o.percentage}%)`)
      .join(' | '),
    'Danh sách HS làm sai': q.wrongStudents
      .map((s) => `${s.fullName} (${s.selectedAnswerDisplay})`)
      .join(', '),
  }));
  const wsQuestions = XLSX.utils.json_to_sheet(
    questionSheetRows.length > 0
      ? questionSheetRows
      : [
          {
            STT: 1,
            'Câu số': 1,
            'Mã câu hỏi': '',
            'Chuyên đề': '',
            'Nội dung câu hỏi': 'Chưa có dữ liệu câu hỏi',
            'Độ khó': '',
            'Tỉ lệ đúng (%)': 0,
            'Số HS đúng': 0,
            'Số HS sai': 0,
            'Tổng số HS': 0,
            'Đáp án đúng': '',
            'Phân bố đáp án': '',
            'Danh sách HS làm sai': '',
          },
        ]
  );
  XLSX.utils.book_append_sheet(wb, wsQuestions, 'Phân tích câu hỏi');

  // Sheet 3: Nhật ký vi phạm
  const studentMap = new Map(
    params.rawRows.map((r) => [r.studentId.toLowerCase(), r])
  );
  const sortedViolations = [...params.violations].sort((a, b) =>
    a.occurredAt.localeCompare(b.occurredAt)
  );
  const violationSheetRows = sortedViolations.map((v, idx) => {
    const st = studentMap.get(v.studentId.toLowerCase());
    return {
      STT: idx + 1,
      'Thời điểm': v.occurredAt,
      'Tài khoản': st?.username || v.studentId,
      'Họ và tên': st?.fullName || v.studentId,
      Lớp: st?.className || params.session.targetClass,
      'Loại vi phạm': VIOLATION_EVENT_DISPLAY_LABELS[v.type] || v.type,
      'Thời gian rời đi (giây)': v.awaySeconds,
      'Câu đang làm': v.currentQuestionOrder,
      'Ghi chú': v.note || '',
    };
  });
  const wsViolations = XLSX.utils.json_to_sheet(
    violationSheetRows.length > 0
      ? violationSheetRows
      : [
          {
            STT: '',
            'Thời điểm': '',
            'Tài khoản': '',
            'Họ và tên': 'Không có sự kiện vi phạm',
            Lớp: '',
            'Loại vi phạm': '',
            'Thời gian rời đi (giây)': 0,
            'Câu đang làm': '',
            'Ghi chú': '',
          },
        ]
  );
  XLSX.utils.book_append_sheet(wb, wsViolations, 'Nhật ký vi phạm');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}

/**
 * Đọc và kiểm tra lại file Excel (.xlsx) đã xuất (phục vụ kiểm thử tự động Bước 7B/8)
 */
export function parseSessionResultsExcelBytes(bytes: Uint8Array): {
  sheetNames: string[];
  scoreSheet: Array<Record<string, unknown>>;
  questionSheet: Array<Record<string, unknown>>;
  violationSheet: Array<Record<string, unknown>>;
} {
  const wb = XLSX.read(bytes, { type: 'array' });
  const scoreSheet = wb.Sheets['Bảng điểm']
    ? (XLSX.utils.sheet_to_json(wb.Sheets['Bảng điểm']) as Array<
        Record<string, unknown>
      >)
    : [];
  const questionSheet = wb.Sheets['Phân tích câu hỏi']
    ? (XLSX.utils.sheet_to_json(wb.Sheets['Phân tích câu hỏi']) as Array<
        Record<string, unknown>
      >)
    : [];
  const violationSheet = wb.Sheets['Nhật ký vi phạm']
    ? (XLSX.utils.sheet_to_json(wb.Sheets['Nhật ký vi phạm']) as Array<
        Record<string, unknown>
      >)
    : [];
  return {
    sheetNames: wb.SheetNames,
    scoreSheet,
    questionSheet,
    violationSheet,
  };
}

/**
 * 5) Tùy chọn: So sánh 2 ca thi (điểm trung bình, tỉ lệ đạt, điểm trung vị)
 */
export function compareTwoExamSessions(params: {
  currentSession: ExamSessionRecord;
  currentAnalytics: SessionClassAnalytics;
  targetSession: ExamSessionRecord;
  targetAnalytics: SessionClassAnalytics;
}): SessionComparisonSummary {
  const avgDelta =
    params.currentAnalytics.kpis.averageScore -
    params.targetAnalytics.kpis.averageScore;
  const medianDelta =
    params.currentAnalytics.kpis.medianScore -
    params.targetAnalytics.kpis.medianScore;
  const passRateDelta =
    Math.round(
      (params.currentAnalytics.kpis.passRatePercent -
        params.targetAnalytics.kpis.passRatePercent) *
        10
    ) / 10;

  return {
    currentSessionId: params.currentSession.id,
    currentTitle: params.currentSession.title,
    currentCode: params.currentSession.code,
    currentParticipantCount: params.currentAnalytics.kpis.participantCount,
    currentAverageScore: params.currentAnalytics.kpis.averageScore,
    currentMedianScore: params.currentAnalytics.kpis.medianScore,
    currentPassRatePercent: params.currentAnalytics.kpis.passRatePercent,
    targetSessionId: params.targetSession.id,
    targetTitle: params.targetSession.title,
    targetCode: params.targetSession.code,
    targetParticipantCount: params.targetAnalytics.kpis.participantCount,
    targetAverageScore: params.targetAnalytics.kpis.averageScore,
    targetMedianScore: params.targetAnalytics.kpis.medianScore,
    targetPassRatePercent: params.targetAnalytics.kpis.passRatePercent,
    averageScoreDelta: avgDelta,
    medianScoreDelta: medianDelta,
    passRateDelta,
  };
}

/**
 * Tính toán toàn bộ số liệu và biểu đồ Tổng quan lớp (Bước 7A/8) từ bảng điểm gốc
 */
export function computeSessionClassAnalytics(
  rawRows: RawScoreTableRow[],
  session: Pick<
    ExamSessionRecord,
    'status' | 'passScore' | 'durationMinutes' | 'questionCount'
  >
): SessionClassAnalytics {
  const passScore = session.passScore ?? CERTIPORT_PASS_SCORE;
  const durationMinutes = Math.max(1, session.durationMinutes || 50);
  const participantCount = rawRows.length;

  const hasInProgressAttempt = rawRows.some((r) => r.status === 'in_progress');
  const isProvisional = session.status !== 'ended' || hasInProgressAttempt;
  const provisionalReason = isProvisional
    ? 'Số liệu tạm thời (ca thi chưa kết thúc)'
    : null;

  // 1) Hàng chỉ số đầu trang
  let averageScore = 0;
  let medianScore = 0;
  let highestScore = 0;
  let lowestScore = 0;
  let passCount = 0;
  let failCount = 0;
  let passRatePercent = 0;
  let failRatePercent = 0;

  if (participantCount > 0) {
    const scoresAsc = rawRows.map((r) => r.score).sort((a, b) => a - b);
    const totalScore = scoresAsc.reduce((acc, s) => acc + s, 0);
    averageScore = Math.round(totalScore / participantCount);

    const mid = Math.floor(participantCount / 2);
    medianScore =
      participantCount % 2 === 1
        ? scoresAsc[mid]
        : Math.round((scoresAsc[mid - 1] + scoresAsc[mid]) / 2);

    lowestScore = scoresAsc[0];
    highestScore = scoresAsc[participantCount - 1];

    passCount = rawRows.filter((r) => r.score >= passScore).length;
    failCount = participantCount - passCount;
    passRatePercent = Math.round((passCount / participantCount) * 1000) / 10;
    failRatePercent = Math.max(
      0,
      Math.round((100 - passRatePercent) * 10) / 10
    );
  }

  // 2) Phổ điểm: 10 khoảng 100 điểm (0–100, ..., 900–1000)
  const passBinIndex = getScoreBinIndex(passScore);
  const avgBinIndex = participantCount > 0 ? getScoreBinIndex(averageScore) : -1;

  const bins: ScoreHistogramBin[] = Array.from({ length: 10 }, (_, idx) => {
    const minScore = idx * 100;
    const maxScore = (idx + 1) * 100;
    const matchingRows = rawRows.filter((r) => r.scoreBinIndex === idx);
    const count = matchingRows.length;
    const percentage =
      participantCount > 0
        ? Math.round((count / participantCount) * 1000) / 10
        : 0;
    return {
      binIndex: idx,
      minScore,
      maxScore,
      label: getScoreBinLabel(idx),
      rangeText:
        idx === 9
          ? `${minScore} – ${maxScore} điểm`
          : `${minScore} – dưới ${maxScore} điểm`,
      count,
      percentage,
      containsPassScore: idx === passBinIndex,
      containsAverageScore: idx === avgBinIndex,
      isPassZone: maxScore > passScore && minScore >= Math.floor(passScore / 100) * 100,
      studentIds: matchingRows.map((r) => r.studentId),
    };
  });

  const maxBinCount = Math.max(1, ...bins.map((b) => b.count));
  const passScoreLinePercent = Math.max(
    0,
    Math.min(100, (passScore / 1000) * 100)
  );
  const averageScoreLinePercent =
    participantCount > 0
      ? Math.max(0, Math.min(100, (averageScore / 1000) * 100))
      : 0;

  // 3) Theo chuyên đề (4 thanh ngang)
  const rawTopicBars: TopicOverviewBar[] = CERTIPORT_TOPIC_DEFINITIONS.map(
    (def) => {
      let correctCount = 0;
      let totalCount = 0;
      for (const row of rawRows) {
        const st = row.topicStats[def.canonicalTopic];
        if (st) {
          correctCount += st.correct;
          totalCount += st.total;
        }
      }
      const accuracyPercent =
        totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
      return {
        topic: def.canonicalTopic,
        shortLabel: def.shortLabel,
        codeLabel: def.codeLabel,
        correctCount,
        totalCount,
        accuracyPercent,
        isWeakest: false,
      };
    }
  );

  let weakestTopic: TopicOverviewBar | null = null;
  const activeTopics = rawTopicBars.filter((b) => b.totalCount > 0);
  if (participantCount > 0 && activeTopics.length > 0) {
    let minAcc = Infinity;
    for (const b of activeTopics) {
      if (b.accuracyPercent < minAcc) {
        minAcc = b.accuracyPercent;
      }
    }
    const weakestCandidate = activeTopics.find((b) => b.accuracyPercent === minAcc)!;
    weakestCandidate.isWeakest = true;
    weakestTopic = weakestCandidate;
  }

  const weakestSummaryLine = weakestTopic
    ? `Yếu nhất: ${weakestTopic.shortLabel}, đúng ${weakestTopic.accuracyPercent}%`
    : 'Chưa có dữ liệu chuyên đề';

  // 5) Biểu đồ phân tán: Thời gian làm bài so với điểm
  const sessionDurationSeconds = durationMinutes * 60;
  const fastThresholdSeconds = Math.max(180, Math.round(sessionDurationSeconds * 0.25));
  const timeoutThresholdSeconds = Math.round(sessionDurationSeconds * 0.9);
  const fastThresholdMinutes = Math.round((fastThresholdSeconds / 60) * 10) / 10;
  const timeoutThresholdMinutes = Math.round((timeoutThresholdSeconds / 60) * 10) / 10;

  const points: TimeVsScoreScatterPoint[] = rawRows.map((r) => {
    let category: ScatterPointCategory;
    let categoryLabel: string;

    if (r.durationSeconds <= fastThresholdSeconds && r.score < passScore) {
      category = 'fast_low_score';
      categoryLabel = 'Làm quá nhanh, điểm thấp';
    } else if (
      r.submitReason === 'timeout' ||
      r.durationSeconds >= timeoutThresholdSeconds
    ) {
      category = 'near_timeout';
      categoryLabel = 'Làm hết giờ / sát giờ';
    } else if (r.score >= passScore) {
      category = 'normal_pass';
      categoryLabel = 'Đạt chuẩn';
    } else {
      category = 'normal_fail';
      categoryLabel = 'Chưa đạt';
    }

    return {
      attemptId: r.attemptId,
      studentId: r.studentId,
      username: r.username,
      fullName: r.fullName,
      className: r.className,
      score: r.score,
      durationSeconds: r.durationSeconds,
      durationMinutes: r.durationMinutes,
      passed: r.passed,
      status: r.status,
      category,
      categoryLabel,
    };
  });

  const maxObservedMinutes =
    points.length > 0 ? Math.max(...points.map((p) => p.durationMinutes)) : 0;
  const maxDurationMinutes = Math.max(durationMinutes, Math.ceil(maxObservedMinutes));
  const fastLowScoreCount = points.filter(
    (p) => p.category === 'fast_low_score'
  ).length;
  const nearTimeoutCount = points.filter(
    (p) => p.category === 'near_timeout'
  ).length;

  return {
    isProvisional,
    provisionalReason,
    passScore,
    durationMinutes,
    kpis: {
      participantCount,
      averageScore,
      medianScore,
      highestScore,
      lowestScore,
      passCount,
      failCount,
      passRatePercent,
      failRatePercent,
    },
    histogram: {
      bins,
      maxBinCount,
      passScoreLinePercent,
      averageScoreLinePercent,
    },
    passFailBar: {
      passCount,
      failCount,
      passRatePercent,
      failRatePercent,
    },
    topics: {
      bars: rawTopicBars,
      weakestTopic,
      weakestSummaryLine,
    },
    scatter: {
      points,
      maxDurationMinutes,
      fastThresholdMinutes,
      timeoutThresholdMinutes,
      fastLowScoreCount,
      nearTimeoutCount,
    },
  };
}

/**
 * Truy vấn đối chiếu độc lập trên bảng điểm gốc để đảm bảo mọi con số trên biểu đồ
 * khớp tuyệt đối 100% với bảng điểm gốc (yêu cầu phần Kiểm tra của Bước 7A/8).
 */
export function verifyAnalyticsAgainstRawScoreTable(
  analytics: SessionClassAnalytics,
  rawRows: RawScoreTableRow[],
  passScore: number = CERTIPORT_PASS_SCORE
): AnalyticsReconciliationReport {
  const discrepancies: string[] = [];
  const n = rawRows.length;

  let expectedAvg = 0;
  let expectedMedian = 0;
  let expectedMax = 0;
  let expectedMin = 0;
  let expectedPassCount = 0;

  if (n > 0) {
    let sum = 0;
    expectedMax = -Infinity;
    expectedMin = Infinity;
    const sorted: number[] = [];

    for (const r of rawRows) {
      sum += r.score;
      if (r.score > expectedMax) expectedMax = r.score;
      if (r.score < expectedMin) expectedMin = r.score;
      if (r.score >= passScore) expectedPassCount += 1;
      sorted.push(r.score);
    }

    sorted.sort((a, b) => a - b);
    expectedAvg = Math.round(sum / n);
    expectedMedian =
      n % 2 === 1
        ? sorted[Math.floor(n / 2)]
        : Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
  }

  const expectedPassRate =
    n > 0 ? Math.round((expectedPassCount / n) * 1000) / 10 : 0;
  const histogramSum = analytics.histogram.bins.reduce(
    (acc, b) => acc + b.count,
    0
  );
  const scatterCount = analytics.scatter.points.length;

  if (analytics.kpis.participantCount !== n) {
    discrepancies.push(
      `Lệch số thí sinh: KPI=${analytics.kpis.participantCount}, Bảng gốc=${n}`
    );
  }
  if (analytics.kpis.averageScore !== expectedAvg) {
    discrepancies.push(
      `Lệch điểm trung bình: KPI=${analytics.kpis.averageScore}, Bảng gốc=${expectedAvg}`
    );
  }
  if (analytics.kpis.medianScore !== expectedMedian) {
    discrepancies.push(
      `Lệch điểm trung vị: KPI=${analytics.kpis.medianScore}, Bảng gốc=${expectedMedian}`
    );
  }
  if (analytics.kpis.highestScore !== expectedMax) {
    discrepancies.push(
      `Lệch điểm cao nhất: KPI=${analytics.kpis.highestScore}, Bảng gốc=${expectedMax}`
    );
  }
  if (analytics.kpis.lowestScore !== expectedMin) {
    discrepancies.push(
      `Lệch điểm thấp nhất: KPI=${analytics.kpis.lowestScore}, Bảng gốc=${expectedMin}`
    );
  }
  if (analytics.kpis.passRatePercent !== expectedPassRate) {
    discrepancies.push(
      `Lệch tỉ lệ đạt: KPI=${analytics.kpis.passRatePercent}%, Bảng gốc=${expectedPassRate}%`
    );
  }
  if (histogramSum !== n) {
    discrepancies.push(
      `Tổng số thí sinh trong Histogram (${histogramSum}) không khớp bảng gốc (${n})`
    );
  }
  if (
    analytics.passFailBar.passCount + analytics.passFailBar.failCount !==
    n
  ) {
    discrepancies.push(
      `Tổng Đạt + Không đạt (${analytics.passFailBar.passCount + analytics.passFailBar.failCount}) không khớp bảng gốc (${n})`
    );
  }
  if (scatterCount !== n) {
    discrepancies.push(
      `Số điểm trên biểu đồ phân tán (${scatterCount}) không khớp bảng gốc (${n})`
    );
  }

  for (const bar of analytics.topics.bars) {
    let rawCorrect = 0;
    let rawTotal = 0;
    for (const r of rawRows) {
      const st = r.topicStats[bar.topic];
      if (st) {
        rawCorrect += st.correct;
        rawTotal += st.total;
      }
    }
    const rawAcc = rawTotal > 0 ? Math.round((rawCorrect / rawTotal) * 100) : 0;
    if (
      bar.correctCount !== rawCorrect ||
      bar.totalCount !== rawTotal ||
      bar.accuracyPercent !== rawAcc
    ) {
      discrepancies.push(
        `Chuyên đề "${bar.shortLabel}" lệch số liệu: Biểu đồ=${bar.correctCount}/${bar.totalCount} (${bar.accuracyPercent}%), Bảng gốc=${rawCorrect}/${rawTotal} (${rawAcc}%)`
      );
    }
  }

  return {
    matches: discrepancies.length === 0,
    discrepancies,
    rawRowCount: n,
    reconciledMetrics: {
      participantCount: n,
      averageScore: expectedAvg,
      medianScore: expectedMedian,
      highestScore: expectedMax,
      lowestScore: expectedMin,
      passRatePercent: expectedPassRate,
      histogramSum,
      scatterCount,
    },
  };
}
