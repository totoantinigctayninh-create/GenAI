import {
  BreakdownStatItem,
  CorrectAnswerValue,
  DropdownSubItem,
  MatchingPair,
  MockExamQuestionResult,
  OrderingStep,
  QuestionOption,
  QuestionType,
  UserAnswer,
} from './exam';

export type ExamSessionSelectionMode = 'proportional' | 'manual';

export type ExamSessionResultVisibility =
  | 'none'
  | 'score_only'
  | 'score_and_answers';

export type ExamSessionStatus = 'draft' | 'open' | 'locked' | 'ended';

export type AttemptSubmitReason =
  | 'voluntary'
  | 'timeout'
  | 'violation'
  | 'teacher_forced';

export type SessionAttemptStatus = 'in_progress' | 'submitted';

export type ViolationEventType =
  | 'tab_switch'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'blocked_key'
  | 'phim_bi_chan'
  | 'window_resize'
  | 'multi_screen'
  | 'copy_paste'
  | 'devtools'
  | 'multi_device'
  | 'other';

export type ExamAuditAction =
  | 'create'
  | 'update'
  | 'open'
  | 'lock'
  | 'unlock'
  | 'extend'
  | 'allow_reentry'
  | 'end'
  | 'clone'
  | 'delete'
  | 'force_submit';

export type CodeVerifyRejectionReason =
  | 'not_found'
  | 'not_open_yet'
  | 'locked'
  | 'ended'
  | 'wrong_class'
  | 'already_submitted'
  | 'rate_limited';

/**
 * Bảng 1: `exam_sessions`
 * Lưu cấu hình ca thi do giáo viên tạo và quản lý
 */
export interface ExamSessionRecord {
  id: string;
  title: string;
  /** Mã ca thi 6 ký tự (chữ và số, loại bỏ 0/O/1/I/L, lưu in hoa) */
  code: string;
  /** ID hoặc username của giáo viên tạo ca thi */
  createdBy: string;
  createdByName: string;
  /** Lớp/nhóm được phép thi, hoặc "ALL" (mở cho mọi học sinh có mã) */
  targetClass: string;
  questionCount: number;
  durationMinutes: number;
  selectionMode: ExamSessionSelectionMode;
  /** Danh sách ID câu hỏi nếu giáo viên chọn thủ công (selectionMode === 'manual') */
  manualQuestionIds?: string[];
  shuffleQuestions: boolean;
  shuffleOptions: boolean;
  /** Khung giờ mở thi (ISO 8601, null nếu mở thủ công không giới hạn khung giờ) */
  openAt: string | null;
  closeAt: string | null;
  /** Ngưỡng vi phạm tối đa trước khi tự động thu bài (mặc định 3) */
  maxViolations: number;
  /** Điểm đạt thang 1000 chuẩn Certiport (mặc định 700) */
  passScore: number;
  /** Chế độ hiển thị kết quả cho học sinh sau khi nộp bài */
  resultVisibility: ExamSessionResultVisibility;
  status: ExamSessionStatus;
  createdAt: string;
  updatedAt: string;
  /** Thống kê nhanh phục vụ bảng danh sách ca thi của giáo viên */
  enteredCount?: number;
  inProgressCount?: number;
  submittedCount?: number;
  totalTargetStudents?: number | null;
}

/**
 * Cấu trúc câu hỏi đã được sinh cố định cho 1 lượt thi của học sinh
 * (TUYỆT ĐỐI KHÔNG chứa `correctAnswer` hay `explanation`)
 */
export interface SanitizedStudentQuestion {
  id: string;
  orderNumber: number;
  type: QuestionType;
  topic: string;
  examSet: string;
  prompt: string;
  instruction?: string;
  imageUrl?: string;
  options?: QuestionOption[];
  maxSelect?: number;
  maxSelections?: number;
  subItems?: DropdownSubItem[];
  dropdownOptions?: string[];
  dropdownColumns?: [string, string];
  /** Đối với câu matching, danh sách vế trái và danh sách mảnh ghép vế phải đã xáo trộn */
  matchingLeftItems?: { id: string; left: string }[];
  matchingRightChoices?: string[];
  /** Đối với câu ordering, danh sách các bước đã xáo trộn thứ tự hiển thị ban đầu */
  steps?: OrderingStep[];
}

