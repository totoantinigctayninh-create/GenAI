import type { MatchingPair, Question, UserAnswer } from '../types/exam.ts';
import type {
  AttemptSubmitReason,
  SanitizedStudentQuestion,
  SessionAttemptRecord,
  StudentAttemptPaperPayload,
  TeacherLiveNotEnteredStudent,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession.ts';

export interface LocalAnswerBackupEntry {
  selectedAnswer: UserAnswer | null;
  flagged: boolean;
  timeSpentSeconds: number;
  dirty: boolean;
  updatedAtMs: number;
}

export interface QueuedViolationEvent {
  clientEventId: string;
  type: ViolationEventType;
  occurredAt: string;
  awaySeconds: number;
  currentQuestionOrder: number;
  note?: string;
}

export interface LocalAttemptBackup {
  attemptId: string;
  sessionCode: string;
  sessionToken: string;
  currentIndex: number;
  updatedAt: string;
  answers: Record<string, LocalAnswerBackupEntry>;
  queuedViolations?: QueuedViolationEvent[];
  localViolationCount?: number;
}

/**
 * Chuyển đổi câu hỏi đã lọc từ máy chủ (`SanitizedStudentQuestion`) sang cấu trúc `Question`
 * để tái sử dụng `QuestionRenderer` và `isQuestionAnswered` trên trình duyệt.
 * TUYỆT ĐỐI KHÔNG chứa đáp án đúng hay lời giải thích.
 */
export function toClientRenderableQuestion(
  sq: SanitizedStudentQuestion
): Question {
  const pairs: MatchingPair[] | undefined = sq.matchingLeftItems
    ? sq.matchingLeftItems.map((leftItem, idx) => ({
        id: leftItem.id,
        left: leftItem.left,
        right: sq.matchingRightChoices?.[idx] ?? '',
      }))
    : undefined;

  return {
    id: sq.id,
    type: sq.type,
    topic: sq.topic,
    examSet: sq.examSet,
    prompt: sq.prompt,
    ...(sq.instruction !== undefined ? { instruction: sq.instruction } : {}),
    ...(sq.imageUrl !== undefined ? { imageUrl: sq.imageUrl } : {}),
    ...(sq.options ? { options: sq.options } : {}),
    ...(sq.maxSelect !== undefined ? { maxSelect: sq.maxSelect } : {}),
    ...(sq.maxSelections !== undefined
      ? { maxSelections: sq.maxSelections }
      : {}),
    ...(sq.subItems ? { subItems: sq.subItems } : {}),
    ...(sq.dropdownOptions ? { dropdownOptions: sq.dropdownOptions } : {}),
    ...(sq.dropdownColumns ? { dropdownColumns: sq.dropdownColumns } : {}),
    ...(pairs ? { pairs } : {}),
    ...(sq.steps ? { steps: sq.steps } : {}),
    correctAnswer: '',
    explanation: '',
  };
}

/**
 * Tính độ lệch đồng hồ giữa máy chủ và trình duyệt (`serverNowMs - clientNowMs`)
 */
export function computeServerClockOffsetMs(
  serverNowIso: string,
  clientNowMs: number = Date.now()
): number {
  const serverMs = new Date(serverNowIso).getTime();
  if (!Number.isFinite(serverMs)) {
    return 0;
  }
  return serverMs - clientNowMs;
}

/**
 * Tính số giây làm bài còn lại dựa trên hạn nộp `deadlineAt` của máy chủ
 * và độ lệch đồng hồ `serverOffsetMs`.
 */
export function computeServerRemainingSeconds(
  deadlineAtIso: string,
  serverOffsetMs: number,
  clientNowMs: number = Date.now()
): number {
  const deadlineMs = new Date(deadlineAtIso).getTime();
  if (!Number.isFinite(deadlineMs)) {
    return 0;
  }
  const estimatedServerNowMs = clientNowMs + serverOffsetMs;
  return Math.max(0, Math.floor((deadlineMs - estimatedServerNowMs) / 1000));
}

/**
 * Hợp nhất dữ liệu đáp án đã lưu trên máy chủ với bản lưu tạm trên máy học sinh (`localStorage`),
 * đảm bảo khi tải lại trang giữa chừng hoặc mất mạng vẫn giữ nguyên đáp án vừa chọn và liệt kê
 * các câu cần đồng bộ lên máy chủ (`dirtyQuestionIds`).
 */
export function mergeServerAndLocalAnswers(
  serverSavedAnswers: StudentAttemptPaperPayload['savedAnswers'],
  localBackupAnswers?: Record<string, LocalAnswerBackupEntry>
): {
  answersMap: Record<string, UserAnswer>;
  flaggedMap: Record<string, boolean>;
  timeSpentMap: Record<string, number>;
  mergedBackupEntries: Record<string, LocalAnswerBackupEntry>;
  dirtyQuestionIds: string[];
} {
  const answersMap: Record<string, UserAnswer> = {};
  const resolvedFlaggedMap: Record<string, boolean> = {};
  const timeSpentMap: Record<string, number> = {};
  const mergedBackupEntries: Record<string, LocalAnswerBackupEntry> = {};
  const dirtyQuestionIds: string[] = [];

  const allQuestionIds = new Set<string>([
    ...Object.keys(serverSavedAnswers || {}),
    ...Object.keys(localBackupAnswers || {}),
  ]);

  for (const qId of allQuestionIds) {
    const srv = serverSavedAnswers?.[qId];
    const loc = localBackupAnswers?.[qId];
    const srvTimeMs = srv?.savedAt ? new Date(srv.savedAt).getTime() : 0;
    const locTimeMs = loc?.updatedAtMs ?? 0;

    // Ưu tiên bản lưu trên máy nếu đang đánh dấu dirty (chưa gửi kịp lên máy chủ) hoặc mới hơn bản máy chủ
    const preferLocal =
      Boolean(loc) && (loc!.dirty || locTimeMs > srvTimeMs || !srv);

    const selectedAnswer = preferLocal
      ? loc!.selectedAnswer
      : (srv?.selectedAnswer ?? null);
    const flagged = preferLocal ? Boolean(loc!.flagged) : Boolean(srv?.flagged);
    const timeSpentSeconds = Math.max(
      0,
      Math.floor(srv?.timeSpentSeconds ?? 0),
      Math.floor(loc?.timeSpentSeconds ?? 0)
    );
    const isDirty = Boolean(preferLocal && loc?.dirty);

    if (selectedAnswer !== null && selectedAnswer !== undefined) {
      answersMap[qId] = selectedAnswer;
    }
    if (flagged) {
      resolvedFlaggedMap[qId] = true;
    }
    timeSpentMap[qId] = timeSpentSeconds;

    mergedBackupEntries[qId] = {
      selectedAnswer,
      flagged,
      timeSpentSeconds,
      dirty: isDirty,
      updatedAtMs: Math.max(srvTimeMs, locTimeMs, Date.now()),
    };

    if (isDirty) {
      dirtyQuestionIds.push(qId);
    }
  }

  return {
    answersMap,
    flaggedMap: resolvedFlaggedMap,
    timeSpentMap,
    mergedBackupEntries,
    dirtyQuestionIds,
  };
}

/**
 * Kiểm tra an toàn bảo mật mạng: Đảm bảo payload trả về trong lúc đang thi
 * không bao giờ chứa khóa `correctAnswer` hoặc `explanation`.
 */
export function hasCorrectAnswerLeakInPayload(payload: unknown): boolean {
  if (payload === null || payload === undefined || typeof payload !== 'object') {
    return false;
  }
  if (Array.isArray(payload)) {
    return payload.some((item) => hasCorrectAnswerLeakInPayload(item));
  }
  const record = payload as Record<string, unknown>;
  for (const [key, val] of Object.entries(record)) {
    if (key === 'correctAnswer' || key === 'explanation') {
      return true;
    }
    if (hasCorrectAnswerLeakInPayload(val)) {
      return true;
    }
  }
  return false;
}

/**
 * Xác định xem loại sự kiện vi phạm có được tính vào ngưỡng tự nộp (`maxViolations`) hay không.
 * - Các sự kiện "phím bị chặn" (`blocked_key`, `phim_bi_chan`, `copy_paste`, `devtools`) chỉ ghi nhật ký `violation_events`, KHÔNG tính vào ngưỡng tự nộp.
 * - Các sự kiện rời màn hình (`tab_switch`, `window_blur`, `fullscreen_exit`, `window_resize`, `multi_screen`, `multi_device`) được tính vào ngưỡng tự nộp.
 */
export function doesViolationCountTowardLimit(type: ViolationEventType): boolean {
  if (
    type === 'blocked_key' ||
    type === 'phim_bi_chan' ||
    type === 'copy_paste' ||
    type === 'devtools'
  ) {
    return false;
  }
  return true;
}

/**
 * Phát hiện phím tắt bị chặn trong phòng thi:
 * - Esc: mở/đóng hộp thoại xác nhận nộp bài & thoát (không thoát toàn màn hình)
 * - F12, Ctrl+Shift+I/J/C, Cmd+Opt+I/J/C, Ctrl+P/S/U/C/X/V: chặn và ghi nhận loại "phím bị chặn"
 */
export function detectBlockedKeyShortcut(input: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
}): {
  blocked: boolean;
  label: string;
  isEscape: boolean;
} {
  const rawKey = String(input.key || '');
  if (rawKey === 'Escape' || rawKey === 'Esc') {
    return { blocked: true, label: 'Escape', isEscape: true };
  }

  if (rawKey.toUpperCase() === 'F12') {
    return { blocked: true, label: 'F12', isEscape: false };
  }

  const upper = rawKey.toUpperCase();
  const hasCtrlOrMeta = Boolean(input.ctrlKey || input.metaKey);

  // Ctrl+Shift+I / J / C (DevTools) hoặc Cmd+Option+I / J / C trên macOS
  if (
    ((hasCtrlOrMeta && input.shiftKey) || (input.metaKey && input.altKey)) &&
    (upper === 'I' || upper === 'J' || upper === 'C')
  ) {
    return {
      blocked: true,
      label: `Ctrl+Shift+${upper}`,
      isEscape: false,
    };
  }

  // Ctrl+P (In), Ctrl+S (Lưu), Ctrl+U (Xem nguồn), Ctrl+C (Sao chép), Ctrl+X (Cắt), Ctrl+V (Dán)
  if (
    hasCtrlOrMeta &&
    !input.shiftKey &&
    (upper === 'P' ||
      upper === 'S' ||
      upper === 'U' ||
      upper === 'C' ||
      upper === 'X' ||
      upper === 'V')
  ) {
    return {
      blocked: true,
      label: `Ctrl+${upper}`,
      isEscape: false,
    };
  }

  return { blocked: false, label: '', isEscape: false };
}

