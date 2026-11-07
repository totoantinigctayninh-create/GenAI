import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Flag,
  History,
  Keyboard,
  Maximize2,
  Send,
  ShieldAlert,
  WifiOff,
  XCircle,
} from 'lucide-react';
import {
  CERTIPORT_PASS_SCORE,
  MOCK_EXAM_WARNING_THRESHOLD_SECONDS,
  Question,
  UserAccount,
  UserAnswer,
} from '../types/exam';
import {
  StudentAttemptPaperPayload,
  StudentAttemptResultPayload,
  VerifyCodeResult,
  ViolationEventType,
} from '../types/examSession';
import { examSessionApi } from '../services/examSessionApi';
import {
  formatCountdownClock,
  isQuestionAnswered,
} from '../utils/scoring';
import {
  formatVerifyCodeErrorMessage,
  sanitizeLiveExamCodeInput,
} from '../utils/uiFormatting';
import {
  computeServerClockOffsetMs,
  computeServerRemainingSeconds,
  detectBlockedKeyShortcut,
  doesViolationCountTowardLimit,
  evaluateViolationPolicy,
  isSuspiciousSplitScreenResize,
  LocalAnswerBackupEntry,
  LocalAttemptBackup,
  mergeServerAndLocalAnswers,
  QueuedViolationEvent,
  toClientRenderableQuestion,
} from '../utils/liveExamHelpers';
import { QuestionFontScale, QuestionRenderer } from './QuestionRenderer';

interface LiveExamTabProps {
  currentUser: UserAccount;
  fontScale?: QuestionFontScale;
  onChangeFontScale?: (scale: QuestionFontScale) => void;
  onExamPhaseChange?: (inProgress: boolean) => void;
  onLiveExamSubmitted?: (result: StudentAttemptResultPayload) => void;
  onOpenHistoryTab?: () => void;
}

export interface BrowserExamCapabilities {
  fullscreenSupported: boolean;
  keyboardLockSupported: boolean;
  browserNote?: string;
}

export function detectBrowserExamCapabilities(): BrowserExamCapabilities {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { fullscreenSupported: true, keyboardLockSupported: true };
  }

  const win = window as unknown as Record<string, unknown>;
  if (win.__FORCE_NO_FULLSCREEN__ === true) {
    return {
      fullscreenSupported: false,
      keyboardLockSupported: false,
      browserNote: 'Trình duyệt không hỗ trợ Fullscreen API',
    };
  }

  const docEl = document.documentElement as unknown as Record<string, unknown>;
  const fullscreenSupported = Boolean(
    typeof docEl.requestFullscreen === 'function' ||
      typeof docEl.webkitRequestFullscreen === 'function'
  );

  const nav = navigator as unknown as {
    keyboard?: { lock?: (keys?: string[]) => Promise<void> };
    userAgent?: string;
  };
  const keyboardLockSupported =
    win.__FORCE_NO_KEYBOARD_LOCK__ === true
      ? false
      : Boolean(nav.keyboard && typeof nav.keyboard.lock === 'function');

  let browserNote: string | undefined;
  if (!keyboardLockSupported) {
    const ua = nav.userAgent || '';
    const browserLabel = /Firefox/i.test(ua)
      ? 'Firefox'
      : /Safari/i.test(ua) && !/Chrome|Chromium|Edg/i.test(ua)
        ? 'Safari'
        : 'Trình duyệt hiện tại';
    browserNote = `${browserLabel} không hỗ trợ Keyboard Lock API (phím Esc không bị khóa cứng toàn màn hình).`;
  }

  return {
    fullscreenSupported,
    keyboardLockSupported,
    ...(browserNote ? { browserNote } : {}),
  };
}