/**
 * Bảng 2: `attempts`
 * Lượt làm bài của học sinh trong một ca thi
 */
export interface SessionAttemptRecord {
  id: string;
  sessionId: string;
  sessionCode: string;
  sessionTitle: string;
  studentId: string;
  username: string;
  fullName: string;
  className: string;
  /**
   * Đề đã sinh riêng cho học sinh (lưu lại một lần duy nhất khi bắt đầu thi).
   * Khi học sinh vào lại sẽ nhận đúng danh sách câu hỏi và thứ tự đáp án này.
   */
  generatedQuestions: SanitizedStudentQuestion[];
  /** Thời điểm bắt đầu tính từ đồng hồ máy chủ (ISO 8601) */
  startedAt: string;
  /** Hạn nộp bài tính ở máy chủ (ISO 8601), có thể được giáo viên gia hạn */
  deadlineAt: string;
  /** Thời điểm nộp bài thực tế ở máy chủ (ISO 8601, null nếu đang làm) */
  submittedAt: string | null;
  /** Kiểu nộp: tự nguyện / hết giờ / vi phạm / giáo viên nộp giúp */
  submitReason: AttemptSubmitReason | null;
  /** Điểm thang 1000 chuẩn Certiport (null khi đang thi) */
  score: number | null;
  correctCount: number | null;
  totalQuestions: number;
  percentage: number | null;
  passed: boolean | null;
  /** Số lần học sinh vào lại hoặc chuyển thiết bị */
  reentryCount: number;
  /** Cờ cho phép vào lại do giáo viên cấp (nếu phiên yêu cầu duyệt vào lại) */
  reentryAllowed: boolean;
  /** Số lần vi phạm đã ghi nhận trong lượt thi này */
  violationCount: number;
  /** Token phiên thiết bị đang hoạt động (đảm bảo mỗi học sinh chỉ 1 phiên hoạt động) */
  activeSessionToken: string | null;
  activeDeviceId: string | null;
  /** Cờ ghi nhận trình duyệt học sinh có hỗ trợ Keyboard Lock API hay không */
  keyboardLockSupported?: boolean;
  /** Ghi chú trình duyệt để giáo viên biết (ví dụ: Safari/Firefox không có Keyboard Lock API) */
  browserNote?: string;
  status: SessionAttemptStatus;
  /** Số câu đã trả lời hiện tại (phục vụ theo dõi trực tiếp Bước 6) */
  answeredCount?: number;
  /** Số giây còn lại tính theo đồng hồ máy chủ (phục vụ theo dõi trực tiếp Bước 6) */
  remainingSeconds?: number;
  /** Thời gian làm bài tính bằng giây (phục vụ thống kê biểu đồ Bước 7A/7B) */
  durationSeconds?: number;
  /** ID lượt thi cũ nếu lượt thi này được tạo mới từ thao tác "Cho vào lại" của giáo viên */
  previousAttemptId?: string;
  /** ID lượt thi mới nếu lượt thi bị tự nộp do sự cố này đã được giáo viên cấp lượt thi mới ("Cho vào lại") */
  supersededByAttemptId?: string;
  /** Phản hồi kết quả chi tiết (chỉ được lưu ở máy chủ và lọc theo resultVisibility khi trả về) */
  questionResults?: MockExamQuestionResult[];
  topicBreakdown?: BreakdownStatItem[];
  typeBreakdown?: BreakdownStatItem[];
  /** Chi tiết từng câu hỏi kèm đáp án đúng, phương án học sinh chọn và thời gian làm từng câu (chỉ trả về cho Giáo viên ở trang Kết quả 7B) */
  teacherQuestionDetails?: TeacherAttemptQuestionDetail[];
}

export interface TeacherAttemptQuestionDetail {
  questionId: string;
  orderNumber: number;
  topic: string;
  type: QuestionType;
  prompt: string;
  options?: QuestionOption[];
  answered: boolean;
  flagged: boolean;
  isCorrect: boolean;
  userAnswer: UserAnswer | null;
  userAnswerDisplay: string;
  correctAnswer: CorrectAnswerValue;
  correctAnswerDisplay: string;
  explanation: string;
  timeSpentSeconds: number;
}