/**
 * Phát hiện thay đổi kích thước cửa sổ bất thường (nghi chia đôi màn hình Split Screen / Snap Assist)
 */
export function isSuspiciousSplitScreenResize(
  viewportWidth: number,
  viewportHeight: number,
  screenAvailWidth: number,
  screenAvailHeight: number
): boolean {
  if (screenAvailWidth < 768 || screenAvailHeight < 500) {
    return false;
  }
  const widthRatio = viewportWidth / screenAvailWidth;
  const heightRatio = viewportHeight / screenAvailHeight;
  return widthRatio < 0.72 || heightRatio < 0.65;
}

/**
 * Đánh giá chính sách xử lý vi phạm theo cấu hình ca thi (`maxViolations`, mặc định 3):
 * - Phím bị chặn không tăng `violationCount` và không tự nộp.
 * - Sự kiện rời màn hình tăng `violationCount`; lần cuối trước ngưỡng (`nextViolationCount === maxViolations - 1`) cảnh báo đỏ; chạm ngưỡng (`nextViolationCount >= maxViolations`) tự nộp bài.
 */
export function evaluateViolationPolicy(
  currentViolationCount: number,
  maxViolations: number,
  eventType: ViolationEventType
): {
  countsTowardLimit: boolean;
  nextViolationCount: number;
  isLastWarningBeforeSubmit: boolean;
  shouldAutoSubmit: boolean;
} {
  const safeMax = Math.max(1, Math.floor(maxViolations || 3));
  const safeCurrent = Math.max(0, Math.floor(currentViolationCount || 0));
  const countsTowardLimit = doesViolationCountTowardLimit(eventType);

  if (!countsTowardLimit) {
    return {
      countsTowardLimit: false,
      nextViolationCount: safeCurrent,
      isLastWarningBeforeSubmit: safeCurrent === safeMax - 1,
      shouldAutoSubmit: false,
    };
  }

  const nextViolationCount = safeCurrent + 1;
  const shouldAutoSubmit = nextViolationCount >= safeMax;
  const isLastWarningBeforeSubmit =
    !shouldAutoSubmit && nextViolationCount === safeMax - 1;

  return {
    countsTowardLimit: true,
    nextViolationCount,
    isLastWarningBeforeSubmit,
    shouldAutoSubmit,
  };
}