function getOrCreateStudentDeviceId(): string {
  const key = 'certiport_student_device_id_v1';
  try {
    const existing = localStorage.getItem(key);
    if (existing) return existing;
    const created = `dev_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(key, created);
    return created;
  } catch {
    return 'dev_browser_default';
  }
}

function getAttemptBackupKey(studentId: string, attemptId: string): string {
  return `certiport_live_exam_backup_v1_${studentId}_${attemptId}`;
}

function loadLocalAttemptBackup(
  studentId: string,
  attemptId: string
): LocalAttemptBackup | null {
  try {
    const raw = localStorage.getItem(getAttemptBackupKey(studentId, attemptId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalAttemptBackup;
    if (parsed && parsed.attemptId === attemptId && parsed.answers) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function saveLocalAttemptBackup(
  studentId: string,
  backup: LocalAttemptBackup
): void {
  try {
    localStorage.setItem(
      getAttemptBackupKey(studentId, backup.attemptId),
      JSON.stringify(backup)
    );
  } catch {
    // Bỏ qua nếu trình duyệt chặn localStorage
  }
}

function removeLocalAttemptBackup(studentId: string, attemptId: string): void {
  try {
    localStorage.removeItem(getAttemptBackupKey(studentId, attemptId));
  } catch {
    // Bỏ qua
  }
}

function isBrowserSimulatedOrRealOffline(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as Record<string, unknown>;
  if (win.__FORCE_OFFLINE__ === true) return true;
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function lockEscapeKeyboardSafely(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const nav = navigator as unknown as {
      keyboard?: { lock?: (keys?: string[]) => Promise<void> };
    };
    if (nav.keyboard && typeof nav.keyboard.lock === 'function') {
      void nav.keyboard.lock(['Escape']).catch(() => {});
    }
  } catch {
    // Bỏ qua
  }
}

function unlockKeyboardSafely(): void {
  if (typeof navigator === 'undefined') return;
  try {
    const nav = navigator as unknown as {
      keyboard?: { unlock?: () => void };
    };
    if (nav.keyboard && typeof nav.keyboard.unlock === 'function') {
      nav.keyboard.unlock();
    }
  } catch {
    // Bỏ qua
  }
}

function requestFullscreenAndLockEscSafely(): void {
  if (typeof document === 'undefined') return;
  try {
    const docEl = document.documentElement as unknown as {
      requestFullscreen?: () => Promise<void>;
      webkitRequestFullscreen?: () => Promise<void>;
    };
    if (typeof docEl.requestFullscreen === 'function') {
      void docEl.requestFullscreen().catch(() => {});
    } else if (typeof docEl.webkitRequestFullscreen === 'function') {
      void docEl.webkitRequestFullscreen().catch(() => {});
    }
    lockEscapeKeyboardSafely();
  } catch {
    // Bỏ qua
  }
}

function exitFullscreenSafely(): void {
  if (typeof document === 'undefined') return;
  unlockKeyboardSafely();

  try {
    const doc = document as unknown as {
      fullscreenElement?: Element | null;
      webkitFullscreenElement?: Element | null;
      exitFullscreen?: () => Promise<void>;
      webkitExitFullscreen?: () => Promise<void>;
    };
    if (doc.fullscreenElement && typeof doc.exitFullscreen === 'function') {
      void doc.exitFullscreen().catch(() => {});
    } else if (
      doc.webkitFullscreenElement &&
      typeof doc.webkitExitFullscreen === 'function'
    ) {
      void doc.webkitExitFullscreen().catch(() => {});
    }
  } catch {
    // Bỏ qua nếu trình duyệt đã thoát toàn màn hình
  }
}

function formatDurationText(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins === 0) return `${secs} giây`;
  return `${mins} phút ${secs.toString().padStart(2, '0')} giây`;
}

export const LiveExamTab: React.FC<LiveExamTabProps> = ({
  currentUser,
  fontScale = 'normal',
  onExamPhaseChange,
  onLiveExamSubmitted,
  onOpenHistoryTab,
}) => {
  // ---- State màn hình nhập mã & xác nhận ----
  const [code, setCode] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [rateLimitCountdown, setRateLimitCountdown] = useState<number>(0);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);

  const [verifiedSession, setVerifiedSession] = useState<
    NonNullable<VerifyCodeResult['session']> | null
  >(null);
  const [hasAcceptedRules, setHasAcceptedRules] = useState<boolean>(false);
  const [isStarting, setIsStarting] = useState<boolean>(false);

  // ---- State phòng thi đang làm bài (Bước 3 & Bước 4) ----
  const [activePaper, setActivePaper] =
    useState<StudentAttemptPaperPayload | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, UserAnswer>>(
    {}
  );
  const [flaggedMap, setFlaggedMap] = useState<Record<string, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [isOffline, setIsOffline] = useState<boolean>(() =>
    isBrowserSimulatedOrRealOffline()
  );
  const [showSubmitModal, setShowSubmitModal] = useState<boolean>(false);
  const [isSubmitArmed, setIsSubmitArmed] = useState<boolean>(false);
  const [isSubmittingExam, setIsSubmittingExam] = useState<boolean>(false);

  // ---- State chống gian lận (Bước 4) ----
  const [violationCount, setViolationCount] = useState<number>(0);
  const [maxViolations, setMaxViolations] = useState<number>(3);
  const [awayOverlayState, setAwayOverlayState] = useState<{
    open: boolean;
    count: number;
    max: number;
    isLastWarning: boolean;
  } | null>(null);
  const [fullscreenExitOverlayOpen, setFullscreenExitOverlayOpen] =
    useState<boolean>(false);
  const [blockedKeyNotice, setBlockedKeyNotice] = useState<string | null>(null);
  const [environmentWarning, setEnvironmentWarning] = useState<string | null>(
    null
  );

  // ---- State màn hình sau khi nộp bài ----
  const [submittedResult, setSubmittedResult] =
    useState<StudentAttemptResultPayload | null>(null);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const cancelSubmitBtnRef = useRef<HTMLButtonElement | null>(null);
  const confirmSubmitBtnRef = useRef<HTMLButtonElement | null>(null);
  const resumeAwayBtnRef = useRef<HTMLButtonElement | null>(null);
  const returnFullscreenBtnRef = useRef<HTMLButtonElement | null>(null);

  const browserCaps = detectBrowserExamCapabilities();

  // Refs phục vụ tự lưu, đếm thời gian từng câu, chống gian lận và đồng bộ khi mất mạng
  const activePaperRef = useRef<StudentAttemptPaperPayload | null>(null);
  const serverOffsetMsRef = useRef<number>(0);
  const deadlineIsoRef = useRef<string>('');
  const currentIndexRef = useRef<number>(0);
  const userAnswersRef = useRef<Record<string, UserAnswer>>({});
  const flaggedMapRef = useRef<Record<string, boolean>>({});
  const timeSpentMapRef = useRef<Record<string, number>>({});
  const backupEntriesRef = useRef<Record<string, LocalAnswerBackupEntry>>({});
  const dirtyQuestionIdsRef = useRef<Set<string>>(new Set());
  const queuedViolationsRef = useRef<QueuedViolationEvent[]>([]);
  const isFlushingViolationsRef = useRef<boolean>(false);
  const debounceTimerRef = useRef<number | null>(null);
  const isFlushingRef = useRef<boolean>(false);
  const isFinalizingSubmitRef = useRef<boolean>(false);

  // Refs cho Bước 4 (chống gian lận & hộp thoại Esc)
  const violationCountRef = useRef<number>(0);
  const maxViolationsRef = useRef<number>(3);
  const showSubmitModalRef = useRef<boolean>(false);
  const submitArmTimerRef = useRef<number | null>(null);
  const blockedNoticeTimerRef = useRef<number | null>(null);
  const awaySessionActiveRef = useRef<boolean>(false);
  const awayStartedAtMsRef = useRef<number | null>(null);
  const lastScreenLeaveTriggerMsRef = useRef<number>(0);
  const baselineViewportRef = useRef<{ width: number; height: number }>({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  });
  const lastResizeViolationMsRef = useRef<number>(0);

  useEffect(() => {
    activePaperRef.current = activePaper;
  }, [activePaper]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    showSubmitModalRef.current = showSubmitModal;
  }, [showSubmitModal]);

  // Thông báo cho StudentPortal để ẩn/hiện Sidebar khi vào/thoát phòng thi
  useEffect(() => {
    const inExamRoom = Boolean(activePaper && !submittedResult);
    onExamPhaseChange?.(inExamRoom);
    return () => {
      onExamPhaseChange?.(false);
    };
  }, [activePaper, submittedResult, onExamPhaseChange]);

  // Tự động focus vào ô nhập mã khi ở màn hình nhập mã
  useEffect(() => {
    if (!verifiedSession && !activePaper && !submittedResult) {
      inputRef.current?.focus();
    }
  }, [verifiedSession, activePaper, submittedResult]);

  // Đếm ngược thời gian chờ khi bị giới hạn nhập sai 5 lần
  useEffect(() => {
    if (rateLimitCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setRateLimitCountdown((prev) => {
        if (prev <= 1) {
          setErrorMsg(null);
          return 0;
        }
        const next = prev - 1;
        setErrorMsg(`Thử lại sau ${next} giây`);
        return next;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [rateLimitCountdown]);

  // Chuyển đổi danh sách câu hỏi đã lọc từ máy chủ sang định dạng hiển thị cho QuestionRenderer
  const renderableQuestions: Question[] = useMemo(() => {
    if (!activePaper) return [];
    return activePaper.questions.map((sq) => toClientRenderableQuestion(sq));
  }, [activePaper]);

  const activeQuestion: Question | null =
    renderableQuestions[currentIndex] ?? renderableQuestions[0] ?? null;

  // Lưu bản sao lưu cục bộ ngay lập tức vào localStorage (bao gồm cả hàng đợi vi phạm khi mất mạng)
  const persistBackupToLocal = useCallback(() => {
    const paper = activePaperRef.current;
    if (!paper) return;
    saveLocalAttemptBackup(currentUser.id, {
      attemptId: paper.attempt.id,
      sessionCode: paper.attempt.sessionCode,
      sessionToken: paper.sessionToken,
      currentIndex: currentIndexRef.current,
      updatedAt: new Date().toISOString(),
      answers: { ...backupEntriesRef.current },
      queuedViolations: [...queuedViolationsRef.current],
    });
  }, [currentUser.id]);

  // Hàm thu thập toàn bộ đáp án hiện tại để đính kèm khi nộp bài hoặc khi vi phạm chạm ngưỡng
  const collectFinalAnswersSnapshot = useCallback(() => {
    const paper = activePaperRef.current;
    if (!paper) return [];
    return paper.questions.map((sq) => ({
      questionId: sq.id,
      selectedAnswer: userAnswersRef.current[sq.id] ?? null,
      flagged: Boolean(flaggedMapRef.current[sq.id]),
      timeSpentSeconds: Math.max(
        0,
        Math.floor(timeSpentMapRef.current[sq.id] ?? 0)
      ),
    }));
  }, []);

  // Hàm nộp bài chính thức (tự nguyện, hết giờ, hoặc tự động thu bài do vượt ngưỡng vi phạm)
  const handleFinalizeSubmit = useCallback(
    async (reason: 'voluntary' | 'timeout' | 'violation') => {
      const paper = activePaperRef.current;
      if (!paper || isFinalizingSubmitRef.current) return;
      isFinalizingSubmitRef.current = true;
      setIsSubmittingExam(true);
      setShowSubmitModal(false);
      setIsSubmitArmed(false);
      setAwayOverlayState(null);
      setFullscreenExitOverlayOpen(false);

      if (submitArmTimerRef.current !== null) {
        window.clearTimeout(submitArmTimerRef.current);
        submitArmTimerRef.current = null;
      }
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }

      try {
        const finalAnswers = collectFinalAnswersSnapshot();
        const response = await examSessionApi.submitAttempt(
          currentUser.id,
          paper.attempt.id,
          paper.sessionToken,
          {
            reason,
            finalAnswers,
          }
        );

        removeLocalAttemptBackup(currentUser.id, paper.attempt.id);
        dirtyQuestionIdsRef.current.clear();
        queuedViolationsRef.current = [];

        exitFullscreenSafely();
        activePaperRef.current = null;
        setSubmittedResult(response.result);
        setActivePaper(null);
        onLiveExamSubmitted?.(response.result);
      } catch {
        // Nếu máy chủ đã tự thu bài trước đó (do vi phạm hoặc hết giờ), lấy kết quả trực tiếp
        try {
          const fallback = await examSessionApi.getResult(
            currentUser.id,
            paper.attempt.id
          );
          removeLocalAttemptBackup(currentUser.id, paper.attempt.id);
          dirtyQuestionIdsRef.current.clear();
          queuedViolationsRef.current = [];
          exitFullscreenSafely();
          activePaperRef.current = null;
          setSubmittedResult(fallback.result);
          setActivePaper(null);
          onLiveExamSubmitted?.(fallback.result);
        } catch {
          isFinalizingSubmitRef.current = false;
        }
      } finally {
        setIsSubmittingExam(false);
      }
    },
    [collectFinalAnswersSnapshot, currentUser.id, onLiveExamSubmitted]
  );

  const finalizeSubmitRef = useRef(handleFinalizeSubmit);
  useEffect(() => {
    finalizeSubmitRef.current = handleFinalizeSubmit;
  }, [handleFinalizeSubmit]);

  // Đồng bộ hàng đợi vi phạm lên máy chủ
  const flushQueuedViolationsToServer = useCallback(async () => {
    const paper = activePaperRef.current;
    if (
      !paper ||
      isFlushingViolationsRef.current ||
      isFinalizingSubmitRef.current
    ) {
      return;
    }
    if (isBrowserSimulatedOrRealOffline()) {
      setIsOffline(true);
      return;
    }
    if (queuedViolationsRef.current.length === 0) {
      return;
    }

    isFlushingViolationsRef.current = true;
    try {
      while (queuedViolationsRef.current.length > 0) {
        if (isBrowserSimulatedOrRealOffline() || isFinalizingSubmitRef.current) {
          break;
        }
        const item = queuedViolationsRef.current[0];
        try {
          const res = await examSessionApi.recordViolation(
            currentUser.id,
            paper.attempt.id,
            paper.sessionToken,
            {
              type: item.type,
              occurredAt: item.occurredAt,
              awaySeconds: item.awaySeconds,
              currentQuestionOrder: item.currentQuestionOrder,
              note: item.note,
              finalAnswers: collectFinalAnswersSnapshot(),
            }
          );

          queuedViolationsRef.current.shift();
          persistBackupToLocal();

          // Đồng bộ số lần vi phạm từ máy chủ
          if (typeof res.violationCount === 'number') {
            violationCountRef.current = Math.max(
              violationCountRef.current,
              res.violationCount
            );
            setViolationCount(violationCountRef.current);
          }
          if (typeof res.maxViolations === 'number') {
            maxViolationsRef.current = res.maxViolations;
            setMaxViolations(res.maxViolations);
          }

          // Nếu máy chủ quyết định tự động nộp bài do chạm ngưỡng vi phạm
          if (res.autoSubmitted || res.status === 'submitted') {
            if (res.result) {
              removeLocalAttemptBackup(currentUser.id, paper.attempt.id);
              dirtyQuestionIdsRef.current.clear();
              queuedViolationsRef.current = [];
              exitFullscreenSafely();
              activePaperRef.current = null;
              setAwayOverlayState(null);
              setFullscreenExitOverlayOpen(false);
              setShowSubmitModal(false);
              setSubmittedResult(res.result);
              setActivePaper(null);
              onLiveExamSubmitted?.(res.result);
              return;
            } else {
              void finalizeSubmitRef.current('violation');
              return;
            }
          }
        } catch {
          setIsOffline(true);
          break;
        }
      }
    } finally {
      isFlushingViolationsRef.current = false;
    }
  }, [
    collectFinalAnswersSnapshot,
    currentUser.id,
    onLiveExamSubmitted,
    persistBackupToLocal,
  ]);

  // Hàm ghi nhận một sự kiện vi phạm (đưa vào hàng đợi & gửi ngay về máy chủ)
  const enqueueAndSendViolationEvent = useCallback(
    (
      type: ViolationEventType,
      options?: { awaySeconds?: number; note?: string }
    ) => {
      const paper = activePaperRef.current;
      if (!paper || isFinalizingSubmitRef.current) return;

      const eventItem: QueuedViolationEvent = {
        clientEventId: `viol_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        type,
        occurredAt: new Date().toISOString(),
        awaySeconds: options?.awaySeconds ?? 0,
        currentQuestionOrder: currentIndexRef.current + 1,
        note: options?.note,
      };

      queuedViolationsRef.current.push(eventItem);
      persistBackupToLocal();
      void flushQueuedViolationsToServer();
    },
    [flushQueuedViolationsToServer, persistBackupToLocal]
  );

  // Hàm hiển thị thông báo ngắn khi học sinh bấm phím bị chặn / chuột phải / sao chép
  const showBlockedActionFeedback = useCallback(
    (label: string) => {
      setBlockedKeyNotice(
        `Đã chặn thao tác (${label}). Mọi hành vi rời bài thi đều được ghi lại.`
      );
      if (blockedNoticeTimerRef.current !== null) {
        window.clearTimeout(blockedNoticeTimerRef.current);
      }
      blockedNoticeTimerRef.current = window.setTimeout(() => {
        blockedNoticeTimerRef.current = null;
        setBlockedKeyNotice(null);
      }, 3000);
      enqueueAndSendViolationEvent('phim_bi_chan', {
        awaySeconds: 0,
        note: label,
      });
    },
    [enqueueAndSendViolationEvent]
  );

  // Hàm xử lý khi phát hiện hành vi rời bài thi (tab_switch / window_blur / fullscreen_exit)
  const triggerScreenLeavingViolation = useCallback(
    (
      type: 'tab_switch' | 'window_blur' | 'fullscreen_exit',
      options?: { awaySeconds?: number; note?: string; showAwayModal?: boolean }
    ) => {
      const paper = activePaperRef.current;
      if (!paper || isFinalizingSubmitRef.current) return;

      const policy = evaluateViolationPolicy(
        violationCountRef.current,
        maxViolationsRef.current,
        type
      );

      violationCountRef.current = policy.nextViolationCount;
      setViolationCount(policy.nextViolationCount);

      enqueueAndSendViolationEvent(type, {
        awaySeconds: options?.awaySeconds ?? 1,
        note: options?.note,
      });

      if (policy.shouldAutoSubmit) {
        void finalizeSubmitRef.current('violation');
        return;
      }

      if (options?.showAwayModal !== false) {
        setAwayOverlayState({
          open: true,
          count: policy.nextViolationCount,
          max: maxViolationsRef.current,
          isLastWarning: policy.isLastWarningBeforeSubmit,
        });
      }
    },
    [enqueueAndSendViolationEvent]
  );

  // Đồng bộ toàn bộ các câu đang đánh dấu dirty lên máy chủ
  const flushDirtyAnswersToServer = useCallback(async () => {
    const paper = activePaperRef.current;
    if (!paper || isFlushingRef.current || isFinalizingSubmitRef.current) {
      return;
    }

    if (isBrowserSimulatedOrRealOffline()) {
      setIsOffline(true);
      return;
    }

    const pendingIds = Array.from(dirtyQuestionIdsRef.current);
    if (pendingIds.length === 0) {
      setIsOffline(false);
      return;
    }

    isFlushingRef.current = true;
    let encounteredNetworkError = false;

    try {
      for (const qId of pendingIds) {
        if (isBrowserSimulatedOrRealOffline()) {
          encounteredNetworkError = true;
          break;
        }

        const snapshotAnswer = userAnswersRef.current[qId] ?? null;
        const snapshotFlagged = Boolean(flaggedMapRef.current[qId]);
        const snapshotTimeSpent = Math.max(
          0,
          Math.floor(timeSpentMapRef.current[qId] ?? 0)
        );

        try {
          await examSessionApi.saveAnswer(
            currentUser.id,
            paper.attempt.id,
            paper.sessionToken,
            {
              questionId: qId,
              selectedAnswer: snapshotAnswer,
              flagged: snapshotFlagged,
              timeSpentSeconds: snapshotTimeSpent,
            }
          );

          const currentVal = userAnswersRef.current[qId] ?? null;
          const currentFlag = Boolean(flaggedMapRef.current[qId]);
          if (
            JSON.stringify(currentVal) === JSON.stringify(snapshotAnswer) &&
            currentFlag === snapshotFlagged
          ) {
            dirtyQuestionIdsRef.current.delete(qId);
            if (backupEntriesRef.current[qId]) {
              backupEntriesRef.current[qId] = {
                ...backupEntriesRef.current[qId],
                dirty: false,
              };
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (
            msg.includes('hết thời gian') ||
            msg.includes('đã kết thúc') ||
            msg.includes('đã nộp')
          ) {
            dirtyQuestionIdsRef.current.clear();
            break;
          }
          encounteredNetworkError = true;
          break;
        }
      }
    } finally {
      isFlushingRef.current = false;
      persistBackupToLocal();
      setIsOffline(encounteredNetworkError || isBrowserSimulatedOrRealOffline());
    }
  }, [currentUser.id, persistBackupToLocal]);

  // Lên lịch tự lưu có debounce ngắn (250ms) mỗi khi chọn đáp án hoặc gắn cờ
  const scheduleDebouncedSave = useCallback(
    (questionId: string) => {
      dirtyQuestionIdsRef.current.add(questionId);
      persistBackupToLocal();

      if (isBrowserSimulatedOrRealOffline()) {
        setIsOffline(true);
        return;
      }

      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        void flushDirtyAnswersToServer();
      }, 250);
    },
    [flushDirtyAnswersToServer, persistBackupToLocal]
  );

  // Đồng hồ đếm ngược theo hạn nộp máy chủ + ghi thời gian làm mỗi câu (mỗi 1 giây)
  // Lưu ý: Đồng hồ vẫn chạy ngay cả khi đang mở hộp thoại Esc hoặc lớp phủ cảnh báo rời màn hình
  useEffect(() => {
    if (!activePaper || submittedResult) return;

    const timer = window.setInterval(() => {
      const currentQ = activePaper.questions[currentIndexRef.current];
      if (currentQ) {
        const qId = currentQ.id;
        const nextSpent = (timeSpentMapRef.current[qId] ?? 0) + 1;
        timeSpentMapRef.current[qId] = nextSpent;
        const existingEntry = backupEntriesRef.current[qId];
        backupEntriesRef.current[qId] = {
          selectedAnswer: userAnswersRef.current[qId] ?? null,
          flagged: Boolean(flaggedMapRef.current[qId]),
          timeSpentSeconds: nextSpent,
          dirty: existingEntry?.dirty ?? false,
          updatedAtMs: existingEntry?.updatedAtMs ?? Date.now(),
        };
      }

      const nextRemaining = computeServerRemainingSeconds(
        deadlineIsoRef.current,
        serverOffsetMsRef.current,
        Date.now()
      );
      setRemainingSeconds(nextRemaining);

      if (nextRemaining <= 0) {
        window.clearInterval(timer);
        void finalizeSubmitRef.current('timeout');
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [activePaper, submittedResult]);

  // Lắng nghe sự kiện mạng Online / Offline và tự động đồng bộ đáp án + hàng đợi vi phạm khi có mạng lại
  useEffect(() => {
    if (!activePaper || submittedResult) return;

    const handleOnline = () => {
      if (!isBrowserSimulatedOrRealOffline()) {
        setIsOffline(false);
        void flushDirtyAnswersToServer();
        void flushQueuedViolationsToServer();
      }
    };

    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    const retryInterval = window.setInterval(() => {
      const currentlyOffline = isBrowserSimulatedOrRealOffline();
      if (currentlyOffline) {
        setIsOffline(true);
      } else {
        if (dirtyQuestionIdsRef.current.size > 0 || isOffline) {
          void flushDirtyAnswersToServer();
        }
        if (queuedViolationsRef.current.length > 0) {
          void flushQueuedViolationsToServer();
        }
      }
    }, 1500);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.clearInterval(retryInterval);
    };
  }, [
    activePaper,
    submittedResult,
    isOffline,
    flushDirtyAnswersToServer,
    flushQueuedViolationsToServer,
  ]);

  // Đồng bộ định kỳ với máy chủ (mỗi 15 giây) để cập nhật hạn nộp và trạng thái bài thi
  useEffect(() => {
    if (!activePaper || submittedResult) return;

    const syncServerClockAndDeadline = async () => {
      if (isBrowserSimulatedOrRealOffline()) return;
      try {
        const freshPaper = await examSessionApi.getAttemptPaper(
          currentUser.id,
          activePaper.attempt.id,
          activePaper.sessionToken
        );

        if (freshPaper.attempt.status === 'submitted') {
          const res = await examSessionApi.getResult(
            currentUser.id,
            activePaper.attempt.id
          );
          removeLocalAttemptBackup(currentUser.id, activePaper.attempt.id);
          exitFullscreenSafely();
          activePaperRef.current = null;
          setSubmittedResult(res.result);
          setActivePaper(null);
          onLiveExamSubmitted?.(res.result);
          return;
        }

        const nextOffset = computeServerClockOffsetMs(
          freshPaper.attempt.serverNow,
          Date.now()
        );
        serverOffsetMsRef.current = nextOffset;
        deadlineIsoRef.current = freshPaper.attempt.deadlineAt;
        setRemainingSeconds(
          computeServerRemainingSeconds(
            freshPaper.attempt.deadlineAt,
            nextOffset,
            Date.now()
          )
        );
      } catch {
        // Bỏ qua nếu mạng chập chờn tạm thời
      }
    };

    const interval = window.setInterval(syncServerClockAndDeadline, 15000);
    return () => window.clearInterval(interval);
  }, [activePaper, submittedResult, currentUser.id, onLiveExamSubmitted]);

  // Lưu tức thời trước khi đóng/tải lại trang (beforeunload)
  useEffect(() => {
    if (!activePaper || submittedResult) return;

    const handleBeforeUnload = () => {
      persistBackupToLocal();
      if (isBrowserSimulatedOrRealOffline()) return;

      const pendingIds = Array.from(dirtyQuestionIdsRef.current);
      for (const qId of pendingIds) {
        const payload = {
          questionId: qId,
          selectedAnswer: userAnswersRef.current[qId] ?? null,
          flagged: Boolean(flaggedMapRef.current[qId]),
          timeSpentSeconds: Math.max(
            0,
            Math.floor(timeSpentMapRef.current[qId] ?? 0)
          ),
        };
        try {
          void fetch(
            `/api/attempts/${encodeURIComponent(activePaper.attempt.id)}/answers`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-user-id': currentUser.id,
                'x-exam-session-token': activePaper.sessionToken,
              },
              body: JSON.stringify(payload),
              keepalive: true,
            }
          );
        } catch {
          // Đã lưu trong localStorage
        }
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [activePaper, submittedResult, currentUser.id, persistBackupToLocal]);

  // Hàm đóng/mở hộp thoại Esc ("Nộp bài và thoát?")
  const openSubmitDialog = useCallback(() => {
    if (submitArmTimerRef.current !== null) {
      window.clearTimeout(submitArmTimerRef.current);
      submitArmTimerRef.current = null;
    }
    setIsSubmitArmed(false);
    setShowSubmitModal(true);
  }, []);

  const closeSubmitDialog = useCallback(() => {
    if (submitArmTimerRef.current !== null) {
      window.clearTimeout(submitArmTimerRef.current);
      submitArmTimerRef.current = null;
    }
    setIsSubmitArmed(false);
    setShowSubmitModal(false);
  }, []);

  // Nút "Nộp bài" trong hộp thoại cần xác nhận 2 bước (đổi thành "Xác nhận nộp bài" trong 3 giây)
  const handleDialogSubmitButtonClick = useCallback(() => {
    if (isSubmittingExam) return;
    if (!isSubmitArmed) {
      setIsSubmitArmed(true);
      if (submitArmTimerRef.current !== null) {
        window.clearTimeout(submitArmTimerRef.current);
      }
      submitArmTimerRef.current = window.setTimeout(() => {
        submitArmTimerRef.current = null;
        setIsSubmitArmed(false);
      }, 3000);
      return;
    }

    if (submitArmTimerRef.current !== null) {
      window.clearTimeout(submitArmTimerRef.current);
      submitArmTimerRef.current = null;
    }
    void handleFinalizeSubmit('voluntary');
  }, [handleFinalizeSubmit, isSubmitArmed, isSubmittingExam]);

  // Khi mở hộp thoại Esc ("Nộp bài và thoát?"), mặc định focus vào nút "Tiếp tục làm bài"
  useEffect(() => {
    if (showSubmitModal) {
      const id = window.setTimeout(() => {
        cancelSubmitBtnRef.current?.focus();
      }, 10);
      return () => window.clearTimeout(id);
    }
  }, [showSubmitModal]);

  // Khi mở lớp phủ cảnh báo rời màn hình, focus vào nút "Tiếp tục làm bài"
  useEffect(() => {
    if (awayOverlayState?.open) {
      const id = window.setTimeout(() => {
        resumeAwayBtnRef.current?.focus();
      }, 10);
      return () => window.clearTimeout(id);
    }
  }, [awayOverlayState?.open]);

  // Khi mở lớp phủ thoát toàn màn hình, focus vào nút "Quay lại toàn màn hình"
  useEffect(() => {
    if (fullscreenExitOverlayOpen) {
      const id = window.setTimeout(() => {
        returnFullscreenBtnRef.current?.focus();
      }, 10);
      return () => window.clearTimeout(id);
    }
  }, [fullscreenExitOverlayOpen]);

  // Phím tắt chuyển câu (ArrowLeft / ArrowRight)
  const handleSelectQuestionIndex = useCallback(
    (nextIndex: number) => {
      const paper = activePaperRef.current;
      if (!paper) return;
      const bounded = Math.max(
        0,
        Math.min(paper.questions.length - 1, nextIndex)
      );
      const prevQ = paper.questions[currentIndexRef.current];
      if (
        prevQ &&
        (userAnswersRef.current[prevQ.id] !== undefined ||
          flaggedMapRef.current[prevQ.id])
      ) {
        scheduleDebouncedSave(prevQ.id);
      }
      currentIndexRef.current = bounded;
      setCurrentIndex(bounded);
      persistBackupToLocal();
    },
    [persistBackupToLocal, scheduleDebouncedSave]
  );

  // ==========================================================================
  // BƯỚC 4/8 - PHẦN A & B & C: CHỐNG GIAN LẬN (CHỈ BẬT TRONG PHÒNG THI, GỠ SẠCH SAU KHI NỘP)
  // ==========================================================================
  useEffect(() => {
    const inExamRoom = Boolean(activePaper && !submittedResult);
    if (!inExamRoom) return;

    // 1. Kiểm tra nhiều màn hình (window.screen.isExtended) ngay khi vào phòng thi
    try {
      const scr = window.screen as unknown as { isExtended?: boolean };
      if (scr && scr.isExtended === true) {
        setEnvironmentWarning(
          'Phát hiện thiết bị đang kết nối nhiều màn hình. Mọi hành vi rời bài thi đều được ghi lại.'
        );
        enqueueAndSendViolationEvent('multi_screen', {
          awaySeconds: 0,
          note: 'window.screen.isExtended = true',
        });
      }
    } catch {
      // Bỏ qua
    }

    // 2. Chặn chuột phải (contextmenu)
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      showBlockedActionFeedback('Chuột phải');
    };

    // 3. Chặn sao chép, cắt, dán (copy, cut, paste)
    const handleCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      showBlockedActionFeedback('Sao chép');
    };
    const handleCut = (e: ClipboardEvent) => {
      e.preventDefault();
      showBlockedActionFeedback('Cắt');
    };
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      showBlockedActionFeedback('Dán');
    };

    // 4. Chặn kéo thả văn bản/hình ảnh ngoài vùng câu hỏi ghép nối/sắp xếp
    const handleDragStart = (e: DragEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && target.closest('[draggable="true"]')) {
        return;
      }
      e.preventDefault();
      showBlockedActionFeedback('Kéo thả');
    };

    // 5. Lắng nghe bàn phím: Chặn F12, Ctrl+Shift+I/J/C, Ctrl+P/S/U/C/X/V, xử lý phím Esc & bẫy focus hộp thoại
    const handleKeyDownCapture = (e: KeyboardEvent) => {
      // Bẫy focus bằng Tab / Shift+Tab khi hộp thoại Esc đang mở
      if (showSubmitModalRef.current && e.key === 'Tab') {
        const cancelEl = cancelSubmitBtnRef.current;
        const confirmEl = confirmSubmitBtnRef.current;
        if (cancelEl && confirmEl) {
          e.preventDefault();
          if (document.activeElement === cancelEl) {
            confirmEl.focus();
          } else {
            cancelEl.focus();
          }
          return;
        }
      }

      const shortcutCheck = detectBlockedKeyShortcut({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
      });

      // Bắt phím Esc: không thoát toàn màn hình mà mở/đóng hộp thoại "Nộp bài và thoát?"
      if (shortcutCheck.isEscape) {
        e.preventDefault();
        e.stopPropagation();
        if (showSubmitModalRef.current) {
          closeSubmitDialog();
        } else {
          openSubmitDialog();
        }
        return;
      }

      // Chặn các tổ hợp phím bị cấm (ghi nhận loại 'phim_bi_chan', không tính vào ngưỡng tự nộp)
      if (shortcutCheck.blocked) {
        e.preventDefault();
        e.stopPropagation();
        showBlockedActionFeedback(shortcutCheck.label || e.key);
        return;
      }

      // Phím tắt chuyển câu ArrowLeft / ArrowRight khi không mở hộp thoại
      if (!showSubmitModalRef.current) {
        const target = e.target as HTMLElement | null;
        if (
          target &&
          (target.tagName === 'INPUT' ||
            target.tagName === 'TEXTAREA' ||
            target.tagName === 'SELECT')
        ) {
          return;
        }
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          handleSelectQuestionIndex(currentIndexRef.current - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          handleSelectQuestionIndex(currentIndexRef.current + 1);
        }
      }
    };

    // 6. Phát hiện đổi tab, Alt+Tab, chuyển cửa sổ (visibilitychange & window blur)
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const now = Date.now();
        if (
          !awaySessionActiveRef.current &&
          now - lastScreenLeaveTriggerMsRef.current > 400
        ) {
          awaySessionActiveRef.current = true;
          awayStartedAtMsRef.current = now;
          lastScreenLeaveTriggerMsRef.current = now;
          triggerScreenLeavingViolation('tab_switch', {
            awaySeconds: 1,
            note: 'Chuyển tab hoặc ẩn trình duyệt (visibilitychange)',
            showAwayModal: true,
          });
        }
      } else if (document.visibilityState === 'visible') {
        awaySessionActiveRef.current = false;
      }
    };

    const handleWindowBlur = () => {
      const now = Date.now();
      if (
        !awaySessionActiveRef.current &&
        now - lastScreenLeaveTriggerMsRef.current > 400
      ) {
        awaySessionActiveRef.current = true;
        awayStartedAtMsRef.current = now;
        lastScreenLeaveTriggerMsRef.current = now;
        triggerScreenLeavingViolation('window_blur', {
          awaySeconds: 1,
          note: 'Rời cửa sổ làm bài (Alt+Tab / window blur)',
          showAwayModal: true,
        });
      }
    };

    const handleWindowFocus = () => {
      awaySessionActiveRef.current = false;
    };

    // 7. Phát hiện thoát toàn màn hình (F11, giữ Esc, cử chỉ hệ thống - fullscreenchange)
    const handleFullscreenChange = () => {
      const doc = document as unknown as {
        fullscreenElement?: Element | null;
        webkitFullscreenElement?: Element | null;
      };
      const isCurrentlyFullscreen = Boolean(
        doc.fullscreenElement || doc.webkitFullscreenElement
      );

      if (!isCurrentlyFullscreen && !isFinalizingSubmitRef.current) {
        unlockKeyboardSafely();
        setFullscreenExitOverlayOpen(true);

        const now = Date.now();
        if (now - lastScreenLeaveTriggerMsRef.current > 300) {
          lastScreenLeaveTriggerMsRef.current = now;
          triggerScreenLeavingViolation('fullscreen_exit', {
            awaySeconds: 1,
            note: 'Thoát chế độ toàn màn hình (fullscreenchange)',
            showAwayModal: false,
          });
        }
      } else if (isCurrentlyFullscreen) {
        setFullscreenExitOverlayOpen(false);
        lockEscapeKeyboardSafely();
      }
    };

    // 8. Phát hiện thay đổi kích thước cửa sổ bất thường (nghi chia đôi màn hình) + màn hình phụ mới cắm
    const handleWindowResize = () => {
      const now = Date.now();
      const base = baselineViewportRef.current;
      const curW = window.innerWidth;
      const curH = window.innerHeight;

      if (
        isSuspiciousSplitScreenResize(base.width, base.height, curW, curH) &&
        now - lastResizeViolationMsRef.current > 3000
      ) {
        lastResizeViolationMsRef.current = now;
        setEnvironmentWarning(
          'Phát hiện kích thước cửa sổ thu nhỏ bất thường (nghi chia đôi màn hình). Mọi hành vi rời bài thi đều được ghi lại.'
        );
        enqueueAndSendViolationEvent('window_resize', {
          awaySeconds: 0,
          note: `Thu nhỏ cửa sổ từ ${base.width}x${base.height} xuống ${curW}x${curH}`,
        });
      }

      try {
        const scr = window.screen as unknown as { isExtended?: boolean };
        if (
          scr &&
          scr.isExtended === true &&
          now - lastResizeViolationMsRef.current > 5000
        ) {
          lastResizeViolationMsRef.current = now;
          setEnvironmentWarning(
            'Phát hiện thiết bị đang kết nối nhiều màn hình. Mọi hành vi rời bài thi đều được ghi lại.'
          );
          enqueueAndSendViolationEvent('multi_screen', {
            awaySeconds: 0,
            note: 'window.screen.isExtended = true',
          });
        }
      } catch {
        // Bỏ qua
      }
    };

    document.addEventListener('contextmenu', handleContextMenu, true);
    document.addEventListener('copy', handleCopy, true);
    document.addEventListener('cut', handleCut, true);
    document.addEventListener('paste', handlePaste, true);
    document.addEventListener('dragstart', handleDragStart, true);
    window.addEventListener('keydown', handleKeyDownCapture, true);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener(
      'webkitfullscreenchange',
      handleFullscreenChange as EventListener
    );
    window.addEventListener('resize', handleWindowResize);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu, true);
      document.removeEventListener('copy', handleCopy, true);
      document.removeEventListener('cut', handleCut, true);
      document.removeEventListener('paste', handlePaste, true);
      document.removeEventListener('dragstart', handleDragStart, true);
      window.removeEventListener('keydown', handleKeyDownCapture, true);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener(
        'webkitfullscreenchange',
        handleFullscreenChange as EventListener
      );
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [
    activePaper,
    submittedResult,
    closeSubmitDialog,
    enqueueAndSendViolationEvent,
    handleSelectQuestionIndex,
    openSubmitDialog,
    showBlockedActionFeedback,
    triggerScreenLeavingViolation,
  ]);

  // Xử lý thay đổi đáp án từng câu
  const handleAnswerChange = useCallback(
    (questionId: string, nextAnswer: UserAnswer) => {
      userAnswersRef.current = {
        ...userAnswersRef.current,
        [questionId]: nextAnswer,
      };
      setUserAnswers({ ...userAnswersRef.current });

      const spent = timeSpentMapRef.current[questionId] ?? 0;
      backupEntriesRef.current[questionId] = {
        selectedAnswer: nextAnswer,
        flagged: Boolean(flaggedMapRef.current[questionId]),
        timeSpentSeconds: spent,
        dirty: true,
        updatedAtMs: Date.now(),
      };

      scheduleDebouncedSave(questionId);
    },
    [scheduleDebouncedSave]
  );

  // Xử lý gắn cờ / bỏ cờ câu hỏi
  const handleToggleFlag = useCallback(
    (questionId: string) => {
      const nextFlagged = !flaggedMapRef.current[questionId];
      flaggedMapRef.current = {
        ...flaggedMapRef.current,
        [questionId]: nextFlagged,
      };
      setFlaggedMap({ ...flaggedMapRef.current });

      const spent = timeSpentMapRef.current[questionId] ?? 0;
      backupEntriesRef.current[questionId] = {
        selectedAnswer: userAnswersRef.current[questionId] ?? null,
        flagged: nextFlagged,
        timeSpentSeconds: spent,
        dirty: true,
        updatedAtMs: Date.now(),
      };

      scheduleDebouncedSave(questionId);
    },
    [scheduleDebouncedSave]
  );

  // Thống kê số câu đã làm / chưa làm / gắn cờ trên lưới câu hỏi
  const questionGridStats = useMemo(() => {
    let answeredCount = 0;
    let flaggedCount = 0;
    renderableQuestions.forEach((q) => {
      if (isQuestionAnswered(q, userAnswers[q.id])) {
        answeredCount += 1;
      }
      if (flaggedMap[q.id]) {
        flaggedCount += 1;
      }
    });
    const unansweredCount = Math.max(
      0,
      renderableQuestions.length - answeredCount
    );
    return { answeredCount, unansweredCount, flaggedCount };
  }, [renderableQuestions, userAnswers, flaggedMap]);

  // ---- Xử lý màn hình nhập mã & xác nhận ----
  const handleCodeChange = (raw: string) => {
    const cleaned = sanitizeLiveExamCodeInput(raw);
    setCode(cleaned);
    if (rateLimitCountdown <= 0 && errorMsg) {
      setErrorMsg(null);
    }
  };

  const handlePasteCode = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text');
    handleCodeChange(pasted);
  };

  const handleVerifySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (rateLimitCountdown > 0) {
      setErrorMsg(`Thử lại sau ${rateLimitCountdown} giây`);
      return;
    }

    const cleanedCode = sanitizeLiveExamCodeInput(code);
    if (!cleanedCode) {
      inputRef.current?.focus();
      return;
    }

    setIsVerifying(true);
    try {
      const result = await examSessionApi.verifyCode(
        currentUser.id,
        cleanedCode,
        {
          id: currentUser.id,
          username: currentUser.username,
          fullName: currentUser.fullName,
          className: currentUser.className,
        }
      );

      if (!result.valid || !result.session) {
        if (result.reason === 'rate_limited') {
          const waitSecs = Math.max(1, Number(result.retryAfterSeconds) || 60);
          setRateLimitCountdown(waitSecs);
          setErrorMsg(`Thử lại sau ${waitSecs} giây`);
        } else {
          setErrorMsg(
            formatVerifyCodeErrorMessage(
              result.reason,
              result.retryAfterSeconds
            )
          );
        }
        inputRef.current?.focus();
        return;
      }

      setErrorMsg(null);
      setHasAcceptedRules(false);
      setVerifiedSession(result.session);
    } catch {
      setErrorMsg('Mã không tồn tại');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleStartOrResumeExam = async () => {
    if (
      !verifiedSession ||
      !hasAcceptedRules ||
      !browserCaps.fullscreenSupported
    ) {
      return;
    }

    setIsStarting(true);
    setErrorMsg(null);
    isFinalizingSubmitRef.current = false;

    try {
      // Toàn màn hình + khóa phím Esc kích hoạt trực tiếp từ thao tác bấm của người dùng
      requestFullscreenAndLockEscSafely();
      baselineViewportRef.current = {
        width: typeof window !== 'undefined' ? window.innerWidth : 1280,
        height: typeof window !== 'undefined' ? window.innerHeight : 800,
      };

      const deviceId = getOrCreateStudentDeviceId();
      const paper = await examSessionApi.startExam(
        currentUser.id,
        verifiedSession.code,
        deviceId,
        {
          studentProfile: {
            id: currentUser.id,
            username: currentUser.username,
            fullName: currentUser.fullName,
            className: currentUser.className,
          },
          keyboardLockSupported: browserCaps.keyboardLockSupported,
          browserNote: browserCaps.browserNote,
        }
      );

      const localBackup = loadLocalAttemptBackup(
        currentUser.id,
        paper.attempt.id
      );
      const merged = mergeServerAndLocalAnswers(
        paper.savedAnswers,
        localBackup?.answers
      );

      activePaperRef.current = paper;
      userAnswersRef.current = merged.answersMap;
      flaggedMapRef.current = merged.flaggedMap;
      timeSpentMapRef.current = merged.timeSpentMap;
      backupEntriesRef.current = merged.mergedBackupEntries;
      dirtyQuestionIdsRef.current = new Set(merged.dirtyQuestionIds);
      queuedViolationsRef.current = Array.isArray(localBackup?.queuedViolations)
        ? [...localBackup.queuedViolations]
        : [];

      const initialViolations = paper.attempt.violationCount ?? 0;
      const initialMaxViolations = paper.attempt.maxViolations ?? 3;
      violationCountRef.current = initialViolations;
      maxViolationsRef.current = initialMaxViolations;
      setViolationCount(initialViolations);
      setMaxViolations(initialMaxViolations);
      setAwayOverlayState(null);
      setFullscreenExitOverlayOpen(false);
      setBlockedKeyNotice(null);
      setEnvironmentWarning(null);
      awaySessionActiveRef.current = false;
      awayStartedAtMsRef.current = null;
      lastScreenLeaveTriggerMsRef.current = 0;

      const offsetMs = computeServerClockOffsetMs(
        paper.attempt.serverNow,
        Date.now()
      );
      serverOffsetMsRef.current = offsetMs;
      deadlineIsoRef.current = paper.attempt.deadlineAt;

      const initialRemaining = computeServerRemainingSeconds(
        paper.attempt.deadlineAt,
        offsetMs,
        Date.now()
      );
      const resumeIndex =
        localBackup &&
        typeof localBackup.currentIndex === 'number' &&
        localBackup.currentIndex >= 0 &&
        localBackup.currentIndex < paper.questions.length
          ? localBackup.currentIndex
          : 0;

      currentIndexRef.current = resumeIndex;
      setUserAnswers(merged.answersMap);
      setFlaggedMap(merged.flaggedMap);
      setCurrentIndex(resumeIndex);
      setRemainingSeconds(initialRemaining);
      setSubmittedResult(null);
      setShowSubmitModal(false);
      setIsSubmitArmed(false);
      setIsOffline(isBrowserSimulatedOrRealOffline());
      setActivePaper(paper);

      // Nếu khi vào lại (ví dụ từ thiết bị khác) số lần vi phạm đã chạm ngưỡng thì nộp tự động ngay
      if (initialViolations >= initialMaxViolations) {
        window.setTimeout(() => {
          void finalizeSubmitRef.current('violation');
        }, 50);
        return;
      }

      if (
        merged.dirtyQuestionIds.length > 0 ||
        queuedViolationsRef.current.length > 0
      ) {
        window.setTimeout(() => {
          void flushDirtyAnswersToServer();
          void flushQueuedViolationsToServer();
        }, 50);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Ca thi đã khóa';
      setErrorMsg(msg);
    } finally {
      setIsStarting(false);
    }
  };

  // Xử lý khi học sinh bấm "Tiếp tục làm bài" trên lớp phủ cảnh báo rời màn hình
  const handleDismissAwayOverlay = useCallback(() => {
    awaySessionActiveRef.current = false;
    awayStartedAtMsRef.current = null;
    setAwayOverlayState(null);
  }, []);

  // Xử lý khi học sinh bấm "Quay lại toàn màn hình" trên lớp phủ thoát toàn màn hình
  const handleReturnToFullscreen = useCallback(() => {
    requestFullscreenAndLockEscSafely();
    setFullscreenExitOverlayOpen(false);
  }, []);

  // ==========================================================================
  // TRẠNG THÁI 4: MÀN HÌNH SAU KHI NỘP BÀI (THEO CẤU HÌNH CỦA GIÁO VIÊN)
  // ==========================================================================
  if (submittedResult) {
    const isVisibilityNone = submittedResult.resultVisibility === 'none';
    const isScoreAndAnswers =
      submittedResult.resultVisibility === 'score_and_answers';
    const passScore = submittedResult.passScore ?? CERTIPORT_PASS_SCORE;
    const isPassed = Boolean(submittedResult.passed);

    return (
      <div
        data-testid="live-exam-submitted-screen"
        className="max-w-[780px] mx-auto py-6 sm:py-10 space-y-6"
      >
        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          <header className="space-y-2 border-b border-[var(--color-border-subtle)] pb-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center gap-2 text-teal-700 font-semibold text-[15px]">
                <CheckCircle2 className="w-5 h-5 shrink-0" />
                <span data-testid="live-exam-submitted-heading">Đã nộp bài</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {submittedResult.submitReason === 'violation' && (
                  <span
                    data-testid="live-exam-violation-submit-badge"
                    className="px-3 py-1 rounded-full bg-red-50 border border-red-200 text-red-700 text-xs font-bold inline-flex items-center gap-1.5"
                  >
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                    <span>Nộp tự động do vi phạm</span>
                  </span>
                )}
                {submittedResult.submitReason === 'timeout' && (
                  <span
                    data-testid="live-exam-timeout-badge"
                    className="px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold"
                  >
                    Hết giờ — Tự động nộp bài
                  </span>
                )}
              </div>
            </div>

            <h1 className="text-2xl sm:text-[28px] font-bold text-[var(--color-text-primary)] tracking-tight">
              {submittedResult.sessionTitle}
            </h1>
          </header>

          {/* Chế độ 1: Không hiển thị kết quả (chỉ hiện thông báo chờ công bố) */}
          {isVisibilityNone ? (
            <div
              data-testid="live-exam-visibility-none-msg"
              className="py-6 px-4 rounded-xl bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)] text-center text-[16px] font-medium text-[var(--color-text-primary)]"
            >
              Đã nộp bài, thầy cô sẽ công bố kết quả
            </div>
          ) : (
            /* Chế độ 2 & 3: Hiển thị điểm /1000 kèm Đạt hoặc Chưa đạt */
            <div className="space-y-6">
              <div className="p-5 sm:p-6 rounded-xl bg-[var(--color-bg-subtle)] border border-[var(--color-border-subtle)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-sm text-[var(--color-text-secondary)]">
                    Điểm bài thi (chuẩn đạt {passScore}/1000)
                  </div>
                  <div
                    data-testid="live-exam-result-score"
                    className="text-3xl sm:text-4xl font-bold font-mono text-[var(--color-text-primary)] tabular-nums"
                  >
                    {submittedResult.score ?? 0} / 1000
                  </div>
                  <div className="text-[15px] text-[var(--color-text-secondary)] tabular-nums">
                    Đúng {submittedResult.correctCount ?? 0} /{' '}
                    {submittedResult.totalQuestions ?? 0} câu (
                    {submittedResult.percentage ?? 0}%) · Thời gian làm{' '}
                    {formatDurationText(submittedResult.durationSeconds)}
                  </div>
                </div>

                <div>
                  <span
                    data-testid="live-exam-result-status"
                    className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-[15px] font-bold ${
                      isPassed
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-rose-100 text-rose-800 border border-rose-300'
                    }`}
                  >
                    {isPassed ? (
                      <>
                        <Award className="w-5 h-5 shrink-0" />
                        <span>Đạt</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-5 h-5 shrink-0" />
                        <span>Chưa đạt</span>
                      </>
                    )}
                  </span>
                </div>
              </div>

              {/* Chế độ 3: Hiển thị điểm kèm đáp án chi tiết từng câu */}
              {isScoreAndAnswers &&
                submittedResult.questionsWithAnswers &&
                submittedResult.questionsWithAnswers.length > 0 && (
                  <div
                    data-testid="live-exam-result-answers-list"
                    className="space-y-4 pt-2 border-t border-[var(--color-border-subtle)]"
                  >
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                      Chi tiết đáp án ({submittedResult.questionsWithAnswers.length}{' '}
                      câu)
                    </h2>

                    <div className="space-y-3">
                      {submittedResult.questionsWithAnswers.map((qItem) => (
                        <div
                          key={qItem.questionId}
                          data-testid={`live-exam-result-question-${qItem.orderNumber}`}
                          className={`p-4 rounded-xl border space-y-2.5 ${
                            qItem.isCorrect
                              ? 'border-emerald-200 bg-emerald-50/30'
                              : 'border-rose-200 bg-rose-50/30'
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                            <span className="font-bold text-[var(--color-text-primary)]">
                              Câu {qItem.orderNumber} · {qItem.topic}
                            </span>
                            <span
                              className={`px-2.5 py-0.5 rounded-md text-xs font-bold ${
                                qItem.isCorrect
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-rose-600 text-white'
                              }`}
                            >
                              {qItem.isCorrect ? 'Đúng' : 'Sai'}
                            </span>
                          </div>

                          <p className="text-[15px] font-medium text-[var(--color-text-primary)]">
                            {qItem.prompt}
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm pt-1">
                            <div className="p-3 rounded-lg bg-white border border-slate-200">
                              <div className="text-xs font-semibold text-slate-500 mb-1">
                                Câu trả lời đã chọn
                              </div>
                              <div className="font-medium text-slate-900 break-words">
                                {qItem.userAnswerDisplay ||
                                  (qItem.userAnswer === null ||
                                  qItem.userAnswer === undefined ||
                                  qItem.userAnswer === ''
                                    ? 'Chưa trả lời'
                                    : typeof qItem.userAnswer === 'string'
                                      ? qItem.userAnswer
                                      : Array.isArray(qItem.userAnswer)
                                        ? qItem.userAnswer.join(', ')
                                        : Object.entries(qItem.userAnswer)
                                            .map(([k, v]) => `${k}: ${v}`)
                                            .join(' | '))}
                              </div>
                            </div>

                            <div className="p-3 rounded-lg bg-white border border-emerald-200">
                              <div className="text-xs font-semibold text-emerald-700 mb-1">
                                Đáp án đúng
                              </div>
                              <div className="font-semibold text-emerald-900 break-words">
                                {qItem.correctAnswerDisplay ||
                                  (typeof qItem.correctAnswer === 'string'
                                    ? qItem.correctAnswer
                                    : Array.isArray(qItem.correctAnswer)
                                      ? qItem.correctAnswer.join(', ')
                                      : Object.entries(qItem.correctAnswer || {})
                                          .map(([k, v]) => `${k}: ${v}`)
                                          .join(' | '))}
                              </div>
                            </div>
                          </div>

                          {qItem.explanation && (
                            <p className="text-xs sm:text-sm text-slate-600 pt-1">
                              <strong>Giải thích:</strong> {qItem.explanation}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
            </div>
          )}

          <div className="pt-4 border-t border-[var(--color-border-subtle)] flex flex-wrap items-center justify-between gap-4">
            {onOpenHistoryTab && (
              <button
                type="button"
                data-testid="live-exam-go-history-btn"
                onClick={onOpenHistoryTab}
                className="h-11 px-5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[15px] font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer"
              >
                <History className="w-4 h-4" />
                <span>Xem lịch sử phòng thi</span>
              </button>
            )}

            <button
              type="button"
              data-testid="live-exam-reset-btn"
              onClick={() => {
                setSubmittedResult(null);
                setActivePaper(null);
                setVerifiedSession(null);
                setCode('');
                setHasAcceptedRules(false);
                setErrorMsg(null);
              }}
              className="text-[15px] font-medium text-teal-700 hover:underline cursor-pointer"
            >
              Quay lại màn hình nhập mã
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // TRẠNG THÁI 3: PHÒNG THI ĐANG LÀM BÀI (TỐI GIẢN, TOÀN MÀN HÌNH, ẨN SIDEBAR, CHỐNG GIAN LẬN)
  // ==========================================================================
  if (activePaper) {
    const isUnderFiveMinutes =
      remainingSeconds <= MOCK_EXAM_WARNING_THRESHOLD_SECONDS;
    const isLastWarningCount =
      maxViolations > 1 && violationCount === maxViolations - 1;

    return (
      <div
        data-testid="live-exam-room"
        data-reentry-count={activePaper.attempt.reentryCount}
        data-violation-count={violationCount}
        data-max-violations={maxViolations}
        className="max-w-7xl mx-auto space-y-3 pb-8 select-none"
      >
        {/* Thanh trên: tên ca thi, đồng hồ đếm ngược (đỏ khi còn dưới 5 phút), nút "Nộp bài" */}
        <header
          data-testid="live-exam-top-bar"
          className="sticky top-1.5 z-20 rounded-xl bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] px-4 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <h1
              data-testid="live-exam-room-title"
              className="text-base sm:text-lg font-bold text-[var(--color-text-primary)] truncate"
            >
              {activePaper.attempt.sessionTitle}
            </h1>
            <span className="text-sm font-medium text-[var(--color-text-secondary)] tabular-nums">
              Câu {currentIndex + 1}/{renderableQuestions.length}
            </span>
            {activePaper.attempt.reentryCount > 0 && (
              <span
                data-testid="live-exam-reentry-badge"
                className="text-xs font-medium text-[var(--color-text-muted)] tabular-nums"
              >
                Vào lại: {activePaper.attempt.reentryCount}
              </span>
            )}
            {violationCount > 0 && (
              <span
                data-testid="live-exam-violation-counter"
                data-last-warning={isLastWarningCount ? 'true' : 'false'}
                className={`text-xs font-semibold px-2.5 py-0.5 rounded-full tabular-nums ${
                  isLastWarningCount
                    ? 'bg-red-100 text-red-700 border border-red-300'
                    : 'bg-amber-50 text-amber-800 border border-amber-200'
                }`}
              >
                Rời bài thi: {violationCount}/{maxViolations}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div
              data-testid="live-exam-countdown"
              data-under-five-minutes={isUnderFiveMinutes ? 'true' : 'false'}
              className={`h-10 px-3.5 rounded-lg font-mono text-sm sm:text-base font-bold tabular-nums inline-flex items-center gap-2 transition-colors ${
                isUnderFiveMinutes
                  ? 'bg-red-600 text-white ring-2 ring-red-200'
                  : 'bg-slate-900 text-white dark:bg-slate-800'
              }`}
            >
              <Clock className="w-4 h-4 shrink-0" />
              <span>{formatCountdownClock(remainingSeconds)}</span>
            </div>

            <button
              type="button"
              data-testid="live-exam-submit-btn"
              disabled={isSubmittingExam}
              onClick={openSubmitDialog}
              className="h-10 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-[15px] font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer"
            >
              <Send className="w-4 h-4" />
              <span>Nộp bài</span>
            </button>
          </div>
        </header>

        {/* Thông báo nhỏ khi mất kết nối mạng */}
        {isOffline && (
          <div
            role="status"
            data-testid="live-exam-offline-banner"
            className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-2.5 text-sm font-medium text-amber-900 flex items-center gap-2.5"
          >
            <WifiOff className="w-4 h-4 text-amber-700 shrink-0" />
            <span>Đang mất kết nối, bài vẫn được lưu trên máy</span>
          </div>
        )}

        {/* Thông báo ngắn khi học sinh bấm phím bị chặn / chuột phải / sao chép */}
        {blockedKeyNotice && (
          <div
            role="status"
            data-testid="live-exam-blocked-key-notice"
            className="rounded-lg bg-slate-900 text-white px-4 py-2.5 text-sm font-medium flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{blockedKeyNotice}</span>
            </div>
          </div>
        )}

        {/* Cảnh báo môi trường (chia đôi màn hình / nhiều màn hình) */}
        {environmentWarning && (
          <div
            role="status"
            data-testid="live-exam-env-warning"
            className="rounded-lg bg-amber-50 border border-amber-300 px-4 py-2.5 text-sm font-medium text-amber-900 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>{environmentWarning}</span>
            </div>
            <button
              type="button"
              onClick={() => setEnvironmentWarning(null)}
              className="text-xs font-semibold text-amber-800 hover:underline shrink-0 cursor-pointer"
            >
              Đã hiểu
            </button>
          </div>
        )}

        {/* Nội dung câu hỏi + Lưới số câu */}
        <div className="flex flex-col lg:flex-row gap-4 items-start">
          <div className="flex-1 min-w-0 w-full space-y-3">
            {activeQuestion && (
              <>
                <QuestionRenderer
                  question={activeQuestion}
                  questionNumber={currentIndex + 1}
                  totalQuestions={renderableQuestions.length}
                  userAnswer={userAnswers[activeQuestion.id]}
                  onChangeAnswer={(ans) =>
                    handleAnswerChange(activeQuestion.id, ans)
                  }
                  showFeedback={false}
                  readOnly={false}
                  fontScale={fontScale}
                />

                {/* Thanh chuyển câu & gắn cờ */}
                <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="live-exam-prev-btn"
                      disabled={currentIndex === 0}
                      onClick={() =>
                        handleSelectQuestionIndex(currentIndex - 1)
                      }
                      className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-sm font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Câu trước</span>
                    </button>

                    <button
                      type="button"
                      data-testid="live-exam-next-btn"
                      disabled={currentIndex >= renderableQuestions.length - 1}
                      onClick={() =>
                        handleSelectQuestionIndex(currentIndex + 1)
                      }
                      className="h-10 px-3.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-sm font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <span>Câu tiếp theo</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <button
                    type="button"
                    data-testid="live-exam-flag-btn"
                    onClick={() => handleToggleFlag(activeQuestion.id)}
                    className={`h-10 px-3.5 rounded-lg border text-sm font-medium inline-flex items-center gap-1.5 transition-colors cursor-pointer ${
                      flaggedMap[activeQuestion.id]
                        ? 'border-amber-500 bg-amber-50 text-amber-900 font-semibold'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-amber-500'
                    }`}
                  >
                    <Flag
                      className={`w-4 h-4 ${
                        flaggedMap[activeQuestion.id]
                          ? 'fill-amber-400 text-amber-600'
                          : ''
                      }`}
                    />
                    <span>
                      {flaggedMap[activeQuestion.id]
                        ? 'Đã gắn cờ'
                        : 'Gắn cờ câu hỏi'}
                    </span>
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Lưới số câu (đánh dấu câu đã làm, câu đang chọn, câu gắn cờ) */}
          <aside
            data-testid="live-exam-question-grid"
            className="w-full lg:w-64 shrink-0 bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-4 space-y-3 lg:sticky lg:top-16"
          >
            <div className="flex items-center justify-between text-sm">
              <h2 className="font-semibold text-[var(--color-text-primary)]">
                Lưới số câu
              </h2>
              <span className="text-xs font-mono font-semibold text-teal-800 bg-teal-50 px-2 py-0.5 rounded tabular-nums">
                {questionGridStats.answeredCount}/{renderableQuestions.length}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-[var(--color-text-secondary)] tabular-nums">
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2.5 h-2.5 rounded-xs bg-teal-700 shrink-0" />
                Đã làm ({questionGridStats.answeredCount})
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span className="w-2.5 h-2.5 rounded-xs bg-white border-2 border-teal-700 shrink-0" />
                Đang chọn
              </span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <Flag className="w-3 h-3 fill-amber-400 text-amber-600 shrink-0" />
                Gắn cờ ({questionGridStats.flaggedCount})
              </span>
            </div>

            <div className="grid grid-cols-6 gap-1.5 max-h-[300px] overflow-y-auto p-0.5">
              {renderableQuestions.map((q, idx) => {
                const isCurrent = idx === currentIndex;
                const answered = isQuestionAnswered(q, userAnswers[q.id]);
                const flagged = Boolean(flaggedMap[q.id]);

                let cellStyle =
                  'bg-slate-50 border-slate-200 text-slate-700 hover:border-teal-600';
                if (answered) {
                  cellStyle = 'bg-teal-700 border-teal-700 text-white font-bold';
                }
                if (flagged && !answered) {
                  cellStyle =
                    'bg-amber-50 border-amber-400 text-amber-900 font-bold';
                }
                if (isCurrent) {
                  cellStyle += ' ring-2 ring-teal-700 ring-offset-1';
                }

                return (
                  <button
                    key={q.id}
                    type="button"
                    data-testid={`live-exam-nav-item-${idx + 1}`}
                    data-answered={answered ? 'true' : 'false'}
                    data-current={isCurrent ? 'true' : 'false'}
                    data-flagged={flagged ? 'true' : 'false'}
                    aria-label={`Câu ${idx + 1}${
                      answered ? ', đã làm' : ', chưa làm'
                    }${flagged ? ', đã gắn cờ' : ''}`}
                    onClick={() => handleSelectQuestionIndex(idx)}
                    className={`h-9 rounded-lg border text-xs font-mono tabular-nums flex items-center justify-center relative cursor-pointer transition-all ${cellStyle}`}
                  >
                    <span>{idx + 1}</span>
                    {flagged && (
                      <Flag className="w-2.5 h-2.5 fill-amber-400 text-amber-600 absolute -top-1 -right-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </aside>
        </div>

        {/* LỚP PHỦ B.2: Thoát toàn màn hình bằng F11 / giữ Esc / cử chỉ hệ thống (che bài thi ngay lập tức) */}
        {fullscreenExitOverlayOpen && (
          <div
            role="dialog"
            aria-modal="true"
            data-testid="live-exam-fullscreen-overlay"
            className="fixed inset-0 z-50 bg-slate-950/95 flex items-center justify-center p-4"
          >
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl max-w-md w-full p-6 sm:p-7 shadow-xl space-y-5 text-center">
              <div className="w-12 h-12 rounded-full bg-teal-50 border border-teal-200 text-teal-700 mx-auto flex items-center justify-center">
                <Maximize2 className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-bold text-[var(--color-text-primary)]">
                  Bài thi yêu cầu chế độ toàn màn hình
                </h3>
                <p className="text-[15px] text-[var(--color-text-secondary)]">
                  Mọi hành vi rời bài thi đều được ghi lại. Đồng hồ làm bài vẫn
                  đang đếm ngược ({formatCountdownClock(remainingSeconds)}).
                </p>
              </div>

              <button
                ref={returnFullscreenBtnRef}
                type="button"
                data-testid="return-fullscreen-btn"
                onClick={handleReturnToFullscreen}
                className="w-full h-11 px-5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-[15px] font-semibold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
                <span>Quay lại toàn màn hình</span>
              </button>
            </div>
          </div>
        )}

        {/* LỚP PHỦ B.1: Cảnh báo khi học sinh vừa rời khỏi bài thi (đổi tab, Alt+Tab, chuyển cửa sổ) */}
        {awayOverlayState?.open && !fullscreenExitOverlayOpen && (
          <div
            role="dialog"
            aria-modal="true"
            data-testid="live-exam-away-overlay"
            data-last-warning={awayOverlayState.isLastWarning ? 'true' : 'false'}
            className="fixed inset-0 z-50 bg-slate-950/90 flex items-center justify-center p-4"
          >
            <div
              className={`rounded-xl max-w-md w-full p-6 sm:p-7 shadow-xl space-y-5 text-center border-2 ${
                awayOverlayState.isLastWarning
                  ? 'bg-rose-50 border-rose-600 text-rose-950'
                  : 'bg-[var(--color-bg-surface)] border-[var(--color-border-subtle)] text-[var(--color-text-primary)]'
              }`}
            >
              <div
                className={`w-12 h-12 rounded-full mx-auto flex items-center justify-center ${
                  awayOverlayState.isLastWarning
                    ? 'bg-rose-100 border border-rose-300 text-rose-700'
                    : 'bg-amber-50 border border-amber-200 text-amber-700'
                }`}
              >
                <ShieldAlert className="w-6 h-6" />
              </div>

              <div className="space-y-2">
                <h3
                  data-testid="live-exam-away-overlay-title"
                  className={`text-xl font-bold tabular-nums ${
                    awayOverlayState.isLastWarning
                      ? 'text-rose-700'
                      : 'text-[var(--color-text-primary)]'
                  }`}
                >
                  Bạn vừa rời khỏi bài thi (lần {awayOverlayState.count}/
                  {awayOverlayState.max})
                </h3>

                <p
                  className={`text-[15px] ${
                    awayOverlayState.isLastWarning
                      ? 'text-rose-800 font-semibold'
                      : 'text-[var(--color-text-secondary)]'
                  }`}
                >
                  {awayOverlayState.isLastWarning
                    ? 'Cảnh báo cuối: Rời bài thi thêm 1 lần nữa sẽ tự động nộp bài. Mọi hành vi rời bài thi đều được ghi lại.'
                    : 'Mọi hành vi rời bài thi đều được ghi lại.'}
                </p>
              </div>

              <button
                ref={resumeAwayBtnRef}
                type="button"
                data-testid="resume-after-away-btn"
                onClick={handleDismissAwayOverlay}
                className={`w-full h-11 px-5 rounded-lg text-white text-[15px] font-semibold transition-colors cursor-pointer ${
                  awayOverlayState.isLastWarning
                    ? 'bg-rose-600 hover:bg-rose-700'
                    : 'bg-teal-700 hover:bg-teal-800'
                }`}
              >
                Tiếp tục làm bài
              </button>
            </div>
          </div>
        )}

        {/* HỘP THOẠI PHẦN C: Hộp thoại Esc (và khi bấm nút "Nộp bài" ở thanh trên) */}
        {showSubmitModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-exam-submit-dialog-title"
            data-testid="live-exam-submit-modal"
            className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          >
            <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl max-w-md w-full p-6 shadow-xl space-y-5">
              <div className="space-y-1.5">
                <h3
                  id="live-exam-submit-dialog-title"
                  data-testid="live-exam-submit-dialog-title"
                  className="text-xl font-bold text-[var(--color-text-primary)]"
                >
                  Nộp bài và thoát?
                </h3>

                {questionGridStats.unansweredCount > 0 && (
                  <p
                    data-testid="live-exam-unanswered-line"
                    className="text-[15px] font-medium text-[var(--color-text-secondary)] tabular-nums"
                  >
                    Còn {questionGridStats.unansweredCount} câu chưa làm
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  ref={cancelSubmitBtnRef}
                  type="button"
                  data-testid="cancel-submit-live-exam-btn"
                  onClick={closeSubmitDialog}
                  className="h-10 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors cursor-pointer"
                >
                  Tiếp tục làm bài
                </button>

                <button
                  ref={confirmSubmitBtnRef}
                  type="button"
                  data-testid="confirm-submit-live-exam-btn"
                  data-armed={isSubmitArmed ? 'true' : 'false'}
                  disabled={isSubmittingExam}
                  onClick={handleDialogSubmitButtonClick}
                  className={`h-10 px-4 rounded-lg border text-sm font-semibold transition-colors cursor-pointer disabled:opacity-60 ${
                    isSubmitArmed
                      ? 'bg-rose-600 hover:bg-rose-700 border-rose-600 text-white'
                      : 'bg-white hover:bg-rose-50 border-rose-600 text-rose-700'
                  }`}
                >
                  {isSubmitArmed ? 'Xác nhận nộp bài' : 'Nộp bài'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ==========================================================================
  // TRẠNG THÁI 2: MÀN HÌNH XÁC NHẬN (KHI MÃ HỢP LỆ)
  // ==========================================================================
  if (verifiedSession) {
    const isResuming = Boolean(verifiedSession.canResumeAttemptId);

    return (
      <div
        data-testid="live-exam-confirm-screen"
        className="max-w-[560px] mx-auto py-6 sm:py-10 space-y-6"
      >
        <div className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-6 sm:p-8 space-y-6 shadow-xs">
          {/* Tên ca thi, số câu, thời gian */}
          <header className="space-y-2 border-b border-[var(--color-border-subtle)] pb-5">
            <div className="flex items-start justify-between gap-4">
              <h1
                data-testid="confirm-session-title"
                className="text-2xl sm:text-[28px] font-bold text-[var(--color-text-primary)] tracking-tight leading-snug"
              >
                {verifiedSession.title}
              </h1>
              <button
                type="button"
                data-testid="change-code-btn"
                onClick={() => {
                  setVerifiedSession(null);
                  setHasAcceptedRules(false);
                  setErrorMsg(null);
                }}
                className="text-[15px] font-medium text-[var(--color-text-secondary)] hover:text-teal-700 hover:underline shrink-0 cursor-pointer"
              >
                Đổi mã
              </button>
            </div>

            <div
              data-testid="confirm-session-meta"
              className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] font-medium text-[var(--color-text-secondary)] tabular-nums"
            >
              <span>{verifiedSession.questionCount} câu</span>
              <span>{verifiedSession.durationMinutes} phút</span>
            </div>
          </header>

          {/* Đúng 3 quy định ngắn */}
          <ul
            data-testid="confirm-rules-list"
            className="space-y-3.5 text-[15px] text-[var(--color-text-primary)]"
          >
            <li className="flex items-center gap-3">
              <Maximize2 className="w-4 h-4 text-teal-700 shrink-0" />
              <span>Bài thi chạy toàn màn hình</span>
            </li>
            <li className="flex items-center gap-3">
              <Eye className="w-4 h-4 text-teal-700 shrink-0" />
              <span>Rời màn hình hoặc đổi tab sẽ bị ghi nhận</span>
            </li>
            <li className="flex items-center gap-3">
              <Keyboard className="w-4 h-4 text-teal-700 shrink-0" />
              <span>Thoát bằng Esc sẽ hỏi nộp bài</span>
            </li>
          </ul>

          {/* Kiểm tra trình duyệt: chặn nếu không có Fullscreen API */}
          {!browserCaps.fullscreenSupported && (
            <div
              role="alert"
              data-testid="fullscreen-unsupported-alert"
              className="rounded-lg bg-red-50 border border-red-200 p-4 text-[15px] text-red-700 flex items-start gap-3"
            >
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <span>
                Trình duyệt hiện tại không hỗ trợ chế độ toàn màn hình. Vui lòng
                mở bằng trình duyệt Chrome hoặc Microsoft Edge để làm bài.
              </span>
            </div>
          )}

          {/* Ghi chú nhẹ nếu trình duyệt không hỗ trợ Keyboard Lock API (Safari/Firefox) */}
          {browserCaps.fullscreenSupported &&
            !browserCaps.keyboardLockSupported && (
              <div
                data-testid="keyboard-lock-note"
                className="text-sm text-[var(--color-text-muted)]"
              >
                Lưu ý: Trình duyệt này không hỗ trợ khóa phím Esc tự động; thông
                tin này sẽ được đính kèm vào lượt thi.
              </div>
            )}

          {errorMsg && (
            <p
              role="alert"
              data-testid="confirm-error-msg"
              className="text-[15px] font-medium text-red-700"
            >
              {errorMsg}
            </p>
          )}

          {/* Hộp kiểm "Tôi đã đọc quy định" và nút chính */}
          <div className="pt-2 space-y-5 border-t border-[var(--color-border-subtle)]">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <input
                type="checkbox"
                data-testid="accept-rules-checkbox"
                checked={hasAcceptedRules}
                onChange={(e) => setHasAcceptedRules(e.target.checked)}
                disabled={!browserCaps.fullscreenSupported}
                className="w-4.5 h-4.5 rounded border-slate-300 text-teal-700 focus:ring-teal-700 cursor-pointer"
              />
              <span className="text-[15px] font-medium text-[var(--color-text-primary)]">
                Tôi đã đọc quy định
              </span>
            </label>

            <button
              type="button"
              data-testid="start-live-exam-btn"
              disabled={
                !hasAcceptedRules ||
                !browserCaps.fullscreenSupported ||
                isStarting
              }
              onClick={handleStartOrResumeExam}
              className="w-full h-12 px-6 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-slate-800 dark:disabled:text-slate-500 text-white text-[15px] font-semibold transition-colors duration-150 inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>
                {isResuming ? 'Tiếp tục làm bài' : 'Bắt đầu làm bài'}
              </span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================================================
  // TRẠNG THÁI 1: MÀN HÌNH NHẬP MÃ CA THI (Ở GIỮA MÀN HÌNH)
  // ==========================================================================
  return (
    <div
      data-testid="live-exam-code-screen"
      className="max-w-[440px] mx-auto py-10 sm:py-16"
    >
      <form
        onSubmit={handleVerifySubmit}
        noValidate
        className="bg-[var(--color-bg-surface)] border border-[var(--color-border-subtle)] rounded-xl p-6 sm:p-8 space-y-6 shadow-xs text-center"
      >
        <div className="space-y-2">
          <h1
            className="font-bold text-[var(--color-text-primary)] tracking-tight"
            style={{
              fontSize: 'var(--text-title, clamp(1.875rem, 2.5vw, 2.125rem))',
            }}
          >
            Thi ngay
          </h1>
          <p className="text-[15px] text-[var(--color-text-secondary)]">
            Nhập mã do thầy cô cung cấp
          </p>
        </div>

        <div className="space-y-2">
          <input
            ref={inputRef}
            id="live-exam-code-input"
            data-testid="live-exam-code-input"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            onChange={(e) => handleCodeChange(e.target.value)}
            onPaste={handlePasteCode}
            placeholder="MÃ 6 KÝ TỰ"
            aria-label="Nhập mã do thầy cô cung cấp"
            aria-invalid={Boolean(errorMsg)}
            className="w-full h-14 px-4 rounded-lg bg-[var(--color-bg-canvas)] border border-slate-300 dark:border-slate-700 focus:border-teal-700 text-center text-2xl font-bold tracking-[0.25em] text-[var(--color-text-primary)] placeholder:text-slate-300 dark:placeholder:text-slate-600 placeholder:text-base placeholder:tracking-widest placeholder:font-medium transition-colors"
          />

          {errorMsg && (
            <p
              role="alert"
              data-testid="live-exam-code-error"
              className="text-[15px] font-medium text-red-700 min-h-[22px]"
            >
              {errorMsg}
            </p>
          )}
        </div>

        <button
          type="submit"
          data-testid="live-exam-verify-btn"
          disabled={isVerifying || rateLimitCountdown > 0}
          className="w-full h-12 px-6 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-[15px] font-semibold transition-colors duration-150 cursor-pointer"
        >
          Vào thi
        </button>
      </form>
    </div>
  );
};
