import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Lock,
  Maximize2,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  StopCircle,
  Trash2,
  Unlock,
  X,
  AlertTriangle,
} from 'lucide-react';
import { Question, UserAccount } from '../types/exam';
import {
  ExamSessionRecord,
  ExamSessionResultVisibility,
  ExamSessionSelectionMode,
  ExamSessionStatus,
} from '../types/examSession';
import { examSessionApi } from '../services/examSessionApi';
import {
  CreateExamSessionFormErrors,
  validateCreateExamSessionForm,
} from '../utils/liveExamHelpers';
import { TeacherSessionDetailView } from './TeacherSessionDetailView';

interface TeacherExamSessionsTabProps {
  currentUser: UserAccount;
  questions: Question[];
  users: UserAccount[];
}

const STATUS_LABELS: Record<ExamSessionStatus, string> = {
  draft: 'Nháp',
  open: 'Đang mở',
  locked: 'Đã khóa',
  ended: 'Đã kết thúc',
};

const RESULT_VISIBILITY_LABELS: Record<ExamSessionResultVisibility, string> = {
  none: 'Không hiển thị',
  score_only: 'Chỉ điểm',
  score_and_answers: 'Điểm kèm đáp án',
};

export const TeacherExamSessionsTab: React.FC<TeacherExamSessionsTabProps> = ({
  currentUser,
  questions,
  users,
}) => {
  const [sessions, setSessions] = useState<ExamSessionRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Trang chi tiết ca thi (BƯỚC 6/8: Tab "Đang thi" & "Kết quả")
  const [selectedSessionForDetail, setSelectedSessionForDetail] =
    useState<ExamSessionRecord | null>(null);

  // Bộ lọc danh sách ca thi
  const [statusFilter, setStatusFilter] = useState<'ALL' | ExamSessionStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Sao chép mã nhanh trên từng dòng
  const [copiedCodeId, setCopiedCodeId] = useState<string | null>(null);

  // Menu hành động "⋯" trên từng dòng
  const [openMenuSessionId, setOpenMenuSessionId] = useState<string | null>(null);
  const [busySessionId, setBusySessionId] = useState<string | null>(null);

  // Hộp thoại xác nhận Kết thúc ca thi
  const [confirmEndSession, setConfirmEndSession] =
    useState<ExamSessionRecord | null>(null);

  // Hộp thoại xác nhận Xóa ca thi
  const [confirmDeleteSession, setConfirmDeleteSession] =
    useState<ExamSessionRecord | null>(null);

  // Màn hình Chiếu mã chữ lớn (bấm Esc để đóng)
  const [projectedSession, setProjectedSession] =
    useState<ExamSessionRecord | null>(null);

  // Drawer Tạo ca thi bên phải
  const [isDrawerOpen, setIsDrawerOpen] = useState<boolean>(false);
  const [createdSessionInDrawer, setCreatedSessionInDrawer] =
    useState<ExamSessionRecord | null>(null);
  const [isSubmittingCreate, setIsSubmittingCreate] = useState<boolean>(false);

  // Trường dữ liệu trong Drawer Tạo ca thi
  const [title, setTitle] = useState<string>('');
  const [targetClassMode, setTargetClassMode] = useState<'ALL' | 'CUSTOM'>('ALL');
  const [customClassName, setCustomClassName] = useState<string>(
    currentUser.className || '12A1'
  );
  const [questionCount, setQuestionCount] = useState<string>('45');
  const [durationMinutes, setDurationMinutes] = useState<string>('50');
  const [openImmediately, setOpenImmediately] = useState<boolean>(true);

  // Accordion "Nâng cao" (đóng sẵn theo mặc định)
  const [isAdvancedOpen, setIsAdvancedOpen] = useState<boolean>(false);
  const [selectionMode, setSelectionMode] =
    useState<ExamSessionSelectionMode>('proportional');
  const [manualQuestionIds, setManualQuestionIds] = useState<string[]>([]);
  const [manualSearchQuery, setManualSearchQuery] = useState<string>('');
  const [shuffleQuestionsAndOptions, setShuffleQuestionsAndOptions] =
    useState<boolean>(true);
  const [openAt, setOpenAt] = useState<string>('');
  const [closeAt, setCloseAt] = useState<string>('');
  const [maxViolations, setMaxViolations] = useState<string>('3');
  const [passScore, setPassScore] = useState<string>('700');
  const [resultVisibility, setResultVisibility] =
    useState<ExamSessionResultVisibility>('score_only');

  const [formErrors, setFormErrors] = useState<CreateExamSessionFormErrors>({});

  const teacherId = currentUser.id || currentUser.username;

  // Danh sách lớp gợi ý từ danh sách học sinh hiện có
  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    if (currentUser.className && currentUser.className.trim()) {
      set.add(currentUser.className.trim());
    }
    for (const u of users) {
      if (u.role === 'student' && u.className && u.className.trim()) {
        set.add(u.className.trim());
      }
    }
    for (const preset of ['12A1', '12A2', '11A1', '10A1']) {
      set.add(preset);
    }
    return Array.from(set);
  }, [users, currentUser.className]);

  const loadSessions = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const res = await examSessionApi.listSessions(teacherId);
        setSessions(Array.isArray(res.sessions) ? res.sessions : []);
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : 'Không thể tải danh sách ca thi.';
        setBannerMessage({ type: 'error', text: msg });
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [teacherId]
  );

  useEffect(() => {
    void loadSessions(false);
    const interval = window.setInterval(() => {
      void loadSessions(true);
    }, 8000);
    return () => window.clearInterval(interval);
  }, [loadSessions]);

  // Đóng màn hình Chiếu mã hoặc Drawer khi bấm phím Esc
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (projectedSession) {
          e.preventDefault();
          setProjectedSession(null);
          return;
        }
        if (openMenuSessionId) {
          setOpenMenuSessionId(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [projectedSession, openMenuSessionId]);

  // Đóng menu "⋯" khi bấm ra ngoài
  useEffect(() => {
    if (!openMenuSessionId) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest('[data-row-menu]')) {
        setOpenMenuSessionId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [openMenuSessionId]);

  const handleCopyCode = async (code: string, sessionId: string) => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      }
      setCopiedCodeId(sessionId);
      window.setTimeout(() => {
        setCopiedCodeId((prev) => (prev === sessionId ? null : prev));
      }, 2000);
    } catch {
      setCopiedCodeId(sessionId);
    }
  };

  const resetCreateForm = () => {
    setTitle('');
    setTargetClassMode('ALL');
    setCustomClassName(currentUser.className || availableClasses[0] || '12A1');
    setQuestionCount(String(Math.min(45, Math.max(1, questions.length || 45))));
    setDurationMinutes('50');
    setOpenImmediately(true);
    setIsAdvancedOpen(false);
    setSelectionMode('proportional');
    setManualQuestionIds([]);
    setManualSearchQuery('');
    setShuffleQuestionsAndOptions(true);
    setOpenAt('');
    setCloseAt('');
    setMaxViolations('3');
    setPassScore('700');
    setResultVisibility('score_only');
    setFormErrors({});
    setCreatedSessionInDrawer(null);
  };

  const handleOpenCreateDrawer = () => {
    resetCreateForm();
    setIsDrawerOpen(true);
  };

  const handleCloseDrawer = () => {
    if (isSubmittingCreate) return;
    setIsDrawerOpen(false);
    setCreatedSessionInDrawer(null);
  };

  const effectiveTargetClass =
    targetClassMode === 'ALL' ? 'ALL' : customClassName.trim();

  const filteredManualQuestions = useMemo(() => {
    const q = manualSearchQuery.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter(
      (item) =>
        item.prompt.toLowerCase().includes(q) ||
        item.topic.toLowerCase().includes(q) ||
        item.id.toLowerCase().includes(q)
    );
  }, [questions, manualSearchQuery]);

  const toggleManualQuestion = (qId: string) => {
    setManualQuestionIds((prev) => {
      const next = prev.includes(qId)
        ? prev.filter((id) => id !== qId)
        : [...prev, qId];
      return next;
    });
    setFormErrors((prev) => ({ ...prev, manualQuestionIds: undefined }));
  };

  const handleSubmitCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    setBannerMessage(null);

    const validation = validateCreateExamSessionForm(
      {
        title,
        targetClass: effectiveTargetClass,
        questionCount,
        durationMinutes,
        selectionMode,
        manualQuestionIds,
        openAt: openAt || null,
        closeAt: closeAt || null,
        maxViolations,
        passScore,
      },
      Math.max(45, questions.length)
    );

    if (!validation.valid) {
      setFormErrors(validation.errors);
      if (
        validation.errors.manualQuestionIds ||
        validation.errors.openAt ||
        validation.errors.closeAt ||
        validation.errors.maxViolations ||
        validation.errors.passScore
      ) {
        setIsAdvancedOpen(true);
      }
      return;
    }

    setFormErrors({});
    setIsSubmittingCreate(true);

    try {
      const resolvedQuestionCount =
        selectionMode === 'manual'
          ? manualQuestionIds.length
          : Number(questionCount);

      const res = await examSessionApi.createSession(teacherId, {
        title: title.trim(),
        targetClass: effectiveTargetClass,
        questionCount: resolvedQuestionCount,
        durationMinutes: Number(durationMinutes),
        selectionMode,
        ...(selectionMode === 'manual' ? { manualQuestionIds } : {}),
        shuffleQuestions: shuffleQuestionsAndOptions,
        shuffleOptions: shuffleQuestionsAndOptions,
        openAt: openAt ? new Date(openAt).toISOString() : null,
        closeAt: closeAt ? new Date(closeAt).toISOString() : null,
        maxViolations: Number(maxViolations),
        passScore: Number(passScore),
        resultVisibility,
        status: openImmediately ? 'open' : 'draft',
      });

      setCreatedSessionInDrawer(res.session);
      await loadSessions(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Không thể tạo ca thi mới.';
      setFormErrors({ title: msg });
    } finally {
      setIsSubmittingCreate(false);
    }
  };

  const handleToggleLockSwitch = async (session: ExamSessionRecord) => {
    if (session.status === 'ended' || busySessionId === session.id) return;
    setBusySessionId(session.id);
    setBannerMessage(null);

    try {
      if (session.status === 'open') {
        await examSessionApi.lockSession(teacherId, session.id);
        setBannerMessage({
          type: 'success',
          text: `Đã khóa ca thi "${session.title}" (${session.code}). Học sinh mới không vào được bằng mã, học sinh đang làm bài vẫn thi tiếp.`,
        });
      } else if (session.status === 'locked') {
        await examSessionApi.unlockSession(teacherId, session.id);
        setBannerMessage({
          type: 'success',
          text: `Đã mở khóa ca thi "${session.title}" (${session.code}). Học sinh có thể dùng mã để vào thi.`,
        });
      } else if (session.status === 'draft') {
        await examSessionApi.openSession(teacherId, session.id);
        setBannerMessage({
          type: 'success',
          text: `Đã mở ca thi "${session.title}" (${session.code}).`,
        });
      }
      await loadSessions(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể cập nhật trạng thái khóa ca thi.',
      });
    } finally {
      setBusySessionId(null);
    }
  };

  const handleCloneSession = async (session: ExamSessionRecord) => {
    setOpenMenuSessionId(null);
    setBusySessionId(session.id);
    setBannerMessage(null);
    try {
      const res = await examSessionApi.cloneSession(teacherId, session.id);
      setBannerMessage({
        type: 'success',
        text: `Đã tạo bản sao "${res.session.title}" với mã mới ${res.session.code}.`,
      });
      await loadSessions(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể sao chép ca thi.',
      });
    } finally {
      setBusySessionId(null);
    }
  };

  const handleConfirmEndSession = async () => {
    if (!confirmEndSession) return;
    const target = confirmEndSession;
    setConfirmEndSession(null);
    setBusySessionId(target.id);
    setBannerMessage(null);

    try {
      await examSessionApi.endSession(teacherId, target.id);
      setBannerMessage({
        type: 'success',
        text: `Đã kết thúc ca thi "${target.title}" (${target.code}) và tự động nộp bài của tất cả học sinh đang thi.`,
      });
      await loadSessions(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể kết thúc ca thi.',
      });
    } finally {
      setBusySessionId(null);
    }
  };

  const handleConfirmDeleteSession = async () => {
    if (!confirmDeleteSession) return;
    const target = confirmDeleteSession;
    setConfirmDeleteSession(null);
    setBusySessionId(target.id);
    setBannerMessage(null);

    try {
      await examSessionApi.deleteSession(teacherId, target.id);
      setBannerMessage({
        type: 'success',
        text: `Đã xóa ca thi "${target.title}" (${target.code}).`,
      });
      await loadSessions(true);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể xóa ca thi.',
      });
    } finally {
      setBusySessionId(null);
    }
  };

  const filteredSessions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sessions.filter((s) => {
      if (statusFilter !== 'ALL' && s.status !== statusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        s.targetClass.toLowerCase().includes(q)
      );
    });
  }, [sessions, statusFilter, searchQuery]);

  const statusCounts = useMemo(() => {
    return {
      ALL: sessions.length,
      draft: sessions.filter((s) => s.status === 'draft').length,
      open: sessions.filter((s) => s.status === 'open').length,
      locked: sessions.filter((s) => s.status === 'locked').length,
      ended: sessions.filter((s) => s.status === 'ended').length,
    };
  }, [sessions]);

  if (selectedSessionForDetail) {
    return (
      <TeacherSessionDetailView
        currentUser={currentUser}
        sessionId={selectedSessionForDetail.id}
        initialSession={selectedSessionForDetail}
        onBack={() => {
          setSelectedSessionForDetail(null);
          void loadSessions(true);
        }}
        onSessionUpdated={(updated) => {
          setSessions((prev) =>
            prev.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
          );
        }}
      />
    );
  }

  return (
    <div className="space-y-6" data-testid="teacher-exam-sessions-tab">
      {/* Thanh tiêu đề & Nút chính "Tạo ca thi" */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Quản lý Ca thi
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Tạo mã ca thi 6 ký tự cho học sinh vào thi ngay, khóa/mở khóa nhận học sinh mới theo thời gian thực.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => void loadSessions(false)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold transition-colors cursor-pointer"
            title="Làm mới danh sách"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
          <button
            type="button"
            onClick={handleOpenCreateDrawer}
            data-testid="open-create-session-drawer-btn"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold shadow-sm transition-colors cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Tạo ca thi
          </button>
        </div>
      </div>

      {/* Thông báo trạng thái thao tác */}
      {bannerMessage && (
        <div
          data-testid="session-action-banner"
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

      {/* Bộ lọc theo trạng thái & Ô tìm kiếm */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div
          className="flex flex-wrap items-center gap-1.5"
          role="tablist"
          aria-label="Bộ lọc trạng thái ca thi"
        >
          {(
            [
              { id: 'ALL', label: 'Tất cả' },
              { id: 'open', label: 'Đang mở' },
              { id: 'locked', label: 'Đã khóa' },
              { id: 'draft', label: 'Nháp' },
              { id: 'ended', label: 'Đã kết thúc' },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.id;
            const count = statusCounts[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                data-testid={`filter-status-${tab.id}`}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer tabular-nums ${
                  active
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>

        <div className="relative w-full lg:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm theo tên ca thi, mã hoặc lớp..."
            data-testid="search-sessions-input"
            className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Bảng gọn danh sách ca thi */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-visible">
        <div className="overflow-x-auto">
          <table
            className="w-full text-left border-collapse"
            data-testid="exam-sessions-table"
          >
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-bold text-slate-600 whitespace-nowrap">
                <th className="py-3.5 px-4">Tên ca thi</th>
                <th className="py-3.5 px-4">Mã vào thi</th>
                <th className="py-3.5 px-4">Trạng thái</th>
                <th className="py-3.5 px-4">HS đã vào / Tổng</th>
                <th className="py-3.5 px-4">Thời gian</th>
                <th className="py-3.5 px-4">Khóa / Mở khóa</th>
                <th className="py-3.5 px-4 text-right">Hành động</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {loading && sessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 px-4 text-center text-slate-500"
                  >
                    Đang tải danh sách ca thi...
                  </td>
                </tr>
              ) : filteredSessions.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-12 px-4 text-center text-slate-500"
                    data-testid="empty-sessions-state"
                  >
                    {sessions.length === 0
                      ? 'Chưa có ca thi nào. Bấm "Tạo ca thi" ở góc trên để tạo mã cho học sinh vào thi.'
                      : 'Không tìm thấy ca thi nào khớp với bộ lọc hiện tại.'}
                  </td>
                </tr>
              ) : (
                filteredSessions.map((session) => {
                  const enteredCount = session.enteredCount ?? 0;
                  const inProgressCount = session.inProgressCount ?? 0;
                  const totalTarget = session.totalTargetStudents;
                  const isCopied = copiedCodeId === session.id;
                  const isBusy = busySessionId === session.id;
                  const isLocked = session.status === 'locked';
                  const isOpen = session.status === 'open';
                  const isEnded = session.status === 'ended';
                  const isDraft = session.status === 'draft';

                  return (
                    <tr
                      key={session.id}
                      data-testid={`session-row-${session.code}`}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      {/* 1. Tên ca thi & Lớp (Bấm vào tên để mở trang chi tiết ca thi) */}
                      <td className="py-3.5 px-4 align-middle">
                        <button
                          type="button"
                          onClick={() => setSelectedSessionForDetail(session)}
                          data-testid={`open-session-detail-btn-${session.code}`}
                          className="font-bold text-slate-900 hover:text-teal-700 text-left transition-colors cursor-pointer"
                        >
                          {session.title}
                        </button>
                        <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="whitespace-nowrap">
                            Đối tượng:{' '}
                            <strong className="text-slate-700 font-semibold">
                              {session.targetClass === 'ALL'
                                ? 'Mọi học sinh có mã'
                                : `Lớp ${session.targetClass}`}
                            </strong>
                          </span>
                          <span className="text-slate-300">|</span>
                          <span className="whitespace-nowrap">
                            Kết quả:{' '}
                            {RESULT_VISIBILITY_LABELS[session.resultVisibility]}
                          </span>
                        </div>
                      </td>

                      {/* 2. Mã 6 ký tự (bấm để sao chép + nút Chiếu mã) */}
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              void handleCopyCode(session.code, session.id)
                            }
                            data-testid={`copy-code-btn-${session.code}`}
                            title="Bấm để sao chép mã ca thi"
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-300 bg-slate-50 hover:bg-teal-50 hover:border-teal-300 font-mono font-bold text-sm tracking-wider text-slate-900 transition-colors cursor-pointer tabular-nums"
                          >
                            <span>{session.code}</span>
                            {isCopied ? (
                              <Check className="w-3.5 h-3.5 text-teal-700" />
                            ) : (
                              <Copy className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setProjectedSession(session)}
                            data-testid={`project-code-btn-${session.code}`}
                            title="Chiếu mã chữ lớn lên màn hình"
                            className="p-1.5 rounded-md border border-slate-200 text-slate-600 hover:text-teal-700 hover:border-teal-300 hover:bg-teal-50 transition-colors cursor-pointer"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                        {isCopied && (
                          <div className="text-[11px] font-semibold text-teal-700 mt-1">
                            Đã sao chép mã
                          </div>
                        )}
                      </td>

                      {/* 3. Trạng thái */}
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        <span
                          data-testid={`session-status-${session.code}`}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-bold border whitespace-nowrap ${
                            isOpen
                              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                              : isLocked
                                ? 'bg-amber-50 text-amber-800 border-amber-200'
                                : isDraft
                                  ? 'bg-slate-100 text-slate-700 border-slate-200'
                                  : 'bg-slate-100 text-slate-500 border-slate-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                              isOpen
                                ? 'bg-emerald-600'
                                : isLocked
                                  ? 'bg-amber-600'
                                  : 'bg-slate-400'
                            }`}
                          />
                          {STATUS_LABELS[session.status]}
                        </span>
                      </td>

                      {/* 4. Số học sinh đã vào / Tổng */}
                      <td className="py-3.5 px-4 align-middle tabular-nums whitespace-nowrap">
                        <div
                          className="font-bold text-slate-900"
                          data-testid={`session-participants-${session.code}`}
                        >
                          {totalTarget !== null && totalTarget !== undefined
                            ? `${enteredCount}/${totalTarget}`
                            : `${enteredCount} / Mọi HS`}
                        </div>
                        <div className="text-xs text-slate-500">
                          {inProgressCount > 0 ? (
                            <span className="text-teal-700 font-semibold">
                              {inProgressCount} đang làm bài
                            </span>
                          ) : enteredCount > 0 ? (
                            <span>Đã nộp {session.submittedCount ?? enteredCount}</span>
                          ) : (
                            <span>Chưa có thí sinh</span>
                          )}
                        </div>
                      </td>

                      {/* 5. Thời gian & Số câu */}
                      <td className="py-3.5 px-4 align-middle tabular-nums whitespace-nowrap">
                        <div className="font-semibold text-slate-800">
                          {session.durationMinutes} phút
                        </div>
                        <div className="text-xs text-slate-500">
                          {session.questionCount} câu • Đạt {session.passScore}/1000
                        </div>
                      </td>

                      {/* 6. Công tắc Khóa / Mở khóa ngay trên mỗi dòng */}
                      <td className="py-3.5 px-4 align-middle whitespace-nowrap">
                        {isEnded ? (
                          <span className="text-xs text-slate-400">
                            Đã kết thúc
                          </span>
                        ) : isDraft ? (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleToggleLockSwitch(session)}
                            data-testid={`open-draft-btn-${session.code}`}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-teal-600 text-teal-700 hover:bg-teal-50 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                          >
                            <Unlock className="w-3.5 h-3.5" />
                            Mở ca thi
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              role="switch"
                              aria-checked={isLocked}
                              disabled={isBusy}
                              onClick={() => void handleToggleLockSwitch(session)}
                              data-testid={`toggle-lock-switch-${session.code}`}
                              title={
                                isLocked
                                  ? 'Đang khóa nhận học sinh mới. Bấm để mở khóa.'
                                  : 'Đang mở. Bấm để khóa không cho học sinh mới vào bằng mã (học sinh đang thi vẫn làm tiếp).'
                              }
                              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                isLocked ? 'bg-amber-600' : 'bg-slate-200'
                              } disabled:opacity-50`}
                            >
                              <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ${
                                  isLocked ? 'translate-x-5' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <span className="text-xs font-medium text-slate-700 inline-flex items-center gap-1 whitespace-nowrap">
                              {isLocked ? (
                                <>
                                  <Lock className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                                  Đã khóa mã
                                </>
                              ) : (
                                <>
                                  <Unlock className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                                  Mở vào thi
                                </>
                              )}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 7. Menu "⋯" trên mỗi dòng */}
                      <td
                        className="py-3.5 px-4 align-middle text-right relative"
                        data-row-menu
                      >
                        <button
                          type="button"
                          onClick={() =>
                            setOpenMenuSessionId((prev) =>
                              prev === session.id ? null : session.id
                            )
                          }
                          data-testid={`row-menu-btn-${session.code}`}
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-slate-200 bg-white hover:bg-slate-100 text-slate-700 transition-colors cursor-pointer"
                          aria-label="Menu hành động ca thi"
                        >
                          <MoreHorizontal className="w-4 h-4" />
                        </button>

                        {openMenuSessionId === session.id && (
                          <div
                            data-testid={`row-menu-dropdown-${session.code}`}
                            className="absolute right-4 mt-1.5 w-52 rounded-xl bg-white border border-slate-200 shadow-lg py-1.5 z-30 text-left"
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setOpenMenuSessionId(null);
                                setProjectedSession(session);
                              }}
                              className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                            >
                              <Maximize2 className="w-3.5 h-3.5 text-teal-700" />
                              Chiếu mã toàn màn hình
                            </button>

                            <button
                              type="button"
                              onClick={() => void handleCloneSession(session)}
                              data-testid={`menu-clone-${session.code}`}
                              className="w-full px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer"
                            >
                              <Copy className="w-3.5 h-3.5 text-slate-500" />
                              Tạo bản sao
                            </button>

                            {!isEnded && (
                              <button
                                type="button"
                                onClick={() => {
                                  setOpenMenuSessionId(null);
                                  setConfirmEndSession(session);
                                }}
                                data-testid={`menu-end-${session.code}`}
                                className="w-full px-3.5 py-2 text-xs font-semibold text-amber-800 hover:bg-amber-50 flex items-center gap-2 cursor-pointer"
                              >
                                <StopCircle className="w-3.5 h-3.5 text-amber-600" />
                                Kết thúc ca thi
                              </button>
                            )}

                            <div className="my-1 border-t border-slate-100" />

                            <button
                              type="button"
                              disabled={enteredCount > 0}
                              onClick={() => {
                                if (enteredCount > 0) return;
                                setOpenMenuSessionId(null);
                                setConfirmDeleteSession(session);
                              }}
                              data-testid={`menu-delete-${session.code}`}
                              title={
                                enteredCount > 0
                                  ? 'Chỉ có thể xóa ca thi khi chưa có học sinh nào vào thi'
                                  : 'Xóa ca thi này'
                              }
                              className={`w-full px-3.5 py-2 text-xs font-semibold flex items-center justify-between gap-2 ${
                                enteredCount > 0
                                  ? 'text-slate-300 cursor-not-allowed'
                                  : 'text-rose-700 hover:bg-rose-50 cursor-pointer'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <Trash2 className="w-3.5 h-3.5" />
                                Xóa ca thi
                              </span>
                              {enteredCount > 0 && (
                                <span className="text-[10px] text-slate-400 font-normal">
                                  Đã có HS thi
                                </span>
                              )}
                            </button>
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

      {/* ==========================================================================
          DRAWER BÊN PHẢI: TẠO CA THI (KHÔNG CHUYỂN TRANG)
         ========================================================================== */}
      {isDrawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[1px]"
          data-testid="create-session-drawer-backdrop"
        >
          <div
            className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col justify-between overflow-hidden"
            data-testid="create-session-drawer"
          >
            {/* Header Drawer */}
            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50/70">
              <div>
                <h2 className="text-lg font-bold text-slate-900">
                  {createdSessionInDrawer
                    ? 'Đã tạo ca thi thành công'
                    : 'Tạo ca thi mới'}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {createdSessionInDrawer
                    ? 'Cung cấp mã 6 ký tự dưới đây cho học sinh nhập vào mục Thi ngay.'
                    : 'Thiết lập thông tin ca thi và nhận mã 6 ký tự ngay lập tức.'}
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseDrawer}
                data-testid="close-drawer-btn"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nội dung Drawer: Nếu vừa lưu xong -> Hiện mã lớn kèm nút Sao chép & Chiếu mã */}
            {createdSessionInDrawer ? (
              <div
                className="p-6 flex-1 overflow-y-auto flex flex-col items-center justify-center text-center space-y-6"
                data-testid="drawer-created-code-panel"
              >
                <div className="w-full max-w-md rounded-2xl border-2 border-teal-600 bg-teal-50/50 p-6 space-y-4">
                  <div className="text-xs font-bold text-teal-800">
                    Mã vào phòng thi của học sinh
                  </div>
                  <div
                    className="text-4xl sm:text-5xl font-mono font-black tracking-[0.25em] text-slate-900 select-all tabular-nums"
                    data-testid="created-session-big-code"
                  >
                    {createdSessionInDrawer.code}
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    {createdSessionInDrawer.title}
                  </div>
                  <div className="text-xs text-slate-600 tabular-nums">
                    Đối tượng:{' '}
                    <strong>
                      {createdSessionInDrawer.targetClass === 'ALL'
                        ? 'Mọi học sinh có mã'
                        : `Lớp ${createdSessionInDrawer.targetClass}`}
                    </strong>{' '}
                    • {createdSessionInDrawer.questionCount} câu •{' '}
                    {createdSessionInDrawer.durationMinutes} phút
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        void handleCopyCode(
                          createdSessionInDrawer.code,
                          createdSessionInDrawer.id
                        )
                      }
                      data-testid="drawer-copy-code-btn"
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-sm font-bold transition-colors cursor-pointer"
                    >
                      {copiedCodeId === createdSessionInDrawer.id ? (
                        <>
                          <Check className="w-4 h-4 text-teal-700" />
                          Đã sao chép
                        </>
                      ) : (
                        <>
                          <Copy className="w-4 h-4" />
                          Sao chép
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setProjectedSession(createdSessionInDrawer)}
                      data-testid="drawer-project-code-btn"
                      className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold shadow-sm transition-colors cursor-pointer"
                    >
                      <Maximize2 className="w-4 h-4" />
                      Chiếu mã
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={resetCreateForm}
                    className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold cursor-pointer"
                  >
                    Tạo thêm ca thi khác
                  </button>
                  <button
                    type="button"
                    onClick={handleCloseDrawer}
                    data-testid="drawer-done-btn"
                    className="px-5 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold cursor-pointer"
                  >
                    Hoàn tất
                  </button>
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => void handleSubmitCreateSession(e)}
                noValidate
                className="flex-1 overflow-y-auto p-6 space-y-5"
                data-testid="create-session-form"
              >
                {/* 1. Tên ca thi (Bắt buộc) */}
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">
                    Tên ca thi <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => {
                      setTitle(e.target.value);
                      if (formErrors.title) {
                        setFormErrors((prev) => ({ ...prev, title: undefined }));
                      }
                    }}
                    placeholder="Ví dụ: Kiểm tra định kỳ GenAI - Lớp 12A1"
                    data-testid="input-session-title"
                    className={`w-full px-3.5 py-2.5 rounded-lg border text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                      formErrors.title
                        ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/30'
                        : 'border-slate-300 focus:ring-teal-600 bg-white'
                    }`}
                  />
                  {formErrors.title && (
                    <p
                      className="text-xs font-semibold text-rose-600 mt-1.5"
                      data-testid="error-session-title"
                    >
                      {formErrors.title}
                    </p>
                  )}
                </div>

                {/* 2. Lớp hoặc nhóm được thi (Bắt buộc) */}
                <div>
                  <label className="block text-sm font-bold text-slate-800 mb-1.5">
                    Lớp hoặc nhóm được thi <span className="text-rose-600">*</span>
                  </label>
                  <div className="grid grid-cols-2 gap-2.5 mb-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        setTargetClassMode('ALL');
                        setFormErrors((prev) => ({
                          ...prev,
                          targetClass: undefined,
                        }));
                      }}
                      data-testid="target-class-all-btn"
                      className={`px-3.5 py-2.5 rounded-lg border text-xs font-bold text-left transition-colors cursor-pointer ${
                        targetClassMode === 'ALL'
                          ? 'border-teal-700 bg-teal-50/70 text-teal-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Mọi học sinh có mã
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setTargetClassMode('CUSTOM');
                        setFormErrors((prev) => ({
                          ...prev,
                          targetClass: undefined,
                        }));
                      }}
                      data-testid="target-class-custom-btn"
                      className={`px-3.5 py-2.5 rounded-lg border text-xs font-bold text-left transition-colors cursor-pointer ${
                        targetClassMode === 'CUSTOM'
                          ? 'border-teal-700 bg-teal-50/70 text-teal-900'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      Giới hạn theo lớp / nhóm
                    </button>
                  </div>

                  {targetClassMode === 'CUSTOM' && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={customClassName}
                        onChange={(e) => {
                          setCustomClassName(e.target.value);
                          setFormErrors((prev) => ({
                            ...prev,
                            targetClass: undefined,
                          }));
                        }}
                        placeholder="Nhập tên lớp (ví dụ: 12A1 hoặc 12A1, 12A2)"
                        data-testid="input-custom-target-class"
                        className={`w-full px-3.5 py-2 rounded-lg border text-sm text-slate-900 focus:outline-none focus:ring-2 ${
                          formErrors.targetClass
                            ? 'border-rose-400 focus:ring-rose-500'
                            : 'border-slate-300 focus:ring-teal-600'
                        }`}
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-slate-500">Chọn nhanh:</span>
                        {availableClasses.map((cls) => (
                          <button
                            key={cls}
                            type="button"
                            onClick={() => {
                              setCustomClassName(cls);
                              setFormErrors((prev) => ({
                                ...prev,
                                targetClass: undefined,
                              }));
                            }}
                            className={`px-2 py-0.5 rounded border text-xs font-semibold cursor-pointer ${
                              customClassName.trim() === cls
                                ? 'border-teal-600 bg-teal-50 text-teal-800'
                                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            {cls}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {formErrors.targetClass && (
                    <p
                      className="text-xs font-semibold text-rose-600 mt-1.5"
                      data-testid="error-session-target-class"
                    >
                      {formErrors.targetClass}
                    </p>
                  )}
                </div>

                {/* 3. Số câu (mặc định 45) & Thời gian (mặc định 50 phút) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-bold text-slate-800 mb-1.5">
                      Số câu hỏi <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={Math.max(45, questions.length)}
                      disabled={selectionMode === 'manual'}
                      value={
                        selectionMode === 'manual'
                          ? String(manualQuestionIds.length)
                          : questionCount
                      }
                      onChange={(e) => {
                        setQuestionCount(e.target.value);
                        if (formErrors.questionCount) {
                          setFormErrors((prev) => ({
                            ...prev,
                            questionCount: undefined,
                          }));
                        }
                      }}
                      data-testid="input-session-question-count"
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-2 ${
                        selectionMode === 'manual'
                          ? 'bg-slate-100 border-slate-200 text-slate-500'
                          : formErrors.questionCount
                            ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/30'
                            : 'border-slate-300 focus:ring-teal-600 bg-white'
                      }`}
                    />
                    {formErrors.questionCount && (
                      <p
                        className="text-xs font-semibold text-rose-600 mt-1.5"
                        data-testid="error-session-question-count"
                      >
                        {formErrors.questionCount}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-slate-800 mb-1.5">
                      Thời gian (phút) <span className="text-rose-600">*</span>
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={300}
                      value={durationMinutes}
                      onChange={(e) => {
                        setDurationMinutes(e.target.value);
                        if (formErrors.durationMinutes) {
                          setFormErrors((prev) => ({
                            ...prev,
                            durationMinutes: undefined,
                          }));
                        }
                      }}
                      data-testid="input-session-duration"
                      className={`w-full px-3.5 py-2.5 rounded-lg border text-sm font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-2 ${
                        formErrors.durationMinutes
                          ? 'border-rose-400 focus:ring-rose-500 bg-rose-50/30'
                          : 'border-slate-300 focus:ring-teal-600 bg-white'
                      }`}
                    />
                    {formErrors.durationMinutes && (
                      <p
                        className="text-xs font-semibold text-rose-600 mt-1.5"
                        data-testid="error-session-duration"
                      >
                        {formErrors.durationMinutes}
                      </p>
                    )}
                  </div>
                </div>

                {/* Tuỳ chọn mở thi ngay sau khi tạo */}
                <label className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 bg-slate-50/70 cursor-pointer">
                  <div>
                    <div className="text-sm font-bold text-slate-800">
                      Mở ca thi ngay sau khi lưu
                    </div>
                    <div className="text-xs text-slate-500">
                      Nếu tắt, ca thi sẽ lưu ở trạng thái Nháp cho đến khi bạn bấm Mở.
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    checked={openImmediately}
                    onChange={(e) => setOpenImmediately(e.target.checked)}
                    data-testid="checkbox-open-immediately"
                    className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
                  />
                </label>

                {/* ==============================================================
                    ACCORDION "NÂNG CAO" (ĐÓNG SẴN MẶC ĐỊNH)
                   ============================================================== */}
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setIsAdvancedOpen((prev) => !prev)}
                    data-testid="toggle-advanced-accordion-btn"
                    aria-expanded={isAdvancedOpen}
                    className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between text-left transition-colors cursor-pointer"
                  >
                    <div>
                      <div className="text-sm font-bold text-slate-800">
                        Nâng cao
                      </div>
                      <div className="text-xs text-slate-500">
                        Cách lấy đề, xáo trộn, khung giờ mở, ngưỡng vi phạm ({maxViolations}), điểm đạt ({passScore}), hiển thị kết quả
                      </div>
                    </div>
                    {isAdvancedOpen ? (
                      <ChevronUp className="w-4 h-4 text-slate-600 shrink-0" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-slate-600 shrink-0" />
                    )}
                  </button>

                  {isAdvancedOpen && (
                    <div
                      className="p-4 space-y-4 border-t border-slate-200 bg-white"
                      data-testid="advanced-accordion-content"
                    >
                      {/* A. Cách lấy đề */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          Cách lấy đề
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectionMode('proportional');
                              setFormErrors((prev) => ({
                                ...prev,
                                manualQuestionIds: undefined,
                              }));
                            }}
                            data-testid="selection-mode-proportional"
                            className={`p-2.5 rounded-lg border text-xs font-semibold text-left cursor-pointer ${
                              selectionMode === 'proportional'
                                ? 'border-teal-700 bg-teal-50/70 text-teal-900'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            Bốc ngẫu nhiên theo tỉ lệ chuyên đề
                          </button>
                          <button
                            type="button"
                            onClick={() => setSelectionMode('manual')}
                            data-testid="selection-mode-manual"
                            className={`p-2.5 rounded-lg border text-xs font-semibold text-left cursor-pointer ${
                              selectionMode === 'manual'
                                ? 'border-teal-700 bg-teal-50/70 text-teal-900'
                                : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            Chọn thủ công bộ câu hỏi ({manualQuestionIds.length})
                          </button>
                        </div>

                        {selectionMode === 'manual' && (
                          <div className="mt-3 border border-slate-200 rounded-lg p-3 space-y-2.5 bg-slate-50/50">
                            <div className="flex items-center justify-between gap-2">
                              <input
                                type="text"
                                value={manualSearchQuery}
                                onChange={(e) =>
                                  setManualSearchQuery(e.target.value)
                                }
                                placeholder="Tìm câu hỏi theo nội dung hoặc chuyên đề..."
                                className="flex-1 px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-none focus:ring-2 focus:ring-teal-600"
                              />
                              <span className="text-xs font-bold text-teal-800 tabular-nums">
                                Đã chọn: {manualQuestionIds.length} câu
                              </span>
                            </div>

                            <div className="max-h-44 overflow-y-auto divide-y divide-slate-200 border border-slate-200 rounded-md bg-white">
                              {filteredManualQuestions.map((q) => {
                                const checked = manualQuestionIds.includes(q.id);
                                return (
                                  <label
                                    key={q.id}
                                    className="flex items-start gap-2.5 p-2 text-xs hover:bg-slate-50 cursor-pointer"
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleManualQuestion(q.id)}
                                      className="mt-0.5 accent-teal-700 rounded"
                                    />
                                    <div className="min-w-0 flex-1">
                                      <div className="font-semibold text-slate-800 line-clamp-1">
                                        {q.prompt}
                                      </div>
                                      <div className="text-[11px] text-slate-500">
                                        {q.topic} • {q.examSet}
                                      </div>
                                    </div>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {formErrors.manualQuestionIds && (
                          <p
                            className="text-xs font-semibold text-rose-600 mt-1.5"
                            data-testid="error-session-manual-questions"
                          >
                            {formErrors.manualQuestionIds}
                          </p>
                        )}
                      </div>

                      {/* B. Xáo trộn câu và đáp án (mặc định bật) */}
                      <label className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-200 bg-slate-50/50 cursor-pointer">
                        <div>
                          <div className="text-xs font-bold text-slate-800">
                            Xáo trộn thứ tự câu hỏi và đáp án
                          </div>
                          <div className="text-[11px] text-slate-500">
                            Mỗi học sinh nhận thứ tự câu và phương án khác nhau (mặc định bật).
                          </div>
                        </div>
                        <input
                          type="checkbox"
                          checked={shuffleQuestionsAndOptions}
                          onChange={(e) =>
                            setShuffleQuestionsAndOptions(e.target.checked)
                          }
                          data-testid="checkbox-shuffle-questions"
                          className="w-4 h-4 accent-teal-700 rounded cursor-pointer"
                        />
                      </label>

                      {/* C. Khung giờ mở (tự khóa khi hết khung giờ) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Mở từ thời điểm (tuỳ chọn)
                          </label>
                          <input
                            type="datetime-local"
                            value={openAt}
                            onChange={(e) => {
                              setOpenAt(e.target.value);
                              setFormErrors((prev) => ({
                                ...prev,
                                openAt: undefined,
                                closeAt: undefined,
                              }));
                            }}
                            data-testid="input-session-open-at"
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
                          />
                          {formErrors.openAt && (
                            <p className="text-xs font-semibold text-rose-600 mt-1">
                              {formErrors.openAt}
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Đóng lúc (tự khóa khi hết giờ)
                          </label>
                          <input
                            type="datetime-local"
                            value={closeAt}
                            onChange={(e) => {
                              setCloseAt(e.target.value);
                              setFormErrors((prev) => ({
                                ...prev,
                                closeAt: undefined,
                              }));
                            }}
                            data-testid="input-session-close-at"
                            className={`w-full px-3 py-2 rounded-lg border text-xs text-slate-800 focus:outline-none focus:ring-2 ${
                              formErrors.closeAt
                                ? 'border-rose-400 focus:ring-rose-500'
                                : 'border-slate-300 focus:ring-teal-600'
                            }`}
                          />
                          {formErrors.closeAt && (
                            <p
                              className="text-xs font-semibold text-rose-600 mt-1"
                              data-testid="error-session-close-at"
                            >
                              {formErrors.closeAt}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* D. Ngưỡng vi phạm tự nộp (mặc định 3) & Điểm đạt (mặc định 700) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Ngưỡng vi phạm tự nộp
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={maxViolations}
                            onChange={(e) => {
                              setMaxViolations(e.target.value);
                              setFormErrors((prev) => ({
                                ...prev,
                                maxViolations: undefined,
                              }));
                            }}
                            data-testid="input-session-max-violations"
                            className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-2 ${
                              formErrors.maxViolations
                                ? 'border-rose-400 focus:ring-rose-500'
                                : 'border-slate-300 focus:ring-teal-600'
                            }`}
                          />
                          {formErrors.maxViolations && (
                            <p
                              className="text-xs font-semibold text-rose-600 mt-1"
                              data-testid="error-session-max-violations"
                            >
                              {formErrors.maxViolations}
                            </p>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            Điểm đạt (thang 1000)
                          </label>
                          <input
                            type="number"
                            min={100}
                            max={1000}
                            step={10}
                            value={passScore}
                            onChange={(e) => {
                              setPassScore(e.target.value);
                              setFormErrors((prev) => ({
                                ...prev,
                                passScore: undefined,
                              }));
                            }}
                            data-testid="input-session-pass-score"
                            className={`w-full px-3 py-2 rounded-lg border text-xs font-semibold text-slate-900 tabular-nums focus:outline-none focus:ring-2 ${
                              formErrors.passScore
                                ? 'border-rose-400 focus:ring-rose-500'
                                : 'border-slate-300 focus:ring-teal-600'
                            }`}
                          />
                          {formErrors.passScore && (
                            <p
                              className="text-xs font-semibold text-rose-600 mt-1"
                              data-testid="error-session-pass-score"
                            >
                              {formErrors.passScore}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* E. Hiển thị kết quả cho học sinh */}
                      <div>
                        <label className="block text-xs font-bold text-slate-700 mb-1.5">
                          Hiển thị kết quả cho học sinh sau khi nộp bài
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                          {(
                            [
                              { id: 'none', label: 'Không hiển thị' },
                              { id: 'score_only', label: 'Chỉ điểm' },
                              {
                                id: 'score_and_answers',
                                label: 'Điểm kèm đáp án',
                              },
                            ] as const
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => setResultVisibility(opt.id)}
                              data-testid={`visibility-option-${opt.id}`}
                              className={`px-2.5 py-2 rounded-lg border text-xs font-semibold text-center cursor-pointer transition-colors ${
                                resultVisibility === opt.id
                                  ? 'border-teal-700 bg-teal-50 text-teal-900'
                                  : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Footer nút Lưu trong Drawer */}
                <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleCloseDrawer}
                    className="px-4 py-2.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold cursor-pointer"
                  >
                    Hủy
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmittingCreate}
                    data-testid="submit-create-session-btn"
                    className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-bold shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {isSubmittingCreate ? 'Đang tạo ca thi...' : 'Lưu ca thi'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ==========================================================================
          HỘP XÁC NHẬN KẾT THÚC CA THI
         ========================================================================== */}
      {confirmEndSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="confirm-end-session-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Xác nhận kết thúc ca thi?
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Ca thi <strong>{confirmEndSession.title}</strong> (mã{' '}
                  <span className="font-mono font-bold">
                    {confirmEndSession.code}
                  </span>
                  ) sẽ đóng vĩnh viễn và hệ thống sẽ{' '}
                  <strong>
                    tự động thu bài, chấm điểm tất cả học sinh đang làm bài
                  </strong>
                  .
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmEndSession(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmEndSession()}
                data-testid="confirm-end-session-submit-btn"
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-bold cursor-pointer"
              >
                Kết thúc & Thu bài
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          HỘP XÁC NHẬN XÓA CA THI (CHỈ KHI CHƯA CÓ AI THI)
         ========================================================================== */}
      {confirmDeleteSession && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
          data-testid="confirm-delete-session-modal"
        >
          <div className="bg-white rounded-2xl border border-slate-200 max-w-md w-full p-6 space-y-4 shadow-xl">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Xóa ca thi chưa có thí sinh?
                </h3>
                <p className="text-sm text-slate-600 mt-1">
                  Bạn sắp xóa ca thi <strong>{confirmDeleteSession.title}</strong>{' '}
                  (mã{' '}
                  <span className="font-mono font-bold">
                    {confirmDeleteSession.code}
                  </span>
                  ). Thao tác này không thể hoàn tác.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteSession(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-50 text-sm font-semibold cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteSession()}
                data-testid="confirm-delete-session-submit-btn"
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold cursor-pointer"
              >
                Xóa ca thi
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==========================================================================
          MÀN HÌNH "CHIẾU MÃ" CHỮ RẤT LỚN LÊN BẢNG (BẤM ESC ĐỂ ĐÓNG)
         ========================================================================== */}
      {projectedSession && (
        <div
          className="fixed inset-0 z-[70] bg-slate-950 text-white flex flex-col justify-between p-6 sm:p-10 select-none"
          data-testid="projected-code-fullscreen-modal"
        >
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-teal-400">
                MÃ VÀO PHÒNG THI TRỰC TIẾP
              </div>
              <div className="text-xl sm:text-2xl font-bold text-white mt-0.5">
                {projectedSession.title}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setProjectedSession(null)}
              data-testid="close-projected-code-btn"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-sm font-semibold transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
              Đóng (Esc)
            </button>
          </div>

          <div className="my-auto text-center space-y-6">
            <p className="text-base sm:text-xl text-slate-300 font-medium">
              Học sinh chọn mục <strong className="text-white">Thi ngay</strong> và nhập mã:
            </p>

            <div
              className="inline-block px-8 sm:px-14 py-8 sm:py-10 rounded-3xl bg-slate-900 border-2 border-teal-500/60 shadow-2xl font-mono font-black text-6xl sm:text-8xl md:text-9xl tracking-[0.25em] text-teal-400 tabular-nums select-all"
              data-testid="projected-big-code-text"
            >
              {projectedSession.code}
            </div>

            <div className="flex flex-wrap items-center justify-center gap-6 text-sm sm:text-base text-slate-300 tabular-nums">
              <span>
                Đối tượng:{' '}
                <strong className="text-white">
                  {projectedSession.targetClass === 'ALL'
                    ? 'Mọi học sinh có mã'
                    : `Lớp ${projectedSession.targetClass}`}
                </strong>
              </span>
              <span>•</span>
              <span>
                Số câu:{' '}
                <strong className="text-white">
                  {projectedSession.questionCount} câu
                </strong>
              </span>
              <span>•</span>
              <span>
                Thời gian:{' '}
                <strong className="text-white">
                  {projectedSession.durationMinutes} phút
                </strong>
              </span>
            </div>
          </div>

          <div className="text-center text-xs text-slate-400">
            Nhấn phím <kbd className="px-2 py-0.5 rounded bg-slate-800 text-slate-200 font-mono">Esc</kbd> để đóng màn hình chiếu mã
          </div>
        </div>
      )}
    </div>
  );
};