export interface CreateExamSessionFormValues {
  title: string;
  targetClass: string;
  questionCount: number | string;
  durationMinutes: number | string;
  selectionMode: 'proportional' | 'manual';
  manualQuestionIds?: string[];
  openAt?: string | null;
  closeAt?: string | null;
  maxViolations: number | string;
  passScore: number | string;
}

export interface CreateExamSessionFormErrors {
  title?: string;
  targetClass?: string;
  questionCount?: string;
  durationMinutes?: string;
  manualQuestionIds?: string;
  openAt?: string;
  closeAt?: string;
  maxViolations?: string;
  passScore?: string;
}

/**
 * Kiểm tra dữ liệu nhập đầu vào khi Tạo ca thi (BƯỚC 5/8)
 * và trả về thông báo lỗi tiếng Việt cụ thể cho từng ô bị sai.
 */
export function validateCreateExamSessionForm(
  values: CreateExamSessionFormValues,
  maxAvailableQuestions: number = 500
): {
  valid: boolean;
  errors: CreateExamSessionFormErrors;
} {
  const errors: CreateExamSessionFormErrors = {};

  const trimmedTitle = String(values.title ?? '').trim();
  if (!trimmedTitle) {
    errors.title = 'Tên ca thi không được để trống.';
  } else if (trimmedTitle.length < 3) {
    errors.title = 'Tên ca thi phải có ít nhất 3 ký tự.';
  }

  const trimmedClass = String(values.targetClass ?? '').trim();
  if (!trimmedClass) {
    errors.targetClass = 'Vui lòng chọn hoặc nhập lớp/nhóm được thi.';
  }

  if (values.selectionMode === 'manual') {
    const manualList = Array.isArray(values.manualQuestionIds)
      ? values.manualQuestionIds.filter(Boolean)
      : [];
    if (manualList.length === 0) {
      errors.manualQuestionIds =
        'Vui lòng chọn ít nhất 1 câu hỏi cho bộ đề thủ công.';
    }
  } else {
    const rawCount = Number(values.questionCount);
    const upperBound = Math.max(1, maxAvailableQuestions || 500);
    if (
      String(values.questionCount ?? '').trim() === '' ||
      !Number.isFinite(rawCount) ||
      !Number.isInteger(rawCount) ||
      rawCount < 1
    ) {
      errors.questionCount = 'Số câu hỏi phải là số nguyên từ 1 trở lên.';
    } else if (rawCount > upperBound) {
      errors.questionCount = `Số câu hỏi không được vượt quá ${upperBound} câu hiện có trong ngân hàng.`;
    }
  }

  const rawDuration = Number(values.durationMinutes);
  if (
    String(values.durationMinutes ?? '').trim() === '' ||
    !Number.isFinite(rawDuration) ||
    !Number.isInteger(rawDuration) ||
    rawDuration < 1 ||
    rawDuration > 300
  ) {
    errors.durationMinutes = 'Thời gian làm bài phải là số nguyên từ 1 đến 300 phút.';
  }

  const rawMaxViolations = Number(values.maxViolations);
  if (
    String(values.maxViolations ?? '').trim() === '' ||
    !Number.isFinite(rawMaxViolations) ||
    !Number.isInteger(rawMaxViolations) ||
    rawMaxViolations < 1 ||
    rawMaxViolations > 20
  ) {
    errors.maxViolations = 'Ngưỡng vi phạm tự nộp phải là số nguyên từ 1 đến 20 lần.';
  }

  const rawPassScore = Number(values.passScore);
  if (
    String(values.passScore ?? '').trim() === '' ||
    !Number.isFinite(rawPassScore) ||
    !Number.isInteger(rawPassScore) ||
    rawPassScore < 100 ||
    rawPassScore > 1000
  ) {
    errors.passScore = 'Điểm đạt phải là số nguyên từ 100 đến 1000 điểm.';
  }

  const openStr = String(values.openAt ?? '').trim();
  const closeStr = String(values.closeAt ?? '').trim();
  const openMs = openStr ? new Date(openStr).getTime() : null;
  const closeMs = closeStr ? new Date(closeStr).getTime() : null;

  if (openStr && (openMs === null || Number.isNaN(openMs))) {
    errors.openAt = 'Định dạng thời gian mở không hợp lệ.';
  }
  if (closeStr && (closeMs === null || Number.isNaN(closeMs))) {
    errors.closeAt = 'Định dạng thời gian đóng không hợp lệ.';
  }
  if (
    openMs !== null &&
    closeMs !== null &&
    !Number.isNaN(openMs) &&
    !Number.isNaN(closeMs) &&
    closeMs <= openMs
  ) {
    errors.closeAt = 'Khung giờ đóng phải muộn hơn thời điểm bắt đầu mở ca thi.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export type ViolationSeverityLevel = 'normal' | 'warning' | 'exceeded';

/**
 * Phân loại mức độ vi phạm của học sinh để tô màu trực quan (BƯỚC 6/8):
 * - `exceeded`: Đã chạm hoặc vượt ngưỡng tự nộp (`violationCount >= maxViolations`)
 * - `warning`: Gần ngưỡng (`violationCount > 0 && violationCount === maxViolations - 1`)
 * - `normal`: Bình thường (`0` hoặc thấp hơn mức cảnh báo sát ngưỡng)
 */
export function getViolationSeverityLevel(
  violationCount: number,
  maxViolations: number
): ViolationSeverityLevel {
  const safeMax = Math.max(1, Math.floor(maxViolations || 3));
  const safeCount = Math.max(0, Math.floor(violationCount || 0));
  if (safeCount >= safeMax) {
    return 'exceeded';
  }
  if (safeCount > 0 && safeCount === safeMax - 1) {
    return 'warning';
  }
  return 'normal';
}

/**
 * Tạo dòng tóm tắt duy nhất cho tab "Đang thi" (BƯỚC 6/8):
 * Ví dụ: "32 đang thi, 5 đã nộp, 3 chưa vào"
 */
export function formatSingleSummaryLine(summary: {
  inProgressCount: number;
  submittedCount: number;
  notEnteredCount: number;
}): string {
  return `${summary.inProgressCount} đang thi, ${summary.submittedCount} đã nộp, ${summary.notEnteredCount} chưa vào`;
}

export interface LiveStudentMonitoringRow {
  rowKey: string;
  studentId: string;
  username: string;
  fullName: string;
  className: string;
  status: 'in_progress' | 'submitted' | 'not_entered';
  attemptId?: string;
  submitReason?: AttemptSubmitReason | null;
  answeredCount: number;
  totalQuestions: number;
  progressPercent: number;
  deadlineAt?: string;
  remainingSeconds: number | null;
  violationCount: number;
  violationSeverity: ViolationSeverityLevel;
  recentViolations: ViolationEventRecord[];
  reentryCount: number;
  previousAttemptId?: string | null;
  supersededByAttemptId?: string | null;
}

/**
 * Xây dựng danh sách học sinh theo dõi trực tiếp ở tab "Đang thi" (BƯỚC 6/8):
 * - Gộp các lượt thi hiện hành (`!supersededByAttemptId`) và danh sách học sinh chưa vào (`notEnteredStudents`).
 * - Học sinh có vi phạm nhiều được đẩy lên đầu danh sách (`violationCount` giảm dần).
 * - Hỗ trợ bộ lọc "Chỉ hiện học sinh có vi phạm" (`onlyWithViolations`) và tìm kiếm theo tên/tài khoản.
 */
export function buildLiveStudentMonitoringRows(input: {
  attempts: SessionAttemptRecord[];
  notEnteredStudents: TeacherLiveNotEnteredStudent[];
  violations: ViolationEventRecord[];
  maxViolations: number;
  sessionQuestionCount: number;
  onlyWithViolations?: boolean;
  searchQuery?: string;
  serverOffsetMs?: number;
  clientNowMs?: number;
}): LiveStudentMonitoringRow[] {
  const {
    attempts,
    notEnteredStudents,
    violations,
    maxViolations,
    sessionQuestionCount,
    onlyWithViolations = false,
    searchQuery = '',
    serverOffsetMs = 0,
    clientNowMs = Date.now(),
  } = input;

  // Nhóm sự kiện vi phạm theo attemptId và studentId (mới nhất lên đầu)
  const violationsByAttempt = new Map<string, ViolationEventRecord[]>();
  const violationsByStudent = new Map<string, ViolationEventRecord[]>();
  const sortedViolations = [...(violations || [])].sort((a, b) =>
    b.occurredAt.localeCompare(a.occurredAt)
  );
  for (const v of sortedViolations) {
    const attList = violationsByAttempt.get(v.attemptId) ?? [];
    attList.push(v);
    violationsByAttempt.set(v.attemptId, attList);

    const stuKey = v.studentId.toLowerCase();
    const stuList = violationsByStudent.get(stuKey) ?? [];
    stuList.push(v);
    violationsByStudent.set(stuKey, stuList);
  }

  // Chỉ hiển thị lượt thi hiện hành của mỗi học sinh (bài cũ đã được thay bằng lượt thi mới vẫn giữ trong DB nhưng không làm trùng dòng học sinh)
  const activeAttempts = (attempts || []).filter(
    (att) => !att.supersededByAttemptId
  );

  const rows: LiveStudentMonitoringRow[] = [];

  for (const att of activeAttempts) {
    const totalQ = Math.max(
      1,
      att.totalQuestions || att.generatedQuestions?.length || sessionQuestionCount || 45
    );
    const answered = Math.min(totalQ, Math.max(0, att.answeredCount ?? 0));
    const progressPercent = Math.round((answered / totalQ) * 100);
    const remaining =
      att.status === 'in_progress'
        ? computeServerRemainingSeconds(
            att.deadlineAt,
            serverOffsetMs,
            clientNowMs
          )
        : null;

    const studentViolations =
      violationsByAttempt.get(att.id) ??
      violationsByStudent.get(att.studentId.toLowerCase()) ??
      [];

    rows.push({
      rowKey: `att_${att.id}`,
      studentId: att.studentId,
      username: att.username,
      fullName: att.fullName,
      className: att.className,
      status: att.status,
      attemptId: att.id,
      submitReason: att.submitReason,
      answeredCount: answered,
      totalQuestions: totalQ,
      progressPercent,
      deadlineAt: att.deadlineAt,
      remainingSeconds: remaining,
      violationCount: att.violationCount,
      violationSeverity: getViolationSeverityLevel(
        att.violationCount,
        maxViolations
      ),
      recentViolations: studentViolations,
      reentryCount: att.reentryCount,
      previousAttemptId: att.previousAttemptId ?? null,
      supersededByAttemptId: att.supersededByAttemptId ?? null,
    });
  }

  for (const stu of notEnteredStudents || []) {
    const totalQ = Math.max(1, sessionQuestionCount || 45);
    rows.push({
      rowKey: `not_entered_${stu.studentId}`,
      studentId: stu.studentId,
      username: stu.username,
      fullName: stu.fullName,
      className: stu.className,
      status: 'not_entered',
      answeredCount: 0,
      totalQuestions: totalQ,
      progressPercent: 0,
      remainingSeconds: null,
      violationCount: 0,
      violationSeverity: 'normal',
      recentViolations: [],
      reentryCount: 0,
      previousAttemptId: null,
      supersededByAttemptId: null,
    });
  }

  // Sắp xếp: Học sinh có vi phạm nhiều lên đầu danh sách; sau đó ưu tiên đang thi -> đã nộp -> chưa vào
  const statusRank: Record<LiveStudentMonitoringRow['status'], number> = {
    in_progress: 0,
    submitted: 1,
    not_entered: 2,
  };

  rows.sort((a, b) => {
    if (b.violationCount !== a.violationCount) {
      return b.violationCount - a.violationCount;
    }
    if (b.recentViolations.length !== a.recentViolations.length) {
      return b.recentViolations.length - a.recentViolations.length;
    }
    if (statusRank[a.status] !== statusRank[b.status]) {
      return statusRank[a.status] - statusRank[b.status];
    }
    return a.fullName.localeCompare(b.fullName, 'vi');
  });

  const cleanQuery = searchQuery.trim().toLowerCase();

  return rows.filter((row) => {
    if (
      onlyWithViolations &&
      row.violationCount <= 0 &&
      row.recentViolations.length === 0
    ) {
      return false;
    }
    if (cleanQuery) {
      return (
        row.fullName.toLowerCase().includes(cleanQuery) ||
        row.username.toLowerCase().includes(cleanQuery) ||
        row.className.toLowerCase().includes(cleanQuery)
      );
    }
    return true;
  });
}
