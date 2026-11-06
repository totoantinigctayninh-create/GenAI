import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  Filter,
  History,
  LogOut,
  Maximize2,
  Minimize2,
  PlayCircle,
  RotateCcw,
  Settings2,
  Shuffle,
  Sparkles,
  Star,
  Target,
  Trash2,
} from 'lucide-react';
import {
  CERTIPORT_PASS_SCORE,
  CERTIPORT_TOPICS,
  ExamAttempt,
  QUESTION_FILTER_OPTIONS,
  QUESTION_TYPE_LABELS,
  Question,
  QuestionTypeFilter,
  UserAccount,
  UserAnswer,
} from '../types/exam';
import {
  evaluateQuestion,
  filterPracticeQuestions,
  formatPracticeTimerLabel,
  getCorrectAnswerBreakdown,
  getUserAnswerBreakdown,
  resolvePracticeSessionPool,
} from '../utils/scoring';
import { ThemeToggleButton } from '../context/ThemeContext';
import { IgcToanTinDefaultEmblem } from './LoginScreen';
import { MockExamView } from './MockExamView';
import { QuestionFontScale, QuestionRenderer } from './QuestionRenderer';

interface StudentPortalProps {
  currentUser: UserAccount;
  questions: Question[];
  attempts: ExamAttempt[];
  onLogout: () => Promise<void>;
  onSaveAttempt: (attempt: ExamAttempt, wrongQuestionIds: string[]) => Promise<void>;
  onSyncStudyTime: (additionalSeconds: number) => Promise<void>;
  onToggleBookmark: (questionId: string) => Promise<void>;
  onRecordPracticeCheck: (
    questionId: string,
    isCorrect: boolean,
    removeOnCorrect?: boolean
  ) => Promise<void>;
  onMarkQuestionMastered: (questionId: string) => Promise<void>;
  departmentLogoUrl?: string;
}

type StudentTab = 'dashboard' | 'practice' | 'mistakes' | 'exam' | 'history';

