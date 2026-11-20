import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowLeft,
  BellRing,
  Check,
  Clock,
  Copy,
  History,
  Lock,
  Maximize2,
  Radio,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Share2,
  ShieldAlert,
  StopCircle,
  Unlock,
  Users,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { UserAccount } from '../types/exam';
import {
  AttemptSubmitReason,
  ExamSessionRecord,
  ExamSessionStatus,
  SessionRealtimeEvent,
  TeacherSessionDetailPayload,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession';
import { examSessionApi } from '../services/examSessionApi';
import {
  buildLiveStudentMonitoringRows,
  computeServerClockOffsetMs,
  formatSingleSummaryLine,
  LiveStudentMonitoringRow,
} from '../utils/liveExamHelpers';
import {
  buildSessionShareMessage,
  filterLiveMonitoringRowsByStatus,
  LiveMonitoringStatusFilter,
} from '../utils/examSessionQuickHelpers';
import {
  buildLiveViolationTimeline,
  filterLiveViolationTimeline,
  formatAwayDurationVietnamese,
  formatExactViolationTimestamp,
  formatLatestViolationInlineSummary,
  LiveViolationFeedItem,
  VIOLATION_BEHAVIOR_LABELS,
  ViolationFeedCategoryFilter,
} from '../utils/liveProctoringUtils';
import { TeacherSessionResultsOverview } from './TeacherSessionResultsOverview';

interface TeacherSessionDetailViewProps {
  currentUser: UserAccount;
  sessionId: string;
  initialSession?: ExamSessionRecord;
  initialTab?: 'live' | 'results';
  onBack: () => void;
  onSessionUpdated?: (session: ExamSessionRecord) => void;
}

const STATUS_LABELS: Record<ExamSessionStatus, string> = {
  draft: 'Nháp',
  open: 'Đang mở',
  locked: 'Đã khóa',
  ended: 'Đã kết thúc',
};

const SUBMIT_REASON_LABELS: Record<AttemptSubmitReason, string> = {
  voluntary: 'Tự nguyện',
  timeout: 'Hết giờ',
  violation: 'Vi phạm',
  teacher_forced: 'GV nộp giúp',
};

const VIOLATION_TYPE_LABELS: Record<ViolationEventType, string> = {
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

function formatCountdownMmSs(seconds: number | null): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '—';
  }
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatTimeHhMmSs(isoString: string): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return isoString;
  return d.toLocaleTimeString('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  create: 'Tạo ca thi',
  update: 'Cập nhật cấu hình',
  open: 'Mở ca thi',
  lock: 'Khóa mã vào thi',
  unlock: 'Mở khóa mã vào thi',
  end: 'Kết thúc ca thi',
  extend: 'Gia hạn thời gian',
  force_submit: 'Nộp bài giúp học sinh',
  allow_reentry: 'Cho học sinh vào lại',
  clone: 'Tạo bản sao ca thi',
};

function formatAuditLogNote(action: string, rawNote?: string): string {
  if (!rawNote) return AUDIT_ACTION_LABELS[action] || 'Thao tác quản trị ca thi';
  const trimmed = rawNote.trim();
  if (!trimmed.startsWith('{')) return trimmed;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (action === 'create' && parsed.code) {
      return `Tạo ca thi mã ${String(parsed.code)} (${parsed.status === 'open' ? 'mở ngay' : 'nháp'})`;
    }
    if (action === 'update' && Array.isArray(parsed.updatedFields)) {
      return `Đã cập nhật ${parsed.updatedFields.length} thông số cấu hình ca thi`;
    }
    if (action === 'extend' && parsed.extraMinutes) {
      return `Gia hạn thêm ${String(parsed.extraMinutes)} phút`;
    }
    return AUDIT_ACTION_LABELS[action] || trimmed;
  } catch {
    return trimmed;
  }
}

export const TeacherSessionDetailView: React.FC<
  TeacherSessionDetailViewProps
