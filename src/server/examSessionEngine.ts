import {
  CERTIPORT_PASS_SCORE,
  CERTIPORT_TOPICS,
  type Question,
  type UserAccount,
  type UserAnswer,
} from '../types/exam.ts';
import type {
  AttemptAnswerRecord,
  AttemptSubmitReason,
  ExamAuditAction,
  ExamAuditLogRecord,
  ExamSessionRecord,
  ExamSessionResultVisibility,
  ExamSessionSelectionMode,
  ExamSessionStatus,
  SanitizedStudentQuestion,
  SessionAttemptRecord,
  StudentAttemptPaperPayload,
  StudentAttemptResultPayload,
  TeacherAttemptQuestionDetail,
  TeacherLiveNotEnteredStudent,
  TeacherSessionDetailPayload,
  VerifyCodeResult,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession.ts';
import {
  buildProportionalExamPool,
  evaluateExamSet,
  getCorrectAnswerBreakdown,
  getUserAnswerBreakdown,
} from '../utils/scoring.ts';
import { doesViolationCountTowardLimit } from '../utils/liveExamHelpers.ts';

/**
 * Bảng chữ cái sinh mã ca thi 6 ký tự:
 * Loại bỏ các ký tự dễ nhầm lẫn: 0, O, 1, I, L
 */
export const EXAM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const EXAM_CODE_LENGTH = 6;

/**
 * Cấu hình giới hạn nhập mã sai:
 * Sai 5 lần liên tiếp sẽ bị khóa 60 giây (tính theo cả tài khoản lẫn IP)
 */
export const CODE_RATE_LIMIT_MAX_FAILURES = 5;
export const CODE_RATE_LIMIT_LOCKOUT_MS = 60 * 1000;
export const CODE_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

export class ExamEngineError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string;

  constructor(message: string, statusCode: number = 400, errorCode: string = 'BAD_REQUEST') {
    super(message);
    this.name = 'ExamEngineError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
  }
}

export function normalizeExamCode(rawCode: string): string {
  return String(rawCode || '')
    .trim()
    .toUpperCase();
}

export function isValidExamCodeFormat(code: string): boolean {
  const normalized = normalizeExamCode(code);
  if (normalized.length !== EXAM_CODE_LENGTH) return false;
  for (const ch of normalized) {
    if (!EXAM_CODE_ALPHABET.includes(ch)) {
      return false;
    }
  }
  return true;
}

export function generateUniqueExamCode(
  existingActiveCodes: Set<string>,
  randomFn: () => number = Math.random
): string {
  const activeUpper = new Set(
    Array.from(existingActiveCodes).map((c) => normalizeExamCode(c))
  );

  for (let attempt = 0; attempt < 500; attempt++) {
    let candidate = '';
    for (let i = 0; i < EXAM_CODE_LENGTH; i++) {
      const idx = Math.floor(randomFn() * EXAM_CODE_ALPHABET.length);
      candidate += EXAM_CODE_ALPHABET[idx];
    }
    if (!activeUpper.has(candidate)) {
      return candidate;
    }
  }

  throw new ExamEngineError(
    'Không thể sinh mã ca thi duy nhất. Vui lòng thử lại.',
    500,
    'CODE_GENERATION_FAILED'
  );
}

