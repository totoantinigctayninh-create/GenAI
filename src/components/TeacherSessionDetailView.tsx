import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  Clock,
  Copy,
  History,
  Lock,
  Maximize2,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Unlock,
  Users,
  X,
} from 'lucide-react';
import { UserAccount } from '../types/exam';
import {
  AttemptSubmitReason,
  ExamSessionRecord,
  ExamSessionStatus,
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
import { TeacherSessionResultsOverview } from './TeacherSessionResultsOverview';

interface TeacherSessionDetailViewProps {
  currentUser: UserAccount;
  sessionId: string;
  initialSession?: ExamSessionRecord;
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

export const TeacherSessionDetailView: React.FC<
  TeacherSessionDetailViewProps
> = ({ currentUser, sessionId, initialSession, onBack, onSessionUpdated }) => {
  const teacherId = currentUser.id || currentUser.username;

  const [activeTab, setActiveTab] = useState<'live' | 'results'>('live');
  const [detail, setDetail] = useState<TeacherSessionDetailPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [serverOffsetMs, setServerOffsetMs] = useState<number>(0);
  const [clientNowMs, setClientNowMs] = useState<number>(() => Date.now());

  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Sao chép mã & Chiếu mã toàn màn hình
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [isProjectingCode, setIsProjectingCode] = useState<boolean>(false);
  const [isLockSwitchBusy, setIsLockSwitchBusy] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Bộ lọc bảng học sinh
  const [onlyWithViolations, setOnlyWithViolations] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Popover xem danh sách sự kiện vi phạm gần nhất của 1 học sinh
  const [openViolationPopoverRowKey, setOpenViolationPopoverRowKey] = useState<
    string | null
  >(null);

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

  const loadDetail = useCallback(
    async (silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setIsRefreshing(true);
      }
      try {
        const res = await examSessionApi.getSessionDetail(teacherId, sessionId);
        setDetail(res);
        if (res.serverNow) {
          setServerOffsetMs(computeServerClockOffsetMs(res.serverNow, Date.now()));
        }
        setClientNowMs(Date.now());
        if (onSessionUpdated && res.session) {
          onSessionUpdated(res.session);
        }
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
    [teacherId, sessionId, onSessionUpdated]
  );

  // Cập nhật thời gian thực mỗi 5 giây theo yêu cầu Bước 6/8
  useEffect(() => {
    void loadDetail(false);
    const pollInterval = window.setInterval(() => {
      void loadDetail(true);
    }, 5000);
    return () => window.clearInterval(pollInterval);
  }, [loadDetail]);

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
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
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

  const rows = useMemo(() => {
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
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border ${
                  session.status === 'open'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : isLocked
                      ? 'bg-amber-50 text-amber-800 border-amber-200'
                      : 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    session.status === 'open'
                      ? 'bg-emerald-600'
                      : isLocked
                        ? 'bg-amber-600'
                        : 'bg-slate-400'
                  }`}
                />
                {STATUS_LABELS[session.status]}
              </span>

              <span className="text-xs text-slate-500 tabular-nums">
                {session.questionCount} câu • {session.durationMinutes} phút • Ngưỡng vi phạm:{' '}
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

          {/* Cụm Mã ca thi + Công tắc Khóa/Mở khóa + Gia hạn cả ca ở đầu trang */}
          <div className="flex flex-wrap items-center gap-3">
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

            {/* Công tắc Khóa / Mở khóa ở đầu trang */}
            {!isEnded && (
              <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5">
                {isDraft ? (
                  <button
                    type="button"
                    disabled={isLockSwitchBusy}
                    onClick={() => void handleToggleLock()}
                    data-testid="detail-open-session-btn"
                    className="inline-flex items-center gap-1.5 text-xs font-bold text-teal-700 hover:text-teal-800 cursor-pointer disabled:opacity-50"
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

            {/* Nút hành động cấp ca thi: Gia hạn cho cả ca */}
            {!isEnded && (
              <button
                type="button"
                onClick={handleOpenExtendSessionModal}
                data-testid="extend-whole-session-btn"
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                <Clock className="w-3.5 h-3.5" />
                Gia hạn cho cả ca
              </button>
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

          <div className="flex items-center gap-2 text-xs text-slate-500">
            <span className="hidden sm:inline">
              Tự động cập nhật mỗi 5 giây
            </span>
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
          {/* Thanh công cụ lọc: "Chỉ hiện học sinh có vi phạm" + Tìm kiếm */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label
                data-testid="filter-only-violations-label"
                className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold cursor-pointer select-none transition-colors ${
                  onlyWithViolations
                    ? 'bg-rose-50 border-rose-300 text-rose-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={onlyWithViolations}
                  onChange={(e) => setOnlyWithViolations(e.target.checked)}
                  data-testid="filter-only-violations-toggle"
                  className="w-4 h-4 rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                />
                <span>
                  Chỉ hiện học sinh có vi phạm ({totalViolatingStudentsCount})
                </span>
              </label>

              <span className="text-xs text-slate-500">
                Học sinh có vi phạm nhiều được xếp lên đầu danh sách
              </span>
            </div>

            <div className="relative w-full sm:w-72">
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

          {/* Bảng theo dõi học sinh trực tiếp */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-visible">
            <div className="overflow-x-auto">
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
                        {onlyWithViolations
                          ? 'Chưa có học sinh nào ghi nhận vi phạm trong ca thi này.'
                          : 'Chưa có học sinh nào trong danh sách theo dõi.'}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row) => {
                      const isLowTime =
                        row.status === 'in_progress' &&
                        row.remainingSeconds !== null &&
                        row.remainingSeconds <= 300;
                      const isPopoverOpen =
                        openViolationPopoverRowKey === row.rowKey;

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
                              <span>•</span>
                              <span>Lớp {row.className}</span>
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
                              onClick={() =>
                                setOpenViolationPopoverRowKey((prev) =>
                                  prev === row.rowKey ? null : row.rowKey
                                )
                              }
                              data-testid={`student-violation-badge-${row.username}`}
                              data-severity={row.violationSeverity}
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

                            {/* Popover liệt kê các sự kiện vi phạm gần nhất */}
                            {isPopoverOpen && (
                              <div
                                data-testid={`violation-popover-${row.username}`}
                                className="absolute left-4 top-full mt-1.5 z-40 w-80 sm:w-96 bg-white rounded-xl border border-slate-200 shadow-xl p-3.5 text-left whitespace-normal"
                              >
                                <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-slate-100">
                                  <div>
                                    <div className="text-xs font-bold text-slate-900">
                                      Nhật ký vi phạm • {row.fullName}
                                    </div>
                                    <div className="text-[11px] text-slate-500 tabular-nums">
                                      Tính vào ngưỡng: {row.violationCount}/
                                      {session.maxViolations} lần • Tổng sự kiện:{' '}
                                      {row.recentViolations.length}
                                    </div>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setOpenViolationPopoverRowKey(null)
                                    }
                                    className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                {row.recentViolations.length === 0 ? (
                                  <p className="text-xs text-slate-500 py-3 text-center">
                                    Học sinh này chưa có sự kiện vi phạm nào.
                                  </p>
                                ) : (
                                  <div className="max-h-56 overflow-y-auto divide-y divide-slate-100">
                                    {row.recentViolations
                                      .slice(0, 8)
                                      .map((v: ViolationEventRecord) => (
                                        <div
                                          key={v.id}
                                          className="py-2 text-xs space-y-0.5"
                                        >
                                          <div className="flex items-center justify-between gap-2">
                                            <span className="font-semibold text-slate-800">
                                              {VIOLATION_TYPE_LABELS[v.type] ||
                                                v.type}
                                            </span>
                                            <span className="text-[11px] text-slate-500 font-mono tabular-nums">
                                              {formatTimeHhMmSs(v.occurredAt)}
                                            </span>
                                          </div>
                                          <div className="text-[11px] text-slate-600 flex flex-wrap items-center gap-x-2">
                                            <span>
                                              Câu đang làm:{' '}
                                              <strong>
                                                #{v.currentQuestionOrder}
                                              </strong>
                                            </span>
                                            {v.awaySeconds > 0 && (
                                              <span>
                                                • Rời màn hình:{' '}
                                                <strong className="text-rose-700">
                                                  {v.awaySeconds} giây
                                                </strong>
                                              </span>
                                            )}
                                            {v.note && (
                                              <span className="text-slate-500">
                                                • {v.note}
                                              </span>
                                            )}
                                          </div>
                                        </div>
                                      ))}
                                  </div>
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

          {/* Nhật ký tác vụ ca thi (exam_audit_log) */}
          {detail && detail.auditLogs && detail.auditLogs.length > 0 && (
            <div
              data-testid="session-audit-log-panel"
              className="bg-white rounded-xl border border-slate-200 p-4 space-y-2.5"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-teal-700" />
                  Nhật ký tác vụ ca thi (exam_audit_log)
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
                      <span className="font-mono font-semibold text-teal-800 mr-2">
                        [{log.action}]
                      </span>
                      <span>{log.note}</span>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="extend-time-modal"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
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
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmExtend} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">
                  Số phút cộng thêm
                </label>
                <div className="flex items-center gap-2 mb-2">
                  {[5, 10, 15, 30].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => {
                        setExtendMinutesInput(String(preset));
                        setExtendInputError(null);
                      }}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold border cursor-pointer tabular-nums ${
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
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                />
                {extendInputError && (
                  <p className="text-xs font-medium text-rose-600 mt-1">
                    {extendInputError}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  disabled={isSubmittingExtend}
                  onClick={() => setExtendModalTarget(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingExtend}
                  data-testid="confirm-extend-submit-btn"
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="confirm-force-submit-modal"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
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

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                disabled={isSubmittingForceSubmit}
                onClick={() => setConfirmForceSubmitRow(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                disabled={isSubmittingForceSubmit}
                onClick={() => void handleConfirmForceSubmit()}
                data-testid="confirm-force-submit-btn"
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="confirm-allow-reentry-modal"
        >
          <div className="bg-white rounded-xl border border-slate-200 max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Cho phép học sinh vào thi lại
                </h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
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
              <button
                type="button"
                onClick={() => setConfirmReentryRow(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleConfirmAllowReentry} className="space-y-4">
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
                  className="w-full px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 tabular-nums"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-1">
                <button
                  type="button"
                  disabled={isSubmittingReentry}
                  onClick={() => setConfirmReentryRow(null)}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-semibold cursor-pointer"
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReentry}
                  data-testid="confirm-allow-reentry-btn"
                  className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
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

      {/* Màn hình Chiếu mã chữ lớn */}
      {isProjectingCode && (
        <div
          className="fixed inset-0 z-50 bg-slate-950 text-white flex flex-col items-center justify-center p-6 select-none"
          data-testid="detail-projected-code-modal"
        >
          <button
            type="button"
            onClick={() => setIsProjectingCode(false)}
            className="absolute top-6 right-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold cursor-pointer"
          >
            <X className="w-4 h-4" />
            Đóng (Esc)
          </button>
          <div className="text-center space-y-6 max-w-3xl">
            <p className="text-lg font-medium text-teal-400">{session.title}</p>
            <div className="font-mono font-black text-7xl sm:text-9xl tracking-[0.22em] text-white bg-slate-900 border-2 border-teal-500/40 rounded-2xl px-8 py-10 shadow-2xl tabular-nums">
              {session.code}
            </div>
            <p className="text-sm text-slate-400">
              Học sinh mở mục <strong>Thi ngay</strong> và nhập mã trên để vào phòng thi
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