export function formatStudyDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours} giờ ${minutes} phút ${seconds}s`;
  }
  return `${minutes} phút ${seconds.toString().padStart(2, '0')}s`;
}

export const StudentPortal: React.FC<StudentPortalProps> = ({
  currentUser,
  questions,
  attempts,
  onLogout,
  onSaveAttempt,
  onSyncStudyTime,
  onToggleBookmark,
  onRecordPracticeCheck,
  onMarkQuestionMastered,
  departmentLogoUrl = '',
}) => {
  const [activeTab, setActiveTab] = useState<StudentTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (
      tabParam === 'dashboard' ||
      tabParam === 'practice' ||
      tabParam === 'mistakes' ||
      tabParam === 'exam' ||
      tabParam === 'history'
    ) {
      return tabParam;
    }
    return 'exam';
  });

  // ============================================================================
  // 1. STATE CHO CHẾ ĐỘ LUYỆN TẬP & HỘP THOẠI CẤU HÌNH TRƯỚC KHI VÀO LÀM
  // ============================================================================
  const [practiceTopic, setPracticeTopic] = useState<string>('ALL');
  const [practiceType, setPracticeType] = useState<QuestionTypeFilter>('ALL');
  const [practiceDrawSize, setPracticeDrawSize] = useState<string>('ALL');
  const [practiceCustomCount, setPracticeCustomCount] = useState<number>(35);
  const [practiceTimeMinutes, setPracticeTimeMinutes] = useState<number>(0); // 0 = Không giới hạn thời gian
  const [practiceShuffle, setPracticeShuffle] = useState<boolean>(true);
  const [onlyBookmarked, setOnlyBookmarked] = useState<boolean>(false);

  // Danh sách ID câu hỏi cố định cho phiên Luyện tập hiện tại (Tuyệt đối KHÔNG tự động xáo trộn lại khi chấm đáp án hay đồng bộ thời gian)
  const [practiceSessionIds, setPracticeSessionIds] = useState<string[]>([]);
  const hasInitializedPracticePoolRef = React.useRef<boolean>(false);

  // Hộp thoại xuất hiện trước khi vào làm ở Chế độ Luyện tập
  const [isPracticeSetupOpen, setIsPracticeSetupOpen] = useState<boolean>(true);
  const [isPracticeSessionActive, setIsPracticeSessionActive] = useState<boolean>(false);
  const [practiceElapsedSeconds, setPracticeElapsedSeconds] = useState<number>(0);
  const [showFilterDrawerInPractice, setShowFilterDrawerInPractice] =
    useState<boolean>(false);

  // Tối ưu hiển thị Giao diện Tập trung (Focus Mode) dùng chung cho Luyện tập & Thi thử
  const [fontScale, setFontScale] = useState<QuestionFontScale>('normal');
  const [isFocusMode, setIsFocusMode] = useState<boolean>(true);
  const [isZenHeaderHidden, setIsZenHeaderHidden] = useState<boolean>(false);
  const [isPracticeNavCollapsed, setIsPracticeNavCollapsed] = useState<boolean>(false);
  const [isMockExamInProgress, setIsMockExamInProgress] = useState<boolean>(false);

  const [practiceIndex, setPracticeIndex] = useState<number>(0);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, UserAnswer>>({});
  const [practiceCheckedMap, setPracticeCheckedMap] = useState<Record<string, boolean>>({});

  // ============================================================================
  // 2. STATE CHO KHO CÂU SAI (MISTAKE REVIEW TAB)
  // ============================================================================
  const [mistakeTopicFilter, setMistakeTopicFilter] = useState<string>('ALL');
  const [mistakeIndex, setMistakeIndex] = useState<number>(0);
  const [mistakeAnswers, setMistakeAnswers] = useState<Record<string, UserAnswer>>({});
  const [mistakeCheckedMap, setMistakeCheckedMap] = useState<Record<string, boolean>>({});
  const [masteredSuccessNote, setMasteredSuccessNote] = useState<string | null>(null);

  // ============================================================================
  // 3. STATE CHO LỊCH SỬ XEM LẠI BÀI THI THỬ
  // ============================================================================
  const [selectedHistoryAttemptId, setSelectedHistoryAttemptId] = useState<string | null>(
    null
  );
  const [sessionStudySeconds, setSessionStudySeconds] = useState(0);
  const lastSyncedSecondRef = React.useRef<number>(0);

  // Đồng hồ đếm thời gian ôn tập thực tế và tự động đồng bộ Firestore mỗi 20 giây
  useEffect(() => {
    const timer = window.setInterval(() => {
      setSessionStudySeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (
      sessionStudySeconds > 0 &&
      sessionStudySeconds % 20 === 0 &&
      lastSyncedSecondRef.current !== sessionStudySeconds
    ) {
      lastSyncedSecondRef.current = sessionStudySeconds;
      onSyncStudyTime(20).catch(() => {});
    }
  }, [sessionStudySeconds, onSyncStudyTime]);

  const bookmarkedIds = useMemo(
    () => currentUser.bookmarkedQuestions ?? [],
    [currentUser.bookmarkedQuestions]
  );

  const wrongQuestionIds = useMemo(
    () => currentUser.wrongQuestions ?? [],
    [currentUser.wrongQuestions]
  );

  const masteredQuestionIds = useMemo(
    () => currentUser.masteredQuestions ?? [],
    [currentUser.masteredQuestions]
  );

  const practiceProgress = useMemo(
    () => currentUser.practiceProgress ?? {},
    [currentUser.practiceProgress]
  );

  const myAttempts = useMemo(
    () =>
      attempts.filter(
        (a) => a.userId === currentUser.id || a.username === currentUser.username
      ),
    [attempts, currentUser.id, currentUser.username]
  );

  const selectedHistoryAttempt = useMemo(
    () => myAttempts.find((a) => a.id === selectedHistoryAttemptId) ?? null,
    [myAttempts, selectedHistoryAttemptId]
  );

  // Danh sách câu hỏi cơ sở sau khi lọc Chuyên đề + Dạng câu hỏi + Bookmark
  const baseFilteredQuestions = useMemo(() => {
    return filterPracticeQuestions(
      questions,
      {
        topic: practiceTopic,
        questionType: practiceType,
        examSet: 'ALL',
        onlyBookmarked,
      },
      bookmarkedIds
    );
  }, [questions, practiceTopic, practiceType, onlyBookmarked, bookmarkedIds]);

  // Số câu dự kiến khi đang chọn trong Hộp thoại Thiết lập (Tính toán tĩnh, không gọi Math.random)
  const setupPreviewQuestionCount = useMemo(() => {
    if (practiceDrawSize === 'ALL') return baseFilteredQuestions.length;
    const requested =
      parseInt(practiceDrawSize, 10) ||
      practiceCustomCount ||
      baseFilteredQuestions.length;
    return Math.min(baseFilteredQuestions.length, Math.max(0, requested));
  }, [baseFilteredQuestions.length, practiceDrawSize, practiceCustomCount]);

  // Hàm rút trích danh sách ID câu hỏi cố định cho Phiên Luyện tập (Chỉ gọi khi bấm Bắt đầu hoặc Bốc đề mới)
  const buildLockedPracticeSessionIds = React.useCallback(
    (overrides?: {
      topic?: string;
      type?: QuestionTypeFilter;
      bookmarkedOnly?: boolean;
      drawSize?: string;
      customCount?: number;
      shuffle?: boolean;
    }): string[] => {
      const nextTopic = overrides?.topic ?? practiceTopic;
      const nextType = overrides?.type ?? practiceType;
      const nextBookmarkedOnly = overrides?.bookmarkedOnly ?? onlyBookmarked;
      const nextDrawSize = overrides?.drawSize ?? practiceDrawSize;
      const nextCustomCount = overrides?.customCount ?? practiceCustomCount;
      const nextShuffle = overrides?.shuffle ?? practiceShuffle;

      const pool = filterPracticeQuestions(
        questions,
        {
          topic: nextTopic,
          questionType: nextType,
          examSet: 'ALL',
          onlyBookmarked: nextBookmarkedOnly,
        },
        bookmarkedIds
      );

      const isAllMode = nextDrawSize === 'ALL';
      const requestedCount = isAllMode
        ? pool.length
        : Math.max(
            1,
            parseInt(nextDrawSize, 10) || nextCustomCount || pool.length
          );

      const drawn = resolvePracticeSessionPool(pool, {
        questionCountMode: isAllMode ? 'ALL' : 'CUSTOM',
        customQuestionCount: requestedCount,
        timeLimitMinutes: practiceTimeMinutes,
        shuffleQuestions: nextShuffle,
        focusMode: isFocusMode,
      });

      return drawn.questions.map((q) => q.id);
    },
    [
      questions,
      practiceTopic,
      practiceType,
      onlyBookmarked,
      bookmarkedIds,
      practiceDrawSize,
      practiceCustomCount,
      practiceTimeMinutes,
      practiceShuffle,
      isFocusMode,
    ]
  );

  // Chỉ khởi tạo danh sách câu hỏi mặc định khi chưa có danh sách trong phiên
  useEffect(() => {
    if (!isPracticeSessionActive && questions.length > 0 && practiceSessionIds.length === 0) {
      hasInitializedPracticePoolRef.current = true;
      setPracticeSessionIds(buildLockedPracticeSessionIds());
    }
  }, [
    isPracticeSessionActive,
    questions.length,
    practiceSessionIds.length,
    buildLockedPracticeSessionIds,
  ]);

  const questionsByIdMap = useMemo(
    () => new Map<string, Question>(questions.map((q) => [q.id, q])),
    [questions]
  );

  // Danh sách câu hỏi của Phiên Luyện tập được giữ cố định thứ tự 100% trong suốt quá trình làm bài
  const filteredPracticeQuestions = useMemo(() => {
    if (practiceSessionIds.length > 0) {
      const lockedList = practiceSessionIds
        .map((id) => questionsByIdMap.get(id))
        .filter((q): q is Question => Boolean(q));
      if (lockedList.length > 0) {
        return lockedList;
      }
    }
    return baseFilteredQuestions;
  }, [practiceSessionIds, questionsByIdMap, baseFilteredQuestions]);

  const activePracticeQuestion =
    filteredPracticeQuestions[practiceIndex] ?? filteredPracticeQuestions[0] ?? null;

  // Đồng hồ đếm thời gian của phiên Luyện tập hiện tại
  useEffect(() => {
    if (activeTab !== 'practice' || !isPracticeSessionActive || isPracticeSetupOpen) {
      return;
    }
    const timer = window.setInterval(() => {
      setPracticeElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeTab, isPracticeSessionActive, isPracticeSetupOpen]);

  const practiceTimerStatus = useMemo(
    () => formatPracticeTimerLabel(practiceTimeMinutes, practiceElapsedSeconds),
    [practiceTimeMinutes, practiceElapsedSeconds]
  );

  // Thống kê nhanh trong phiên Luyện tập hiện tại
  const practiceSessionStats = useMemo(() => {
    let checkedCount = 0;
    let correctCount = 0;
    filteredPracticeQuestions.forEach((q) => {
      if (practiceCheckedMap[q.id]) {
        checkedCount += 1;
        if (evaluateQuestion(q, practiceAnswers[q.id])) {
          correctCount += 1;
        }
      }
    });
    const progressPercent =
      filteredPracticeQuestions.length > 0
        ? Math.round((checkedCount / filteredPracticeQuestions.length) * 100)
        : 0;
    return { checkedCount, correctCount, progressPercent };
  }, [filteredPracticeQuestions, practiceCheckedMap, practiceAnswers]);

  // Bắt đầu phiên luyện tập từ Hộp thoại Cấu hình — Khóa cố định danh sách câu hỏi và tự động ẩn Header
  const handleStartPracticeSession = () => {
    const lockedIds = buildLockedPracticeSessionIds();
    hasInitializedPracticePoolRef.current = true;
    setPracticeSessionIds(lockedIds);
    setPracticeIndex(0);
    setPracticeElapsedSeconds(0);
    setIsPracticeSetupOpen(false);
    setIsPracticeSessionActive(true);
    setShowFilterDrawerInPractice(false);
    if (isFocusMode) {
      setIsZenHeaderHidden(true);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Thoát chế độ luyện tập quay về trang Tổng quan và hiện lại thanh Header
  const handleExitPracticeSession = () => {
    setIsPracticeSessionActive(false);
    setIsPracticeSetupOpen(false);
    setIsZenHeaderHidden(false);
    setShowFilterDrawerInPractice(false);
    setActiveTab('dashboard');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Phím tắt bàn phím nhanh trong Chế độ Luyện tập (← Câu trước, → Câu tiếp, Enter Kiểm tra đáp án)
  useEffect(() => {
    if (activeTab !== 'practice' || isPracticeSetupOpen || !activePracticeQuestion) {
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
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
        setPracticeIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setPracticeIndex((i) =>
          Math.min(filteredPracticeQuestions.length - 1, i + 1)
        );
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTab,
    isPracticeSetupOpen,
    activePracticeQuestion,
    filteredPracticeQuestions.length,
  ]);

  // Danh sách câu hỏi trong Kho câu sai
  const wrongQuestionsList = useMemo(() => {
    const wrongSet = new Set(wrongQuestionIds);
    return questions.filter((q) => {
      if (!wrongSet.has(q.id)) return false;
      if (mistakeTopicFilter !== 'ALL' && q.topic !== mistakeTopicFilter) return false;
      return true;
    });
  }, [questions, wrongQuestionIds, mistakeTopicFilter]);

  const activeMistakeQuestion =
    wrongQuestionsList[mistakeIndex] ?? wrongQuestionsList[0] ?? null;

  // Xử lý bấm "Kiểm tra đáp án" trong Chế độ Luyện tập (Không hiện thông báo lưu Firebase để tránh xao nhãng)
  const handleCheckPracticeAnswer = async (question: Question) => {
    const ans = practiceAnswers[question.id];
    const isCorrect = evaluateQuestion(question, ans);

    setPracticeCheckedMap((prev) => ({
      ...prev,
      [question.id]: true,
    }));

    await onRecordPracticeCheck(question.id, isCorrect, false);
  };

  // Xử lý bấm "Kiểm tra đáp án" trong Kho câu sai (Giữ nguyên câu hiện tại để đọc giải thích, chỉ chuyển khi người dùng bấm)
  const handleCheckMistakeAnswer = async (question: Question) => {
    const ans = mistakeAnswers[question.id];
    const isCorrect = evaluateQuestion(question, ans);

    setMistakeCheckedMap((prev) => ({
      ...prev,
      [question.id]: true,
    }));

    await onRecordPracticeCheck(question.id, isCorrect, false);

    if (isCorrect) {
      setMasteredSuccessNote(
        `Chính xác tuyệt đối! Bạn có thể bấm nút "Đã nắm vững (Xóa khỏi kho câu sai)" bên dưới để hoàn tất khắc phục câu này.`
      );
    } else {
      setMasteredSuccessNote(null);
    }
  };

  // Xử lý bấm "Đã nắm vững (Xóa khỏi kho câu sai)"
  const handleConfirmMastered = async (questionId: string) => {
    await onMarkQuestionMastered(questionId);
    setMasteredSuccessNote(
      `Đã xóa câu ${questionId.toUpperCase()} khỏi Kho câu sai!`
    );
    setMistakeIndex(0);
  };

  const totalCombinedStudySeconds =
    (currentUser.totalStudySeconds || 0) + (sessionStudySeconds % 20);

  // Kiểm tra xem học sinh có đang ở trong không gian Tập trung Ôn thi / Thi thử hay không
  const isInFocusWorkspace =
    (activeTab === 'practice' && isPracticeSessionActive && isFocusMode) ||
    (activeTab === 'exam' && isMockExamInProgress);

  const handleSelectPracticeTab = () => {
    setActiveTab('practice');
    if (!isPracticeSessionActive) {
      setIsPracticeSetupOpen(true);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* LEFT SIDEBAR CHO DESKTOP (Tự động ẩn nếu bật Chế độ Tập trung Tối đa / Ẩn sidebar) */}
      {!isZenHeaderHidden && (
        <aside
          data-testid="student-sidebar"
          aria-label="Thanh điều hướng Học sinh"
          className="hidden md:flex md:flex-col md:w-60 lg:w-64 md:shrink-0 bg-white border-r border-slate-200 md:sticky md:top-0 md:h-screen z-30 select-none"
        >
          {/* Zone 1: Brand Wordmark & Logo Tổ Toán - Tin IGC Tây Ninh */}
          <div className="px-4 py-4 border-b border-slate-200 flex items-center justify-between gap-2">
            <a
              href="#student-home"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('dashboard');
              }}
              className="flex items-center gap-2.5 group min-w-0"
            >
              <div className="keep-light w-10 h-10 rounded-full bg-white border border-teal-200 flex items-center justify-center shrink-0 overflow-hidden shadow-2xs">
                {departmentLogoUrl ? (
                  <img
                    src={departmentLogoUrl}
                    alt="Logo Tổ Toán - Tin"
                    className="w-full h-full object-contain rounded-full p-0.5"
                  />
                ) : (
                  <IgcToanTinDefaultEmblem className="w-8 h-8" />
                )}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-extrabold tracking-tight text-teal-900 truncate">
                  Tổ Toán - Tin · IGC
                </div>
                <div className="text-[11px] font-medium text-slate-500 truncate">
                  Hệ thống Ôn Gen AI
                </div>
              </div>
            </a>
          </div>

          {/* Thông tin tóm tắt Thí sinh trong Sidebar */}
          <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 space-y-2">
            <div className="min-w-0">
              <div className="text-xs font-bold text-slate-900 truncate">
                {currentUser.fullName}
              </div>
              <div className="text-[11px] text-slate-500 truncate">
                Mã HS:{' '}
                <strong className="font-mono text-teal-800">
                  {currentUser.username}
                </strong>{' '}
                · {currentUser.className || 'Lớp GenAI'}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-0.5 tabular-nums">
              <div className="px-2 py-1 rounded-md bg-white border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block">Ôn tập</span>
                <span className="font-mono font-bold text-xs text-teal-800">
                  {formatStudyDuration(totalCombinedStudySeconds)}
                </span>
              </div>
              <div className="px-2 py-1 rounded-md bg-white border border-slate-200/80">
                <span className="text-[10px] text-slate-400 block">Đã nhớ</span>
                <span className="font-mono font-bold text-xs text-emerald-700">
                  {masteredQuestionIds.length} câu
                </span>
              </div>
            </div>
          </div>

          {/* Zone 2: Vertical Navigation Menu */}
          <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
            <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Menu Học tập
            </div>

            <button
              type="button"
              data-testid="nav-tab-dashboard"
              onClick={() => setActiveTab('dashboard')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
                activeTab === 'dashboard'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5 truncate">
                <Target className="w-4 h-4 shrink-0" />
                <span className="truncate">Tổng quan</span>
              </span>
            </button>

            <button
              type="button"
              data-testid="nav-tab-practice"
              onClick={handleSelectPracticeTab}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
                activeTab === 'practice'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5 truncate">
                <PlayCircle className="w-4 h-4 shrink-0" />
                <span className="truncate">Chế độ Luyện tập</span>
              </span>
              <span
                className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md tabular-nums ${
                  activeTab === 'practice'
                    ? 'bg-teal-800 text-teal-100'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {questions.length}
              </span>
            </button>

            <button
              type="button"
              data-testid="nav-tab-mistakes"
              onClick={() => setActiveTab('mistakes')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
                activeTab === 'mistakes'
                  ? 'bg-rose-600 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5 truncate">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="truncate">Kho câu sai</span>
              </span>
              <span
                className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md tabular-nums ${
                  activeTab === 'mistakes'
                    ? 'bg-rose-700 text-white'
                    : wrongQuestionIds.length > 0
                      ? 'bg-rose-100 text-rose-800'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {wrongQuestionIds.length}
              </span>
            </button>

            <button
              type="button"
              data-testid="nav-tab-exam"
              onClick={() => setActiveTab('exam')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
                activeTab === 'exam'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5 truncate">
                <Award className="w-4 h-4 shrink-0" />
                <span className="truncate">Thi thử (Mock Exam)</span>
              </span>
            </button>

            <button
              type="button"
              data-testid="nav-tab-history"
              onClick={() => setActiveTab('history')}
              className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
                activeTab === 'history'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="inline-flex items-center gap-2.5 truncate">
                <History className="w-4 h-4 shrink-0" />
                <span className="truncate">Lịch sử phòng thi</span>
              </span>
              <span
                className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md tabular-nums ${
                  activeTab === 'history'
                    ? 'bg-teal-800 text-teal-100'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {myAttempts.length}
              </span>
            </button>
          </nav>

          {/* Zone 3: Sidebar Footer Actions (Dark Mode + Logout) */}
          <div className="p-3 border-t border-slate-200 space-y-2 bg-slate-50/40">
            <ThemeToggleButton
              variant="sidebar"
              testId="student-sidebar-theme-toggle"
            />
            <button
              type="button"
              onClick={onLogout}
              className="w-full px-3 py-2 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 border border-transparent rounded-xl transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Đăng xuất ({currentUser.username})</span>
            </button>
          </div>
        </aside>
      )}

      {/* Thanh điều hướng rút gọn trên Mobile (< 768px) */}
      {!isZenHeaderHidden && (
        <div className="md:hidden bg-white border-b border-slate-200 sticky top-0 z-30">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
            <a
              href="#student-home"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('dashboard');
              }}
              className="text-sm font-extrabold tracking-tight text-teal-800"
            >
              Tổ Toán - Tin · IGC
            </a>
            <div className="flex items-center gap-2">
              <ThemeToggleButton
                variant="compact"
                testId="student-mobile-theme-toggle"
              />
              <button
                type="button"
                onClick={onLogout}
                className="px-2.5 py-1 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg inline-flex items-center gap-1 cursor-pointer"
              >
                <LogOut className="w-3 h-3" />
                <span>Đăng xuất</span>
              </button>
            </div>
          </div>
          <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === 'dashboard'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Tổng quan
            </button>
            <button
              type="button"
              onClick={handleSelectPracticeTab}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === 'practice'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Chế độ Luyện tập
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('mistakes')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === 'mistakes'
                  ? 'bg-rose-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Kho câu sai ({wrongQuestionIds.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('exam')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === 'exam'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Thi thử (Mock Exam)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
                activeTab === 'history'
                  ? 'bg-teal-700 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              Lịch sử ({myAttempts.length})
            </button>
          </div>
        </div>
      )}

      {/* Main Workspace */}
      <main
        className={`flex-1 min-w-0 max-w-7xl w-full mx-auto px-3 sm:px-6 ${
          isInFocusWorkspace ? 'py-2 space-y-2.5' : 'py-5 space-y-5'
        }`}
      >
        {/* Khung thông tin Học sinh — Tự động ẩn khi đang trong Phiên Ôn thi / Thi thử Tập trung */}
        {!isInFocusWorkspace && (
          <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-xs text-slate-500">
                Thí sinh: <strong className="text-slate-900">{currentUser.fullName}</strong> · Mã học
                sinh: <strong className="font-mono text-teal-800">{currentUser.username}</strong> ·{' '}
                <span>{currentUser.className || 'Lớp luyện thi Certiport GenAI'}</span>
              </div>
              <h1 className="text-lg sm:text-xl font-bold text-slate-900">
                Hệ thống Luyện thi & Thi thử Chuẩn Phòng thi Certiport Generative AI
              </h1>
            </div>

            <div className="flex flex-wrap items-center gap-6 text-xs text-slate-600 tabular-nums">
              <div>
                <span className="text-slate-400 block">Thời gian ôn tập</span>
                <span className="font-mono font-semibold text-sm text-teal-800">
                  {formatStudyDuration(totalCombinedStudySeconds)}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Đã đánh dấu (Bookmark)</span>
                <span className="font-mono font-semibold text-sm text-amber-700">
                  {bookmarkedIds.length} câu
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Kho câu sai cần ôn</span>
                <span className="font-mono font-semibold text-sm text-rose-700">
                  {wrongQuestionIds.length} câu
                </span>
              </div>
              <div>
                <span className="text-slate-400 block">Đã khắc phục</span>
                <span className="font-mono font-semibold text-sm text-emerald-700">
                  {masteredQuestionIds.length} câu
                </span>
              </div>
            </div>
          </section>
        )}

        {/* =====================================================================
            TAB 1: CHẾ ĐỘ LUYỆN TẬP (CÓ HỘP THOẠI CHỌN SỐ CÂU & THỜI GIAN TRƯỚC KHI VÀO LÀM + GIAO DIỆN TẬP TRUNG)
           ===================================================================== */}
        {activeTab === 'practice' && (
          <div data-testid="practice-focus-workspace" className="space-y-2.5">
            {/* HỘP THOẠI CẤU HÌNH PHIÊN LUYỆN TẬP TRƯỚC KHI VÀO LÀM */}
            {isPracticeSetupOpen && (
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="practice-setup-dialog-title"
                data-testid="practice-setup-dialog"
                className="fixed inset-0 z-50 bg-slate-900/65 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto"
              >
                <div className="bg-white border border-slate-200 rounded-2xl max-w-2xl w-full p-6 sm:p-7 shadow-2xl space-y-6 my-auto">
                  <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                    <div className="space-y-1">
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-800">
                        <Settings2 className="w-4 h-4 text-teal-700" />
                        <span>Thiết lập Phiên Luyện tập Cá nhân</span>
                      </div>
                      <h2
                        id="practice-setup-dialog-title"
                        className="text-lg sm:text-xl font-bold text-slate-900"
                      >
                        Chọn Số câu hỏi & Thời gian trước khi vào Luyện tập
                      </h2>
                      <p className="text-xs sm:text-sm text-slate-600">
                        Bạn có thể chọn <strong>làm tất cả các câu ({baseFilteredQuestions.length} câu)</strong> và <strong>không giới hạn thời gian</strong>, hoặc giới hạn số câu và đồng hồ đếm ngược để rèn tốc độ.
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isPracticeSessionActive && (
                        <button
                          type="button"
                          onClick={() => setIsPracticeSetupOpen(false)}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 cursor-pointer"
                        >
                          Đóng
                        </button>
                      )}
                      <button
                        type="button"
                        data-testid="exit-practice-from-setup-btn"
                        onClick={handleExitPracticeSession}
                        className="px-3 py-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-bold text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>Thoát luyện tập</span>
                      </button>
                    </div>
                  </div>

                  {/* Bước 1: Chọn Số lượng câu hỏi muốn làm */}
                  <div className="space-y-2.5">
                    <label className="block text-xs sm:text-sm font-bold text-slate-900">
                      1. Chọn số lượng câu hỏi muốn làm (Ngân hàng hiện có {baseFilteredQuestions.length} câu):
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        data-testid="practice-count-option-all"
                        onClick={() => {
                          setPracticeDrawSize('ALL');
                          setPracticeCustomCount(baseFilteredQuestions.length);
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          practiceDrawSize === 'ALL'
                            ? 'border-teal-600 bg-teal-50/80 ring-1 ring-teal-600 text-teal-950'
                            : 'border-slate-200 bg-white hover:border-teal-500 text-slate-800'
                        }`}
                      >
                        <div className="text-xs sm:text-sm font-bold">
                          Làm tất cả các câu
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
                          Toàn bộ {baseFilteredQuestions.length} câu hỏi
                        </div>
                      </button>

                      {[10, 20, 35, 45].map((cnt) => {
                        const isSelected = practiceDrawSize === String(cnt);
                        return (
                          <button
                            key={cnt}
                            type="button"
                            data-testid={`practice-count-option-${cnt}`}
                            onClick={() => {
                              setPracticeDrawSize(String(cnt));
                              setPracticeCustomCount(cnt);
                            }}
                            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'border-teal-600 bg-teal-50/80 ring-1 ring-teal-600 text-teal-950'
                                : 'border-slate-200 bg-white hover:border-teal-500 text-slate-800'
                            }`}
                          >
                            <div className="text-xs sm:text-sm font-bold font-mono tabular-nums">
                              {cnt} câu hỏi
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {cnt === 45
                                ? 'Chuẩn đề thi Certiport'
                                : 'Bốc theo tỉ lệ ngân hàng'}
                            </div>
                          </button>
                        );
                      })}

                      {/* Ô nhập số câu tùy ý */}
                      <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-center">
                        <label
                          htmlFor="practice-custom-count-input"
                          className="text-[11px] font-semibold text-slate-600 mb-1"
                        >
                          Hoặc nhập số câu tùy ý:
                        </label>
                        <input
                          id="practice-custom-count-input"
                          data-testid="practice-custom-count-input"
                          type="number"
                          min={1}
                          max={Math.max(1, baseFilteredQuestions.length)}
                          value={
                            practiceDrawSize === 'ALL'
                              ? baseFilteredQuestions.length
                              : parseInt(practiceDrawSize, 10) || practiceCustomCount
                          }
                          onChange={(e) => {
                            const val = Math.max(
                              1,
                              Math.min(
                                Math.max(1, baseFilteredQuestions.length),
                                parseInt(e.target.value, 10) || 1
                              )
                            );
                            setPracticeCustomCount(val);
                            setPracticeDrawSize(String(val));
                          }}
                          className="w-full px-2.5 py-1 text-xs sm:text-sm font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bước 2: Chọn Thời gian làm bài (Hỗ trợ Không giới hạn thời gian) */}
                  <div className="space-y-2.5">
                    <label className="block text-xs sm:text-sm font-bold text-slate-900">
                      2. Chọn thời gian làm bài:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        data-testid="practice-time-option-0"
                        onClick={() => setPracticeTimeMinutes(0)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          practiceTimeMinutes === 0
                            ? 'border-teal-600 bg-teal-50/80 ring-1 ring-teal-600 text-teal-950'
                            : 'border-slate-200 bg-white hover:border-teal-500 text-slate-800'
                        }`}
                      >
                        <div className="text-xs sm:text-sm font-bold">
                          ∞ Không giới hạn
                        </div>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Tự do ôn tập thoải mái
                        </div>
                      </button>

                      {[15, 30, 50, 60].map((mins) => {
                        const isSelected = practiceTimeMinutes === mins;
                        return (
                          <button
                            key={mins}
                            type="button"
                            data-testid={`practice-time-option-${mins}`}
                            onClick={() => setPracticeTimeMinutes(mins)}
                            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'border-teal-600 bg-teal-50/80 ring-1 ring-teal-600 text-teal-950'
                                : 'border-slate-200 bg-white hover:border-teal-500 text-slate-800'
                            }`}
                          >
                            <div className="text-xs sm:text-sm font-bold font-mono tabular-nums">
                              {mins} phút
                            </div>
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              {mins === 50
                                ? 'Chuẩn 50p Certiport'
                                : 'Đếm ngược thời gian'}
                            </div>
                          </button>
                        );
                      })}

                      <div className="p-2.5 rounded-xl border border-slate-200 bg-slate-50 flex flex-col justify-center">
                        <label
                          htmlFor="practice-custom-time-input"
                          className="text-[11px] font-semibold text-slate-600 mb-1"
                        >
                          Số phút tùy chỉnh (0 = ∞):
                        </label>
                        <input
                          id="practice-custom-time-input"
                          data-testid="practice-custom-time-input"
                          type="number"
                          min={0}
                          max={300}
                          value={practiceTimeMinutes}
                          onChange={(e) =>
                            setPracticeTimeMinutes(
                              Math.max(0, parseInt(e.target.value, 10) || 0)
                            )
                          }
                          className="w-full px-2.5 py-1 text-xs sm:text-sm font-mono font-bold rounded-lg border border-slate-300 bg-white text-slate-900"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bước 3: Lọc Chuyên đề, Dạng bài & Chế độ Tập trung */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-slate-100">
                    <div>
                      <label
                        htmlFor="setup-practice-topic"
                        className="block text-xs font-semibold text-slate-600 mb-1"
                      >
                        Chuyên đề kiến thức:
                      </label>
                      <select
                        id="setup-practice-topic"
                        value={practiceTopic}
                        onChange={(e) => setPracticeTopic(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-900"
                      >
                        <option value="ALL">Tất cả 4 chuyên đề kiến thức</option>
                        {CERTIPORT_TOPICS.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="setup-practice-type"
                        className="block text-xs font-semibold text-slate-600 mb-1"
                      >
                        Dạng câu hỏi tương tác:
                      </label>
                      <select
                        id="setup-practice-type"
                        value={practiceType}
                        onChange={(e) =>
                          setPracticeType(e.target.value as QuestionTypeFilter)
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-900"
                      >
                        {QUESTION_FILTER_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 pt-1 text-xs font-semibold text-slate-700">
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={practiceShuffle}
                        onChange={(e) => setPracticeShuffle(e.target.checked)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span>Xáo trộn ngẫu nhiên câu hỏi</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={isFocusMode}
                        onChange={(e) => setIsFocusMode(e.target.checked)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span>Tối ưu hiển thị Tập trung (Ẩn khung phụ, phóng rõ chữ đề)</span>
                    </label>

                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={onlyBookmarked}
                        onChange={(e) => setOnlyBookmarked(e.target.checked)}
                        className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                      />
                      <span>Chỉ làm câu đã đánh dấu ({bookmarkedIds.length})</span>
                    </label>
                  </div>

                  {/* Nút Bắt đầu Vào Làm Bài */}
                  <div className="pt-4 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
                    <div className="text-xs text-slate-600 tabular-nums">
                      Sẵn sàng:{' '}
                      <strong className="text-teal-800 font-mono">
                        {setupPreviewQuestionCount} câu hỏi
                      </strong>{' '}
                      · Thời gian:{' '}
                      <strong className="text-teal-800">
                        {practiceTimeMinutes === 0
                          ? '∞ Không giới hạn thời gian'
                          : `${practiceTimeMinutes} phút`}
                      </strong>
                    </div>

                    <button
                      type="button"
                      data-testid="start-practice-session-btn"
                      disabled={setupPreviewQuestionCount === 0}
                      onClick={handleStartPracticeSession}
                      className="px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 text-white text-sm font-bold inline-flex items-center gap-2 shadow-sm transition-all cursor-pointer"
                    >
                      <PlayCircle className="w-5 h-5" />
                      <span>
                        Bắt đầu Vào Làm Bài ({setupPreviewQuestionCount} câu)
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* THANH ĐIỀU KHIỂN ÔN THI TẬP TRUNG SIÊU GỌN (1 DÒNG ~38PX) */}
            <section
              aria-label="Thanh điều khiển Chế độ Luyện tập Tập trung"
              data-testid="practice-focus-command-bar"
              className="sticky top-1.5 z-20 bg-white/95 backdrop-blur-xs border border-slate-200 rounded-lg px-3 py-1.5 shadow-2xs space-y-1.5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2.5 py-1 rounded-md bg-teal-800 text-white text-[11px] font-bold tracking-wide tabular-nums">
                    LUYỆN TẬP · CÂU {Math.min(practiceIndex + 1, filteredPracticeQuestions.length)}/{filteredPracticeQuestions.length}
                  </span>

                  <span className="text-xs font-medium text-slate-700 tabular-nums">
                    Đã chấm:{' '}
                    <strong className="font-mono text-teal-800">
                      {practiceSessionStats.checkedCount}/{filteredPracticeQuestions.length}
                    </strong>{' '}
                    ({practiceSessionStats.progressPercent}%) · Đúng:{' '}
                    <strong className="font-mono text-emerald-700">
                      {practiceSessionStats.correctCount}
                    </strong>
                  </span>
                </div>

                {/* Các nút Công cụ Tập trung & Quan sát gọn trên 1 dòng */}
                <div className="flex flex-wrap items-center gap-1.5">
                  {/* Đồng hồ Thời gian (Không giới hạn hoặc Đếm ngược) */}
                  <div
                    data-testid="practice-session-timer"
                    className={`px-2 py-1 rounded-md font-mono text-xs font-bold tabular-nums inline-flex items-center gap-1 ${
                      practiceTimerStatus.isExpired
                        ? 'bg-rose-600 text-white'
                        : practiceTimerStatus.isWarning
                          ? 'bg-amber-500 text-white animate-pulse'
                          : 'bg-slate-900 text-white'
                    }`}
                  >
                    <Clock className="w-3 h-3 shrink-0" />
                    <span>
                      {practiceTimerStatus.isUnlimited
                        ? `∞ Tự do · ${practiceTimerStatus.displayClock}`
                        : practiceTimerStatus.isExpired
                          ? 'Hết giờ! (00:00)'
                          : `Còn: ${practiceTimerStatus.displayClock}`}
                    </span>
                  </div>

                  {/* Bộ chỉnh cỡ chữ A- / A / A+ */}
                  <div
                    className="inline-flex items-center rounded-md border border-slate-200 bg-slate-100 p-0.5 text-[11px]"
                    role="group"
                    aria-label="Chỉnh cỡ chữ câu hỏi"
                  >
                    <button
                      type="button"
                      data-testid="font-scale-btn-normal"
                      onClick={() => setFontScale('normal')}
                      className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                        fontScale === 'normal'
                          ? 'bg-white text-teal-800 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      data-testid="font-scale-btn-large"
                      onClick={() => setFontScale('large')}
                      className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                        fontScale === 'large'
                          ? 'bg-white text-teal-800 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      A
                    </button>
                    <button
                      type="button"
                      data-testid="font-scale-btn-xlarge"
                      onClick={() => setFontScale('xlarge')}
                      className={`px-1.5 py-0.5 rounded font-bold transition-colors cursor-pointer ${
                        fontScale === 'xlarge'
                          ? 'bg-white text-teal-800 shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      A+
                    </button>
                  </div>

                  {/* Nút Chuyển đổi Sáng/Tối ngay trong phiên Luyện tập Tập trung */}
                  <ThemeToggleButton
                    variant="compact"
                    testId="practice-zen-theme-toggle"
                  />

                  {/* Nút Mở rộng khung đề (Ẩn/Hiện cột danh sách câu hỏi) */}
                  <button
                    type="button"
                    data-testid="toggle-navigator-sidebar-btn"
                    onClick={() => setIsPracticeNavCollapsed((prev) => !prev)}
                    className="px-2 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                  >
                    {isPracticeNavCollapsed ? (
                      <>
                        <Minimize2 className="w-3 h-3" />
                        <span>Hiện bảng số</span>
                      </>
                    ) : (
                      <>
                        <Maximize2 className="w-3 h-3" />
                        <span>Mở rộng đề</span>
                      </>
                    )}
                  </button>

                  {/* Nút Mở lại Hộp thoại Chọn Số câu & Thời gian */}
                  <button
                    type="button"
                    data-testid="open-practice-setup-btn"
                    onClick={() => setIsPracticeSetupOpen(true)}
                    className="px-2 py-1 rounded-md border border-teal-600 bg-teal-50/80 hover:bg-teal-100 text-[11px] font-bold text-teal-900 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Settings2 className="w-3 h-3 text-teal-700" />
                    <span>Cấu hình đề</span>
                  </button>

                  {/* Nút bật/tắt nhanh bộ lọc phụ */}
                  <button
                    type="button"
                    onClick={() => setShowFilterDrawerInPractice((prev) => !prev)}
                    className="px-2 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Filter className="w-3 h-3" />
                    <span>Bộ lọc</span>
                  </button>

                  {/* Nút Thoát chế độ luyện tập */}
                  <button
                    type="button"
                    data-testid="exit-practice-session-btn"
                    onClick={handleExitPracticeSession}
                    className="px-2.5 py-1 rounded-md border border-rose-300 bg-rose-50 hover:bg-rose-600 hover:text-white hover:border-rose-600 text-[11px] font-bold text-rose-700 inline-flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                    <span>Thoát luyện tập</span>
                  </button>
                </div>
              </div>

              {/* Ngăn kéo Bộ lọc nhanh (chỉ mở khi học sinh bấm nút "Bộ lọc") */}
              {showFilterDrawerInPractice && (
                <div className="pt-2.5 border-t border-slate-200 grid grid-cols-1 md:grid-cols-3 gap-2.5">
                  <div>
                    <label
                      htmlFor="practice-topic-select"
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      Chuyên đề kiến thức:
                    </label>
                    <select
                      id="practice-topic-select"
                      value={practiceTopic}
                      onChange={(e) => {
                        const nextTopic = e.target.value;
                        setPracticeTopic(nextTopic);
                        setPracticeSessionIds(
                          buildLockedPracticeSessionIds({ topic: nextTopic })
                        );
                        setPracticeIndex(0);
                      }}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900"
                    >
                      <option value="ALL">Tất cả 4 chuyên đề kiến thức</option>
                      {CERTIPORT_TOPICS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="practice-type-select"
                      className="block text-[11px] font-semibold text-slate-600 mb-1"
                    >
                      Dạng bài tập:
                    </label>
                    <select
                      id="practice-type-select"
                      value={practiceType}
                      onChange={(e) => {
                        const nextType = e.target.value as QuestionTypeFilter;
                        setPracticeType(nextType);
                        setPracticeSessionIds(
                          buildLockedPracticeSessionIds({ type: nextType })
                        );
                        setPracticeIndex(0);
                      }}
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-medium text-slate-900"
                    >
                      {QUESTION_FILTER_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      data-testid="redraw-proportional-practice-btn"
                      onClick={() => {
                        setPracticeSessionIds(buildLockedPracticeSessionIds());
                        setPracticeIndex(0);
                      }}
                      className="px-3 py-1.5 rounded-lg border border-teal-600 bg-teal-50 text-xs font-bold text-teal-900 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Shuffle className="w-3.5 h-3.5" />
                      <span>Bốc đề mới</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        const nextBookmarked = !onlyBookmarked;
                        setOnlyBookmarked(nextBookmarked);
                        setPracticeSessionIds(
                          buildLockedPracticeSessionIds({
                            bookmarkedOnly: nextBookmarked,
                          })
                        );
                        setPracticeIndex(0);
                      }}
                      className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1 cursor-pointer ${
                        onlyBookmarked
                          ? 'border-amber-500 bg-amber-50 text-amber-900'
                          : 'border-slate-300 bg-white text-slate-700'
                      }`}
                    >
                      <Star className="w-3.5 h-3.5" />
                      <span>Bookmark ({bookmarkedIds.length})</span>
                    </button>
                  </div>
                </div>
              )}
            </section>

            {filteredPracticeQuestions.length === 0 ? (
              <div className="p-12 bg-white border border-slate-200 rounded-xl text-center space-y-3">
                <p className="text-sm font-medium text-slate-700">
                  Không tìm thấy câu hỏi nào khớp với điều kiện lọc hiện tại.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setPracticeTopic('ALL');
                    setPracticeType('ALL');
                    setPracticeDrawSize('ALL');
                    setOnlyBookmarked(false);
                    setPracticeSessionIds(
                      buildLockedPracticeSessionIds({
                        topic: 'ALL',
                        type: 'ALL',
                        drawSize: 'ALL',
                        bookmarkedOnly: false,
                      })
                    );
                    setPracticeIndex(0);
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg cursor-pointer"
                >
                  Hiển thị toàn bộ {questions.length} câu hỏi
                </button>
              </div>
            ) : (
              <div className="flex flex-col lg:flex-row gap-3 items-start">
                <div
                  className={`${
                    isPracticeNavCollapsed
                      ? 'w-full max-w-5xl mx-auto'
                      : 'flex-1 min-w-0 w-full'
                  } space-y-2.5`}
                >
                  {activePracticeQuestion && (
                    <>
                      <QuestionRenderer
                        question={activePracticeQuestion}
                        questionNumber={practiceIndex + 1}
                        totalQuestions={filteredPracticeQuestions.length}
                        userAnswer={practiceAnswers[activePracticeQuestion.id]}
                        onChangeAnswer={(ans) => {
                          setPracticeAnswers((prev) => ({
                            ...prev,
                            [activePracticeQuestion.id]: ans,
                          }));
                          if (practiceCheckedMap[activePracticeQuestion.id]) {
                            setPracticeCheckedMap((prev) => ({
                              ...prev,
                              [activePracticeQuestion.id]: false,
                            }));
                          }
                        }}
                        showFeedback={Boolean(practiceCheckedMap[activePracticeQuestion.id])}
                        isBookmarked={bookmarkedIds.includes(activePracticeQuestion.id)}
                        onToggleBookmark={(qId) => onToggleBookmark(qId)}
                        fontScale={fontScale}
                      />

                      <div className="bg-white border border-slate-200 rounded-xl px-3.5 py-2 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={practiceIndex === 0}
                            onClick={() => setPracticeIndex((i) => Math.max(0, i - 1))}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" /> Câu trước (←)
                          </button>

                          <button
                            type="button"
                            disabled={practiceIndex >= filteredPracticeQuestions.length - 1}
                            onClick={() =>
                              setPracticeIndex((i) =>
                                Math.min(filteredPracticeQuestions.length - 1, i + 1)
                              )
                            }
                            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            Câu tiếp theo (→) <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setPracticeAnswers((prev) => {
                                const next = { ...prev };
                                delete next[activePracticeQuestion.id];
                                return next;
                              });
                              setPracticeCheckedMap((prev) => ({
                                ...prev,
                                [activePracticeQuestion.id]: false,
                              }));
                            }}
                            className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Làm lại câu này</span>
                          </button>

                          <button
                            type="button"
                            data-testid="check-practice-answer-btn"
                            onClick={() => handleCheckPracticeAnswer(activePracticeQuestion)}
                            className="px-4 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Kiểm tra đáp án</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                {/* BẢNG CÂU HỎI SIÊU GỌN (CHỈ CHUYỂN CÂU KHI BẤM CHỌN) */}
                {!isPracticeNavCollapsed && (
                  <aside
                    data-testid="practice-question-navigator"
                    className="w-full lg:w-56 xl:w-60 shrink-0 bg-white border border-slate-200 rounded-xl p-2.5 space-y-2 sticky top-12"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <h3 className="text-[11px] font-bold text-slate-900">
                        Bảng câu hỏi ({filteredPracticeQuestions.length})
                      </h3>
                      <span className="text-[10px] text-slate-500">
                        Bấm số để chuyển
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-slate-600 px-1.5 py-1 rounded bg-slate-50 border border-slate-100">
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-emerald-600" /> Đúng
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-rose-500" /> Sai
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="w-2 h-2 rounded-xs bg-white border border-slate-300" /> Chưa chấm
                      </span>
                    </div>

                    <div className="grid grid-cols-6 gap-1 p-1 max-h-[260px] overflow-y-auto">
                      {filteredPracticeQuestions.map((q, idx) => {
                        const isCurrent = idx === practiceIndex;
                        const isBookmarked = bookmarkedIds.includes(q.id);
                        const checkedHere = Boolean(practiceCheckedMap[q.id]);
                        const localCorrect =
                          checkedHere && evaluateQuestion(q, practiceAnswers[q.id]);
                        const savedStat = practiceProgress[q.id];

                        let styleClass =
                          'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-600';
                        if (checkedHere) {
                          styleClass = localCorrect
                            ? 'border-emerald-700 bg-emerald-600 text-white font-bold'
                            : 'border-rose-600 bg-rose-500 text-white font-bold';
                        } else if (savedStat) {
                          styleClass = savedStat.isCorrect
                            ? 'border-emerald-300 bg-emerald-50 text-emerald-900 font-semibold'
                            : 'border-rose-300 bg-rose-50 text-rose-900 font-semibold';
                        }

                        if (isCurrent) {
                          styleClass += ' ring-2 ring-teal-700 ring-offset-1 font-extrabold';
                        }

                        return (
                          <button
                            key={q.id}
                            type="button"
                            data-testid={`practice-nav-item-${idx + 1}`}
                            title={`Câu ${idx + 1}${checkedHere ? (localCorrect ? ' (Đúng)' : ' (Sai)') : ''}`}
                            onClick={() => setPracticeIndex(idx)}
                            className={`h-7 rounded-md border text-[11px] font-mono tabular-nums transition-all flex items-center justify-center relative cursor-pointer ${styleClass}`}
                          >
                            <span>{idx + 1}</span>
                            {isBookmarked && (
                              <span className="absolute -top-0.5 right-0.5 text-[8px] text-amber-500 leading-none">
                                ★
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </aside>
                )}
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 2: KHO CÂU SAI (MISTAKE REVIEW TAB) — KÈM THANH ĐO TIẾN ĐỘ KHẮC PHỤC
           ===================================================================== */}
        {activeTab === 'mistakes' && (
          <div className="space-y-6">
            <section className="bg-white border border-slate-200/80 rounded-2xl p-5 sm:p-6 shadow-sm space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-rose-700 bg-rose-50 border border-rose-200/80 px-3 py-1 rounded-full">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Kho câu sai cá nhân</span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 pt-1">
                    Ôn luyện & Khắc phục Câu hỏi Làm sai ({wrongQuestionsList.length} câu cần khắc phục)
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Mọi câu hỏi bạn trả lời sai trong <strong>Chế độ Luyện tập</strong> hoặc{' '}
                    <strong>Chế độ Thi thử (Mock Exam)</strong> đều tự động được lưu tại đây. Khi
                    làm lại và trả lời <strong>ĐÚNG 100%</strong>, bạn có thể xác nhận{' '}
                    <strong>"Đã nắm vững"</strong> để xóa khỏi kho câu sai.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <select
                    aria-label="Lọc chuyên đề trong Kho câu sai"
                    value={mistakeTopicFilter}
                    onChange={(e) => {
                      setMistakeTopicFilter(e.target.value);
                      setMistakeIndex(0);
                    }}
                    className="px-3.5 py-2 rounded-xl border border-slate-300 bg-white text-xs font-semibold text-slate-800"
                  >
                    <option value="ALL">
                      Tất cả chuyên đề ({wrongQuestionIds.length} câu sai)
                    </option>
                    {CERTIPORT_TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Thanh đo Tiến độ Khắc phục: Đã khắc phục X / Tổng số câu sai */}
              {(() => {
                const totalMistakesEver =
                  masteredQuestionIds.length + wrongQuestionIds.length;
                const masteryPercent =
                  totalMistakesEver > 0
                    ? Math.round((masteredQuestionIds.length / totalMistakesEver) * 100)
                    : 100;
                return (
                  <div
                    data-testid="mistake-mastery-progress"
                    className="p-4 rounded-xl bg-slate-50/90 border border-slate-200/80 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <Award className="w-4 h-4 text-emerald-600" />
                        <span>
                          Tiến độ khắc phục Kho câu sai:{' '}
                          <strong className="font-mono text-emerald-700">
                            Đã khắc phục {masteredQuestionIds.length} / {totalMistakesEver} câu sai
                          </strong>
                        </span>
                      </span>
                      <span className="font-mono font-extrabold text-emerald-800 bg-emerald-100/90 px-2.5 py-0.5 rounded-full tabular-nums">
                        {masteryPercent}% Hoàn thành
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden">
                      <div
                        style={{ width: `${masteryPercent}%` }}
                        className="h-full rounded-full bg-gradient-to-r from-teal-600 to-emerald-500 transition-all duration-500 ease-out"
                      />
                    </div>
                  </div>
                );
              })()}

              {masteredSuccessNote && (
                <div
                  role="status"
                  className="animate-feedback-reveal p-4 rounded-xl bg-gradient-to-r from-emerald-50 via-teal-50 to-amber-50 border border-emerald-300 text-xs sm:text-sm font-bold text-emerald-950 flex items-center justify-between gap-3 shadow-xs"
                >
                  <div className="flex items-center gap-2.5">
                    <span className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <Sparkles className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-700">
                        Chúc mừng bạn đã chinh phục kiến thức!
                      </div>
                      <div>{masteredSuccessNote}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMasteredSuccessNote(null)}
                    className="px-2.5 py-1 rounded-lg bg-white/80 hover:bg-white text-xs font-bold text-emerald-800 border border-emerald-200 shrink-0 cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              )}
            </section>

            {wrongQuestionsList.length === 0 ? (
              <div className="bg-white border border-slate-200 rounded-xl p-12 text-center space-y-4">
                <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-bold text-slate-900">
                    Tuyệt vời! Hiện không có câu hỏi nào tồn đọng trong Kho câu sai
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto">
                    Bạn đã khắc phục hết các câu hỏi làm sai ({masteredQuestionIds.length} câu đã
                    nắm vững).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('practice')}
                  className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                >
                  Chuyển sang Chế độ Luyện tập
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8 space-y-4">
                  {activeMistakeQuestion && (
                    <>
                      <QuestionRenderer
                        question={activeMistakeQuestion}
                        questionNumber={mistakeIndex + 1}
                        totalQuestions={wrongQuestionsList.length}
                        userAnswer={mistakeAnswers[activeMistakeQuestion.id]}
                        onChangeAnswer={(ans) => {
                          setMistakeAnswers((prev) => ({
                            ...prev,
                            [activeMistakeQuestion.id]: ans,
                          }));
                          if (mistakeCheckedMap[activeMistakeQuestion.id]) {
                            setMistakeCheckedMap((prev) => ({
                              ...prev,
                              [activeMistakeQuestion.id]: false,
                            }));
                          }
                        }}
                        showFeedback={Boolean(mistakeCheckedMap[activeMistakeQuestion.id])}
                        isBookmarked={bookmarkedIds.includes(activeMistakeQuestion.id)}
                        onToggleBookmark={(qId) => onToggleBookmark(qId)}
                      />

                      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={mistakeIndex === 0}
                            onClick={() => setMistakeIndex((i) => Math.max(0, i - 1))}
                            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" /> Câu sai trước
                          </button>

                          <button
                            type="button"
                            disabled={mistakeIndex >= wrongQuestionsList.length - 1}
                            onClick={() =>
                              setMistakeIndex((i) =>
                                Math.min(wrongQuestionsList.length - 1, i + 1)
                              )
                            }
                            className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            Câu sai tiếp theo <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                          <button
                            type="button"
                            onClick={() => handleCheckMistakeAnswer(activeMistakeQuestion)}
                            className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold transition-colors inline-flex items-center gap-2 cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Kiểm tra đáp án</span>
                          </button>

                          {mistakeCheckedMap[activeMistakeQuestion.id] &&
                            evaluateQuestion(
                              activeMistakeQuestion,
                              mistakeAnswers[activeMistakeQuestion.id]
                            ) && (
                              <button
                                type="button"
                                onClick={() =>
                                  handleConfirmMastered(activeMistakeQuestion.id)
                                }
                                className="px-4 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs sm:text-sm font-bold transition-colors inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
                              >
                                <Sparkles className="w-4 h-4" />
                                <span>Đã nắm vững (Xóa khỏi kho câu sai)</span>
                              </button>
                            )}
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-900">
                      Danh sách Câu cần Khắc phục ({wrongQuestionsList.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Chọn câu hỏi bên dưới để làm lại. Trả lời đúng 100% để mở khóa nút "Đã nắm vững".
                    </p>
                  </div>

                  <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {wrongQuestionsList.map((q, idx) => {
                      const isCurrent = idx === mistakeIndex;
                      const isChecked = Boolean(mistakeCheckedMap[q.id]);
                      const isNowCorrect =
                        isChecked && evaluateQuestion(q, mistakeAnswers[q.id]);

                      return (
                        <div
                          key={q.id}
                          className={`p-3 rounded-xl border transition-all flex flex-col gap-2 ${
                            isCurrent
                              ? 'border-rose-500 bg-rose-50/40 ring-1 ring-rose-500'
                              : 'border-slate-200 bg-slate-50/60 hover:bg-slate-50'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => setMistakeIndex(idx)}
                            className="w-full text-left space-y-1 cursor-pointer"
                          >
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono font-bold text-rose-800">
                                Câu sai #{idx + 1} ({q.id.toUpperCase()}) · {q.topic}
                              </span>
                              <span className="text-slate-500">
                                {QUESTION_TYPE_LABELS[q.type]}
                              </span>
                            </div>
                            <p className="text-xs font-medium text-slate-900 line-clamp-2">
                              {q.prompt}
                            </p>
                          </button>

                          <div className="flex items-center justify-between pt-1 border-t border-slate-200/70">
                            <span className="text-[11px] text-slate-500">
                              {isNowCorrect ? (
                                <strong className="text-emerald-700">
                                  ✓ Đã làm lại ĐÚNG 100%
                                </strong>
                              ) : (
                                'Đang chờ làm lại đúng 100%'
                              )}
                            </span>

                            <button
                              type="button"
                              onClick={() => handleConfirmMastered(q.id)}
                              className="text-[11px] font-semibold text-emerald-700 hover:text-emerald-900 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3 h-3" /> Đã nắm vững
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 3: TỔNG QUAN & CHỌN NHANH CHẾ ĐỘ HỌC
           ===================================================================== */}
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              <div className="lg:col-span-7 bg-gradient-to-br from-sky-50 via-white to-teal-50/50 border border-slate-200 rounded-xl p-6 flex flex-col justify-between space-y-6">
                <div className="space-y-2.5">
                  <div className="text-xs font-semibold text-teal-700">
                    Mô phỏng 100% Phòng thi Certiport Generative AI · Bốc đề tự động theo tỉ lệ ngân hàng
                  </div>
                  <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                    Luyện tập Từng câu, Khắc phục Kho câu sai & Thi thử 50 phút
                  </h2>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Mỗi khi bạn bắt đầu làm đề, hệ thống sẽ tự động <strong>bốc ngẫu nhiên số câu hỏi theo đúng tỉ lệ các Chuyên đề và Dạng câu hỏi hiện có trong Ngân hàng đề ({questions.length} câu)</strong>, xáo trộn thứ tự và chấm điểm theo thang 1000 chuẩn Certiport (&ge; 700/1000 là ĐẠT - PASS).
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setActiveTab('exam')}
                    className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <PlayCircle className="w-4 h-4" />
                    <span>Vào Phòng Thi Thử (Bốc đề theo tỉ lệ)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPracticeSetupOpen(true);
                      setActiveTab('practice');
                    }}
                    className="px-4 py-2.5 rounded-lg bg-white border border-slate-300 hover:border-teal-600 text-slate-800 text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <Target className="w-4 h-4" />
                    <span>Chế độ Luyện tập</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('mistakes')}
                    className="px-4 py-2.5 rounded-lg bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-800 text-sm font-semibold transition-colors inline-flex items-center gap-2 cursor-pointer"
                  >
                    <AlertTriangle className="w-4 h-4" />
                    <span>Kho câu sai ({wrongQuestionIds.length} câu)</span>
                  </button>
                </div>
              </div>

              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-bold text-slate-900">
                    Tỉ lệ Ngân hàng Đề ({questions.length} câu)
                  </h3>
                  <span className="text-xs text-teal-800 font-semibold">
                    Bốc ngẫu nhiên theo tỉ lệ
                  </span>
                </div>

                <div className="divide-y divide-slate-100">
                  {CERTIPORT_TOPICS.map((topic) => {
                    const count = questions.filter((q) => q.topic === topic).length;
                    const ratio =
                      questions.length > 0
                        ? Math.round((count / questions.length) * 100)
                        : 0;
                    return (
                      <div
                        key={topic}
                        className="py-3 flex items-center justify-between gap-4"
                      >
                        <div className="space-y-1 flex-1">
                          <div className="text-sm font-semibold text-slate-900">
                            {topic}
                          </div>
                          <div className="text-xs text-slate-500 tabular-nums">
                            Hiện có <strong>{count} câu</strong> · Chiếm tỉ trọng{' '}
                            <strong className="text-teal-800">{ratio}%</strong> trong ngân hàng
                          </div>
                        </div>
                        <button
                          type="button"
                          disabled={count === 0}
                          onClick={() => {
                            setPracticeTopic(topic);
                            setPracticeType('ALL');
                            setPracticeDrawSize('ALL');
                            setOnlyBookmarked(false);
                            setPracticeSessionIds(
                              buildLockedPracticeSessionIds({
                                topic,
                                type: 'ALL',
                                drawSize: 'ALL',
                                bookmarkedOnly: false,
                              })
                            );
                            setPracticeIndex(0);
                            setIsPracticeSetupOpen(true);
                            setActiveTab('practice');
                          }}
                          className="px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-sky-50 text-teal-800 hover:bg-teal-700 hover:text-white disabled:opacity-40 transition-colors cursor-pointer shrink-0"
                        >
                          Luyện chuyên đề
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            TAB 4: CHẾ ĐỘ THI THỬ CHUẨN CERTIPORT (MOCK EXAM VIEW)
           ===================================================================== */}
        {activeTab === 'exam' && (
          <MockExamView
            currentUser={currentUser}
            questionsBank={questions}
            bookmarkedIds={bookmarkedIds}
            onToggleBookmark={onToggleBookmark}
            onSaveAttempt={onSaveAttempt}
            onOpenMistakesTab={() => setActiveTab('mistakes')}
            fontScale={fontScale}
            onChangeFontScale={setFontScale}
            isFocusMode={isZenHeaderHidden}
            onToggleFocusMode={() => setIsZenHeaderHidden((prev) => !prev)}
            onExamPhaseChange={(inProgress) => {
              setIsMockExamInProgress(inProgress);
              setIsZenHeaderHidden(inProgress);
            }}
          />
        )}

        {/* =====================================================================
            TAB 5: LỊCH SỬ LÀM BÀI THI THỬ & XEM LẠI CHI TIẾT TỪNG CÂU
           ===================================================================== */}
        {activeTab === 'history' && (
          <div className="space-y-6">
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Lịch sử Thi thử của {currentUser.fullName} ({currentUser.username})
                  </h2>
                  <p className="text-xs text-slate-500">
                    Lưu trữ trực tiếp trên Cloud Firestore theo thang điểm 1000 chuẩn Certiport
                    (&ge; {CERTIPORT_PASS_SCORE}/1000 là ĐẠT - PASS).
                  </p>
                </div>
                <History className="w-5 h-5 text-teal-700" />
              </div>

              {myAttempts.length === 0 ? (
                <div className="p-12 text-center space-y-3">
                  <p className="text-sm text-slate-500">
                    Bạn chưa nộp lượt thi nào. Hãy vào Chế độ Thi thử (Mock Exam) để hoàn thành bài
                    thi đầu tiên!
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                        <th className="py-3 px-4">Thời gian nộp</th>
                        <th className="py-3 px-4">Chế độ / Bộ đề</th>
                        <th className="py-3 px-4">Số câu đúng</th>
                        <th className="py-3 px-4">Điểm quy đổi Certiport</th>
                        <th className="py-3 px-4">Thời lượng</th>
                        <th className="py-3 px-4">Kết quả</th>
                        <th className="py-3 px-4 text-right">Xem lại</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
                      {myAttempts.map((att) => {
                        const cScore =
                          att.certiportScore ??
                          Math.round(
                            ((att.score ?? att.correctCount) /
                              Math.max(1, att.totalQuestions)) *
                              1000
                          );
                        const isPassed = cScore >= CERTIPORT_PASS_SCORE;

                        return (
                          <tr key={att.id} className="hover:bg-slate-50/80">
                            <td className="py-3 px-4 text-xs text-slate-600 font-mono">
                              {new Date(att.completedAt).toLocaleString('vi-VN')}
                            </td>
                            <td className="py-3 px-4 font-medium text-slate-900">
                              {att.mode || att.examSet}
                            </td>
                            <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                              {att.score ?? att.correctCount} / {att.totalQuestions} (
                              {att.percentage ?? 0}%)
                            </td>
                            <td className="py-3 px-4 font-mono font-bold text-teal-800">
                              {cScore} / 1000
                            </td>
                            <td className="py-3 px-4 text-xs text-slate-600 font-mono">
                              {formatStudyDuration(att.durationSeconds)}
                            </td>
                            <td className="py-3 px-4 text-xs font-bold">
                              {isPassed ? (
                                <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                                  PASS (ĐẠT)
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800">
                                  FAIL (CHƯA ĐẠT)
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedHistoryAttemptId(
                                    selectedHistoryAttemptId === att.id ? null : att.id
                                  )
                                }
                                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-teal-800 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Eye className="w-3.5 h-3.5" />
                                <span>
                                  {selectedHistoryAttemptId === att.id
                                    ? 'Đóng chi tiết'
                                    : 'Xem bài làm'}
                                </span>
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Khung xem lại chi tiết lượt thi đã chọn trong Lịch sử */}
            {selectedHistoryAttempt && (
              <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">
                      Chi tiết Lượt thi: {selectedHistoryAttempt.mode} — Điểm Certiport:{' '}
                      {selectedHistoryAttempt.certiportScore} / 1000
                    </h3>
                    <p className="text-xs text-slate-500">
                      Nộp lúc:{' '}
                      {new Date(selectedHistoryAttempt.completedAt).toLocaleString(
                        'vi-VN'
                      )}{' '}
                      · Thời gian làm:{' '}
                      {formatStudyDuration(selectedHistoryAttempt.durationSeconds)}
                    </p>
                  </div>
                </div>

                {selectedHistoryAttempt.questionResults &&
                selectedHistoryAttempt.questionResults.length > 0 ? (
                  <div className="space-y-4">
                    {selectedHistoryAttempt.questionResults.map((qRes) => {
                      const fullQuestion = questions.find(
                        (q) => q.id === qRes.questionId
                      );
                      return (
                        <div
                          key={qRes.questionId}
                          className={`p-4 rounded-xl border ${
                            qRes.isCorrect
                              ? 'border-emerald-300 bg-emerald-50/30'
                              : 'border-rose-300 bg-rose-50/30'
                          } space-y-2`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-bold text-slate-900">
                              Câu {qRes.orderNumber} ({qRes.questionId.toUpperCase()}) ·{' '}
                              {qRes.topic}
                            </span>
                            <span
                              className={`font-bold px-2 py-0.5 rounded ${
                                qRes.isCorrect
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-rose-600 text-white'
                              }`}
                            >
                              {qRes.isCorrect ? 'ĐÚNG 100% (1/1)' : 'SAI (0/1)'}
                            </span>
                          </div>
                          <p className="text-sm font-semibold text-slate-900">
                            {qRes.prompt}
                          </p>
                          {fullQuestion && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1 text-xs">
                              <div className="bg-white p-2.5 rounded border border-slate-200">
                                <div className="font-bold text-slate-600 mb-1">
                                  Câu trả lời đã chọn:
                                </div>
                                {getUserAnswerBreakdown(
                                  fullQuestion,
                                  qRes.userAnswer
                                ).map((u, i) => (
                                  <div key={i} className="text-slate-800">
                                    • {u.label}: <strong>{u.value}</strong>
                                  </div>
                                ))}
                              </div>
                              <div className="bg-white p-2.5 rounded border border-emerald-200">
                                <div className="font-bold text-emerald-800 mb-1">
                                  Đáp án chuẩn Certiport:
                                </div>
                                {getCorrectAnswerBreakdown(fullQuestion).map((c, i) => (
                                  <div key={i} className="text-emerald-900">
                                    • {c.label}: <strong>{c.value}</strong>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">
                    Lượt thi mẫu khởi tạo sẵn: Đúng {selectedHistoryAttempt.score ?? selectedHistoryAttempt.correctCount}/
                    {selectedHistoryAttempt.totalQuestions} câu (
                    {selectedHistoryAttempt.certiportScore}/1000 điểm).
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};