function shuffleWithRng<T>(items: T[], randomFn: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

/**
 * Loại bỏ hoàn toàn `correctAnswer` và `explanation` khỏi câu hỏi trước khi lưu vào đề học sinh
 * hoặc trả về cho trình duyệt học sinh đang làm bài.
 */
export function sanitizeQuestionForStudent(
  question: Question,
  orderNumber: number,
  shuffleOptions: boolean,
  randomFn: () => number = Math.random
): SanitizedStudentQuestion {
  const sanitized: SanitizedStudentQuestion = {
    id: question.id,
    orderNumber,
    type: question.type,
    topic: question.topic,
    examSet: question.examSet,
    prompt: question.prompt,
  };

  if (question.instruction !== undefined) {
    sanitized.instruction = question.instruction;
  }
  if (question.imageUrl !== undefined) {
    sanitized.imageUrl = question.imageUrl;
  }
  const derivedMaxSelect =
    question.maxSelect ??
    question.maxSelections ??
    (question.type === 'mcq_multiple' && Array.isArray(question.correctAnswer)
      ? question.correctAnswer.length
      : undefined);

  if (derivedMaxSelect !== undefined) {
    sanitized.maxSelect = derivedMaxSelect;
  }
  if (question.maxSelections !== undefined) {
    sanitized.maxSelections = question.maxSelections;
  }
  if (question.dropdownColumns !== undefined) {
    sanitized.dropdownColumns = [...question.dropdownColumns] as [string, string];
  }

  if (question.options && question.options.length > 0) {
    const clonedOpts = question.options.map((o) => ({ id: o.id, text: o.text }));
    sanitized.options = shuffleOptions
      ? shuffleWithRng(clonedOpts, randomFn)
      : clonedOpts;
  }

  if (question.subItems && question.subItems.length > 0) {
    sanitized.subItems = question.subItems.map((sub) => {
      const rawChoices = sub.choices ?? sub.options ?? [];
      const choices = shuffleOptions
        ? shuffleWithRng([...rawChoices], randomFn)
        : [...rawChoices];
      return {
        id: sub.id,
        statement: sub.statement,
        choices,
      };
    });
  }

  if (question.dropdownOptions && question.dropdownOptions.length > 0) {
    sanitized.dropdownOptions = shuffleOptions
      ? shuffleWithRng([...question.dropdownOptions], randomFn)
      : [...question.dropdownOptions];
  }

  if (question.pairs && question.pairs.length > 0) {
    sanitized.matchingLeftItems = question.pairs.map((p) => ({
      id: p.id,
      left: p.left,
    }));
    const rightChoices = question.pairs.map((p) => p.right);
    sanitized.matchingRightChoices = shuffleOptions
      ? shuffleWithRng(rightChoices, randomFn)
      : [...rightChoices].sort((a, b) => a.localeCompare(b, 'vi'));
  }

  if (question.steps && question.steps.length > 0) {
    const clonedSteps = question.steps.map((s) => ({ id: s.id, text: s.text }));
    sanitized.steps = shuffleOptions
      ? shuffleWithRng(clonedSteps, randomFn)
      : [...clonedSteps].sort((a, b) => a.text.localeCompare(b.text, 'vi'));
  }

  return sanitized;
}

interface RateLimitBucket {
  failures: number[];
  lockedUntilMs: number;
}

export interface CreateExamSessionInput {
  title: string;
  code?: string;
  targetClass?: string;
  questionCount?: number;
  durationMinutes?: number;
  selectionMode?: ExamSessionSelectionMode;
  manualQuestionIds?: string[];
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  openAt?: string | null;
  closeAt?: string | null;
  maxViolations?: number;
  passScore?: number;
  resultVisibility?: ExamSessionResultVisibility;
  status?: ExamSessionStatus;
}

export interface UpdateExamSessionInput {
  title?: string;
  targetClass?: string;
  questionCount?: number;
  durationMinutes?: number;
  selectionMode?: ExamSessionSelectionMode;
  manualQuestionIds?: string[];
  shuffleQuestions?: boolean;
  shuffleOptions?: boolean;
  openAt?: string | null;
  closeAt?: string | null;
  maxViolations?: number;
  passScore?: number;
  resultVisibility?: ExamSessionResultVisibility;
  status?: ExamSessionStatus;
}

export interface ExamStorageAdapter {
  onSessionSaved?: (session: ExamSessionRecord) => Promise<void> | void;
  onSessionDeleted?: (sessionId: string) => Promise<void> | void;
  onAttemptSaved?: (attempt: SessionAttemptRecord) => Promise<void> | void;
  onAnswerSaved?: (answer: AttemptAnswerRecord) => Promise<void> | void;
  onViolationSaved?: (violation: ViolationEventRecord) => Promise<void> | void;
  onAuditLogSaved?: (log: ExamAuditLogRecord) => Promise<void> | void;
}

export interface ExamSessionEngineOptions {
  nowFn?: () => Date;
  randomFn?: () => number;
  storageAdapter?: ExamStorageAdapter;
}

/**
 * Máy chủ Quản lý Ca thi & Chấm thi Tập trung (Server-Authoritative Exam Session Engine)
 */
export class ExamSessionEngine {
  private sessions = new Map<string, ExamSessionRecord>();
  private attempts = new Map<string, SessionAttemptRecord>();
  private attemptAnswers = new Map<string, AttemptAnswerRecord>();
  private violations = new Map<string, ViolationEventRecord>();
  private auditLogs = new Map<string, ExamAuditLogRecord>();
  private users = new Map<string, UserAccount>();
  private questions = new Map<string, Question>();

  private rateLimitByAccount = new Map<string, RateLimitBucket>();
  private rateLimitByIp = new Map<string, RateLimitBucket>();

  private nowFn: () => Date;
  private randomFn: () => number;
  private storageAdapter?: ExamStorageAdapter;
  private idCounter = 1;

  constructor(options: ExamSessionEngineOptions = {}) {
    this.nowFn = options.nowFn ?? (() => new Date());
    this.randomFn = options.randomFn ?? Math.random;
    this.storageAdapter = options.storageAdapter;
  }

  private nowIso(): string {
    return this.nowFn().toISOString();
  }

  private nowMs(): number {
    return this.nowFn().getTime();
  }

  private nextId(prefix: string): string {
    const rand = Math.floor(this.randomFn() * 1_000_000)
      .toString(36)
      .padStart(4, '0');
    this.idCounter += 1;
    return `${prefix}_${this.nowMs()}_${this.idCounter}_${rand}`;
  }

  // ============================================================================
  // ĐỒNG BỘ DỮ LIỆU NỀN (USERS, QUESTIONS, HYDRATE TỪ FIRESTORE)
  // ============================================================================

  public setUsers(usersList: UserAccount[]): void {
    for (const u of usersList) {
      const id = u.id || u.username;
      this.users.set(id, { ...u, id });
    }
  }

  public upsertUser(user: UserAccount): void {
    const id = user.id || user.username;
    this.users.set(id, { ...user, id });
  }

  public getUser(userIdOrUsername: string): UserAccount | undefined {
    const clean = String(userIdOrUsername || '').trim();
    if (!clean) return undefined;
    const direct = this.users.get(clean);
    if (direct) return direct;
    for (const u of this.users.values()) {
      if (
        u.id.toLowerCase() === clean.toLowerCase() ||
        u.username.toLowerCase() === clean.toLowerCase()
      ) {
        return u;
      }
    }
    return undefined;
  }

  public setQuestions(questionsList: Question[]): void {
    this.questions.clear();
    for (const q of questionsList) {
      this.questions.set(q.id, q);
    }
  }

  private getFallbackQuestions(): Question[] {
    const list: Question[] = [];
    for (let tIdx = 0; tIdx < CERTIPORT_TOPICS.length; tIdx++) {
      const topic = CERTIPORT_TOPICS[tIdx];
      for (let i = 1; i <= 5; i++) {
        const qNum = tIdx * 5 + i;
        list.push({
          id: `FB_Q_${qNum}`,
          type: 'mcq_single',
          topic,
          examSet: 'Đề chuẩn Certiport GenAI',
          prompt: `Câu hỏi chuẩn Certiport số ${qNum} thuộc chuyên đề ${topic}?`,
          options: [
            { id: 'A', text: 'Phương án đúng chuẩn Certiport' },
            { id: 'B', text: 'Phương án nhiễu B' },
            { id: 'C', text: 'Phương án nhiễu C' },
            { id: 'D', text: 'Phương án nhiễu D' },
          ],
          correctAnswer: 'A',
          explanation: `Giải thích chi tiết cho câu hỏi ${qNum} (${topic}).`,
        });
      }
    }
    return list;
  }

  private resolveMasterQuestion(sq: SanitizedStudentQuestion): Question {
    const masterQ = this.questions.get(sq.id);
    if (masterQ) {
      return masterQ;
    }
    return {
      id: sq.id,
      type: sq.type,
      topic: sq.topic,
      examSet: sq.examSet,
      prompt: sq.prompt,
      options: sq.options ?? [
        { id: 'A', text: 'Phương án A' },
        { id: 'B', text: 'Phương án B' },
        { id: 'C', text: 'Phương án C' },
        { id: 'D', text: 'Phương án D' },
      ],
      correctAnswer: 'A',
      explanation: '',
    };
  }

  public getQuestions(): Question[] {
    if (this.questions.size === 0) {
      return this.getFallbackQuestions();
    }
    return Array.from(this.questions.values());
  }

  public hydrateState(data: {
    sessions?: ExamSessionRecord[];
    attempts?: SessionAttemptRecord[];
    attemptAnswers?: AttemptAnswerRecord[];
    violations?: ViolationEventRecord[];
    auditLogs?: ExamAuditLogRecord[];
  }): void {
    if (data.sessions) {
      for (const s of data.sessions) {
        this.sessions.set(s.id, s);
      }
    }
    if (data.attempts) {
      for (const a of data.attempts) {
        if (a.sessionId && Array.isArray(a.generatedQuestions)) {
          this.attempts.set(a.id, a);
        }
      }
    }
    if (data.attemptAnswers) {
      for (const ans of data.attemptAnswers) {
        this.attemptAnswers.set(ans.id, ans);
      }
    }
    if (data.violations) {
      for (const v of data.violations) {
        this.violations.set(v.id, v);
      }
    }
    if (data.auditLogs) {
      for (const log of data.auditLogs) {
        this.auditLogs.set(log.id, log);
      }
    }
  }

  // ============================================================================
  // KIỂM TRA QUYỀN (RBAC) Ở MÁY CHỦ
  // ============================================================================

  private requireUser(userIdOrAccount: string | UserAccount): UserAccount {
    if (typeof userIdOrAccount === 'object' && userIdOrAccount !== null) {
      return userIdOrAccount;
    }
    const found = this.getUser(userIdOrAccount);
    if (!found) {
      throw new ExamEngineError(
        'Tài khoản không tồn tại hoặc chưa đăng nhập.',
        401,
        'UNAUTHORIZED'
      );
    }
    return found;
  }

  private requireTeacher(userIdOrAccount: string | UserAccount): UserAccount {
    const user = this.requireUser(userIdOrAccount);
    if (user.role !== 'teacher') {
      throw new ExamEngineError(
        'Chỉ giáo viên mới có quyền thực hiện thao tác quản lý ca thi.',
        403,
        'FORBIDDEN_TEACHER_ONLY'
      );
    }
    return user;
  }

  private requireStudent(userIdOrAccount: string | UserAccount): UserAccount {
    const user = this.requireUser(userIdOrAccount);
    if (user.role !== 'student') {
      throw new ExamEngineError(
        'Chức năng này chỉ dành cho tài khoản học sinh.',
        403,
        'FORBIDDEN_STUDENT_ONLY'
      );
    }
    return user;
  }

  /**
   * Giáo viên chỉ được truy cập ca thi do chính mình tạo, hoặc ca thi thuộc lớp mình phụ trách
   * (Tài khoản quản trị gốc `admin` được phép quản lý toàn trường).
   */
  public canTeacherAccessSession(
    teacher: UserAccount,
    session: ExamSessionRecord
  ): boolean {
    if (teacher.role !== 'teacher') return false;
    const isRootAdmin =
      teacher.id.toLowerCase() === 'admin' ||
      teacher.username.toLowerCase() === 'admin';
    if (isRootAdmin) return true;

    const isCreator =
      session.createdBy.toLowerCase() === teacher.id.toLowerCase() ||
      session.createdBy.toLowerCase() === teacher.username.toLowerCase();
    if (isCreator) return true;

    const teacherClass = (teacher.className || '').trim().toLowerCase();
    const sessionClass = (session.targetClass || '').trim().toLowerCase();
    if (
      teacherClass &&
      sessionClass &&
      sessionClass !== 'all' &&
      teacherClass === sessionClass
    ) {
      return true;
    }

    return false;
  }

  private requireTeacherSessionAccess(
    teacherInput: string | UserAccount,
    sessionId: string
  ): { teacher: UserAccount; session: ExamSessionRecord } {
    const teacher = this.requireTeacher(teacherInput);
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ExamEngineError('Không tìm thấy ca thi.', 404, 'SESSION_NOT_FOUND');
    }
    if (!this.canTeacherAccessSession(teacher, session)) {
      throw new ExamEngineError(
        'Bạn chỉ được quyền truy cập ca thi do mình tạo hoặc thuộc lớp mình phụ trách.',
        403,
        'FORBIDDEN_SESSION_ACCESS'
      );
    }
    return { teacher, session };
  }

  /**
   * Kiểm tra học sinh có thuộc lớp/nhóm được phép thi của ca thi hay không
   */
  public isStudentAllowedInSessionClass(
    student: UserAccount,
    session: ExamSessionRecord
  ): boolean {
    const target = (session.targetClass || 'ALL').trim().toLowerCase();
    if (
      !target ||
      target === 'all' ||
      target === 'mở cho mọi học sinh có mã' ||
      target === '*'
    ) {
      return true;
    }
    const studentClass = (student.className || '').trim().toLowerCase();
    if (!studentClass) return false;

    const allowedClasses = target
      .split(/[,;|]/)
      .map((item) => item.trim())
      .filter(Boolean);
    return allowedClasses.includes(studentClass);
  }

  // ============================================================================
  // NHẬT KÝ TÁC VỤ QUẢN LÝ CA THI (AUDIT LOG)
  // ============================================================================

  private recordAuditLog(params: {
    sessionId: string;
    actor: UserAccount;
    action: ExamAuditAction;
    targetAttemptId?: string;
    targetStudentId?: string;
    note?: string;
    details?: Record<string, unknown>;
  }): ExamAuditLogRecord {
    const derivedNote =
      params.note ||
      (typeof params.details?.note === 'string'
        ? params.details.note
        : params.details
          ? JSON.stringify(params.details)
          : params.action);
    const log: ExamAuditLogRecord = {
      id: this.nextId('audit'),
      sessionId: params.sessionId,
      actorId: params.actor.id,
      actorName: params.actor.fullName,
      action: params.action,
      ...(params.targetAttemptId ? { targetAttemptId: params.targetAttemptId } : {}),
      ...(params.targetStudentId ? { targetStudentId: params.targetStudentId } : {}),
      note: derivedNote,
      ...(params.details ? { details: params.details } : {}),
      createdAt: this.nowIso(),
    };
    this.auditLogs.set(log.id, log);
    this.storageAdapter?.onAuditLogSaved?.(log);
    return log;
  }

  // ============================================================================
  // GIỚI HẠN NHẬP MÃ (RATE LIMITING: 5 LẦN SAI -> CHỜ 60 GIÂY THEO TÀI KHOẢN & IP)
  // ============================================================================

  private checkRateLimitBucket(bucket: RateLimitBucket | undefined, nowMs: number): number {
    if (!bucket) return 0;
    if (bucket.lockedUntilMs > nowMs) {
      return Math.max(1, Math.ceil((bucket.lockedUntilMs - nowMs) / 1000));
    }
    return 0;
  }

  public getCodeRateLimitWaitSeconds(accountKey: string, ipAddress: string): number {
    const nowMs = this.nowMs();
    const cleanAccount = String(accountKey || 'anonymous').trim().toLowerCase();
    const cleanIp = String(ipAddress || 'unknown').trim().toLowerCase();

    const accountWait = this.checkRateLimitBucket(
      this.rateLimitByAccount.get(cleanAccount),
      nowMs
    );
    const ipWait = this.checkRateLimitBucket(
      this.rateLimitByIp.get(cleanIp),
      nowMs
    );
    return Math.max(accountWait, ipWait);
  }

  private recordFailedCodeAttempt(accountKey: string, ipAddress: string): number {
    const nowMs = this.nowMs();
    const cleanAccount = String(accountKey || 'anonymous').trim().toLowerCase();
    const cleanIp = String(ipAddress || 'unknown').trim().toLowerCase();

    const updateBucket = (map: Map<string, RateLimitBucket>, key: string): number => {
      const existing = map.get(key) ?? { failures: [], lockedUntilMs: 0 };
      const recentFailures = existing.failures.filter(
        (ts) => nowMs - ts < CODE_RATE_LIMIT_WINDOW_MS
      );
      recentFailures.push(nowMs);
      let lockedUntilMs = existing.lockedUntilMs;
      if (recentFailures.length >= CODE_RATE_LIMIT_MAX_FAILURES) {
        lockedUntilMs = nowMs + CODE_RATE_LIMIT_LOCKOUT_MS;
      }
      map.set(key, { failures: recentFailures, lockedUntilMs });
      return lockedUntilMs > nowMs
        ? Math.max(1, Math.ceil((lockedUntilMs - nowMs) / 1000))
        : 0;
    };

    const waitAcc = updateBucket(this.rateLimitByAccount, cleanAccount);
    const waitIp = updateBucket(this.rateLimitByIp, cleanIp);
    return Math.max(waitAcc, waitIp);
  }

  private clearFailedCodeAttempts(accountKey: string, ipAddress: string): void {
    const cleanAccount = String(accountKey || 'anonymous').trim().toLowerCase();
    const cleanIp = String(ipAddress || 'unknown').trim().toLowerCase();
    this.rateLimitByAccount.delete(cleanAccount);
    this.rateLimitByIp.delete(cleanIp);
  }

  // ============================================================================
  // CHẤM ĐIỂM & TỰ ĐỘNG CHỐT BÀI Ở MÁY CHỦ
  // ============================================================================

  private getSavedAnswerMapForAttempt(attemptId: string): {
    answersMap: Record<string, UserAnswer>;
    flaggedMap: Record<string, boolean>;
    recordsByQuestionId: Record<string, AttemptAnswerRecord>;
  } {
    const answersMap: Record<string, UserAnswer> = {};
    const flaggedMap: Record<string, boolean> = {};
    const recordsByQuestionId: Record<string, AttemptAnswerRecord> = {};

    for (const record of this.attemptAnswers.values()) {
      if (record.attemptId === attemptId) {
        recordsByQuestionId[record.questionId] = record;
        if (record.selectedAnswer !== null && record.selectedAnswer !== undefined) {
          answersMap[record.questionId] = record.selectedAnswer;
        }
        if (record.flagged) {
          flaggedMap[record.questionId] = true;
        }
      }
    }

    return { answersMap, flaggedMap, recordsByQuestionId };
  }

  private evaluateAttemptSnapshot(attempt: SessionAttemptRecord) {
    const session = this.sessions.get(attempt.sessionId);
    const passScore = session?.passScore ?? CERTIPORT_PASS_SCORE;
    const fullQuestions: Question[] = attempt.generatedQuestions.map((sq) =>
      this.resolveMasterQuestion(sq)
    );
    const { answersMap, flaggedMap } = this.getSavedAnswerMapForAttempt(attempt.id);
    const evaluation = evaluateExamSet(fullQuestions, answersMap, flaggedMap);
    const passed = evaluation.certiportScore >= passScore;
    return { evaluation, passed, passScore };
  }

  /**
   * Chấm điểm hoàn toàn ở máy chủ dựa trên ngân hàng câu hỏi gốc (chứa `correctAnswer`)
   * và chốt trạng thái lượt thi (`status = 'submitted'`).
   */
  private finalizeAttemptOnServer(
    attempt: SessionAttemptRecord,
    submitReason: AttemptSubmitReason,
    submittedAtIso?: string
  ): SessionAttemptRecord {
    if (attempt.status === 'submitted') {
      return attempt;
    }

    const effectiveSubmittedAt = submittedAtIso ?? this.nowIso();
    const { evaluation, passed } = this.evaluateAttemptSnapshot(attempt);
    const startedMs = new Date(attempt.startedAt).getTime();
    const submittedMs = new Date(effectiveSubmittedAt).getTime();
    const computedDurationSeconds =
      Number.isFinite(startedMs) && Number.isFinite(submittedMs)
        ? Math.max(1, Math.round((submittedMs - startedMs) / 1000))
        : attempt.durationSeconds ?? 0;

    const updated: SessionAttemptRecord = {
      ...attempt,
      status: 'submitted',
      submittedAt: effectiveSubmittedAt,
      submitReason,
      durationSeconds: computedDurationSeconds,
      score: evaluation.certiportScore,
      correctCount: evaluation.score,
      totalQuestions: evaluation.totalQuestions,
      percentage: evaluation.percentage,
      passed,
      activeSessionToken: null,
      questionResults: evaluation.questionResults,
      topicBreakdown: evaluation.topicBreakdown,
      typeBreakdown: evaluation.typeBreakdown,
    };

    this.attempts.set(updated.id, updated);
    this.storageAdapter?.onAttemptSaved?.(updated);
    return updated;
  }

  /**
   * Kiểm tra hạn nộp của một lượt thi theo đồng hồ máy chủ.
   * Nếu đã quá `deadlineAt`, máy chủ tự động chốt bài với kiểu nộp `'timeout'`.
   */
  private checkAndAutoSubmitIfExpired(attempt: SessionAttemptRecord): SessionAttemptRecord {
    if (attempt.status !== 'in_progress') {
      return attempt;
    }
    const nowMs = this.nowMs();
    const deadlineMs = new Date(attempt.deadlineAt).getTime();
    if (nowMs >= deadlineMs) {
      return this.finalizeAttemptOnServer(
        attempt,
        'timeout',
        new Date(deadlineMs).toISOString()
      );
    }
    return attempt;
  }

  /**
   * Quét định kỳ toàn bộ các lượt thi đang diễn ra (`in_progress`) trên máy chủ
   * để tự động chốt các bài đã hết giờ, đồng thời tự động khóa (`locked`) các ca thi
   * đang mở (`open`) khi đã hết khung giờ mở (`closeAt`).
   */
  public sweepExpiredAttempts(): SessionAttemptRecord[] {
    const nowMs = this.nowMs();
    const nowIso = this.nowIso();

    for (const session of this.sessions.values()) {
      if (session.status === 'open' && session.closeAt) {
        const closeMs = new Date(session.closeAt).getTime();
        if (Number.isFinite(closeMs) && nowMs > closeMs) {
          const lockedSession: ExamSessionRecord = {
            ...session,
            status: 'locked',
            updatedAt: nowIso,
          };
          this.sessions.set(lockedSession.id, lockedSession);
          this.storageAdapter?.onSessionSaved?.(lockedSession);
        }
      }
    }

    const autoSubmitted: SessionAttemptRecord[] = [];
    for (const attempt of this.attempts.values()) {
      if (attempt.status === 'in_progress') {
        const checked = this.checkAndAutoSubmitIfExpired(attempt);
        if (checked.status === 'submitted') {
          autoSubmitted.push(checked);
        }
      }
    }
    return autoSubmitted;
  }

  // ============================================================================
  // API DÀNH CHO GIÁO VIÊN (QUẢN LÝ CA THI)
  // ============================================================================

  private getActiveSessionCodesSet(excludeSessionId?: string): Set<string> {
    const activeCodes = new Set<string>();
    for (const s of this.sessions.values()) {
      if (s.id !== excludeSessionId && s.status !== 'ended') {
        activeCodes.add(normalizeExamCode(s.code));
      }
    }
    return activeCodes;
  }

  public createSession(
    teacherInput: string | UserAccount,
    input: CreateExamSessionInput
  ): ExamSessionRecord {
    const teacher = this.requireTeacher(teacherInput);
    const title = String(input.title || '').trim();
    if (!title) {
      throw new ExamEngineError('Tên ca thi không được để trống.', 400, 'INVALID_TITLE');
    }

    const activeCodes = this.getActiveSessionCodesSet();
    let code: string;
    if (input.code !== undefined && String(input.code).trim() !== '') {
      const candidate = normalizeExamCode(input.code);
      if (!isValidExamCodeFormat(candidate)) {
        throw new ExamEngineError(
          'Mã ca thi phải gồm đúng 6 ký tự chữ/số và không chứa các ký tự dễ nhầm (0, O, 1, I, L).',
          400,
          'INVALID_CODE_FORMAT'
        );
      }
      if (activeCodes.has(candidate)) {
        throw new ExamEngineError(
          `Mã ca thi "${candidate}" đang được sử dụng bởi một ca thi hoạt động khác.`,
          409,
          'DUPLICATE_ACTIVE_CODE'
        );
      }
      code = candidate;
    } else {
      code = generateUniqueExamCode(activeCodes, this.randomFn);
    }

    const selectionMode: ExamSessionSelectionMode =
      input.selectionMode === 'manual' ? 'manual' : 'proportional';
    const manualQuestionIds =
      selectionMode === 'manual' ? [...(input.manualQuestionIds ?? [])] : undefined;

    if (selectionMode === 'manual' && (!manualQuestionIds || manualQuestionIds.length === 0)) {
      throw new ExamEngineError(
        'Chế độ chọn câu hỏi thủ công yêu cầu ít nhất 1 câu hỏi.',
        400,
        'EMPTY_MANUAL_QUESTIONS'
      );
    }

    const questionCount =
      selectionMode === 'manual'
        ? manualQuestionIds!.length
        : Math.max(1, Math.floor(Number(input.questionCount) || 45));
    const durationMinutes = Math.max(1, Math.floor(Number(input.durationMinutes) || 50));
    const maxViolations =
      input.maxViolations !== undefined
        ? Math.max(1, Math.floor(Number(input.maxViolations)))
        : 3;
    const passScore =
      input.passScore !== undefined
        ? Math.max(1, Math.min(1000, Math.floor(Number(input.passScore))))
        : CERTIPORT_PASS_SCORE;

    const now = this.nowIso();
    const session: ExamSessionRecord = {
      id: this.nextId('session'),
      title,
      code,
      createdBy: teacher.id,
      createdByName: teacher.fullName,
      targetClass: String(input.targetClass || 'ALL').trim() || 'ALL',
      questionCount,
      durationMinutes,
      selectionMode,
      ...(manualQuestionIds ? { manualQuestionIds } : {}),
      shuffleQuestions: input.shuffleQuestions ?? true,
      shuffleOptions: input.shuffleOptions ?? true,
      openAt: input.openAt ?? null,
      closeAt: input.closeAt ?? null,
      maxViolations,
      passScore,
      resultVisibility: input.resultVisibility ?? 'score_only',
      status: input.status ?? 'draft',
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    this.storageAdapter?.onSessionSaved?.(session);
    this.recordAuditLog({
      sessionId: session.id,
      actor: teacher,
      action: 'create',
      details: { code: session.code, status: session.status },
    });

    return session;
  }

  public updateSession(
    teacherInput: string | UserAccount,
    sessionId: string,
    patch: UpdateExamSessionInput
  ): ExamSessionRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    if (session.status === 'ended') {
      throw new ExamEngineError(
        'Ca thi đã kết thúc, không thể chỉnh sửa cấu hình.',
        400,
        'SESSION_ALREADY_ENDED'
      );
    }

    const nextSelectionMode = patch.selectionMode ?? session.selectionMode;
    const nextManualIds =
      nextSelectionMode === 'manual'
        ? patch.manualQuestionIds ?? session.manualQuestionIds ?? []
        : undefined;

    const updated: ExamSessionRecord = {
      ...session,
      title: patch.title !== undefined ? String(patch.title).trim() : session.title,
      targetClass:
        patch.targetClass !== undefined
          ? String(patch.targetClass).trim() || 'ALL'
          : session.targetClass,
      selectionMode: nextSelectionMode,
      ...(nextManualIds ? { manualQuestionIds: nextManualIds } : {}),
      questionCount:
        nextSelectionMode === 'manual' && nextManualIds
          ? nextManualIds.length
          : patch.questionCount !== undefined
            ? Math.max(1, Math.floor(Number(patch.questionCount)))
            : session.questionCount,
      durationMinutes:
        patch.durationMinutes !== undefined
          ? Math.max(1, Math.floor(Number(patch.durationMinutes)))
          : session.durationMinutes,
      shuffleQuestions:
        patch.shuffleQuestions !== undefined
          ? Boolean(patch.shuffleQuestions)
          : session.shuffleQuestions,
      shuffleOptions:
        patch.shuffleOptions !== undefined
          ? Boolean(patch.shuffleOptions)
          : session.shuffleOptions,
      openAt: patch.openAt !== undefined ? patch.openAt : session.openAt,
      closeAt: patch.closeAt !== undefined ? patch.closeAt : session.closeAt,
      maxViolations:
        patch.maxViolations !== undefined
          ? Math.max(1, Math.floor(Number(patch.maxViolations)))
          : session.maxViolations,
      passScore:
        patch.passScore !== undefined
          ? Math.max(1, Math.min(1000, Math.floor(Number(patch.passScore))))
          : session.passScore,
      resultVisibility: patch.resultVisibility ?? session.resultVisibility,
      status: patch.status ?? session.status,
      updatedAt: this.nowIso(),
    };

    this.sessions.set(updated.id, updated);
    this.storageAdapter?.onSessionSaved?.(updated);
    this.recordAuditLog({
      sessionId: updated.id,
      actor: teacher,
      action: 'update',
      details: { updatedFields: Object.keys(patch) },
    });
    return updated;
  }

  public openSession(
    teacherInput: string | UserAccount,
    sessionId: string
  ): ExamSessionRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    if (session.status === 'ended') {
      throw new ExamEngineError('Ca thi đã kết thúc, không thể mở lại.', 400, 'SESSION_ENDED');
    }
    const updated: ExamSessionRecord = {
      ...session,
      status: 'open',
      updatedAt: this.nowIso(),
    };
    this.sessions.set(updated.id, updated);
    this.storageAdapter?.onSessionSaved?.(updated);
    this.recordAuditLog({
      sessionId: updated.id,
      actor: teacher,
      action: 'open',
    });
    return updated;
  }

  public lockSession(
    teacherInput: string | UserAccount,
    sessionId: string
  ): ExamSessionRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    if (session.status === 'ended') {
      throw new ExamEngineError('Ca thi đã kết thúc.', 400, 'SESSION_ENDED');
    }
    const updated: ExamSessionRecord = {
      ...session,
      status: 'locked',
      updatedAt: this.nowIso(),
    };
    this.sessions.set(updated.id, updated);
    this.storageAdapter?.onSessionSaved?.(updated);
    this.recordAuditLog({
      sessionId: updated.id,
      actor: teacher,
      action: 'lock',
    });
    return updated;
  }

  public unlockSession(
    teacherInput: string | UserAccount,
    sessionId: string
  ): ExamSessionRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    if (session.status === 'ended') {
      throw new ExamEngineError('Ca thi đã kết thúc.', 400, 'SESSION_ENDED');
    }
    const updated: ExamSessionRecord = {
      ...session,
      status: 'open',
      updatedAt: this.nowIso(),
    };
    this.sessions.set(updated.id, updated);
    this.storageAdapter?.onSessionSaved?.(updated);
    this.recordAuditLog({
      sessionId: updated.id,
      actor: teacher,
      action: 'unlock',
    });
    return updated;
  }

  public endSession(
    teacherInput: string | UserAccount,
    sessionId: string
  ): ExamSessionRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    const nowIso = this.nowIso();
    const updated: ExamSessionRecord = {
      ...session,
      status: 'ended',
      updatedAt: nowIso,
    };
    this.sessions.set(updated.id, updated);
    this.storageAdapter?.onSessionSaved?.(updated);

    // Tự động thu và chấm toàn bộ các lượt thi đang làm dở trong ca thi này
    let forceSubmittedCount = 0;
    for (const att of this.attempts.values()) {
      if (att.sessionId === sessionId && att.status === 'in_progress') {
        this.finalizeAttemptOnServer(att, 'teacher_forced', nowIso);
        forceSubmittedCount += 1;
      }
    }

    this.recordAuditLog({
      sessionId: updated.id,
      actor: teacher,
      action: 'end',
      details: { forceSubmittedCount },
    });
    return updated;
  }

  /**
   * Gia hạn thêm thời gian (phút) cho một lượt thi cụ thể hoặc cho toàn bộ ca thi
   */
  public extendTime(
    teacherInput: string | UserAccount,
    sessionId: string,
    extraMinutes: number,
    targetAttemptId?: string
  ): { session: ExamSessionRecord; updatedAttempts: SessionAttemptRecord[] } {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    const safeMinutes = Math.max(1, Math.floor(Number(extraMinutes) || 0));
    const extraMs = safeMinutes * 60 * 1000;
    const updatedAttempts: SessionAttemptRecord[] = [];

    let updatedSession = session;
    if (!targetAttemptId) {
      updatedSession = {
        ...session,
        durationMinutes: session.durationMinutes + safeMinutes,
        closeAt: session.closeAt
          ? new Date(new Date(session.closeAt).getTime() + extraMs).toISOString()
          : null,
        updatedAt: this.nowIso(),
      };
      this.sessions.set(updatedSession.id, updatedSession);
      this.storageAdapter?.onSessionSaved?.(updatedSession);
    }

    for (const att of this.attempts.values()) {
      if (att.sessionId !== sessionId) continue;
      if (targetAttemptId && att.id !== targetAttemptId) continue;
      if (att.status === 'in_progress') {
        const nextDeadline = new Date(
          new Date(att.deadlineAt).getTime() + extraMs
        ).toISOString();
        const nextAtt: SessionAttemptRecord = {
          ...att,
          deadlineAt: nextDeadline,
        };
        this.attempts.set(nextAtt.id, nextAtt);
        this.storageAdapter?.onAttemptSaved?.(nextAtt);
        updatedAttempts.push(nextAtt);
      }
    }

    this.recordAuditLog({
      sessionId,
      actor: teacher,
      action: 'extend',
      ...(targetAttemptId ? { targetAttemptId } : {}),
      note: targetAttemptId
        ? `Gia hạn thêm ${safeMinutes} phút cho lượt thi ${targetAttemptId}.`
        : `Gia hạn thêm ${safeMinutes} phút cho cả ca thi (${updatedAttempts.length} học sinh đang thi).`,
      details: { extraMinutes: safeMinutes, affectedAttempts: updatedAttempts.length },
    });

    return { session: updatedSession, updatedAttempts };
  }

  /**
   * Giáo viên cho phép học sinh vào lại phòng thi:
   * - Nếu học sinh bị tự nộp do sự cố (`status === 'submitted'`), hệ thống GIỮ NGUYÊN bản ghi bài thi cũ,
   *   tạo một lượt thi mới (`in_progress`) với cùng đề và kế thừa toàn bộ đáp án đã làm từ bài cũ,
   *   đồng thời ghi rõ trong `exam_audit_log`.
   * - Nếu học sinh đang thi (`status === 'in_progress'`) nhưng bị kẹt phiên thiết bị, hệ thống mở khóa phiên thiết bị và ghi nhật ký.
   */
  public allowStudentReentry(
    teacherInput: string | UserAccount,
    sessionId: string,
    attemptId: string,
    extraMinutes?: number
  ): SessionAttemptRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.sessionId !== sessionId) {
      throw new ExamEngineError('Không tìm thấy lượt thi của học sinh.', 404, 'ATTEMPT_NOT_FOUND');
    }

    if (attempt.status === 'submitted') {
      const nowMs = this.nowMs();
      const nowIso = this.nowIso();
      const newAttemptId = this.nextId('attempt');

      // Giữ nguyên bài cũ, đánh dấu đã được thay thế bởi lượt thi mới
      const preservedOldAttempt: SessionAttemptRecord = {
        ...attempt,
        supersededByAttemptId: newAttemptId,
      };
      this.attempts.set(preservedOldAttempt.id, preservedOldAttempt);
      this.storageAdapter?.onAttemptSaved?.(preservedOldAttempt);

      // Tính thời gian còn lại cho lượt thi mới (ít nhất 10 phút hoặc phần thời gian còn dư của bài cũ + extraMinutes)
      const oldDeadlineMs = new Date(attempt.deadlineAt).getTime();
      const oldSubmittedMs = attempt.submittedAt
        ? new Date(attempt.submittedAt).getTime()
        : nowMs;
      const leftoverMs = Math.max(0, oldDeadlineMs - oldSubmittedMs);
      const bonusMs =
        extraMinutes && extraMinutes > 0
          ? Math.floor(extraMinutes) * 60 * 1000
          : 0;
      const effectiveDurationMs =
        bonusMs > 0
          ? bonusMs
          : Math.max(10 * 60 * 1000, leftoverMs);
      const nextDeadlineIso = new Date(nowMs + effectiveDurationMs).toISOString();

      const newAttempt: SessionAttemptRecord = {
        id: newAttemptId,
        previousAttemptId: attempt.id,
        sessionId: attempt.sessionId,
        sessionCode: attempt.sessionCode,
        sessionTitle: attempt.sessionTitle,
        studentId: attempt.studentId,
        username: attempt.username,
        fullName: attempt.fullName,
        className: attempt.className,
        generatedQuestions: attempt.generatedQuestions,
        startedAt: nowIso,
        deadlineAt: nextDeadlineIso,
        submittedAt: null,
        submitReason: null,
        score: null,
        correctCount: null,
        totalQuestions: attempt.totalQuestions,
        percentage: null,
        passed: null,
        reentryCount: (attempt.reentryCount || 0) + 1,
        reentryAllowed: true,
        violationCount: 0,
        activeSessionToken: null,
        activeDeviceId: null,
        ...(attempt.keyboardLockSupported !== undefined
          ? { keyboardLockSupported: attempt.keyboardLockSupported }
          : {}),
        ...(attempt.browserNote ? { browserNote: attempt.browserNote } : {}),
        status: 'in_progress',
      };

      // Sao chép toàn bộ đáp án đã lưu từ bài cũ sang lượt thi mới để học sinh làm tiếp
      const { recordsByQuestionId } = this.getSavedAnswerMapForAttempt(attempt.id);
      let preservedAnswersCount = 0;
      for (const oldAns of Object.values(recordsByQuestionId)) {
        const clonedRecordId = `${newAttempt.id}_${oldAns.questionId}`;
        const clonedAns: AttemptAnswerRecord = {
          ...oldAns,
          id: clonedRecordId,
          attemptId: newAttempt.id,
          savedAt: nowIso,
        };
        this.attemptAnswers.set(clonedRecordId, clonedAns);
        this.storageAdapter?.onAnswerSaved?.(clonedAns);
        if (oldAns.selectedAnswer !== null && oldAns.selectedAnswer !== undefined) {
          preservedAnswersCount += 1;
        }
      }

      this.attempts.set(newAttempt.id, newAttempt);
      this.storageAdapter?.onAttemptSaved?.(newAttempt);

      this.recordAuditLog({
        sessionId,
        actor: teacher,
        action: 'allow_reentry',
        targetAttemptId: newAttempt.id,
        targetStudentId: attempt.studentId,
        note: `Cho học sinh ${attempt.fullName} vào lại: giữ nguyên bài cũ (${attempt.id}), tạo lượt thi mới (${newAttempt.id}) kế thừa ${preservedAnswersCount} đáp án.`,
        details: {
          previousAttemptId: attempt.id,
          newAttemptId: newAttempt.id,
          previousSubmitReason: attempt.submitReason,
          preservedAnswersCount,
          sessionCode: session.code,
        },
      });

      return this.enrichAttemptForTeacher(newAttempt);
    }

    const updated: SessionAttemptRecord = {
      ...attempt,
      reentryAllowed: true,
      activeSessionToken: null,
      activeDeviceId: null,
    };
    this.attempts.set(updated.id, updated);
    this.storageAdapter?.onAttemptSaved?.(updated);

    this.recordAuditLog({
      sessionId,
      actor: teacher,
      action: 'allow_reentry',
      targetAttemptId: attempt.id,
      targetStudentId: attempt.studentId,
      note: `Mở khóa phiên thiết bị cho học sinh ${attempt.fullName} (${attempt.id}) vào lại.`,
      details: {
        previousAttemptId: attempt.id,
        newAttemptId: attempt.id,
      },
    });

    return this.enrichAttemptForTeacher(updated);
  }

  /**
   * Giáo viên thu bài / nộp giúp học sinh
   */
  public teacherForceSubmitAttempt(
    teacherInput: string | UserAccount,
    sessionId: string,
    attemptId: string
  ): SessionAttemptRecord {
    const { teacher } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    const attempt = this.attempts.get(attemptId);
    if (!attempt || attempt.sessionId !== sessionId) {
      throw new ExamEngineError('Không tìm thấy lượt thi của học sinh.', 404, 'ATTEMPT_NOT_FOUND');
    }

    const finalized = this.finalizeAttemptOnServer(attempt, 'teacher_forced');
    this.recordAuditLog({
      sessionId,
      actor: teacher,
      action: 'force_submit',
      targetAttemptId: attempt.id,
      targetStudentId: attempt.studentId,
      note: `Giáo viên nộp bài giúp học sinh ${attempt.fullName} (${attempt.id}).`,
    });
    return finalized;
  }

  /**
   * Sao chép ca thi sang ca thi mới (mã 6 ký tự mới, trạng thái nháp)
   */
  public cloneSession(
    teacherInput: string | UserAccount,
    sessionId: string,
    newTitle?: string
  ): ExamSessionRecord {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    const cloned = this.createSession(teacher, {
      title: newTitle?.trim() || `${session.title} (Bản sao)`,
      targetClass: session.targetClass,
      questionCount: session.questionCount,
      durationMinutes: session.durationMinutes,
      selectionMode: session.selectionMode,
      manualQuestionIds: session.manualQuestionIds,
      shuffleQuestions: session.shuffleQuestions,
      shuffleOptions: session.shuffleOptions,
      openAt: null,
      closeAt: null,
      maxViolations: session.maxViolations,
      passScore: session.passScore,
      resultVisibility: session.resultVisibility,
      status: 'draft',
    });

    this.recordAuditLog({
      sessionId: cloned.id,
      actor: teacher,
      action: 'clone',
      details: { sourceSessionId: session.id, newCode: cloned.code },
    });

    return cloned;
  }

  /**
   * Xóa ca thi (chỉ cho phép khi chưa có học sinh nào vào thi)
   */
  public deleteSession(
    teacherInput: string | UserAccount,
    sessionId: string
  ): { deletedId: string; code: string; title: string } {
    const { teacher, session } = this.requireTeacherSessionAccess(teacherInput, sessionId);

    let enteredCount = 0;
    for (const att of this.attempts.values()) {
      if (att.sessionId === sessionId) {
        enteredCount += 1;
      }
    }

    if (enteredCount > 0) {
      throw new ExamEngineError(
        'Chỉ có thể xóa ca thi khi chưa có học sinh nào vào thi.',
        400,
        'SESSION_HAS_ATTEMPTS'
      );
    }

    this.sessions.delete(sessionId);
    this.storageAdapter?.onSessionDeleted?.(sessionId);
    this.recordAuditLog({
      sessionId,
      actor: teacher,
      action: 'delete',
      details: { code: session.code, title: session.title },
    });

    return {
      deletedId: session.id,
      code: session.code,
      title: session.title,
    };
  }

  private countAnsweredForAttempt(attempt: SessionAttemptRecord): number {
    const { answersMap } = this.getSavedAnswerMapForAttempt(attempt.id);
    let count = 0;
    for (const val of Object.values(answersMap)) {
      if (val === null || val === undefined || val === '') continue;
      if (Array.isArray(val) && val.length === 0) continue;
      if (typeof val === 'object' && !Array.isArray(val) && Object.keys(val).length === 0) {
        continue;
      }
      count += 1;
    }
    if (count === 0 && Array.isArray(attempt.questionResults)) {
      count = attempt.questionResults.filter((qr) => qr.answered).length;
    }
    return Math.min(attempt.totalQuestions || count, count);
  }

  private buildTeacherQuestionDetails(
    attempt: SessionAttemptRecord,
    questionResults: NonNullable<SessionAttemptRecord['questionResults']>
  ): TeacherAttemptQuestionDetail[] {
    const { recordsByQuestionId } = this.getSavedAnswerMapForAttempt(attempt.id);
    const generatedMap = new Map(
      attempt.generatedQuestions.map((sq) => [sq.id, sq])
    );

    return questionResults.map((qr, idx) => {
      const genQ = generatedMap.get(qr.questionId);
      const masterQ = this.resolveMasterQuestion(
        genQ ?? {
          id: qr.questionId,
          orderNumber: qr.orderNumber || idx + 1,
          type: qr.type,
          topic: qr.topic,
          examSet: 'Đề chuẩn Certiport GenAI',
          prompt: qr.prompt,
        }
      );

      const displayQuestion: Question = {
        ...masterQ,
        ...(genQ?.options ? { options: genQ.options } : {}),
      };

      const userBreakdown = getUserAnswerBreakdown(
        displayQuestion,
        qr.userAnswer ?? undefined
      );
      const correctBreakdown = getCorrectAnswerBreakdown(displayQuestion);

      const userAnswerDisplay =
        userBreakdown.length === 1
          ? userBreakdown[0].value
          : userBreakdown.map((b) => `${b.label}: ${b.value}`).join(' | ');
      const correctAnswerDisplay =
        correctBreakdown.length === 1
          ? correctBreakdown[0].value
          : correctBreakdown.map((b) => `${b.label}: ${b.value}`).join(' | ');

      const ansRec = recordsByQuestionId[qr.questionId];

      return {
        questionId: qr.questionId,
        orderNumber: qr.orderNumber || genQ?.orderNumber || idx + 1,
        topic: qr.topic || masterQ.topic,
        type: qr.type || masterQ.type,
        prompt: qr.prompt || masterQ.prompt,
        ...(displayQuestion.options ? { options: displayQuestion.options } : {}),
        answered: qr.answered,
        flagged: qr.flagged,
        isCorrect: qr.isCorrect,
        userAnswer: qr.userAnswer,
        userAnswerDisplay: qr.answered
          ? userAnswerDisplay || String(qr.userAnswer ?? '')
          : 'Chưa trả lời',
        correctAnswer: masterQ.correctAnswer,
        correctAnswerDisplay:
          correctAnswerDisplay || String(masterQ.correctAnswer ?? ''),
        explanation: masterQ.explanation || '',
        timeSpentSeconds: ansRec?.timeSpentSeconds ?? 0,
      };
    });
  }

  private enrichAttemptForTeacher(attempt: SessionAttemptRecord): SessionAttemptRecord {
    const nowMs = this.nowMs();
    const deadlineMs = new Date(attempt.deadlineAt).getTime();
    const remainingSeconds =
      attempt.status === 'in_progress' && Number.isFinite(deadlineMs)
        ? Math.max(0, Math.floor((deadlineMs - nowMs) / 1000))
        : 0;
    const answeredCount = this.countAnsweredForAttempt(attempt);

    const startedMs = new Date(attempt.startedAt).getTime();
    const endRefMs =
      attempt.status === 'submitted' && attempt.submittedAt
        ? new Date(attempt.submittedAt).getTime()
        : nowMs;
    const durationSeconds =
      attempt.durationSeconds !== undefined && attempt.durationSeconds > 0
        ? attempt.durationSeconds
        : Number.isFinite(startedMs) && Number.isFinite(endRefMs)
          ? Math.max(0, Math.round((endRefMs - startedMs) / 1000))
          : 0;

    // Tính điểm và phân tích theo chuyên đề (tạm thời cho bài đang thi hoặc bổ sung cho bài đã nộp)
    if (
      attempt.score === null ||
      attempt.score === undefined ||
      !attempt.topicBreakdown ||
      attempt.topicBreakdown.length === 0 ||
      !attempt.questionResults ||
      attempt.questionResults.length === 0
    ) {
      const { evaluation, passed } = this.evaluateAttemptSnapshot(attempt);
      const qResults = attempt.questionResults ?? evaluation.questionResults;
      return {
        ...attempt,
        answeredCount,
        remainingSeconds,
        durationSeconds,
        score: attempt.score ?? evaluation.certiportScore,
        correctCount: attempt.correctCount ?? evaluation.score,
        totalQuestions: attempt.totalQuestions || evaluation.totalQuestions,
        percentage: attempt.percentage ?? evaluation.percentage,
        passed: attempt.passed ?? passed,
        questionResults: qResults,
        topicBreakdown:
          attempt.topicBreakdown && attempt.topicBreakdown.length > 0
            ? attempt.topicBreakdown
            : evaluation.topicBreakdown,
        typeBreakdown:
          attempt.typeBreakdown && attempt.typeBreakdown.length > 0
            ? attempt.typeBreakdown
            : evaluation.typeBreakdown,
        teacherQuestionDetails: this.buildTeacherQuestionDetails(attempt, qResults),
      };
    }

    return {
      ...attempt,
      answeredCount,
      remainingSeconds,
      durationSeconds,
      teacherQuestionDetails: this.buildTeacherQuestionDetails(
        attempt,
        attempt.questionResults
      ),
    };
  }

  private getSessionParticipationBreakdown(session: ExamSessionRecord): {
    activeAttemptsByStudent: Map<string, SessionAttemptRecord>;
    inProgressCount: number;
    submittedCount: number;
    notEnteredStudents: TeacherLiveNotEnteredStudent[];
    totalTargetStudents: number | null;
  } {
    const activeAttemptsByStudent = new Map<string, SessionAttemptRecord>();

    for (const att of this.attempts.values()) {
      if (att.sessionId !== session.id) continue;
      if (att.supersededByAttemptId) continue;

      const key = att.studentId.toLowerCase();
      const prev = activeAttemptsByStudent.get(key);
      if (
        !prev ||
        (att.status === 'in_progress' && prev.status !== 'in_progress') ||
        att.startedAt > prev.startedAt
      ) {
        activeAttemptsByStudent.set(key, att);
      }
    }

    let inProgressCount = 0;
    let submittedCount = 0;
    for (const att of activeAttemptsByStudent.values()) {
      if (att.status === 'in_progress') {
        inProgressCount += 1;
      } else {
        submittedCount += 1;
      }
    }

    const targetNorm = (session.targetClass || 'ALL').trim().toLowerCase();
    const isAllStudents =
      !targetNorm ||
      targetNorm === 'all' ||
      targetNorm === 'mở cho mọi học sinh có mã' ||
      targetNorm === '*';

    const notEnteredStudents: TeacherLiveNotEnteredStudent[] = [];
    for (const u of this.users.values()) {
      if (u.role !== 'student') continue;
      if (!isAllStudents && !this.isStudentAllowedInSessionClass(u, session)) {
        continue;
      }
      if (!activeAttemptsByStudent.has(u.id.toLowerCase())) {
        notEnteredStudents.push({
          studentId: u.id,
          username: u.username,
          fullName: u.fullName,
          className: u.className || session.targetClass,
        });
      }
    }

    notEnteredStudents.sort((a, b) =>
      a.fullName.localeCompare(b.fullName, 'vi')
    );

    const totalTargetStudents = isAllStudents
      ? null
      : activeAttemptsByStudent.size + notEnteredStudents.length;

    return {
      activeAttemptsByStudent,
      inProgressCount,
      submittedCount,
      notEnteredStudents,
      totalTargetStudents,
    };
  }

  private enrichSessionWithStats(session: ExamSessionRecord): ExamSessionRecord {
    const {
      activeAttemptsByStudent,
      inProgressCount,
      submittedCount,
      totalTargetStudents,
    } = this.getSessionParticipationBreakdown(session);

    return {
      ...session,
      enteredCount: activeAttemptsByStudent.size,
      inProgressCount,
      submittedCount,
      totalTargetStudents,
    };
  }

  public listTeacherSessions(teacherInput: string | UserAccount): ExamSessionRecord[] {
    const teacher = this.requireTeacher(teacherInput);
    this.sweepExpiredAttempts();
    return Array.from(this.sessions.values())
      .filter((s) => this.canTeacherAccessSession(teacher, s))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => this.enrichSessionWithStats(s));
  }

  public getTeacherSessionDetail(
    teacherInput: string | UserAccount,
    sessionId: string
  ): TeacherSessionDetailPayload {
    const { session } = this.requireTeacherSessionAccess(teacherInput, sessionId);
    this.sweepExpiredAttempts();

    const breakdown = this.getSessionParticipationBreakdown(session);
    const enrichedSession: ExamSessionRecord = {
      ...session,
      enteredCount: breakdown.activeAttemptsByStudent.size,
      inProgressCount: breakdown.inProgressCount,
      submittedCount: breakdown.submittedCount,
      totalTargetStudents: breakdown.totalTargetStudents,
    };

    const attempts = Array.from(this.attempts.values())
      .filter((a) => a.sessionId === sessionId)
      .map((a) => this.enrichAttemptForTeacher(a))
      .sort((a, b) => {
        // Sắp xếp mặc định: học sinh có nhiều vi phạm lên đầu, sau đó ưu tiên đang thi
        if (b.violationCount !== a.violationCount) {
          return b.violationCount - a.violationCount;
        }
        if (a.status !== b.status) {
          return a.status === 'in_progress' ? -1 : 1;
        }
        return b.startedAt.localeCompare(a.startedAt);
      });

    const violations = Array.from(this.violations.values())
      .filter((v) => v.sessionId === sessionId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const auditLogs = Array.from(this.auditLogs.values())
      .filter((l) => l.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      session: enrichedSession,
      serverNow: this.nowIso(),
      summary: {
        inProgressCount: breakdown.inProgressCount,
        submittedCount: breakdown.submittedCount,
        notEnteredCount: breakdown.notEnteredStudents.length,
      },
      attempts,
      notEnteredStudents: breakdown.notEnteredStudents,
      violations,
      auditLogs,
    };
  }

  /**
   * Tạo danh sách học sinh giả lập (mặc định 40 học sinh: 32 đang thi, 5 đã nộp, 3 chưa vào,
   * hoặc truyền 0 / 1 / 40 học sinh để kiểm thử Bước 6 & Bước 7A/7B).
   */
  public simulateSessionStudents(
    teacherInput: string | UserAccount,
    sessionId: string,
    options?: {
      inProgressCount?: number;
      submittedCount?: number;
      notEnteredCount?: number;
    }
  ): TeacherSessionDetailPayload {
    const { teacher, session } = this.requireTeacherSessionAccess(
      teacherInput,
      sessionId
    );

    const inProgTarget = options?.inProgressCount ?? 32;
    const submittedTarget = options?.submittedCount ?? 5;
    const notEnteredTarget = options?.notEnteredCount ?? 3;
    const totalCount = inProgTarget + submittedTarget + notEnteredTarget;
    const className =
      session.targetClass === 'ALL'
        ? `12A1_${session.code}`
        : session.targetClass;

    // Dọn dẹp dữ liệu giả lập cũ của ca thi này trước khi sinh mới (hỗ trợ chuyển đổi 0 / 1 / 40 học sinh)
    const simUserPrefix = `sim_${session.code.toLowerCase()}_hs_`;
    for (const uId of Array.from(this.users.keys())) {
      if (uId.startsWith(simUserPrefix)) {
        this.users.delete(uId);
      }
    }
    for (const [attId, att] of Array.from(this.attempts.entries())) {
      if (att.sessionId === session.id && attId.startsWith(`att_sim_${session.id}_`)) {
        this.attempts.delete(attId);
      }
    }
    for (const [ansId, ans] of Array.from(this.attemptAnswers.entries())) {
      if (ans.sessionId === session.id && ans.attemptId.startsWith(`att_sim_${session.id}_`)) {
        this.attemptAnswers.delete(ansId);
      }
    }
    for (const [vId, v] of Array.from(this.violations.entries())) {
      if (v.sessionId === session.id && v.attemptId.startsWith(`att_sim_${session.id}_`)) {
        this.violations.delete(vId);
      }
    }

    if (session.targetClass === 'ALL') {
      const scopedSession: ExamSessionRecord = {
        ...session,
        targetClass: className,
      };
      this.sessions.set(scopedSession.id, scopedSession);
    }

    const nowMs = this.nowMs();
    const nowIso = this.nowIso();
    const samplePaper = this.generateStudentPaperOnce(session);
    const totalQ = Math.max(1, samplePaper.length || session.questionCount);
    const sessionDurationSec = Math.max(60, session.durationMinutes * 60);

    for (let i = 1; i <= totalCount; i++) {
      const padded = String(i).padStart(2, '0');
      const studentId = `sim_${session.code.toLowerCase()}_hs_${padded}`;
      const studentAccount: UserAccount = {
        id: studentId,
        username: `hs_${padded}`,
        password: '123',
        fullName: `Học sinh Giả lập ${padded}`,
        role: 'student',
        className,
        lastLogin: nowIso,
        status: 'studying',
        totalStudyMinutes: 30,
      };
      this.users.set(studentId, studentAccount);

      // Nhóm 3: Học sinh chưa vào thi
      if (i > inProgTarget + submittedTarget) {
        continue;
      }

      const isSubmittedStudent = i > inProgTarget;
      const attemptId = `att_sim_${session.id}_${padded}`;

      // Phân bổ thời gian làm bài thực tế để thể hiện rõ trên biểu đồ phân tán (Scatter Plot):
      // - i === 1, 2: Nhóm làm quá nhanh điểm thấp (4–7 phút, điểm thấp < 450)
      // - i === 3, 4, hoặc học sinh nộp hết giờ: Nhóm làm hết giờ (92%–100% thời lượng ca thi)
      // - Các học sinh còn lại: phân bố đều từ 14 phút đến 85% thời lượng ca thi
      let durationSeconds: number;
      if (i === 1 || i === 2) {
        durationSeconds = Math.max(180, Math.round(sessionDurationSec * (0.1 + i * 0.03)));
      } else if (i === 3 || i === 4 || (isSubmittedStudent && i === inProgTarget + 2)) {
        durationSeconds = Math.round(sessionDurationSec * (i === 3 ? 1.0 : 0.94));
      } else {
        const ratio = Math.min(0.88, Math.max(0.28, ((i * 17) % 60) / 100 + 0.28));
        durationSeconds = Math.round(sessionDurationSec * ratio);
      }

      const startedAtMs = nowMs - durationSeconds * 1000;
      const startedAtIso = new Date(startedAtMs).toISOString();
      const remainingSeconds = Math.max(60, sessionDurationSec - durationSeconds);
      const deadlineAtIso = new Date(nowMs + remainingSeconds * 1000).toISOString();

      // Phân bổ mức vi phạm: một số học sinh vượt ngưỡng, gần ngưỡng, hoặc bình thường
      let violationCount = 0;
      if (i === 1 || (isSubmittedStudent && i === inProgTarget + 1)) {
        violationCount = session.maxViolations; // Đã chạm/vượt ngưỡng
      } else if (i === 2 || i === 3) {
        violationCount = Math.max(1, session.maxViolations - 1); // Gần ngưỡng
      } else if (i === 4 || i === 5) {
        violationCount = 1;
      }

      // Mức năng lực của học sinh để phân bố phổ điểm trải đều từ 150 đến 980,
      // đồng thời chuyên đề 3 ("Đạo đức, Pháp lý & Bảo mật") có tỉ lệ đúng thấp nhất (~48%)
      const studentSkill =
        i === 1
          ? 0.2
          : i === 2
            ? 0.32
            : i % 9 === 0
              ? 0.45
              : i % 5 === 0
                ? 0.62
                : Math.min(0.96, 0.68 + ((i * 13) % 28) / 100);

      const answeredTarget = isSubmittedStudent
        ? totalQ
        : i === 1 || i === 2
          ? Math.max(1, Math.floor(totalQ * 0.45))
          : Math.min(totalQ, Math.max(1, Math.floor(totalQ * 0.85)));

      for (let qIdx = 0; qIdx < answeredTarget && qIdx < samplePaper.length; qIdx++) {
        const q = samplePaper[qIdx];
        const masterQ = this.resolveMasterQuestion(q);
        const isEthicsTopic =
          q.topic.includes('Đạo đức') || q.topic.startsWith('3.');
        const topicPenalty = isEthicsTopic ? 0.26 : 0;

        // Phân hóa độ khó câu hỏi để có đủ 3 nhóm: Dễ (>80%), Vừa (40–80%), Khó (<40%)
        const questionDifficultyShift =
          qIdx % 5 === 0
            ? 0.24 // Câu dễ (>80%)
            : qIdx % 4 === 3
              ? -0.32 // Câu khó (<40%)
              : 0; // Câu vừa (40–80%)

        const threshold = Math.max(
          0.08,
          Math.min(0.95, studentSkill - topicPenalty + questionDifficultyShift)
        );
        const pseudoRand = ((i * 31 + (qIdx + 1) * 17) % 100) / 100;
        const shouldBeCorrect = pseudoRand < threshold;

        let chosenAnswer: UserAnswer = 'B';
        if (shouldBeCorrect) {
          chosenAnswer = masterQ.correctAnswer as UserAnswer;
        } else if (masterQ.type === 'mcq_single') {
          // Tạo phương án gây nhiễu rõ rệt (phần lớn học sinh làm sai chọn phương án nhiễu chính)
          const wrongPool = ['A', 'B', 'C', 'D'].filter(
            (opt) => opt !== String(masterQ.correctAnswer || 'A')
          );
          const distractorPick =
            (i + qIdx) % 4 === 0
              ? wrongPool[1] || 'C'
              : (i + qIdx) % 7 === 0
                ? wrongPool[2] || 'D'
                : wrongPool[0] || 'B';
          chosenAnswer = distractorPick;
        } else if (masterQ.type === 'mcq_multiple') {
          chosenAnswer = ['D'];
        }

        const baseTimePerQ = Math.max(
          6,
          Math.round(durationSeconds / Math.max(1, answeredTarget))
        );
        const questionTimeSpent = Math.max(
          5,
          baseTimePerQ + ((i * 7 + qIdx * 11) % 19) - 8
        );

        const ansId = `${attemptId}_${q.id}`;
        this.attemptAnswers.set(ansId, {
          id: ansId,
          attemptId,
          sessionId: session.id,
          studentId,
          questionId: q.id,
          selectedAnswer: chosenAnswer,
          savedAt: nowIso,
          timeSpentSeconds: questionTimeSpent,
          flagged: qIdx === 0 && i % 5 === 0,
        });
      }

      for (let vIdx = 1; vIdx <= violationCount; vIdx++) {
        const vId = `viol_sim_${attemptId}_${vIdx}`;
        const vType: ViolationEventType =
          vIdx % 2 === 1 ? 'tab_switch' : 'fullscreen_exit';
        this.violations.set(vId, {
          id: vId,
          attemptId,
          sessionId: session.id,
          studentId,
          type: vType,
          occurredAt: new Date(nowMs - vIdx * 90 * 1000).toISOString(),
          awaySeconds: 4 + vIdx * 2,
          currentQuestionOrder: Math.min(totalQ, vIdx + 1),
          note:
            vType === 'tab_switch'
              ? 'Chuyển sang tab trình duyệt khác'
              : 'Thoát chế độ toàn màn hình',
        });
      }

      const submitReason: AttemptSubmitReason | null = isSubmittedStudent
        ? violationCount >= session.maxViolations
          ? 'violation'
          : i === inProgTarget + 2
            ? 'timeout'
            : 'voluntary'
        : null;

      const baseAttempt: SessionAttemptRecord = {
        id: attemptId,
        sessionId: session.id,
        sessionCode: session.code,
        sessionTitle: session.title,
        studentId,
        username: studentAccount.username,
        fullName: studentAccount.fullName,
        className,
        generatedQuestions: samplePaper,
        startedAt: startedAtIso,
        deadlineAt: deadlineAtIso,
        submittedAt: isSubmittedStudent ? nowIso : null,
        submitReason,
        durationSeconds,
        score: null,
        correctCount: null,
        totalQuestions: totalQ,
        percentage: null,
        passed: null,
        reentryCount: i % 7 === 0 ? 1 : 0,
        reentryAllowed: false,
        violationCount,
        activeSessionToken: isSubmittedStudent ? null : `tok_${attemptId}`,
        activeDeviceId: isSubmittedStudent ? null : `dev_${studentId}`,
        status: isSubmittedStudent ? 'submitted' : 'in_progress',
      };

      const { evaluation, passed } = this.evaluateAttemptSnapshot(baseAttempt);
      const simAttempt: SessionAttemptRecord = {
        ...baseAttempt,
        score: evaluation.certiportScore,
        correctCount: evaluation.score,
        totalQuestions: evaluation.totalQuestions,
        percentage: evaluation.percentage,
        passed,
        questionResults: evaluation.questionResults,
        topicBreakdown: evaluation.topicBreakdown,
        typeBreakdown: evaluation.typeBreakdown,
      };

      this.attempts.set(simAttempt.id, simAttempt);
    }

    return this.getTeacherSessionDetail(teacher, sessionId);
  }

  // ============================================================================
  // API DÀNH CHO HỌC SINH (XÁC THỰC MÃ, BẮT ĐẦU THI, LẤY ĐỀ, LƯU ĐÁP ÁN, VI PHẠM, NỘP BÀI, KẾT QUẢ)
  // ============================================================================

  private findSessionByCode(rawCode: string): ExamSessionRecord | undefined {
    const cleanCode = normalizeExamCode(rawCode);
    if (!cleanCode) return undefined;
    const matches = Array.from(this.sessions.values()).filter(
      (s) => normalizeExamCode(s.code) === cleanCode
    );
    if (matches.length === 0) return undefined;
    // Ưu tiên ca thi đang hoạt động (open / locked / draft) hơn ca thi đã kết thúc
    const active = matches.find((s) => s.status !== 'ended');
    return active ?? matches[0];
  }

  private findStudentAttemptInSession(
    studentId: string,
    sessionId: string
  ): SessionAttemptRecord | undefined {
    const candidates: SessionAttemptRecord[] = [];
    for (const att of this.attempts.values()) {
      if (
        att.sessionId === sessionId &&
        att.studentId.toLowerCase() === studentId.toLowerCase() &&
        !att.supersededByAttemptId
      ) {
        candidates.push(this.checkAndAutoSubmitIfExpired(att));
      }
    }
    if (candidates.length === 0) return undefined;
    // Ưu tiên lượt thi đang diễn ra (in_progress) hoặc lượt thi mới nhất
    candidates.sort((a, b) => {
      if (a.status !== b.status) {
        return a.status === 'in_progress' ? -1 : 1;
      }
      return b.startedAt.localeCompare(a.startedAt);
    });
    return candidates[0];
  }

  /**
   * Học sinh xác thực mã ca thi 6 ký tự.
   * Trả về thông tin ca thi nếu hợp lệ, hoặc lý do từ chối cụ thể:
   * - `rate_limited`: Sai quá 5 lần, phải chờ 60 giây
   * - `not_found`: Mã không tồn tại
   * - `not_open_yet`: Ca thi đang ở trạng thái nháp hoặc chưa tới giờ mở
   * - `locked`: Ca thi đang bị giáo viên khóa
   * - `ended`: Ca thi đã kết thúc hoặc đã qua khung giờ đóng
   * - `wrong_class`: Học sinh không thuộc lớp được phép dự thi
   * - `already_submitted`: Học sinh đã hoàn thành và nộp bài ở ca thi này
   */
  public verifySessionCode(
    studentInput: string | UserAccount,
    rawCode: string,
    ipAddress: string = '127.0.0.1'
  ): VerifyCodeResult {
    const student = this.requireStudent(studentInput);
    const waitSeconds = this.getCodeRateLimitWaitSeconds(student.id, ipAddress);
    if (waitSeconds > 0) {
      return {
        valid: false,
        reason: 'rate_limited',
        retryAfterSeconds: waitSeconds,
        message: `Thử lại sau ${waitSeconds} giây`,
      };
    }

    const session = this.findSessionByCode(rawCode);
    if (!session) {
      const lockWait = this.recordFailedCodeAttempt(student.id, ipAddress);
      if (lockWait > 0) {
        return {
          valid: false,
          reason: 'rate_limited',
          retryAfterSeconds: lockWait,
          message: `Thử lại sau ${lockWait} giây`,
        };
      }
      return {
        valid: false,
        reason: 'not_found',
        message: 'Mã không tồn tại',
      };
    }

    // Mã tồn tại -> xóa bộ đếm nhập sai
    this.clearFailedCodeAttempts(student.id, ipAddress);

    const nowMs = this.nowMs();
    if (session.status === 'draft') {
      return {
        valid: false,
        reason: 'not_open_yet',
        message: 'Ca thi chưa mở',
      };
    }

    if (session.openAt && nowMs < new Date(session.openAt).getTime()) {
      return {
        valid: false,
        reason: 'not_open_yet',
        message: 'Ca thi chưa mở',
      };
    }

    if (session.status === 'ended') {
      return {
        valid: false,
        reason: 'ended',
        message: 'Ca thi đã khóa',
      };
    }

    if (!this.isStudentAllowedInSessionClass(student, session)) {
      return {
        valid: false,
        reason: 'wrong_class',
        message: 'Bạn không thuộc lớp được phép thi',
      };
    }

    const existingAttempt = this.findStudentAttemptInSession(student.id, session.id);
    if (existingAttempt && existingAttempt.status === 'submitted') {
      return {
        valid: false,
        reason: 'already_submitted',
        message: 'Bạn đã nộp bài ca thi này',
      };
    }

    // Khóa ca thi hoặc hết khung giờ mở: học sinh mới không vào được bằng mã, nhưng học sinh đang làm bài dở vẫn tiếp tục thi
    const isPastCloseWindow =
      Boolean(session.closeAt) && nowMs > new Date(session.closeAt!).getTime();
    if (
      (session.status === 'locked' || isPastCloseWindow) &&
      (!existingAttempt || existingAttempt.status !== 'in_progress')
    ) {
      return {
        valid: false,
        reason: session.status === 'locked' ? 'locked' : 'ended',
        message: 'Ca thi đã khóa',
      };
    }

    return {
      valid: true,
      message: 'Mã ca thi hợp lệ.',
      session: {
        id: session.id,
        title: session.title,
        code: session.code,
        targetClass: session.targetClass,
        questionCount: session.questionCount,
        durationMinutes: session.durationMinutes,
        maxViolations: session.maxViolations,
        passScore: session.passScore,
        openAt: session.openAt,
        closeAt: session.closeAt,
        status: session.status,
        ...(existingAttempt ? { canResumeAttemptId: existingAttempt.id } : {}),
      },
    };
  }

  /**
   * Sinh bộ đề cố định cho học sinh một lần duy nhất (không kèm `correctAnswer` và `explanation`)
   */
  private generateStudentPaperOnce(session: ExamSessionRecord): SanitizedStudentQuestion[] {
    const bank = this.getQuestions();
    let selectedQuestions: Question[] = [];

    if (
      session.selectionMode === 'manual' &&
      session.manualQuestionIds &&
      session.manualQuestionIds.length > 0
    ) {
      const manualMap = new Map(bank.map((q) => [q.id, q]));
      selectedQuestions = session.manualQuestionIds
        .map((id) => manualMap.get(id))
        .filter((q): q is Question => Boolean(q));
      if (session.shuffleQuestions) {
        selectedQuestions = shuffleWithRng(selectedQuestions, this.randomFn);
      }
    } else {
      const drawn = buildProportionalExamPool(
        bank,
        session.questionCount,
        this.randomFn
      ).questions;
      selectedQuestions = session.shuffleQuestions
        ? drawn
        : [...bank].slice(0, Math.min(session.questionCount, bank.length));
    }

    return selectedQuestions.map((q, idx) =>
      sanitizeQuestionForStudent(q, idx + 1, session.shuffleOptions, this.randomFn)
    );
  }

  private buildAttemptPaperPayload(
    attempt: SessionAttemptRecord,
    session: ExamSessionRecord,
    sessionToken: string
  ): StudentAttemptPaperPayload {
    const nowMs = this.nowMs();
    const deadlineMs = new Date(attempt.deadlineAt).getTime();
    const remainingSeconds = Math.max(0, Math.floor((deadlineMs - nowMs) / 1000));
    const { recordsByQuestionId } = this.getSavedAnswerMapForAttempt(attempt.id);

    const savedAnswers: StudentAttemptPaperPayload['savedAnswers'] = {};
    for (const [qId, rec] of Object.entries(recordsByQuestionId)) {
      savedAnswers[qId] = {
        selectedAnswer: rec.selectedAnswer,
        flagged: rec.flagged,
        timeSpentSeconds: rec.timeSpentSeconds,
        savedAt: rec.savedAt,
      };
    }

    return {
      attempt: {
        id: attempt.id,
        sessionId: attempt.sessionId,
        sessionTitle: attempt.sessionTitle,
        sessionCode: attempt.sessionCode,
        studentId: attempt.studentId,
        fullName: attempt.fullName,
        startedAt: attempt.startedAt,
        deadlineAt: attempt.deadlineAt,
        serverNow: this.nowIso(),
        remainingSeconds,
        reentryCount: attempt.reentryCount,
        violationCount: attempt.violationCount,
        maxViolations: session.maxViolations,
        ...(attempt.keyboardLockSupported !== undefined
          ? { keyboardLockSupported: attempt.keyboardLockSupported }
          : {}),
        ...(attempt.browserNote ? { browserNote: attempt.browserNote } : {}),
        status: attempt.status,
      },
      sessionToken,
      questions: attempt.generatedQuestions,
      savedAnswers,
    };
  }

  /**
   * Học sinh bắt đầu thi hoặc vào lại lượt thi đang làm dở.
   * - Đề mỗi học sinh sinh một lần và lưu lại; vào lại trả về đúng đề đó.
   * - Mỗi học sinh chỉ một phiên hoạt động trên một ca thi; đăng nhập thiết bị khác sẽ đóng phiên cũ và ghi nhận vi phạm `multi_device`.
   */
  public startOrResumeAttempt(
    studentInput: string | UserAccount,
    codeOrSessionId: string,
    deviceId: string = 'default_device',
    ipAddress: string = '127.0.0.1',
    browserInfo?: {
      keyboardLockSupported?: boolean;
      browserNote?: string;
    }
  ): StudentAttemptPaperPayload {
    const student = this.requireStudent(studentInput);
    const cleanDevice = String(deviceId || 'default_device').trim();

    let session = this.sessions.get(codeOrSessionId);
    if (!session) {
      const verify = this.verifySessionCode(student, codeOrSessionId, ipAddress);
      if (!verify.valid || !verify.session) {
        throw new ExamEngineError(
          verify.message,
          verify.reason === 'rate_limited' ? 429 : 403,
          verify.reason?.toUpperCase() || 'VERIFY_FAILED'
        );
      }
      session = this.sessions.get(verify.session.id)!;
    } else {
      const verify = this.verifySessionCode(student, session.code, ipAddress);
      if (!verify.valid) {
        throw new ExamEngineError(
          verify.message,
          verify.reason === 'rate_limited' ? 429 : 403,
          verify.reason?.toUpperCase() || 'VERIFY_FAILED'
        );
      }
    }

    const existingAttempt = this.findStudentAttemptInSession(student.id, session.id);

    // Nếu đã có lượt thi đang diễn ra -> xử lý vào lại hoặc chuyển thiết bị
    if (existingAttempt) {
      if (existingAttempt.status === 'submitted') {
        throw new ExamEngineError(
          'Bạn đã nộp bài ca thi này',
          403,
          'ALREADY_SUBMITTED'
        );
      }

      const isDifferentActiveDevice =
        Boolean(existingAttempt.activeSessionToken) &&
        Boolean(existingAttempt.activeDeviceId) &&
        existingAttempt.activeDeviceId !== cleanDevice;

      const nextSessionToken = this.nextId('stoken');
      let updatedAttempt: SessionAttemptRecord = {
        ...existingAttempt,
        reentryCount: existingAttempt.reentryCount + 1,
        reentryAllowed: false,
        activeSessionToken: nextSessionToken,
        activeDeviceId: cleanDevice,
        ...(browserInfo?.keyboardLockSupported !== undefined
          ? { keyboardLockSupported: browserInfo.keyboardLockSupported }
          : {}),
        ...(browserInfo?.browserNote
          ? { browserNote: browserInfo.browserNote }
          : {}),
      };
      this.attempts.set(updatedAttempt.id, updatedAttempt);
      this.storageAdapter?.onAttemptSaved?.(updatedAttempt);

      // Nếu đăng nhập từ thiết bị khác khi phiên cũ đang mở -> đóng phiên cũ và ghi nhận vi phạm
      if (isDifferentActiveDevice) {
        const violationResult = this.recordViolationInternal(
          updatedAttempt,
          session,
          {
            type: 'multi_device',
            awaySeconds: 0,
            currentQuestionOrder: 1,
            note: `Đăng nhập từ thiết bị khác (${cleanDevice}) làm đóng phiên thiết bị cũ (${existingAttempt.activeDeviceId}).`,
          }
        );
        updatedAttempt = violationResult.attempt;
        if (updatedAttempt.status === 'submitted') {
          throw new ExamEngineError(
            'Bài thi đã tự động nộp do vượt ngưỡng vi phạm khi đăng nhập trên nhiều thiết bị.',
            403,
            'AUTO_SUBMITTED_ON_VIOLATION'
          );
        }
      }

      return this.buildAttemptPaperPayload(updatedAttempt, session, nextSessionToken);
    }

    // Tạo mới lượt thi lần đầu tiên cho học sinh trong ca thi này
    const startedAtMs = this.nowMs();
    const durationMs = session.durationMinutes * 60 * 1000;
    let deadlineMs = startedAtMs + durationMs;
    if (session.closeAt) {
      const closeMs = new Date(session.closeAt).getTime();
      if (closeMs > startedAtMs) {
        deadlineMs = Math.min(deadlineMs, closeMs);
      }
    }

    const generatedQuestions = this.generateStudentPaperOnce(session);
    const sessionToken = this.nextId('stoken');

    const newAttempt: SessionAttemptRecord = {
      id: this.nextId('attempt'),
      sessionId: session.id,
      sessionCode: session.code,
      sessionTitle: session.title,
      studentId: student.id,
      username: student.username,
      fullName: student.fullName,
      className: student.className || 'Lớp Certiport GenAI',
      generatedQuestions,
      startedAt: new Date(startedAtMs).toISOString(),
      deadlineAt: new Date(deadlineMs).toISOString(),
      submittedAt: null,
      submitReason: null,
      score: null,
      correctCount: null,
      totalQuestions: generatedQuestions.length,
      percentage: null,
      passed: null,
      reentryCount: 0,
      reentryAllowed: false,
      violationCount: 0,
      activeSessionToken: sessionToken,
      activeDeviceId: cleanDevice,
      ...(browserInfo?.keyboardLockSupported !== undefined
        ? { keyboardLockSupported: browserInfo.keyboardLockSupported }
        : {}),
      ...(browserInfo?.browserNote
        ? { browserNote: browserInfo.browserNote }
        : {}),
      status: 'in_progress',
    };

    this.attempts.set(newAttempt.id, newAttempt);
    this.storageAdapter?.onAttemptSaved?.(newAttempt);

    return this.buildAttemptPaperPayload(newAttempt, session, sessionToken);
  }

  private requireStudentAttemptOwnership(
    studentInput: string | UserAccount,
    attemptId: string,
    sessionToken?: string
  ): {
    student: UserAccount;
    attempt: SessionAttemptRecord;
    session: ExamSessionRecord;
  } {
    const student = this.requireStudent(studentInput);
    const rawAttempt = this.attempts.get(attemptId);
    if (!rawAttempt) {
      throw new ExamEngineError('Không tìm thấy lượt thi.', 404, 'ATTEMPT_NOT_FOUND');
    }

    if (rawAttempt.studentId.toLowerCase() !== student.id.toLowerCase()) {
      throw new ExamEngineError(
        'Bạn chỉ được quyền truy cập lượt thi của chính mình.',
        403,
        'FORBIDDEN_ATTEMPT_OWNERSHIP'
      );
    }

    const session = this.sessions.get(rawAttempt.sessionId);
    if (!session) {
      throw new ExamEngineError('Không tìm thấy ca thi.', 404, 'SESSION_NOT_FOUND');
    }

    const attempt = this.checkAndAutoSubmitIfExpired(rawAttempt);

    if (
      sessionToken !== undefined &&
      attempt.status === 'in_progress' &&
      attempt.activeSessionToken &&
      attempt.activeSessionToken !== sessionToken
    ) {
      throw new ExamEngineError(
        'Phiên thi trên thiết bị này đã bị đóng do tài khoản đăng nhập ở thiết bị khác.',
        409,
        'SESSION_REPLACED_BY_ANOTHER_DEVICE'
      );
    }

    return { student, attempt, session };
  }

  /**
   * Học sinh lấy đề thi đã sinh (không kèm đáp án đúng và giải thích)
   */
  public getAttemptPaper(
    studentInput: string | UserAccount,
    attemptId: string,
    sessionToken?: string
  ): StudentAttemptPaperPayload {
    const { attempt, session } = this.requireStudentAttemptOwnership(
      studentInput,
      attemptId,
      sessionToken
    );

    if (session.status === 'ended') {
      throw new ExamEngineError(
        'Ca thi đã kết thúc.',
        403,
        'SESSION_ENDED'
      );
    }

    return this.buildAttemptPaperPayload(
      attempt,
      session,
      attempt.activeSessionToken || sessionToken || ''
    );
  }

  /**
   * Học sinh lưu đáp án cho 1 câu hỏi trong lượt thi.
   * Lưu ý: Khi ca thi ở trạng thái `locked` (khóa không nhận học sinh mới),
   * học sinh đang trong phòng thi (`in_progress`) vẫn được lưu đáp án và làm bài bình thường.
   */
  public saveAttemptAnswer(
    studentInput: string | UserAccount,
    attemptId: string,
    payload: {
      questionId: string;
      selectedAnswer: UserAnswer | null;
      timeSpentSeconds?: number;
      flagged?: boolean;
      sessionToken?: string;
    }
  ): AttemptAnswerRecord {
    const { attempt, session } = this.requireStudentAttemptOwnership(
      studentInput,
      attemptId,
      payload.sessionToken
    );

    if (session.status === 'ended') {
      throw new ExamEngineError(
        'Ca thi đã kết thúc, không thể lưu thêm đáp án.',
        403,
        'SESSION_ENDED'
      );
    }

    if (attempt.status === 'submitted') {
      throw new ExamEngineError(
        attempt.submitReason === 'timeout'
          ? 'Đã hết thời gian làm bài, hệ thống đã tự động chốt bài của bạn.'
          : 'Lượt thi đã kết thúc, không thể thay đổi đáp án.',
        409,
        attempt.submitReason === 'timeout' ? 'ATTEMPT_TIMEOUT_SUBMITTED' : 'ATTEMPT_ALREADY_SUBMITTED'
      );
    }

    const questionExistsInPaper = attempt.generatedQuestions.some(
      (q) => q.id === payload.questionId
    );
    if (!questionExistsInPaper) {
      throw new ExamEngineError(
        'Câu hỏi không thuộc đề thi của lượt thi này.',
        400,
        'INVALID_QUESTION_ID'
      );
    }

    const recordId = `${attempt.id}_${payload.questionId}`;
    const existing = this.attemptAnswers.get(recordId);

    const record: AttemptAnswerRecord = {
      id: recordId,
      attemptId: attempt.id,
      sessionId: attempt.sessionId,
      studentId: attempt.studentId,
      questionId: payload.questionId,
      selectedAnswer: payload.selectedAnswer,
      savedAt: this.nowIso(),
      timeSpentSeconds: Math.max(
        0,
        Math.floor(
          Number(payload.timeSpentSeconds ?? existing?.timeSpentSeconds ?? 0)
        )
      ),
      flagged:
        payload.flagged !== undefined
          ? Boolean(payload.flagged)
          : Boolean(existing?.flagged),
    };

    this.attemptAnswers.set(recordId, record);
    this.storageAdapter?.onAnswerSaved?.(record);
    return record;
  }

  private syncFinalAnswersHelper(
    attempt: SessionAttemptRecord,
    finalAnswers?: Array<{
      questionId: string;
      selectedAnswer: UserAnswer | null;
      timeSpentSeconds?: number;
      flagged?: boolean;
    }>
  ): void {
    if (
      attempt.status !== 'in_progress' ||
      !Array.isArray(finalAnswers) ||
      finalAnswers.length === 0
    ) {
      return;
    }
    const validIds = new Set(attempt.generatedQuestions.map((q) => q.id));
    for (const item of finalAnswers) {
      if (!item || !validIds.has(item.questionId)) continue;
      const recordId = `${attempt.id}_${item.questionId}`;
      const existing = this.attemptAnswers.get(recordId);
      const record: AttemptAnswerRecord = {
        id: recordId,
        attemptId: attempt.id,
        sessionId: attempt.sessionId,
        studentId: attempt.studentId,
        questionId: item.questionId,
        selectedAnswer: item.selectedAnswer ?? null,
        savedAt: this.nowIso(),
        timeSpentSeconds: Math.max(
          0,
          Math.floor(
            Number(item.timeSpentSeconds ?? existing?.timeSpentSeconds ?? 0)
          )
        ),
        flagged:
          item.flagged !== undefined
            ? Boolean(item.flagged)
            : Boolean(existing?.flagged),
      };
      this.attemptAnswers.set(recordId, record);
      this.storageAdapter?.onAnswerSaved?.(record);
    }
  }

  private recordViolationInternal(
    attempt: SessionAttemptRecord,
    session: ExamSessionRecord,
    payload: {
      type: ViolationEventType;
      occurredAt?: string;
      awaySeconds?: number;
      currentQuestionOrder?: number;
      note?: string;
    }
  ): {
    violation: ViolationEventRecord;
    attempt: SessionAttemptRecord;
    autoSubmitted: boolean;
    countsTowardLimit: boolean;
  } {
    const occurredAt =
      payload.occurredAt && !Number.isNaN(new Date(payload.occurredAt).getTime())
        ? new Date(payload.occurredAt).toISOString()
        : this.nowIso();

    const violation: ViolationEventRecord = {
      id: this.nextId('viol'),
      attemptId: attempt.id,
      sessionId: attempt.sessionId,
      studentId: attempt.studentId,
      type: payload.type,
      occurredAt,
      awaySeconds: Math.max(0, Math.floor(Number(payload.awaySeconds) || 0)),
      currentQuestionOrder: Math.max(
        1,
        Math.floor(Number(payload.currentQuestionOrder) || 1)
      ),
      ...(payload.note ? { note: payload.note } : {}),
    };
    this.violations.set(violation.id, violation);
    this.storageAdapter?.onViolationSaved?.(violation);

    const countsTowardLimit = doesViolationCountTowardLimit(payload.type);
    if (!countsTowardLimit) {
      return {
        violation,
        attempt,
        autoSubmitted: false,
        countsTowardLimit: false,
      };
    }

    const nextViolationCount = attempt.violationCount + 1;
    let updatedAttempt: SessionAttemptRecord = {
      ...attempt,
      violationCount: nextViolationCount,
    };
    this.attempts.set(updatedAttempt.id, updatedAttempt);
    this.storageAdapter?.onAttemptSaved?.(updatedAttempt);

    let autoSubmitted = false;
    if (
      updatedAttempt.status === 'in_progress' &&
      nextViolationCount >= session.maxViolations
    ) {
      updatedAttempt = this.finalizeAttemptOnServer(updatedAttempt, 'violation');
      autoSubmitted = true;
    }

    return {
      violation,
      attempt: updatedAttempt,
      autoSubmitted,
      countsTowardLimit: true,
    };
  }

  /**
   * Ghi nhận sự kiện vi phạm trong lúc làm bài.
   * - Sự kiện "phím bị chặn" (`blocked_key`, `phim_bi_chan`, `copy_paste`, `devtools`) chỉ ghi vào `violation_events`, KHÔNG tính vào ngưỡng tự nộp.
   * - Sự kiện rời màn hình (`tab_switch`, `window_blur`, `fullscreen_exit`, `window_resize`, `multi_screen`) cộng vào `violationCount`; nếu chạm ngưỡng `maxViolations`, máy chủ tự động chốt bài với `submitReason = 'violation'`.
   */
  public recordViolation(
    studentInput: string | UserAccount,
    attemptId: string,
    payload: {
      type: ViolationEventType;
      occurredAt?: string;
      awaySeconds?: number;
      currentQuestionOrder?: number;
      note?: string;
      sessionToken?: string;
      finalAnswers?: Array<{
        questionId: string;
        selectedAnswer: UserAnswer | null;
        timeSpentSeconds?: number;
        flagged?: boolean;
      }>;
    }
  ): {
    violation: ViolationEventRecord;
    violationCount: number;
    maxViolations: number;
    countsTowardLimit: boolean;
    autoSubmitted: boolean;
    status: SessionAttemptRecord['status'];
    result?: StudentAttemptResultPayload;
  } {
    const { student, attempt, session } = this.requireStudentAttemptOwnership(
      studentInput,
      attemptId,
      payload.sessionToken
    );

    if (attempt.status === 'submitted') {
      throw new ExamEngineError(
        'Lượt thi đã nộp, không ghi nhận thêm vi phạm.',
        409,
        'ATTEMPT_ALREADY_SUBMITTED'
      );
    }

    this.syncFinalAnswersHelper(attempt, payload.finalAnswers);

    const recorded = this.recordViolationInternal(attempt, session, payload);
    const resultPayload = recorded.autoSubmitted
      ? this.getAttemptResult(student, attemptId)
      : undefined;

    return {
      violation: recorded.violation,
      violationCount: recorded.attempt.violationCount,
      maxViolations: session.maxViolations,
      countsTowardLimit: recorded.countsTowardLimit,
      autoSubmitted: recorded.autoSubmitted,
      status: recorded.attempt.status,
      ...(resultPayload ? { result: resultPayload } : {}),
    };
  }

  /**
   * Học sinh chủ động nộp bài (hoặc máy chủ tự chốt nếu phát hiện đã quá hạn nộp / vi phạm chạm ngưỡng)
   */
  public submitAttempt(
    studentInput: string | UserAccount,
    attemptId: string,
    sessionToken?: string,
    options?: {
      reason?: 'voluntary' | 'timeout' | 'violation';
      finalAnswers?: Array<{
        questionId: string;
        selectedAnswer: UserAnswer | null;
        timeSpentSeconds?: number;
        flagged?: boolean;
      }>;
    }
  ): StudentAttemptResultPayload {
    const student = this.requireStudent(studentInput);
    const rawAttempt = this.attempts.get(attemptId);
    if (!rawAttempt) {
      throw new ExamEngineError('Không tìm thấy lượt thi.', 404, 'ATTEMPT_NOT_FOUND');
    }
    if (rawAttempt.studentId.toLowerCase() !== student.id.toLowerCase()) {
      throw new ExamEngineError(
        'Bạn chỉ được quyền truy cập lượt thi của chính mình.',
        403,
        'FORBIDDEN_ATTEMPT_OWNERSHIP'
      );
    }

    this.syncFinalAnswersHelper(rawAttempt, options?.finalAnswers);

    const { attempt } = this.requireStudentAttemptOwnership(
      student,
      attemptId,
      sessionToken
    );

    if (attempt.status === 'in_progress') {
      const submitReason: AttemptSubmitReason =
        options?.reason === 'timeout'
          ? 'timeout'
          : options?.reason === 'violation'
            ? 'violation'
            : 'voluntary';
      this.finalizeAttemptOnServer(attempt, submitReason);
    }

    return this.getAttemptResult(student, attemptId);
  }

  /**
   * Học sinh lấy kết quả sau khi nộp bài.
   * Tuân thủ nghiêm ngặt `session.resultVisibility`:
   * - `none`: Không trả về điểm số hay đáp án đúng
   * - `score_only`: Chỉ trả về điểm số, không trả về đáp án đúng / giải thích từng câu
   * - `score_and_answers`: Trả về đầy đủ điểm kèm đáp án đúng và giải thích
   */
  public getAttemptResult(
    studentInput: string | UserAccount,
    attemptId: string
  ): StudentAttemptResultPayload {
    const { attempt, session } = this.requireStudentAttemptOwnership(
      studentInput,
      attemptId
    );

    if (attempt.status !== 'submitted') {
      throw new ExamEngineError(
        'Bài thi chưa được nộp, chưa thể xem kết quả.',
        400,
        'ATTEMPT_NOT_SUBMITTED'
      );
    }

    const startedMs = new Date(attempt.startedAt).getTime();
    const submittedMs = attempt.submittedAt
      ? new Date(attempt.submittedAt).getTime()
      : this.nowMs();
    const durationSeconds = Math.max(0, Math.round((submittedMs - startedMs) / 1000));

    const basePayload: StudentAttemptResultPayload = {
      attemptId: attempt.id,
      sessionId: attempt.sessionId,
      sessionTitle: attempt.sessionTitle,
      sessionCode: attempt.sessionCode,
      studentId: attempt.studentId,
      fullName: attempt.fullName,
      status: attempt.status,
      submittedAt: attempt.submittedAt,
      submitReason: attempt.submitReason,
      durationSeconds,
      resultVisibility: session.resultVisibility,
    };

    if (session.resultVisibility === 'none') {
      return basePayload;
    }

    const scorePayload: StudentAttemptResultPayload = {
      ...basePayload,
      score: attempt.score,
      correctCount: attempt.correctCount,
      totalQuestions: attempt.totalQuestions,
      percentage: attempt.percentage,
      passed: attempt.passed,
      passScore: session.passScore,
      topicBreakdown: attempt.topicBreakdown,
      typeBreakdown: attempt.typeBreakdown,
    };

    if (session.resultVisibility === 'score_only') {
      return scorePayload;
    }

    const generatedMap = new Map(
      attempt.generatedQuestions.map((sq) => [sq.id, sq])
    );

    const questionsWithAnswers = (attempt.questionResults ?? []).map((qr) => {
      const masterQ = this.questions.get(qr.questionId);
      const genQ = generatedMap.get(qr.questionId);
      const displayQuestion: Question | undefined = masterQ
        ? {
            ...masterQ,
            ...(genQ?.options ? { options: genQ.options } : {}),
          }
        : undefined;

      const userBreakdown = displayQuestion
        ? getUserAnswerBreakdown(displayQuestion, qr.userAnswer ?? undefined)
        : [];
      const correctBreakdown = displayQuestion
        ? getCorrectAnswerBreakdown(displayQuestion)
        : [];

      const userAnswerDisplay =
        userBreakdown.length === 1
          ? userBreakdown[0].value
          : userBreakdown.map((b) => `${b.label}: ${b.value}`).join(' | ');
      const correctAnswerDisplay =
        correctBreakdown.length === 1
          ? correctBreakdown[0].value
          : correctBreakdown.map((b) => `${b.label}: ${b.value}`).join(' | ');

      return {
        ...qr,
        correctAnswer: masterQ?.correctAnswer ?? '',
        userAnswerDisplay: userAnswerDisplay || 'Chưa trả lời',
        correctAnswerDisplay: correctAnswerDisplay || '',
        explanation: masterQ?.explanation ?? '',
      };
    });

    return {
      ...scorePayload,
      questionsWithAnswers,
    };
  }

  /**
   * Lấy danh sách toàn bộ các lượt thi "Thi ngay" đã nộp của học sinh
   * (đã lọc theo `session.resultVisibility` của từng ca thi để hiển thị trong Lịch sử phòng thi).
   */
  public listStudentSubmittedAttempts(
    studentInput: string | UserAccount
  ): StudentAttemptResultPayload[] {
    const student = this.requireStudent(studentInput);
    this.sweepExpiredAttempts();

    const submittedList: SessionAttemptRecord[] = [];
    for (const att of this.attempts.values()) {
      if (att.studentId.toLowerCase() !== student.id.toLowerCase()) continue;
      const checked = this.checkAndAutoSubmitIfExpired(att);
      if (checked.status === 'submitted' && this.sessions.has(checked.sessionId)) {
        submittedList.push(checked);
      }
    }

    submittedList.sort((a, b) =>
      (b.submittedAt ?? b.startedAt).localeCompare(a.submittedAt ?? a.startedAt)
    );

    return submittedList.map((att) => this.getAttemptResult(student, att.id));
  }
}