export interface TeacherLiveNotEnteredStudent {
  studentId: string;
  username: string;
  fullName: string;
  className: string;
}

export interface TeacherSessionDetailPayload {
  session: ExamSessionRecord;
  serverNow: string;
  summary: {
    inProgressCount: number;
    submittedCount: number;
    notEnteredCount: number;
  };
  attempts: SessionAttemptRecord[];
  notEnteredStudents: TeacherLiveNotEnteredStudent[];
  violations: ViolationEventRecord[];
  auditLogs: ExamAuditLogRecord[];
}

/**
 * Bảng 3: `attempt_answers`
 * Đáp án từng câu trong lượt thi của học sinh
 */
export interface AttemptAnswerRecord {
  id: string;
  attemptId: string;
  sessionId: string;
  studentId: string;
  questionId: string;
  selectedAnswer: UserAnswer | null;
  savedAt: string;
  timeSpentSeconds: number;
  flagged: boolean;
}

/**
 * Bảng 4: `violation_events`
 * Sự kiện vi phạm quy chế trong lúc làm bài
 */
export interface ViolationEventRecord {
  id: string;
  attemptId: string;
  sessionId: string;
  studentId: string;
  type: ViolationEventType;
  occurredAt: string;
  awaySeconds: number;
  currentQuestionOrder: number;
  note?: string;
}

/**
 * Bảng 5: `exam_audit_log`
 * Nhật ký tác vụ quản lý ca thi của giáo viên
 */
export interface ExamAuditLogRecord {
  id: string;
  sessionId: string;
  actorId: string;
  actorName: string;
  action: ExamAuditAction;
  targetAttemptId?: string;
  targetStudentId?: string;
  note?: string;
  details?: Record<string, unknown>;
  createdAt: string;
}

export interface VerifyCodeResult {
  valid: boolean;
  reason?: CodeVerifyRejectionReason;
  message: string;
  retryAfterSeconds?: number;
  session?: {
    id: string;
    title: string;
    code: string;
    targetClass: string;
    questionCount: number;
    durationMinutes: number;
    maxViolations: number;
    passScore: number;
    openAt: string | null;
    closeAt: string | null;
    status: ExamSessionStatus;
    canResumeAttemptId?: string;
  };
}

export interface StudentAttemptPaperPayload {
  attempt: {
    id: string;
    sessionId: string;
    sessionTitle: string;
    sessionCode: string;
    studentId: string;
    fullName: string;
    startedAt: string;
    deadlineAt: string;
    serverNow: string;
    remainingSeconds: number;
    reentryCount: number;
    violationCount: number;
    maxViolations: number;
    keyboardLockSupported?: boolean;
    browserNote?: string;
    status: SessionAttemptStatus;
  };
  sessionToken: string;
  questions: SanitizedStudentQuestion[];
  savedAnswers: Record<
    string,
    {
      selectedAnswer: UserAnswer | null;
      flagged: boolean;
      timeSpentSeconds: number;
      savedAt: string;
    }
  >;
}

export interface StudentAttemptResultPayload {
  attemptId: string;
  sessionId: string;
  sessionTitle: string;
  sessionCode?: string;
  studentId: string;
  fullName: string;
  status: SessionAttemptStatus;
  submittedAt: string | null;
  submitReason: AttemptSubmitReason | null;
  durationSeconds: number;
  resultVisibility: ExamSessionResultVisibility;
  /** Chỉ có mặt khi resultVisibility === 'score_only' hoặc 'score_and_answers' */
  score?: number | null;
  correctCount?: number | null;
  totalQuestions?: number;
  percentage?: number | null;
  passed?: boolean | null;
  passScore?: number;
  /** Chỉ có mặt khi resultVisibility === 'score_and_answers' */
  questionsWithAnswers?: Array<{
    questionId: string;
    orderNumber: number;
    topic: string;
    type: QuestionType;
    prompt: string;
    answered: boolean;
    flagged: boolean;
    isCorrect: boolean;
    userAnswer: UserAnswer | null;
    correctAnswer: CorrectAnswerValue;
    userAnswerDisplay?: string;
    correctAnswerDisplay?: string;
    explanation: string;
  }>;
  topicBreakdown?: BreakdownStatItem[];
  typeBreakdown?: BreakdownStatItem[];
}
