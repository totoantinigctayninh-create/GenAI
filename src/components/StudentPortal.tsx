import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Filter,
  History,
  LogOut,
  PlayCircle,
  RotateCcw,
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
  buildProportionalExamPool,
  evaluateQuestion,
  filterPracticeQuestions,
  getCorrectAnswerBreakdown,
  getUserAnswerBreakdown,
} from '../utils/scoring';
import { MockExamView } from './MockExamView';
import { QuestionRenderer } from './QuestionRenderer';

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
  // 1. STATE CHO CHẾ ĐỘ LUYỆN TẬP (LỌC CHUYÊN ĐỀ / DẠNG BÀI + BỐC ĐỀ NGẪU NHIÊN THEO TỈ LỆ)
  // ============================================================================
  const [practiceTopic, setPracticeTopic] = useState<string>('ALL');
  const [practiceType, setPracticeType] = useState<QuestionTypeFilter>('ALL');
  const [practiceDrawSize, setPracticeDrawSize] = useState<string>('ALL');
  const [practiceDrawSeed, setPracticeDrawSeed] = useState<number>(0);
  const [onlyBookmarked, setOnlyBookmarked] = useState<boolean>(false);

  const [practiceIndex, setPracticeIndex] = useState<number>(0);
  const [practiceAnswers, setPracticeAnswers] = useState<Record<string, UserAnswer>>({});
  const [practiceCheckedMap, setPracticeCheckedMap] = useState<Record<string, boolean>>({});
  const [syncBannerText, setSyncBannerText] = useState<string | null>(null);

  // ============================================================================
  // 2. STATE CHO KHO CÂU SAI (MISTAKE REVIEW TAB)
  // ============================================================================
  const [mistakeTopicFilter, setMistakeTopicFilter] = useState<string>('ALL');
  const [mistakeIndex, setMistakeIndex] = useState<number>(0);
  const [mistakeAnswers, setMistakeAnswers] = useState<Record<string, UserAnswer>>({});
  const [mistakeCheckedMap, setMistakeCheckedMap] = useState<Record<string, boolean>>({});
  const [autoRemoveOnMastery, setAutoRemoveOnMastery] = useState<boolean>(false);
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

  // Nếu học sinh chọn bốc đề ngẫu nhiên theo tỉ lệ ngân hàng (VD: 5, 10, 20, 35, 45 câu)
  const practiceDrawResult = useMemo(() => {
    // Tham chiếu practiceDrawSeed để cho phép bấm "Bốc lại đề ngẫu nhiên mới"
    void practiceDrawSeed;
    const requestedCount =
      practiceDrawSize === 'ALL'
        ? baseFilteredQuestions.length
        : Math.max(1, parseInt(practiceDrawSize, 10) || baseFilteredQuestions.length);

    if (practiceDrawSize === 'ALL' && practiceDrawSeed === 0) {
      return {
        questions: baseFilteredQuestions,
        totalBankSize: baseFilteredQuestions.length,
        targetCount: baseFilteredQuestions.length,
        topicAllocations: buildProportionalExamPool(
          baseFilteredQuestions,
          baseFilteredQuestions.length
        ).topicAllocations,
      };
    }

    return buildProportionalExamPool(baseFilteredQuestions, requestedCount);
  }, [baseFilteredQuestions, practiceDrawSize, practiceDrawSeed]);

  const filteredPracticeQuestions = practiceDrawResult.questions;

  const activePracticeQuestion =
    filteredPracticeQuestions[practiceIndex] ?? filteredPracticeQuestions[0] ?? null;

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

  // Xử lý bấm "Kiểm tra đáp án" trong Chế độ Luyện tập
  const handleCheckPracticeAnswer = async (question: Question) => {
    const ans = practiceAnswers[question.id];
    const isCorrect = evaluateQuestion(question, ans);

    setPracticeCheckedMap((prev) => ({
      ...prev,
      [question.id]: true,
    }));

    await onRecordPracticeCheck(question.id, isCorrect, false);

    if (!isCorrect) {
      setSyncBannerText(
        `Câu ${question.id.toUpperCase()} chưa chính xác — Đã tự động lưu vào "Kho câu sai" trên Firestore để bạn ôn lại.`
      );
    } else {
      setSyncBannerText(
        `Chính xác 100%! Đã đồng bộ tiến độ hoàn thành câu ${question.id.toUpperCase()} lên Firestore.`
      );
    }
  };

  // Xử lý bấm "Kiểm tra đáp án" trong Kho câu sai
  const handleCheckMistakeAnswer = async (question: Question) => {
    const ans = mistakeAnswers[question.id];
    const isCorrect = evaluateQuestion(question, ans);

    setMistakeCheckedMap((prev) => ({
      ...prev,
      [question.id]: true,
    }));

    await onRecordPracticeCheck(question.id, isCorrect, autoRemoveOnMastery);

    if (isCorrect && autoRemoveOnMastery) {
      setMasteredSuccessNote(
        `Chúc mừng! Bạn đã trả lời đúng 100% câu ${question.id.toUpperCase()} và hệ thống đã tự động chuyển sang trạng thái "Đã nắm vững".`
      );
      setMistakeIndex(0);
    } else if (isCorrect) {
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
      `Đã xóa câu ${questionId.toUpperCase()} khỏi Kho câu sai và cập nhật trạng thái "Đã nắm vững" lên Firestore!`
    );
    setMistakeIndex(0);
  };

  const totalCombinedStudySeconds =
    (currentUser.totalStudySeconds || 0) + (sessionStudySeconds % 20);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Navigation Bar theo chuẩn 3-Zone Contract */}
      <header className="flex items-center justify-between gap-6 px-6 py-4 bg-white border-b border-slate-200 sticky top-0 z-20">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#student-home"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('dashboard');
          }}
          className="text-lg font-bold tracking-tight text-teal-800 whitespace-nowrap shrink-0"
        >
          Certiport GenAI Prep
        </a>

        {/* Zone 2: Top-level Navigation Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <button
            type="button"
            onClick={() => setActiveTab('dashboard')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'dashboard'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Tổng quan
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('practice')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'practice'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Chế độ Luyện tập
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('mistakes')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 inline-flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'mistakes'
                ? 'border-rose-600 text-rose-700 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            <span>Kho câu sai</span>
            <span
              className={`px-1.5 py-0.5 text-xs font-mono font-bold rounded-md tabular-nums ${
                wrongQuestionIds.length > 0
                  ? 'bg-rose-100 text-rose-800'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {wrongQuestionIds.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('exam')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'exam'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Chế độ Thi thử (Mock Exam)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('history')}
            className={`py-1 transition-colors whitespace-nowrap shrink-0 border-b-2 cursor-pointer ${
              activeTab === 'history'
                ? 'border-teal-700 text-teal-800 font-semibold'
                : 'border-transparent hover:text-slate-900'
            }`}
          >
            Lịch sử ({myAttempts.length})
          </button>
        </nav>

        {/* Zone 3: 1 Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={onLogout}
            className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Đăng xuất ({currentUser.username})</span>
          </button>
        </div>
      </header>

      {/* Thanh điều hướng phụ cho màn hình nhỏ */}
      <div className="md:hidden flex items-center gap-1 px-4 py-2 bg-white border-b border-slate-200 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('dashboard')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'dashboard'
              ? 'bg-teal-700 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Tổng quan
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('practice')}
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
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
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
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
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
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
          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
            activeTab === 'history'
              ? 'bg-teal-700 text-white'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          Lịch sử ({myAttempts.length})
        </button>
      </div>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Khung thông tin Học sinh & Đồng bộ thời gian thực Firestore */}
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

        {/* =====================================================================
            TAB 1: CHẾ ĐỘ LUYỆN TẬP (LỌC CHUYÊN ĐỀ / DẠNG BÀI & BỐC ĐỀ THEO TỈ LỆ NGÂN HÀNG)
           ===================================================================== */}
        {activeTab === 'practice' && (
          <div className="space-y-6">
            {/* Thanh Bộ Lọc & Bốc đề ngẫu nhiên theo tỉ lệ Ngân hàng */}
            <section
              aria-label="Thanh bộ lọc và bốc đề Chế độ Luyện tập"
              className="bg-white border border-slate-200 rounded-xl p-5 space-y-4 shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Filter className="w-4 h-4 text-teal-700" />
                  <span>
                    Bộ lọc Luyện tập & Bốc Đề Ngẫu nhiên theo Tỉ lệ Ngân hàng ({filteredPracticeQuestions.length} / {baseFilteredQuestions.length} câu)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="redraw-proportional-practice-btn"
                    onClick={() => {
                      setPracticeDrawSeed((s) => s + 1);
                      setPracticeIndex(0);
                    }}
                    className="px-3.5 py-2 rounded-lg border border-teal-600 bg-teal-50/70 hover:bg-teal-100 text-xs font-bold text-teal-900 inline-flex items-center gap-1.5 transition-all cursor-pointer"
                  >
                    <Shuffle className="w-3.5 h-3.5 text-teal-700" />
                    <span>Bốc đề ngẫu nhiên mới theo tỉ lệ</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setOnlyBookmarked((prev) => !prev);
                      setPracticeIndex(0);
                    }}
                    className={`px-3.5 py-2 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                      onlyBookmarked
                        ? 'border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500'
                        : 'border-slate-300 bg-white text-slate-700 hover:border-teal-600'
                    }`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 ${
                        onlyBookmarked ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                      }`}
                    />
                    <span>Câu đã đánh dấu (Bookmark: {bookmarkedIds.length})</span>
                  </button>

                  {(practiceTopic !== 'ALL' ||
                    practiceType !== 'ALL' ||
                    practiceDrawSize !== 'ALL' ||
                    onlyBookmarked) && (
                    <button
                      type="button"
                      onClick={() => {
                        setPracticeTopic('ALL');
                        setPracticeType('ALL');
                        setPracticeDrawSize('ALL');
                        setPracticeDrawSeed(0);
                        setOnlyBookmarked(false);
                        setPracticeIndex(0);
                      }}
                      className="px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Đặt lại bộ lọc
                    </button>
                  )}
                </div>
              </div>

              {/* 3 chiều cấu hình: Chuyên đề | Dạng bài tập | Số lượng câu bốc ngẫu nhiên theo tỉ lệ */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="practice-topic-select"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    1. Chuyên đề kiến thức (4 chuyên đề Certiport)
                  </label>
                  <select
                    id="practice-topic-select"
                    value={practiceTopic}
                    onChange={(e) => {
                      setPracticeTopic(e.target.value);
                      setPracticeIndex(0);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="ALL">Tất cả 4 chuyên đề kiến thức</option>
                    {CERTIPORT_TOPICS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="practice-type-select"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    2. Dạng bài tập tương tác (4 dạng câu hỏi)
                  </label>
                  <select
                    id="practice-type-select"
                    value={practiceType}
                    onChange={(e) => {
                      setPracticeType(e.target.value as QuestionTypeFilter);
                      setPracticeIndex(0);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-300 bg-white text-xs sm:text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    {QUESTION_FILTER_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="practice-examset-select"
                    className="block text-xs font-semibold text-slate-600"
                  >
                    3. Số câu bốc ngẫu nhiên theo tỉ lệ Ngân hàng
                  </label>
                  <select
                    id="practice-examset-select"
                    value={practiceDrawSize}
                    onChange={(e) => {
                      setPracticeDrawSize(e.target.value);
                      setPracticeDrawSeed((s) => s + 1);
                      setPracticeIndex(0);
                    }}
                    className="w-full px-3 py-2.5 rounded-lg border border-teal-600 bg-teal-50/40 text-xs sm:text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  >
                    <option value="ALL">
                      Toàn bộ câu hỏi trong ngân hàng ({baseFilteredQuestions.length} câu)
                    </option>
                    <option value="5">
                      Bốc ngẫu nhiên 5 câu theo tỉ lệ ngân hàng
                    </option>
                    <option value="10">
                      Bốc ngẫu nhiên 10 câu theo tỉ lệ ngân hàng
                    </option>
                    <option value="20">
                      Bốc ngẫu nhiên 20 câu theo tỉ lệ ngân hàng
                    </option>
                    <option value="35">
                      Bốc ngẫu nhiên 35 câu theo tỉ lệ ngân hàng
                    </option>
                    <option value="45">
                      Bốc ngẫu nhiên 45 câu chuẩn Certiport theo tỉ lệ ngân hàng
                    </option>
                  </select>
                </div>
              </div>

              {/* Thanh hiển thị tỉ lệ phân bổ câu hỏi theo chuyên đề vừa bốc */}
              <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600">
                  Tỉ lệ bốc từ ngân hàng:
                </span>
                {practiceDrawResult.topicAllocations
                  .filter((a) => a.bankCount > 0)
                  .map((alloc) => (
                    <span
                      key={alloc.topic}
                      className="px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 tabular-nums"
                    >
                      {alloc.topic}:{' '}
                      <strong className="text-teal-800 font-mono">
                        {alloc.allocatedCount}/{alloc.bankCount} câu
                      </strong>{' '}
                      ({alloc.bankPercentage}%)
                    </span>
                  ))}
              </div>

              {syncBannerText && (
                <div className="px-4 py-2.5 rounded-lg bg-sky-50 border border-sky-200 text-xs font-medium text-teal-900 flex items-center justify-between gap-2">
                  <span>{syncBannerText}</span>
                  <button
                    type="button"
                    onClick={() => setSyncBannerText(null)}
                    className="text-slate-500 hover:text-slate-800 font-semibold"
                  >
                    Đóng
                  </button>
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
                    setPracticeDrawSeed(0);
                    setOnlyBookmarked(false);
                    setPracticeIndex(0);
                  }}
                  className="px-4 py-2 text-xs font-semibold bg-teal-700 text-white rounded-lg cursor-pointer"
                >
                  Hiển thị toàn bộ {questions.length} câu hỏi
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
                <div className="lg:col-span-8 space-y-4">
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
                      />

                      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            disabled={practiceIndex === 0}
                            onClick={() => setPracticeIndex((i) => Math.max(0, i - 1))}
                            className="px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ChevronLeft className="w-4 h-4" /> Câu trước
                          </button>

                          <button
                            type="button"
                            disabled={practiceIndex >= filteredPracticeQuestions.length - 1}
                            onClick={() =>
                              setPracticeIndex((i) =>
                                Math.min(filteredPracticeQuestions.length - 1, i + 1)
                              )
                            }
                            className="px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            Câu tiếp theo <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
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
                            className="px-3.5 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Làm lại câu này</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCheckPracticeAnswer(activePracticeQuestion)}
                            className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold transition-colors inline-flex items-center gap-2 shadow-xs cursor-pointer"
                          >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Kiểm tra đáp án</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>

                <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5">
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-900">
                      Danh sách Câu hỏi Đang lọc ({filteredPracticeQuestions.length} câu)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Tiến độ & Bookmark tự động đồng bộ trực tiếp lên Cloud Firestore.
                    </p>
                  </div>

                  <div className="grid grid-cols-4 gap-2">
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
                          ? 'border-emerald-600 bg-emerald-50 text-emerald-900 font-bold'
                          : 'border-rose-500 bg-rose-50 text-rose-900 font-bold';
                      } else if (savedStat) {
                        styleClass = savedStat.isCorrect
                          ? 'border-emerald-300 bg-emerald-50/50 text-emerald-900'
                          : 'border-rose-300 bg-rose-50/50 text-rose-900';
                      }

                      if (isCurrent) {
                        styleClass += ' ring-2 ring-teal-700 ring-offset-1';
                      }

                      return (
                        <button
                          key={q.id}
                          type="button"
                          onClick={() => setPracticeIndex(idx)}
                          className={`py-2 px-1.5 rounded-lg border text-xs font-mono tabular-nums transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${styleClass}`}
                        >
                          <span>Câu {idx + 1}</span>
                          <span className="text-[10px] font-sans flex items-center gap-0.5">
                            {isBookmarked && <span className="text-amber-600">★</span>}
                            <span>{q.id.toUpperCase()}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}

        {/* =====================================================================
            TAB 2: KHO CÂU SAI (MISTAKE REVIEW TAB)
           ===================================================================== */}
        {activeTab === 'mistakes' && (
          <div className="space-y-6">
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-rose-700">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Kho câu sai cá nhân (Đồng bộ Firestore `wrongQuestions`)</span>
                  </div>
                  <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                    Ôn luyện & Khắc phục Câu hỏi Làm sai ({wrongQuestionsList.length} câu cần khắc phục)
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Mọi câu hỏi bạn trả lời sai trong <strong>Chế độ Luyện tập</strong> hoặc{' '}
                    <strong>Chế độ Thi thử (Mock Exam)</strong> đều tự động được đưa vào đây. Khi
                    làm lại và trả lời <strong>ĐÚNG 100%</strong>, bạn có thể xác nhận{' '}
                    <strong>"Đã nắm vững (Xóa khỏi kho câu sai)"</strong>.
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
                    className="px-3 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-800"
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

                  <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 bg-slate-100 px-3.5 py-2 rounded-lg cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={autoRemoveOnMastery}
                      onChange={(e) => setAutoRemoveOnMastery(e.target.checked)}
                      className="rounded border-slate-300 text-teal-700 focus:ring-teal-600"
                    />
                    <span>Tự động xóa khỏi Kho câu sai khi trả lời ĐÚNG</span>
                  </label>
                </div>
              </div>

              {masteredSuccessNote && (
                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-300 text-xs sm:text-sm font-semibold text-emerald-900 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{masteredSuccessNote}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMasteredSuccessNote(null)}
                    className="text-xs text-emerald-800 underline shrink-0"
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
                    onClick={() => setActiveTab('practice')}
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
                            setPracticeDrawSeed((s) => s + 1);
                            setOnlyBookmarked(false);
                            setPracticeIndex(0);
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