> = ({
  currentUser,
  sessionId,
  initialSession,
  initialTab = 'live',
  onBack,
  onSessionUpdated,
}) => {
  const teacherId = currentUser.id || currentUser.username;

  const [activeTab, setActiveTab] = useState<'live' | 'results'>(initialTab);
  const [detail, setDetail] = useState<TeacherSessionDetailPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [serverOffsetMs, setServerOffsetMs] = useState<number>(0);
  const [clientNowMs, setClientNowMs] = useState<number>(() => Date.now());

  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Sao chép mã, tin nhắn gửi lớp & Chiếu mã toàn màn hình
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [copiedShareMsg, setCopiedShareMsg] = useState<boolean>(false);
  const [isProjectingCode, setIsProjectingCode] = useState<boolean>(false);
  const [isLockSwitchBusy, setIsLockSwitchBusy] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);
  const [isConfirmEndModalOpen, setIsConfirmEndModalOpen] =
    useState<boolean>(false);
  const [isEndingSession, setIsEndingSession] = useState<boolean>(false);

  // Bộ lọc bảng học sinh
  const [onlyWithViolations, setOnlyWithViolations] = useState<boolean>(false);
  const [liveStatusFilter, setLiveStatusFilter] =
    useState<LiveMonitoringStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Popover xem danh sách sự kiện vi phạm gần nhất của 1 học sinh (render qua Portal)
  const [openViolationPopoverRowKey, setOpenViolationPopoverRowKey] = useState<
    string | null
  >(null);
  const [violationPopoverAnchor, setViolationPopoverAnchor] = useState<{
    top: number;
    left: number;
    width: number;
    placement: 'bottom' | 'top';
  } | null>(null);

  // Giám sát thời gian thực (SSE stream + cảnh báo gian lận tức thời + âm báo tùy chọn)
  const [streamStatus, setStreamStatus] = useState<
    'connected' | 'reconnecting' | 'offline'
  >('reconnecting');
  const [soundAlertEnabled, setSoundAlertEnabled] = useState<boolean>(true);
  const [liveViolationAlert, setLiveViolationAlert] = useState<{
    id: string;
    studentName: string;
    username: string;
    typeLabel: string;
    timeFormatted: string;
    dateFormatted: string;
    questionOrder: number;
    awaySeconds: number;
    note?: string;
    violationCount: number;
    maxViolations: number;
    countsTowardLimit: boolean;
    autoSubmitted: boolean;
  } | null>(null);
  const [highlightedViolationIds, setHighlightedViolationIds] = useState<
    string[]
  >([]);
  const [violationFeedCategory, setViolationFeedCategory] =
    useState<ViolationFeedCategoryFilter>('all');
  const [violationFeedStudentFilter, setViolationFeedStudentFilter] = useState<
    string | null
  >(null);

  const seenViolationIdsRef = useRef<Set<string>>(new Set());
  const initialSnapshotLoadedRef = useRef<boolean>(false);
  const soundAlertEnabledRef = useRef<boolean>(true);
  useEffect(() => {
    soundAlertEnabledRef.current = soundAlertEnabled;
  }, [soundAlertEnabled]);

  const playViolationAlertChime = useCallback(() => {
    if (!soundAlertEnabledRef.current || typeof window === 'undefined') return;
    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const now = ctx.currentTime;
      [660, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);
        gain.gain.setValueAtTime(0.001, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.08, now + idx * 0.12 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.17);
      });
      window.setTimeout(() => {
        void ctx.close().catch(() => {});
      }, 600);
    } catch {
      // Trình duyệt chưa cho phép phát âm thanh tự động
    }
  }, []);

  // Modal "Gia hạn" (cho 1 học sinh hoặc cho cả ca thi)
  const [extendModalTarget, setExtendModalTarget] = useState<{
    mode: 'session' | 'student';
    row?: LiveStudentMonitoringRow;
  } | null>(null);
  const [extendMinutesInput, setExtendMinutesInput] = useState<string>('5');
  const [extendInputError, setExtendInputError] = useState<string | null>(null);
  const [isSubmittingExtend, setIsSubmittingExtend] = useState<boolean>(false);

  // Modal xác nhận "Nộp bài giúp"
  const [confirmForceSubmitRow, setConfirmForceSubmitRow] =
    useState<LiveStudentMonitoringRow | null>(null);
  const [isSubmittingForceSubmit, setIsSubmittingForceSubmit] =
    useState<boolean>(false);

  // Modal xác nhận "Cho vào lại" (tạo lượt thi mới, giữ nguyên bài cũ)
  const [confirmReentryRow, setConfirmReentryRow] =
    useState<LiveStudentMonitoringRow | null>(null);
  const [reentryExtraMinutes, setReentryExtraMinutes] = useState<string>('15');
  const [isSubmittingReentry, setIsSubmittingReentry] =
    useState<boolean>(false);

  const latestAppliedServerMsRef = useRef<number>(0);
  const onSessionUpdatedRef = useRef(onSessionUpdated);
  onSessionUpdatedRef.current = onSessionUpdated;
  const applyIncomingDetailRef = useRef<
    (
      nextDetail: TeacherSessionDetailPayload,
      realtimeEvent?: SessionRealtimeEvent
    ) => void
  >(() => {});

  const loadDetail = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      try {
        const res = await examSessionApi.getSessionDetail(teacherId, sessionId);
        applyIncomingDetailRef.current(res);
      } catch (err) {
        if (!silent) {
          const msg =
            err instanceof Error
              ? err.message
              : 'Không thể tải thông tin chi tiết ca thi.';
          setBannerMessage({ type: 'error', text: msg });
        }
      } finally {
        if (!silent) {
          setLoading(false);
        }
        setIsRefreshing(false);
      }
    },
    [teacherId, sessionId]
  );

  const applyIncomingDetail = useCallback(
    (
      nextDetail: TeacherSessionDetailPayload,
      realtimeEvent?: SessionRealtimeEvent
    ) => {
      const incomingServerMs = nextDetail.serverNow
        ? new Date(nextDetail.serverNow).getTime()
        : 0;
      // Không để gói HTTP cũ (đang bay) ghi đè lên sự kiện SSE thời gian thực mới hơn
      if (
        !realtimeEvent &&
        incomingServerMs > 0 &&
        latestAppliedServerMsRef.current > 0 &&
        incomingServerMs < latestAppliedServerMsRef.current
      ) {
        setLoading(false);
        setIsRefreshing(false);
        return;
      }
      if (incomingServerMs > latestAppliedServerMsRef.current) {
        latestAppliedServerMsRef.current = incomingServerMs;
      }

      setDetail(nextDetail);
      setLoading(false);
      setIsRefreshing(false);
      if (nextDetail.serverNow) {
        setServerOffsetMs(
          computeServerClockOffsetMs(nextDetail.serverNow, Date.now())
        );
      }
      setClientNowMs(Date.now());
      if (onSessionUpdatedRef.current && nextDetail.session) {
        onSessionUpdatedRef.current(nextDetail.session);
      }

      const incomingViolations = nextDetail.violations || [];
      if (!initialSnapshotLoadedRef.current) {
        initialSnapshotLoadedRef.current = true;
        seenViolationIdsRef.current = new Set(incomingViolations.map((v) => v.id));
        return;
      }

      // Phát hiện các sự kiện gian lận mới vừa phát sinh theo thời gian thực
      const newlyArrived = incomingViolations.filter(
        (v) => !seenViolationIdsRef.current.has(v.id)
      );
      if (newlyArrived.length > 0) {
        for (const v of newlyArrived) {
          seenViolationIdsRef.current.add(v.id);
        }
        const newIds = newlyArrived.map((v) => v.id);
        setHighlightedViolationIds((prev) =>
          Array.from(new Set([...newIds, ...prev])).slice(0, 20)
        );
        window.setTimeout(() => {
          setHighlightedViolationIds((prev) =>
            prev.filter((id) => !newIds.includes(id))
          );
        }, 9000);

        const newest = [...newlyArrived].sort(
          (a, b) =>
            new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
        )[0];

        if (newest) {
          const matchedAttempt = (nextDetail.attempts || []).find(
            (a) => a.id === newest.attemptId || a.studentId === newest.studentId
          );
          const ts = formatExactViolationTimestamp(newest.occurredAt);
          const maxV = nextDetail.session?.maxViolations || 3;
          setLiveViolationAlert({
            id: newest.id,
            studentName:
              realtimeEvent?.studentName ||
              matchedAttempt?.fullName ||
              matchedAttempt?.username ||
              newest.studentId,
            username:
              realtimeEvent?.username ||
              matchedAttempt?.username ||
              newest.studentId,
            typeLabel: VIOLATION_BEHAVIOR_LABELS[newest.type] || newest.type,
            timeFormatted: ts.time,
            dateFormatted: ts.date,
            questionOrder: newest.currentQuestionOrder,
            awaySeconds: newest.awaySeconds,
            note: newest.note,
            violationCount:
              realtimeEvent?.violationCount ?? matchedAttempt?.violationCount ?? 1,
            maxViolations: maxV,
            countsTowardLimit:
              realtimeEvent?.countsTowardLimit ??
              (newest.type !== 'phim_bi_chan' &&
                newest.type !== 'blocked_key' &&
                newest.type !== 'copy_paste' &&
                newest.type !== 'devtools'),
            autoSubmitted: Boolean(
              realtimeEvent?.autoSubmitted ||
                matchedAttempt?.submitReason === 'violation'
            ),
          });
          playViolationAlertChime();
        }
      } else if (
        realtimeEvent?.type === 'student:violation_updated' &&
        realtimeEvent.violation
      ) {
        const updatedV = realtimeEvent.violation;
        setLiveViolationAlert((prev) =>
          prev && prev.id === updatedV.id
            ? { ...prev, awaySeconds: updatedV.awaySeconds }
            : prev
        );
      }
    },
    [playViolationAlertChime]
  );

  applyIncomingDetailRef.current = applyIncomingDetail;
  const loadDetailRef = useRef(loadDetail);
  loadDetailRef.current = loadDetail;

  // Mở luồng giám sát thời gian thực (SSE) + đồng bộ an toàn dự phòng mỗi 15 giây
  useEffect(() => {
    initialSnapshotLoadedRef.current = false;
    latestAppliedServerMsRef.current = 0;
    seenViolationIdsRef.current = new Set();
    setLiveViolationAlert(null);

    void loadDetailRef.current(false);

    const unsubscribeStream = examSessionApi.subscribeToSessionStream(
      teacherId,
      sessionId,
      {
        onSnapshot: (snapDetail) => {
          applyIncomingDetailRef.current(snapDetail);
        },
        onUpdate: (event, freshDetail) => {
          applyIncomingDetailRef.current(freshDetail, event);
        },
        onStatusChange: (status) => {
          setStreamStatus(status);
        },
      }
    );

    const fallbackReconcile = window.setInterval(() => {
      void loadDetailRef.current(true);
    }, 15000);

    return () => {
      unsubscribeStream();
      window.clearInterval(fallbackReconcile);
    };
  }, [teacherId, sessionId]);

  // Đồng hồ đếm ngược mượt mỗi 1 giây trên giao diện
  useEffect(() => {
    const tick = window.setInterval(() => {
      setClientNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(tick);
  }, []);

  // Đóng Popover vi phạm khi bấm ra ngoài hoặc bấm Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isProjectingCode) {
          setIsProjectingCode(false);
          return;
        }
        if (openViolationPopoverRowKey) {
          setOpenViolationPopoverRowKey(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isProjectingCode, openViolationPopoverRowKey]);

  useEffect(() => {
    if (!openViolationPopoverRowKey) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('[data-violation-popover-container]')) {
        setOpenViolationPopoverRowKey(null);
        setViolationPopoverAnchor(null);
      }
    };
    const handleViewportChange = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        typeof target.closest === 'function' &&
        target.closest('[data-violation-popover-container]')
      ) {
        return;
      }
      setOpenViolationPopoverRowKey(null);
      setViolationPopoverAnchor(null);
    };
    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [openViolationPopoverRowKey]);

  const session = detail?.session ?? initialSession;

  const summary = useMemo(() => {
    if (detail?.summary) {
      return detail.summary;
    }
    return {
      inProgressCount: session?.inProgressCount ?? 0,
      submittedCount: session?.submittedCount ?? 0,
      notEnteredCount: 0,
    };
  }, [detail?.summary, session]);

  const baseRows = useMemo(() => {
    if (!detail) return [];
    return buildLiveStudentMonitoringRows({
      attempts: detail.attempts || [],
      notEnteredStudents: detail.notEnteredStudents || [],
      violations: detail.violations || [],
      maxViolations: detail.session.maxViolations || 3,
      sessionQuestionCount: detail.session.questionCount || 45,
      onlyWithViolations,
      searchQuery,
      serverOffsetMs,
      clientNowMs,
    });
  }, [
    detail,
    onlyWithViolations,
    searchQuery,
    serverOffsetMs,
    clientNowMs,
  ]);

  const rows = useMemo(
    () => filterLiveMonitoringRowsByStatus(baseRows, liveStatusFilter),
    [baseRows, liveStatusFilter]
  );

  const totalViolatingStudentsCount = useMemo(() => {
    if (!detail) return 0;
    const allRows = buildLiveStudentMonitoringRows({
      attempts: detail.attempts || [],
      notEnteredStudents: detail.notEnteredStudents || [],
      violations: detail.violations || [],
      maxViolations: detail.session.maxViolations || 3,
      sessionQuestionCount: detail.session.questionCount || 45,
      onlyWithViolations: true,
      serverOffsetMs,
      clientNowMs,
    });
    return allRows.length;
  }, [detail, serverOffsetMs, clientNowMs]);

  const violationTimeline = useMemo<LiveViolationFeedItem[]>(() => {
    if (!detail) return [];
    return buildLiveViolationTimeline(
      detail.violations || [],
      detail.attempts || [],
      detail.session?.maxViolations || 3
    );
  }, [detail]);

  const filteredViolationTimeline = useMemo(
    () =>
      filterLiveViolationTimeline(violationTimeline, {
        category: violationFeedCategory,
        searchQuery,
        studentUsername: violationFeedStudentFilter,
      }),
    [
      violationTimeline,
      violationFeedCategory,
      searchQuery,
      violationFeedStudentFilter,
    ]
  );

  const handleCopyCode = async () => {
    if (!session) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(session.code);
      }
      setCopiedCode(true);
      window.setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      setCopiedCode(true);
    }
  };

  const handleCopyShareMessage = async () => {
    if (!session) return;
    try {
      const msg = buildSessionShareMessage(session);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(msg);
      }
      setCopiedShareMsg(true);
      window.setTimeout(() => setCopiedShareMsg(false), 2500);
    } catch {
      setCopiedShareMsg(true);
    }
  };

  const handleEndSessionNow = async () => {
    if (!session || session.status === 'ended' || isEndingSession) return;
    setIsEndingSession(true);
    setBannerMessage(null);
    try {
      await examSessionApi.endSession(teacherId, session.id);
      setIsConfirmEndModalOpen(false);
      setBannerMessage({
        type: 'success',
        text: `Đã kết thúc ca thi "${session.title}" và tự động thu bài của toàn bộ học sinh đang làm bài.`,
      });
      await loadDetail(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể kết thúc ca thi.',
      });
    } finally {
      setIsEndingSession(false);
    }
  };

  const handleToggleLock = async () => {
    if (!session || session.status === 'ended' || isLockSwitchBusy) return;
    setIsLockSwitchBusy(true);
    setBannerMessage(null);
    try {
      if (session.status === 'locked') {
        await examSessionApi.unlockSession(teacherId, session.id);
        setBannerMessage({
          type: 'success',
          text: `Đã mở khóa ca thi "${session.title}". Học sinh có thể dùng mã ${session.code} để vào thi.`,
        });
      } else if (session.status === 'draft') {
        await examSessionApi.openSession(teacherId, session.id);
        setBannerMessage({
          type: 'success',
          text: `Đã mở ca thi "${session.title}".`,
        });
      } else {
        await examSessionApi.lockSession(teacherId, session.id);
        setBannerMessage({
          type: 'success',
          text: `Đã khóa ca thi "${session.title}". Học sinh mới không vào được bằng mã, học sinh đang thi vẫn làm tiếp.`,
        });
      }
      await loadDetail(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể thay đổi trạng thái khóa ca thi.',
      });
    } finally {
      setIsLockSwitchBusy(false);
    }
  };

  const handleOpenExtendSessionModal = () => {
    setExtendMinutesInput('5');
    setExtendInputError(null);
    setExtendModalTarget({ mode: 'session' });
  };

  const handleOpenExtendStudentModal = (row: LiveStudentMonitoringRow) => {
    setExtendMinutesInput('5');
    setExtendInputError(null);
    setExtendModalTarget({ mode: 'student', row });
  };

  const handleConfirmExtend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !extendModalTarget) return;
    const extra = Number(extendMinutesInput);
    if (!Number.isFinite(extra) || !Number.isInteger(extra) || extra < 1 || extra > 180) {
      setExtendInputError('Vui lòng nhập số phút nguyên từ 1 đến 180.');
      return;
    }

    setIsSubmittingExtend(true);
    setExtendInputError(null);
    try {
      const attemptId =
        extendModalTarget.mode === 'student'
          ? extendModalTarget.row?.attemptId
          : undefined;
      await examSessionApi.extendSession(
        teacherId,
        session.id,
        extra,
        attemptId
      );
      setBannerMessage({
        type: 'success',
        text:
          extendModalTarget.mode === 'session'
            ? `Đã gia hạn thêm ${extra} phút cho toàn bộ ca thi.`
            : `Đã gia hạn thêm ${extra} phút cho học sinh "${extendModalTarget.row?.fullName}".`,
      });
      setExtendModalTarget(null);
      await loadDetail(true);
    } catch (err) {
      setExtendInputError(
        err instanceof Error ? err.message : 'Không thể gia hạn thời gian.'
      );
    } finally {
      setIsSubmittingExtend(false);
    }
  };

  const handleConfirmForceSubmit = async () => {
    if (!session || !confirmForceSubmitRow?.attemptId) return;
    setIsSubmittingForceSubmit(true);
    try {
      await examSessionApi.forceSubmitAttempt(
        teacherId,
        session.id,
        confirmForceSubmitRow.attemptId
      );
      setBannerMessage({
        type: 'success',
        text: `Đã nộp bài giúp học sinh "${confirmForceSubmitRow.fullName}" và ghi vào nhật ký ca thi.`,
      });
      setConfirmForceSubmitRow(null);
      await loadDetail(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể nộp bài giúp học sinh.',
      });
    } finally {
      setIsSubmittingForceSubmit(false);
    }
  };

  const handleConfirmAllowReentry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session || !confirmReentryRow?.attemptId) return;
    const extra = Number(reentryExtraMinutes);
    const validExtra =
      Number.isFinite(extra) && extra >= 1 ? Math.floor(extra) : 15;

    setIsSubmittingReentry(true);
    try {
      await examSessionApi.allowStudentReentry(
        teacherId,
        session.id,
        confirmReentryRow.attemptId,
        confirmReentryRow.status === 'submitted' ? validExtra : undefined
      );
      setBannerMessage({
        type: 'success',
        text:
          confirmReentryRow.status === 'submitted'
            ? `Đã tạo lượt thi mới cho "${confirmReentryRow.fullName}" (giữ nguyên bài cũ và đáp án đã lưu, cấp ${validExtra} phút làm tiếp).`
            : `Đã cấp quyền vào lại cho học sinh "${confirmReentryRow.fullName}".`,
      });
      setConfirmReentryRow(null);
      await loadDetail(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể cấp quyền cho học sinh vào lại.',
      });
    } finally {
      setIsSubmittingReentry(false);
    }
  };

  const handleSimulateCohort = async (counts: {
    inProgressCount: number;
    submittedCount: number;
    notEnteredCount: number;
    label: string;
  }) => {
    if (!session || isSimulating) return;
    setIsSimulating(true);
    setBannerMessage(null);
    try {
      const res = await examSessionApi.simulateStudents(teacherId, session.id, {
        inProgressCount: counts.inProgressCount,
        submittedCount: counts.submittedCount,
        notEnteredCount: counts.notEnteredCount,
      });
      setDetail(res);
      if (res.serverNow) {
        setServerOffsetMs(computeServerClockOffsetMs(res.serverNow, Date.now()));
      }
      setClientNowMs(Date.now());
      if (onSessionUpdated && res.session) {
        onSessionUpdated(res.session);
      }
      setBannerMessage({
        type: 'success',
        text: `Đã cập nhật dữ liệu giả lập (${counts.label}) cho ca thi.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể khởi tạo dữ liệu giả lập.',
      });
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSimulate40Students = async () => {
    await handleSimulateCohort({
      inProgressCount: 32,
      submittedCount: 5,
      notEnteredCount: 3,
      label: '40 học sinh: 32 đang thi, 5 đã nộp, 3 chưa vào',
    });
  };

  if (!session && loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-10 text-center text-slate-500">
        Đang tải chi tiết ca thi...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-4">
        <p className="text-slate-700 font-medium">
          Không tìm thấy thông tin ca thi.
        </p>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-teal-700 text-white text-sm font-semibold cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          Quay lại danh sách ca thi
        </button>
      </div>
    );
  }

  const isLocked = session.status === 'locked';
  const isEnded = session.status === 'ended';
  const isDraft = session.status === 'draft';

  return (
    <div className="space-y-5" data-testid="teacher-session-detail-view">
      {/* Thanh điều hướng quay lại & Đầu trang */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={onBack}
                data-testid="back-to-sessions-btn"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 text-xs font-semibold transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Danh sách ca thi
              </button>

              <span
                data-testid="detail-session-status-badge"
                className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-bold border ${
                  session.status === 'open'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : isLocked
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {STATUS_LABELS[session.status]}
              </span>

              <span className="text-xs text-slate-500 tabular-nums">
                {session.questionCount} câu · {session.durationMinutes} phút · Đạt{' '}
                <strong className="text-slate-700">{session.passScore}/1000</strong> · Ngưỡng vi phạm:{' '}
                <strong className="text-slate-700">{session.maxViolations} lần</strong>
              </span>
            </div>

            <h2
              className="text-xl font-bold text-slate-900 tracking-tight"
              data-testid="detail-session-title"
            >
              {session.title}
            </h2>

            {/* DÒNG TÓM TẮT DUY NHẤT theo đúng yêu cầu: "32 đang thi, 5 đã nộp, 3 chưa vào" */}
            <p
              data-testid="live-single-summary-line"
              className="text-sm font-semibold text-teal-800 tabular-nums"
            >
              {formatSingleSummaryLine(summary)}
            </p>
          </div>

          {/* Cụm Mã ca thi + Công tắc Khóa/Mở khóa + Gia hạn + Kết thúc ca thi ở đầu trang */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Mã ca thi */}
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
              <span className="text-xs font-medium text-slate-500">Mã:</span>
              <button
                type="button"
                onClick={() => void handleCopyCode()}
                data-testid="detail-copy-code-btn"
                title="Bấm để sao chép mã ca thi"
                className="inline-flex items-center gap-1.5 font-mono font-black text-base tracking-wider text-slate-900 hover:text-teal-700 cursor-pointer tabular-nums"
              >
                <span>{session.code}</span>
                {copiedCode ? (
                  <Check className="w-4 h-4 text-teal-700" />
                ) : (
                  <Copy className="w-4 h-4 text-slate-400" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setIsProjectingCode(true)}
                data-testid="detail-project-code-btn"
                title="Chiếu mã chữ lớn lên màn hình"
                className="p-1 rounded hover:bg-slate-200/70 text-slate-600 cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Sao chép hướng dẫn gửi lớp (Zalo / Classroom) */}
            <button
              type="button"
              onClick={() => void handleCopyShareMessage()}
              data-testid="detail-copy-share-btn"
              title="Sao chép thông báo kèm mã ca thi để dán vào nhóm lớp Zalo/Classroom"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-teal-50 hover:border-teal-300 text-slate-700 hover:text-teal-800 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {copiedShareMsg ? (
                <>
                  <Check className="w-3.5 h-3.5 text-teal-700" />
                  <span>Đã sao chép tin nhắn</span>
                </>
              ) : (
                <>
                  <Share2 className="w-3.5 h-3.5" />
                  <span>Gửi mã cho lớp</span>
                </>
              )}
            </button>

            {/* Công tắc Khóa / Mở khóa ở đầu trang */}
            {!isEnded && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                {isDraft ? (
                  <button
                    type="button"
                    disabled={isLockSwitchBusy}
                    onClick={() => void handleToggleLock()}
                    data-testid="detail-open-session-btn"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-800 cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    <Unlock className="w-3.5 h-3.5" />
                    Mở ca thi
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isLocked}
                      disabled={isLockSwitchBusy}
                      onClick={() => void handleToggleLock()}
                      data-testid="detail-lock-switch"
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                        isLocked ? 'bg-amber-600' : 'bg-slate-300'
                      } disabled:opacity-50`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                          isLocked ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                    <span className="text-xs font-semibold text-slate-700 whitespace-nowrap">
                      {isLocked ? (
                        <span className="inline-flex items-center gap-1 text-amber-800">
                          <Lock className="w-3.5 h-3.5" />
                          Đã khóa mã
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-slate-700">
                          <Unlock className="w-3.5 h-3.5 text-emerald-700" />
                          Cho phép vào
                        </span>
                      )}
                    </span>
                  </>
                )}
              </div>
            )}

            {/* Nút hành động cấp ca thi: Gia hạn cho cả ca & Kết thúc ca thi */}
            {!isEnded && (
              <>
                <button
                  type="button"
                  onClick={handleOpenExtendSessionModal}
                  data-testid="extend-whole-session-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>Gia hạn cả ca</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmEndModalOpen(true)}
                  data-testid="detail-end-session-btn"
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-900 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
                >
                  <StopCircle className="w-3.5 h-3.5" />
                  <span>Kết thúc ca</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Thanh 2 Tab: "Đang thi" và "Kết quả" */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
          <div className="flex items-center gap-2" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'live'}
              onClick={() => setActiveTab('live')}
              data-testid="detail-tab-live"
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                activeTab === 'live'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Đang thi
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'results'}
              onClick={() => setActiveTab('results')}
              data-testid="detail-tab-results"
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors cursor-pointer ${
                activeTab === 'results'
                  ? 'bg-teal-700 text-white'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              Kết quả
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span
              data-testid="live-stream-status"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold ${
                streamStatus === 'connected'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <Radio
                className={`w-3.5 h-3.5 ${
                  streamStatus === 'connected' ? 'animate-pulse text-emerald-600' : ''
                }`}
              />
              <span>
                {streamStatus === 'connected'
                  ? 'Giám sát trực tiếp'
                  : 'Đang đồng bộ...'}
              </span>
            </span>

            <button
              type="button"
              onClick={() => setSoundAlertEnabled((prev) => !prev)}
              data-testid="toggle-violation-sound-btn"
              title={
                soundAlertEnabled
                  ? 'Đang bật âm báo khi học sinh vi phạm. Bấm để tắt.'
                  : 'Đang tắt âm báo. Bấm để bật âm báo khi có gian lận.'
              }
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-semibold cursor-pointer transition-colors ${
                soundAlertEnabled
                  ? 'border-teal-200 bg-teal-50/70 text-teal-800 hover:bg-teal-100/70'
                  : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
              }`}
            >
              {soundAlertEnabled ? (
                <Volume2 className="w-3.5 h-3.5" />
              ) : (
                <VolumeX className="w-3.5 h-3.5" />
              )}
              <span className="hidden sm:inline">
                {soundAlertEnabled ? 'Âm báo: Bật' : 'Âm báo: Tắt'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => void loadDetail(true)}
              data-testid="detail-refresh-btn"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 font-semibold cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-teal-700' : ''}`}
              />
              Làm mới
            </button>
            <button
              type="button"
              disabled={isSimulating}
              onClick={() => void handleSimulate40Students()}
              data-testid="simulate-40-students-btn"
              title="Tạo nhanh 40 học sinh (32 đang thi, 5 đã nộp, 3 chưa vào) để kiểm thử"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:text-teal-700 hover:border-teal-300 hover:bg-teal-50 font-semibold cursor-pointer disabled:opacity-50"
            >
              <Users className="w-3.5 h-3.5" />
              {isSimulating ? 'Đang tạo...' : 'Giả lập 40 HS'}
            </button>
          </div>
        </div>
      </div>

      {/* Thông báo thao tác */}
      {bannerMessage && (
        <div
          data-testid="detail-action-banner"
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border text-sm font-medium ${
            bannerMessage.type === 'success'
              ? 'bg-teal-50 border-teal-200 text-teal-900'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          <span>{bannerMessage.text}</span>
          <button
            type="button"
            onClick={() => setBannerMessage(null)}
            className="p-1 text-slate-500 hover:text-slate-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* NỘI DUNG TAB 2: KẾT QUẢ (Bước 7A & 7B/8: Tổng quan lớp + Phân tích câu hỏi + Bảng học sinh + Xuất Excel/PDF) */}
      {activeTab === 'results' ? (
        <TeacherSessionResultsOverview
          currentUser={currentUser}
          session={session}
          attempts={detail?.attempts ?? []}
          violations={detail?.violations ?? []}
          serverNowIso={detail?.serverNow}
          isSimulating={isSimulating}
          onSimulateCohort={(counts) => void handleSimulateCohort(counts)}
        />
      ) : (
        /* NỘI DUNG TAB 1: ĐANG THI (Theo dõi trực tiếp) */
        <div className="space-y-4">
          {/* Cảnh báo gian lận tức thời theo thời gian thực */}
          {liveViolationAlert && (
            <div
              role="alert"
              data-testid="realtime-violation-alert-banner"
              className={`rounded-xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
                liveViolationAlert.autoSubmitted ||
                liveViolationAlert.violationCount >= liveViolationAlert.maxViolations
                  ? 'bg-rose-50 border-rose-300 text-rose-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950'
              }`}
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <BellRing
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    liveViolationAlert.autoSubmitted ||
                    liveViolationAlert.violationCount >=
                      liveViolationAlert.maxViolations
                      ? 'text-rose-700'
                      : 'text-amber-700'
                  }`}
                />
                <div className="text-xs sm:text-sm min-w-0">
                  <div className="font-bold flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span>Phát hiện hành vi gian lận</span>
                    <span className="font-mono tabular-nums px-1.5 py-0.5 rounded bg-white/80 border border-current/20 text-xs">
                      {liveViolationAlert.timeFormatted} ·{' '}
                      {liveViolationAlert.dateFormatted}
                    </span>
                  </div>
                  <p className="text-xs mt-0.5 leading-relaxed">
                    <strong>{liveViolationAlert.studentName}</strong> (@
                    {liveViolationAlert.username}) —{' '}
                    <strong>{liveViolationAlert.typeLabel}</strong> tại câu{' '}
                    <strong>#{liveViolationAlert.questionOrder}</strong>
                    {liveViolationAlert.awaySeconds > 0 && (
                      <>
                        {' '}
                        · Rời màn hình{' '}
                        <strong>
                          {formatAwayDurationVietnamese(
                            liveViolationAlert.awaySeconds
                          )}
                        </strong>
                      </>
                    )}
                    {liveViolationAlert.countsTowardLimit && (
                      <>
                        {' '}
                        · Vi phạm{' '}
                        <strong className="tabular-nums">
                          {liveViolationAlert.violationCount}/
                          {liveViolationAlert.maxViolations}
                        </strong>
                      </>
                    )}
                    {liveViolationAlert.autoSubmitted && (
                      <span className="ml-1 font-bold text-rose-700">
                        (Hệ thống đã tự thu bài)
                      </span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery(liveViolationAlert.username);
                    setViolationFeedStudentFilter(liveViolationAlert.username);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 hover:bg-slate-50 text-xs font-semibold text-slate-800 cursor-pointer whitespace-nowrap"
                >
                  Lọc học sinh này
                </button>
                <button
                  type="button"
                  aria-label="Đóng cảnh báo"
                  onClick={() => setLiveViolationAlert(null)}
                  className="p-1 rounded-lg hover:bg-black/5 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* Dải chỉ số giám sát trực tiếp bấm để lọc nhanh */}
          {(() => {
            const totalEntered = summary.inProgressCount + summary.submittedCount;
            const submittedPct =
              totalEntered > 0
                ? Math.round((summary.submittedCount / totalEntered) * 100)
                : 0;

            return (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 tabular-nums">
                  <button
                    type="button"
                    onClick={() => {
                      setOnlyWithViolations(false);
                      setLiveStatusFilter((prev) =>
                        prev === 'in_progress' ? 'all' : 'in_progress'
                      );
                    }}
                    className={`p-3.5 text-left transition-colors cursor-pointer ${
                      liveStatusFilter === 'in_progress'
                        ? 'bg-teal-50/70'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-medium text-slate-500">
                      Đang làm bài
                    </div>
                    <div className="text-2xl font-extrabold text-teal-700 mt-0.5">
                      {summary.inProgressCount}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOnlyWithViolations(false);
                      setLiveStatusFilter((prev) =>
                        prev === 'submitted' ? 'all' : 'submitted'
                      );
                    }}
                    className={`p-3.5 text-left transition-colors cursor-pointer ${
                      liveStatusFilter === 'submitted'
                        ? 'bg-teal-50/70'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-medium text-slate-500">
                      Đã nộp bài
                    </div>
                    <div className="text-2xl font-extrabold text-slate-900 mt-0.5">
                      {summary.submittedCount}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOnlyWithViolations(false);
                      setLiveStatusFilter((prev) =>
                        prev === 'not_entered' ? 'all' : 'not_entered'
                      );
                    }}
                    className={`p-3.5 text-left transition-colors cursor-pointer ${
                      liveStatusFilter === 'not_entered'
                        ? 'bg-teal-50/70'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-medium text-slate-500">
                      Chưa vào thi
                    </div>
                    <div className="text-2xl font-extrabold text-slate-600 mt-0.5">
                      {summary.notEnteredCount}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const next = liveStatusFilter === 'violations' ? 'all' : 'violations';
                      setLiveStatusFilter(next);
                      setOnlyWithViolations(next === 'violations');
                    }}
                    className={`p-3.5 text-left transition-colors cursor-pointer ${
                      liveStatusFilter === 'violations' || onlyWithViolations
                        ? 'bg-rose-50/70'
                        : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="text-xs font-medium text-slate-500">
                      Cảnh báo vi phạm
                    </div>
                    <div
                      className={`text-2xl font-extrabold mt-0.5 ${
                        totalViolatingStudentsCount > 0
                          ? 'text-rose-700'
                          : 'text-slate-600'
                      }`}
                    >
                      {totalViolatingStudentsCount}
                    </div>
                  </button>
                </div>

                {totalEntered > 0 && (
                  <div className="px-4 py-2 bg-slate-50/70 border-t border-slate-200 flex items-center gap-3 text-xs tabular-nums">
                    <span className="font-semibold text-slate-600 whitespace-nowrap">
                      Tiến độ thu bài: {summary.submittedCount}/{totalEntered} HS ({submittedPct}%)
                    </span>
                    <div className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                      <div
                        style={{ width: `${submittedPct}%` }}
                        className="h-full bg-teal-600 transition-all duration-300"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Thanh công cụ lọc: Bộ lọc trạng thái + "Chỉ hiện học sinh có vi phạm" + Tìm kiếm */}
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex flex-wrap items-center gap-1"
                role="tablist"
                aria-label="Lọc trạng thái thí sinh"
              >
                {(
                  [
                    { id: 'all', label: 'Tất cả' },
                    { id: 'in_progress', label: `Đang thi (${summary.inProgressCount})` },
                    { id: 'submitted', label: `Đã nộp (${summary.submittedCount})` },
                    { id: 'not_entered', label: `Chưa vào (${summary.notEnteredCount})` },
                  ] as const
                ).map((tab) => {
                  const active = liveStatusFilter === tab.id && !onlyWithViolations;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => {
                        setLiveStatusFilter(tab.id);
                        setOnlyWithViolations(false);
                      }}
                      className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer tabular-nums whitespace-nowrap ${
                        active
                          ? 'bg-slate-900 dark:bg-teal-700 text-white'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>

              <label
                data-testid="filter-only-violations-label"
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer select-none transition-colors whitespace-nowrap ${
                  onlyWithViolations
                    ? 'bg-rose-50 border-rose-300 text-rose-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={onlyWithViolations}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setOnlyWithViolations(checked);
                    setLiveStatusFilter(checked ? 'violations' : 'all');
                  }}
                  data-testid="filter-only-violations-toggle"
                  className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>
                  Chỉ hiện học sinh có vi phạm ({totalViolatingStudentsCount})
                </span>
              </label>
            </div>

            <div className="relative w-full lg:w-72">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Tìm tên học sinh, tài khoản..."
                data-testid="live-student-search-input"
                className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Theo dõi học sinh trực tiếp: Thẻ xếp dọc (< md) + Bảng đầy đủ (md+) */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-visible">
            {/* Giao diện thẻ xếp dọc cho điện thoại (< md) */}
            <div
              data-testid="mobile-live-monitoring-list"
              className="md:hidden divide-y divide-slate-200"
            >
              {rows.length === 0 ? (
                <div className="py-10 px-4 text-center text-xs text-slate-500">
                  {onlyWithViolations ? (
                    'Chưa có học sinh nào ghi nhận vi phạm trong ca thi này.'
                  ) : liveStatusFilter !== 'all' || searchQuery.trim() !== '' ? (
                    <div className="space-y-2">
                      <p>Không có học sinh nào khớp với bộ lọc hiện tại.</p>
                      <button
                        type="button"
                        onClick={() => {
                          setLiveStatusFilter('all');
                          setOnlyWithViolations(false);
                          setSearchQuery('');
                        }}
                        className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                      >
                        Hiện tất cả học sinh
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 py-2">
                      <p className="text-sm font-semibold text-slate-700">
                        Chưa có học sinh nào vào phòng thi này
                      </p>
                      <p className="text-xs text-slate-500">
                        Chiếu mã <strong className="font-mono text-slate-900">{session.code}</strong> lên màn hình hoặc gửi hướng dẫn vào nhóm lớp để học sinh bắt đầu làm bài.
                      </p>
                      <div className="grid grid-cols-1 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setIsProjectingCode(true)}
                          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                        >
                          <Maximize2 className="w-4 h-4" />
                          Chiếu mã lên màn hình
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleCopyShareMessage()}
                          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                        >
                          <Share2 className="w-4 h-4" />
                          {copiedShareMsg ? 'Đã sao chép!' : 'Sao chép gửi lớp'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                rows.map((row) => {
                  const isLowTime =
                    row.status === 'in_progress' &&
                    row.remainingSeconds !== null &&
                    row.remainingSeconds <= 300;

                  return (
                    <div
                      key={row.rowKey}
                      data-testid="mobile-monitor-student-card"
                      className={`p-4 space-y-3 ${
                        row.violationSeverity === 'exceeded'
                          ? 'bg-rose-50/35'
                          : row.violationSeverity === 'warning'
                            ? 'bg-amber-50/30'
                            : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-slate-900 text-sm flex flex-wrap items-center gap-1.5">
                            <span>{row.fullName}</span>
                            {row.previousAttemptId && (
                              <span className="px-1.5 py-0.5 rounded bg-teal-50 border border-teal-200 text-[10px] font-semibold text-teal-800">
                                Đã cấp lượt thi mới
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            @{row.username} ·{' '}
                            {row.className.toLowerCase().startsWith('lớp')
                              ? row.className
                              : `Lớp ${row.className}`}
                            {row.reentryCount > 0 ? ` · Vào lại ${row.reentryCount} lần` : ''}
                          </div>
                        </div>

                        {row.status === 'in_progress' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                            Đang thi
                          </span>
                        ) : row.status === 'submitted' ? (
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-bold border shrink-0 ${
                              row.submitReason === 'violation'
                                ? 'bg-rose-50 text-rose-800 border-rose-200'
                                : row.submitReason === 'timeout'
                                  ? 'bg-amber-50 text-amber-800 border-amber-200'
                                  : 'bg-slate-100 text-slate-700 border-slate-200'
                            }`}
                          >
                            Đã nộp
                            {row.submitReason
                              ? ` (${SUBMIT_REASON_LABELS[row.submitReason]})`
                              : ''}
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200 shrink-0">
                            Chưa vào
                          </span>
                        )}
                      </div>

                      {/* Tiến độ & Thời gian còn lại */}
                      <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80 space-y-2 tabular-nums">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-semibold text-slate-800">
                            Tiến độ: {row.answeredCount}/{row.totalQuestions} câu ({row.progressPercent}%)
                          </span>
                          <span
                            className={`font-mono font-bold ${
                              row.status === 'in_progress'
                                ? isLowTime
                                  ? 'text-rose-600'
                                  : 'text-slate-900'
                                : 'text-slate-400'
                            }`}
                          >
                            {row.status === 'in_progress'
                              ? formatCountdownMmSs(row.remainingSeconds)
                              : '—'}
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-200/70 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              row.status === 'not_entered' ? 'bg-slate-300' : 'bg-teal-600'
                            }`}
                            style={{
                              width: `${Math.min(100, Math.max(0, row.progressPercent))}%`,
                            }}
                          />
                        </div>
                      </div>

                      {/* Trạng thái vi phạm (bấm mở nhật ký vi phạm) */}
                      <div data-violation-popover-container className="space-y-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            if (openViolationPopoverRowKey === row.rowKey) {
                              setOpenViolationPopoverRowKey(null);
                              setViolationPopoverAnchor(null);
                              return;
                            }
                            const rect = e.currentTarget.getBoundingClientRect();
                            const width = Math.min(360, Math.max(280, window.innerWidth - 24));
                            const estimatedHeight = 260;
                            const spaceBelow = window.innerHeight - rect.bottom;
                            const openUpward =
                              spaceBelow < estimatedHeight && rect.top > estimatedHeight;
                            const left = Math.min(
                              window.innerWidth - width - 12,
                              Math.max(12, rect.left)
                            );
                            setViolationPopoverAnchor({
                              top: openUpward ? Math.max(12, rect.top - 8) : rect.bottom + 8,
                              left,
                              width,
                              placement: openUpward ? 'top' : 'bottom',
                            });
                            setOpenViolationPopoverRowKey(row.rowKey);
                          }}
                          className={`w-full min-h-[44px] inline-flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-xs font-bold border transition-colors cursor-pointer tabular-nums ${
                            row.violationSeverity === 'exceeded'
                              ? 'bg-rose-100 text-rose-900 border-rose-300'
                              : row.violationSeverity === 'warning'
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                          }`}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {row.violationSeverity !== 'normal' && (
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                            )}
                            <span>
                              Vi phạm: {row.violationCount}/{session.maxViolations}{' '}
                              {row.violationSeverity === 'exceeded'
                                ? '(Đã vượt)'
                                : row.violationSeverity === 'warning'
                                  ? '(Gần ngưỡng)'
                                  : '(Bình thường)'}
                            </span>
                          </span>
                          <span className="text-[11px] font-semibold underline opacity-80">
                            Xem nhật ký
                          </span>
                        </button>
                        {row.recentViolations.length > 0 && (
                          <div className="text-[11px] text-slate-600 px-1 truncate tabular-nums">
                            {formatLatestViolationInlineSummary(row.recentViolations[0])}
                          </div>
                        )}
                      </div>

                      {/* Hành động mỗi học sinh (nút chạm 44px) */}
                      {row.status === 'not_entered' ? (
                        <div className="text-xs text-slate-400 text-center py-1">
                          Đang chờ học sinh vào phòng thi
                        </div>
                      ) : row.status === 'in_progress' ? (
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenExtendStudentModal(row)}
                            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-slate-300 bg-white hover:bg-teal-50 hover:border-teal-300 text-slate-800 hover:text-teal-900 text-xs font-semibold cursor-pointer"
                          >
                            <Clock className="w-4 h-4" />
                            <span>Gia hạn</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmForceSubmitRow(row)}
                            className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-rose-200 bg-rose-50/70 hover:bg-rose-100 text-rose-700 text-xs font-semibold cursor-pointer"
                          >
                            <Send className="w-4 h-4" />
                            <span>Nộp bài giúp</span>
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setReentryExtraMinutes('15');
                            setConfirmReentryRow(row);
                          }}
                          className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-teal-600 bg-teal-50/60 hover:bg-teal-100 text-teal-900 text-xs font-bold cursor-pointer"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Cho vào lại (Tạo lượt mới)</span>
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Giao diện bảng đầy đủ trên máy tính (md+) */}
            <div className="hidden md:block overflow-x-auto">
              <table
                className="w-full text-left border-collapse"
                data-testid="live-monitoring-students-table"
              >
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-600 whitespace-nowrap">
                    <th className="py-3 px-4">Học sinh</th>
                    <th className="py-3 px-4">Trạng thái</th>
                    <th className="py-3 px-4">Tiến độ</th>
                    <th className="py-3 px-4">Thời gian còn lại</th>
                    <th className="py-3 px-4">Số lần vi phạm</th>
                    <th className="py-3 px-4 text-right">Hành động</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm">
                  {rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="py-10 px-4 text-center text-slate-500"
                        data-testid="live-students-empty-row"
                      >
                        {onlyWithViolations ? (
                          'Chưa có học sinh nào ghi nhận vi phạm trong ca thi này.'
                        ) : liveStatusFilter !== 'all' || searchQuery.trim() !== '' ? (
                          <div className="space-y-2">
                            <p>Không có học sinh nào khớp với bộ lọc hiện tại.</p>
                            <button
                              type="button"
                              onClick={() => {
                                setLiveStatusFilter('all');
                                setOnlyWithViolations(false);
                                setSearchQuery('');
                              }}
                              className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                            >
                              Hiện tất cả học sinh
                            </button>
                          </div>
                        ) : (
                          <div className="max-w-md mx-auto space-y-3 py-2">
                            <p className="text-sm font-semibold text-slate-700">
                              Chưa có học sinh nào vào phòng thi này
                            </p>
                            <p className="text-xs text-slate-500">
                              Chiếu mã <strong className="font-mono text-slate-900">{session.code}</strong> lên màn hình hoặc gửi hướng dẫn vào nhóm lớp để học sinh bắt đầu làm bài.
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                              <button
                                type="button"
                                onClick={() => setIsProjectingCode(true)}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                                Chiếu mã lên màn hình
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleCopyShareMessage()}
                                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold cursor-pointer"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                                {copiedShareMsg ? 'Đã sao chép!' : 'Sao chép gửi lớp'}
                              </button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const isLowTime =
                        row.status === 'in_progress' &&
                        row.remainingSeconds !== null &&
                        row.remainingSeconds <= 300;

                      return (
                        <tr
                          key={row.rowKey}
                          data-testid={`live-student-row-${row.username}`}
                          className={`transition-colors ${
                            row.violationSeverity === 'exceeded'
                              ? 'bg-rose-50/35 hover:bg-rose-50/60'
                              : row.violationSeverity === 'warning'
                                ? 'bg-amber-50/30 hover:bg-amber-50/50'
                                : 'hover:bg-slate-50/70'
                          }`}
                        >
                          {/* 1. Tên học sinh */}
                          <td className="py-3 px-4 align-middle">
                            <div className="font-bold text-slate-900 flex flex-wrap items-center gap-1.5">
                              <span>{row.fullName}</span>
                              {row.previousAttemptId && (
                                <span
                                  data-testid={`reentry-new-attempt-badge-${row.username}`}
                                  className="px-1.5 py-0.5 rounded bg-teal-50 border border-teal-200 text-[11px] font-semibold text-teal-800"
                                >
                                  Đã cấp lượt thi mới
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-slate-500 flex items-center gap-2 mt-0.5">
                              <span>@{row.username}</span>
                              <span>·</span>
                              <span>
                                {row.className.toLowerCase().startsWith('lớp')
                                  ? row.className
                                  : `Lớp ${row.className}`}
                              </span>
                              {row.reentryCount > 0 && (
                                <>
                                  <span>•</span>
                                  <span className="text-slate-600 font-medium tabular-nums">
                                    Vào lại {row.reentryCount} lần
                                  </span>
                                </>
                              )}
                            </div>
                          </td>

                          {/* 2. Trạng thái */}
                          <td className="py-3 px-4 align-middle whitespace-nowrap">
                            {row.status === 'in_progress' ? (
                              <span
                                data-testid={`student-status-${row.username}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200"
                              >
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
                                Đang thi
                              </span>
                            ) : row.status === 'submitted' ? (
                              <div className="space-y-0.5">
                                <span
                                  data-testid={`student-status-${row.username}`}
                                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${
                                    row.submitReason === 'violation'
                                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                                      : row.submitReason === 'timeout'
                                        ? 'bg-amber-50 text-amber-800 border-amber-200'
                                        : 'bg-slate-100 text-slate-700 border-slate-200'
                                  }`}
                                >
                                  Đã nộp
                                  {row.submitReason
                                    ? ` (${SUBMIT_REASON_LABELS[row.submitReason]})`
                                    : ''}
                                </span>
                              </div>
                            ) : (
                              <span
                                data-testid={`student-status-${row.username}`}
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-500 border border-slate-200"
                              >
                                Chưa vào
                              </span>
                            )}
                          </td>

                          {/* 3. Tiến độ (số câu đã làm/tổng + thanh mảnh) */}
                          <td className="py-3 px-4 align-middle min-w-[140px]">
                            <div className="flex items-center justify-between text-xs font-semibold text-slate-800 tabular-nums mb-1">
                              <span data-testid={`student-progress-text-${row.username}`}>
                                {row.answeredCount}/{row.totalQuestions} câu
                              </span>
                              <span className="text-slate-400">
                                {row.progressPercent}%
                              </span>
                            </div>
                            <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full transition-all duration-300 ${
                                  row.status === 'not_entered'
                                    ? 'bg-slate-300'
                                    : 'bg-teal-600'
                                }`}
                                style={{
                                  width: `${Math.min(100, Math.max(0, row.progressPercent))}%`,
                                }}
                              />
                            </div>
                          </td>

                          {/* 4. Thời gian còn lại */}
                          <td className="py-3 px-4 align-middle whitespace-nowrap tabular-nums">
                            {row.status === 'in_progress' ? (
                              <span
                                data-testid={`student-remaining-${row.username}`}
                                className={`font-mono font-bold text-sm ${
                                  isLowTime ? 'text-rose-600' : 'text-slate-800'
                                }`}
                              >
                                {formatCountdownMmSs(row.remainingSeconds)}
                              </span>
                            ) : (
                              <span
                                data-testid={`student-remaining-${row.username}`}
                                className="text-slate-400 font-mono text-sm"
                              >
                                —
                              </span>
                            )}
                          </td>

                          {/* 5. Số lần vi phạm (tô màu theo mức: bình thường, gần ngưỡng, đã vượt; bấm mở popover) */}
                          <td
                            className="py-3 px-4 align-middle whitespace-nowrap relative"
                            data-violation-popover-container
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                if (openViolationPopoverRowKey === row.rowKey) {
                                  setOpenViolationPopoverRowKey(null);
                                  setViolationPopoverAnchor(null);
                                  return;
                                }
                                const rect =
                                  e.currentTarget.getBoundingClientRect();
                                const width = Math.min(
                                  360,
                                  Math.max(280, window.innerWidth - 24)
                                );
                                const estimatedHeight = 260;
                                const spaceBelow =
                                  window.innerHeight - rect.bottom;
                                const openUpward =
                                  spaceBelow < estimatedHeight &&
                                  rect.top > estimatedHeight;
                                const left = Math.min(
                                  window.innerWidth - width - 12,
                                  Math.max(12, rect.left)
                                );
                                setViolationPopoverAnchor({
                                  top: openUpward
                                    ? Math.max(12, rect.top - 8)
                                    : rect.bottom + 8,
                                  left,
                                  width,
                                  placement: openUpward ? 'top' : 'bottom',
                                });
                                setOpenViolationPopoverRowKey(row.rowKey);
                              }}
                              data-testid={`student-violation-badge-${row.username}`}
                              data-severity={row.violationSeverity}
                              aria-expanded={
                                openViolationPopoverRowKey === row.rowKey
                              }
                              title="Bấm để xem các sự kiện vi phạm gần nhất"
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border transition-colors cursor-pointer tabular-nums ${
                                row.violationSeverity === 'exceeded'
                                  ? 'bg-rose-100 text-rose-900 border-rose-300 hover:bg-rose-200/70'
                                  : row.violationSeverity === 'warning'
                                    ? 'bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200/70'
                                    : 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-200/70'
                              }`}
                            >
                              {row.violationSeverity !== 'normal' && (
                                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                              )}
                              <span>
                                {row.violationCount}/{session.maxViolations}
                              </span>
                              <span className="text-[11px] font-medium opacity-80">
                                {row.violationSeverity === 'exceeded'
                                  ? '(Đã vượt)'
                                  : row.violationSeverity === 'warning'
                                    ? '(Gần ngưỡng)'
                                    : '(Bình thường)'}
                              </span>
                            </button>
                            {row.recentViolations.length > 0 && (
                              <div
                                data-testid={`student-latest-violation-time-${row.username}`}
                                title={
                                  formatLatestViolationInlineSummary(
                                    row.recentViolations[0]
                                  ) || ''
                                }
                                className="text-[11px] text-slate-600 mt-1 max-w-[230px] truncate tabular-nums"
                              >
                                {formatLatestViolationInlineSummary(
                                  row.recentViolations[0]
                                )}
                              </div>
                            )}
                          </td>

                          {/* 6. Hành động mỗi học sinh: "Gia hạn", "Nộp bài giúp", "Cho vào lại" */}
                          <td className="py-3 px-4 align-middle text-right whitespace-nowrap">
                            {row.status === 'not_entered' ? (
                              <span className="text-xs text-slate-400">
                                Chờ vào thi
                              </span>
                            ) : (
                              <div className="inline-flex items-center justify-end gap-1.5">
                                {row.status === 'in_progress' && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleOpenExtendStudentModal(row)
                                      }
                                      data-testid={`student-extend-btn-${row.username}`}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-teal-50 hover:border-teal-300 text-slate-700 hover:text-teal-800 text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                      <Clock className="w-3.5 h-3.5" />
                                      Gia hạn
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setConfirmForceSubmitRow(row)
                                      }
                                      data-testid={`student-force-submit-btn-${row.username}`}
                                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 bg-white hover:bg-rose-50 text-rose-700 text-xs font-semibold transition-colors cursor-pointer"
                                    >
                                      <Send className="w-3.5 h-3.5" />
                                      Nộp bài giúp
                                    </button>
                                  </>
                                )}

                                {row.status === 'submitted' && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReentryExtraMinutes('15');
                                      setConfirmReentryRow(row);
                                    }}
                                    data-testid={`student-allow-reentry-btn-${row.username}`}
                                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-teal-600 bg-white hover:bg-teal-50 text-teal-800 text-xs font-semibold transition-colors cursor-pointer"
                                  >
                                    <RotateCcw className="w-3.5 h-3.5" />
                                    Cho vào lại
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dòng ghi nhận hành vi gian lận theo thời gian thực */}
          <div
            data-testid="live-violation-timeline-panel"
            className="bg-white rounded-xl border border-slate-200 overflow-hidden"
          >
            <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-rose-600" />
                  <span>Ghi nhận gian lận theo thời gian thực</span>
                </h3>
                <span
                  data-testid="live-violation-timeline-count"
                  className="px-2 py-0.5 rounded-md bg-white border border-slate-200 text-xs font-bold text-slate-700 tabular-nums"
                >
                  {violationTimeline.length} sự kiện
                </span>
                {violationFeedStudentFilter && (
                  <button
                    type="button"
                    onClick={() => setViolationFeedStudentFilter(null)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-teal-50 border border-teal-200 text-teal-800 text-xs font-semibold cursor-pointer"
                  >
                    <span>HS: @{violationFeedStudentFilter}</span>
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1">
                {(
                  [
                    { id: 'all', label: 'Tất cả' },
                    { id: 'screen_leave', label: 'Rời màn hình / Đổi tab' },
                    { id: 'blocked_action', label: 'Phím bị chặn / Sao chép' },
                  ] as const
                ).map((cat) => {
                  const active = violationFeedCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setViolationFeedCategory(cat.id)}
                      data-testid={`violation-feed-filter-${cat.id}`}
                      className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                        active
                          ? 'bg-slate-900 dark:bg-teal-700 text-white'
                          : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {filteredViolationTimeline.length === 0 ? (
              <div
                data-testid="live-violation-timeline-empty"
                className="px-4 py-7 text-center text-xs text-slate-500"
              >
                {violationTimeline.length === 0
                  ? 'Chưa ghi nhận hành vi gian lận nào trong ca thi này. Hệ thống đang giám sát trực tiếp từng giây.'
                  : 'Không có sự kiện vi phạm nào khớp với bộ lọc hiện tại.'}
              </div>
            ) : (
              <div className="max-h-80 overflow-y-auto divide-y divide-slate-200">
                {filteredViolationTimeline.slice(0, 60).map((ev) => {
                  const isNewlyArrived = highlightedViolationIds.includes(ev.id);
                  return (
                    <div
                      key={ev.id}
                      data-testid={`live-violation-event-${ev.id}`}
                      className={`px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition-colors ${
                        isNewlyArrived
                          ? 'bg-rose-50/80'
                          : ev.severity === 'critical'
                            ? 'bg-rose-50/30 hover:bg-rose-50/50'
                            : 'hover:bg-slate-50/70'
                      }`}
                    >
                      <div className="flex items-start sm:items-center gap-3 min-w-0">
                        {/* Mốc thời gian cụ thể đến từng giây */}
                        <div className="shrink-0 w-24 text-left font-mono tabular-nums">
                          <div className="font-bold text-slate-900 text-xs">
                            {ev.timeFormatted}
                          </div>
                          <div className="text-[10px] text-slate-400">
                            {ev.dateFormatted}
                          </div>
                        </div>

                        <div className="min-w-0 space-y-0.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <button
                              type="button"
                              onClick={() => {
                                setSearchQuery(ev.username);
                                setViolationFeedStudentFilter(ev.username);
                              }}
                              className="font-bold text-slate-900 hover:text-teal-700 cursor-pointer"
                            >
                              {ev.studentName}
                            </button>
                            <span className="font-mono text-[11px] text-slate-500">
                              @{ev.username}
                            </span>
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md font-bold text-[11px] border ${
                                ev.severity === 'critical'
                                  ? 'bg-rose-100 text-rose-900 border-rose-300'
                                  : ev.severity === 'warning'
                                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                                    : 'bg-slate-100 text-slate-700 border-slate-200'
                              }`}
                            >
                              {ev.typeLabel}
                            </span>
                            {isNewlyArrived && (
                              <span className="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold">
                                MỚI
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                            <span>
                              Câu đang làm: <strong>#{ev.currentQuestionOrder}</strong>
                            </span>
                            {ev.awaySeconds > 0 && (
                              <span>
                                · Rời màn hình:{' '}
                                <strong className="text-rose-700">
                                  {formatAwayDurationVietnamese(ev.awaySeconds)}
                                </strong>
                              </span>
                            )}
                            {ev.note && (
                              <span className="text-slate-500">· {ev.note}</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0 sm:pl-2 tabular-nums">
                        {ev.countsTowardLimit ? (
                          <span
                            className={`px-2 py-0.5 rounded-md text-[11px] font-bold border whitespace-nowrap ${
                              ev.isAutoSubmitTrigger
                                ? 'bg-rose-100 border-rose-300 text-rose-900'
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                            }`}
                          >
                            {ev.isAutoSubmitTrigger
                              ? `Tự thu bài (${ev.studentViolationCount}/${ev.maxViolations})`
                              : `Tính ngưỡng (${ev.studentViolationCount}/${ev.maxViolations})`}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 border border-slate-200 text-slate-600 whitespace-nowrap">
                            Đã chặn (ghi nhật ký)
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Nhật ký thao tác ca thi */}
          {detail && detail.auditLogs && detail.auditLogs.length > 0 && (
            <div
              data-testid="session-audit-log-panel"
              className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-teal-700" />
                  Nhật ký thao tác ca thi
                </h3>
                <span className="text-xs text-slate-400 tabular-nums">
                  {detail.auditLogs.length} bản ghi
                </span>
              </div>
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 text-xs">
                {detail.auditLogs.slice(0, 10).map((log) => (
                  <div
                    key={log.id}
                    className="py-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-slate-600"
                  >
                    <div>
                      <span className="font-semibold text-teal-800 mr-2">
                        {AUDIT_ACTION_LABELS[log.action] || log.action}:
                      </span>
                      <span>{formatAuditLogNote(log.action, log.note)}</span>
                    </div>
                    <span className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0">
                      {formatTimeHhMmSs(log.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: GIA HẠN THỜI GIAN (Cho 1 học sinh hoặc Cho cả ca thi) */}
      {extendModalTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 overflow-y-auto"
          data-testid="extend-time-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-xl">
            <div className="sticky top-0 z-10 px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0">
                <h3 className="text-base font-bold text-slate-900">
                  {extendModalTarget.mode === 'session'
                    ? 'Gia hạn thời gian cho cả ca thi'
                    : `Gia hạn cho học sinh: ${extendModalTarget.row?.fullName}`}
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  {extendModalTarget.mode === 'session'
                    ? 'Cộng thêm số phút vào thời lượng ca thi và tất cả học sinh đang làm bài.'
                    : `Cộng thêm thời gian làm bài cho tài khoản @${extendModalTarget.row?.username}.`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExtendModalTarget(null)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 -mr-2 -mt-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmExtend} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-5 sm:p-6 overflow-y-auto overscroll-contain flex-1 min-h-0">
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Số phút cộng thêm
                </label>
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  {[5, 10, 15, 30].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setExtendMinutesInput(String(preset));
                        setExtendInputError(null);
                      }}
                      className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer tabular-nums ${
                        Number(extendMinutesInput) === preset
                          ? 'bg-teal-50 border-teal-600 text-teal-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      +{preset} phút
                    </button>
                  ))}
                </div>
                <input
                  type="number"
                  min={1}
                  max={180}
                  value={extendMinutesInput}
                  onChange={(e) => {
                    setExtendMinutesInput(e.target.value);
                    setExtendInputError(null);
                  }}
                  data-testid="extend-minutes-input"
                  className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-base sm:text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                />
                {extendInputError && (
                  <p className="text-xs font-medium text-rose-600 mt-1">
                    {extendInputError}
                  </p>
                )}
              </div>

              <div className="sticky bottom-0 z-10 px-5 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={isSubmittingExtend}
                  onClick={() => setExtendModalTarget(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExtend}
                  data-testid="confirm-extend-submit-btn"
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingExtend ? 'Đang lưu...' : 'Xác nhận gia hạn'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: XÁC NHẬN NỘP BÀI GIÚP */}
      {confirmForceSubmitRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 overflow-y-auto"
          data-testid="confirm-force-submit-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-xl">
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 min-h-0">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-rose-50 text-rose-700 shrink-0">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Nộp bài giúp học sinh?
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Hệ thống sẽ chốt ngay bài làm hiện tại của{' '}
                    <strong>{confirmForceSubmitRow.fullName}</strong> (đã làm{' '}
                    <strong>
                      {confirmForceSubmitRow.answeredCount}/
                      {confirmForceSubmitRow.totalQuestions}
                    </strong>{' '}
                    câu), chấm điểm tự động và ghi nhận vào nhật ký ca thi.
                  </p>
                </div>
              </div>
            </div>

            <div className="sticky bottom-0 px-5 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                disabled={isSubmittingForceSubmit}
                onClick={() => setConfirmForceSubmitRow(null)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmittingForceSubmit}
                onClick={() => void handleConfirmForceSubmit()}
                data-testid="confirm-force-submit-btn"
                className="min-h-[44px] px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {isSubmittingForceSubmit
                  ? 'Đang nộp bài...'
                  : 'Xác nhận nộp bài giúp'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: XÁC NHẬN CHO VÀO LẠI (Tạo lượt thi mới, giữ nguyên bài cũ) */}
      {confirmReentryRow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 overflow-y-auto"
          data-testid="confirm-allow-reentry-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-xl">
            <div className="sticky top-0 z-10 px-5 sm:px-6 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-3 shrink-0">
              <h3 className="text-base font-bold text-slate-900">
                Cho phép học sinh vào thi lại
              </h3>
              <button
                type="button"
                onClick={() => setConfirmReentryRow(null)}
                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 cursor-pointer shrink-0 -mr-2 -mt-2"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmAllowReentry} className="flex-1 min-h-0 flex flex-col overflow-hidden">
              <div className="p-5 sm:p-6 space-y-4 overflow-y-auto overscroll-contain flex-1 min-h-0">
                <div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Học sinh <strong>{confirmReentryRow.fullName}</strong> đã bị
                    nộp bài ({SUBMIT_REASON_LABELS[confirmReentryRow.submitReason || 'voluntary']}). Khi cho vào lại:
                  </p>
                  <ul className="text-xs text-slate-600 mt-2 space-y-1 list-disc pl-4">
                    <li>
                      <strong>Giữ nguyên bài cũ</strong> ({confirmReentryRow.attemptId}) trong cơ sở dữ liệu.
                    </li>
                    <li>
                      <strong>Tạo lượt thi mới</strong> với toàn bộ{' '}
                      <strong>
                        {confirmReentryRow.answeredCount}/
                        {confirmReentryRow.totalQuestions}
                      </strong>{' '}
                      đáp án đã làm trước đó để học sinh làm tiếp.
                    </li>
                    <li>Ghi rõ thao tác vào nhật ký kiểm toán ca thi.</li>
                  </ul>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Thời gian làm bài tiếp cho lượt thi mới (phút)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={reentryExtraMinutes}
                    onChange={(e) => setReentryExtraMinutes(e.target.value)}
                    data-testid="reentry-extra-minutes-input"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-slate-300 text-base sm:text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                  />
                </div>
              </div>

              <div className="sticky bottom-0 z-10 px-5 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
                <button
                  type="button"
                  disabled={isSubmittingReentry}
                  onClick={() => setConfirmReentryRow(null)}
                  className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReentry}
                  data-testid="confirm-allow-reentry-btn"
                  className="min-h-[44px] px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingReentry
                    ? 'Đang xử lý...'
                    : 'Tạo lượt thi mới & Cho vào lại'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: XÁC NHẬN KẾT THÚC CA THI NGAY TRONG TRANG CHI TIẾT */}
      {isConfirmEndModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-3 sm:p-4 overflow-y-auto"
          data-testid="detail-confirm-end-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full max-h-[90dvh] flex flex-col overflow-hidden shadow-xl">
            <div className="p-5 sm:p-6 overflow-y-auto flex-1 min-h-0">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-amber-100 text-amber-800 shrink-0">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Kết thúc ca thi & Thu toàn bộ bài làm?
                  </h3>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    Ca thi <strong>{session.title}</strong> (mã{' '}
                    <span className="font-mono font-bold">{session.code}</span>) sẽ
                    đóng vĩnh viễn và hệ thống sẽ tự động thu bài của{' '}
                    <strong>{summary.inProgressCount} học sinh đang thi</strong>.
                  </p>
                </div>
              </div>
            </div>
            <div className="sticky bottom-0 px-5 sm:px-6 py-3.5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5 shrink-0">
              <button
                type="button"
                disabled={isEndingSession}
                onClick={() => setIsConfirmEndModalOpen(false)}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isEndingSession}
                onClick={() => void handleEndSessionNow()}
                data-testid="detail-confirm-end-submit-btn"
                className="min-h-[44px] px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
              >
                {isEndingSession ? 'Đang thu bài...' : 'Kết thúc & Thu bài'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Màn hình Chiếu mã chữ lớn kèm số liệu trực tiếp */}
      {isProjectingCode && (
        <div
          className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col justify-between p-6 sm:p-10 select-none"
          data-testid="detail-projected-code-modal"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-teal-400">
                Phòng thi trực tuyến · {STATUS_LABELS[session.status]}
              </div>
              <div className="text-xl sm:text-2xl font-bold text-white mt-0.5">
                {session.title}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setIsProjectingCode(false)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold cursor-pointer"
            >
              <X className="w-4 h-4" />
              Đóng (Esc)
            </button>
          </div>

          <div className="my-auto text-center space-y-6 max-w-3xl mx-auto">
            <p className="text-base sm:text-lg text-slate-300">
              Học sinh mở mục <strong className="text-white">Thi ngay</strong> và nhập mã:
            </p>
            <div className="font-mono font-black text-7xl sm:text-9xl tracking-[0.22em] text-teal-400 bg-slate-900 border-2 border-teal-500/50 rounded-3xl px-8 sm:px-14 py-8 sm:py-10 shadow-2xl tabular-nums select-all">
              {session.code}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-4 text-sm sm:text-base text-slate-300 tabular-nums">
              <span>
                Đang thi: <strong className="text-emerald-400">{summary.inProgressCount}</strong>
              </span>
              <span>·</span>
              <span>
                Đã nộp: <strong className="text-white">{summary.submittedCount}</strong>
              </span>
              <span>·</span>
              <span>
                {session.questionCount} câu · {session.durationMinutes} phút
              </span>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => void handleCopyCode()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-sm font-semibold cursor-pointer"
              >
                {copiedCode ? <Check className="w-4 h-4 text-teal-400" /> : <Copy className="w-4 h-4" />}
                {copiedCode ? 'Đã sao chép mã' : 'Sao chép mã'}
              </button>
              <button
                type="button"
                onClick={() => void handleCopyShareMessage()}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-teal-700 hover:bg-teal-600 text-white text-sm font-semibold cursor-pointer"
              >
                {copiedShareMsg ? <Check className="w-4 h-4" /> : <Share2 className="w-4 h-4" />}
                {copiedShareMsg ? 'Đã sao chép tin nhắn Zalo' : 'Sao chép gửi lớp'}
              </button>
            </div>
          </div>

          <div className="text-center text-xs text-slate-400">
            Số lượng học sinh đang thi tự động cập nhật theo thời gian thực · Bấm Esc để đóng
          </div>
        </div>
      )}
      {/* Popover Nhật ký vi phạm nổi qua Portal (không bị cắt bởi khung bảng) */}
      {openViolationPopoverRowKey &&
        violationPopoverAnchor &&
        typeof document !== 'undefined' &&
        (() => {
          const activeRow = rows.find(
            (r) => r.rowKey === openViolationPopoverRowKey
          );
          if (!activeRow) return null;
          return createPortal(
            <div
              data-violation-popover-container
              data-testid={`violation-popover-${activeRow.username}`}
              style={{
                position: 'fixed',
                top: violationPopoverAnchor.top,
                left: violationPopoverAnchor.left,
                width: violationPopoverAnchor.width,
                transform:
                  violationPopoverAnchor.placement === 'top'
                    ? 'translateY(-100%)'
                    : undefined,
              }}
              className="z-[80] bg-white rounded-xl border border-slate-200 shadow-xl p-3.5 text-left whitespace-normal"
            >
              <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100">
                <div>
                  <div className="text-xs font-bold text-slate-900">
                    Nhật ký vi phạm • {activeRow.fullName}
                  </div>
                  <div className="text-[11px] text-slate-500 tabular-nums">
                    Tính vào ngưỡng: {activeRow.violationCount}/
                    {session.maxViolations} lần • Tổng sự kiện:{' '}
                    {activeRow.recentViolations.length}
                  </div>
                </div>
                <button
                  type="button"
                  aria-label="Đóng nhật ký vi phạm"
                  onClick={() => {
                    setOpenViolationPopoverRowKey(null);
                    setViolationPopoverAnchor(null);
                  }}
                  className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {activeRow.recentViolations.length === 0 ? (
                <p className="text-xs text-slate-500 py-3 text-center">
                  Học sinh này chưa có sự kiện vi phạm nào.
                </p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
                  {activeRow.recentViolations
                    .slice(0, 12)
                    .map((v: ViolationEventRecord) => {
                      const exactTime = formatExactViolationTimestamp(v.occurredAt);
                      const awayText = formatAwayDurationVietnamese(v.awaySeconds);
                      return (
                        <div key={v.id} className="py-2 text-xs space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-semibold text-slate-800">
                              {VIOLATION_TYPE_LABELS[v.type] || v.type}
                            </span>
                            <span className="text-[11px] text-rose-700 font-mono font-semibold tabular-nums shrink-0">
                              {exactTime.full}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-2">
                            <span>
                              Câu đang làm: <strong>#{v.currentQuestionOrder}</strong>
                            </span>
                            {awayText && (
                              <span>
                                • Rời màn hình:{' '}
                                <strong className="text-rose-700">{awayText}</strong>
                              </span>
                            )}
                            {v.note && (
                              <span className="text-slate-500">• {v.note}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>,
            document.body
          );
        })()}
    </div>
  );
};
