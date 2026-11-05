import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileCheck2,
  Flag,
  HelpCircle,
  Layers,
  PlayCircle,
  RotateCcw,
  Send,
  ShieldAlert,
  Shuffle,
  XCircle,
} from 'lucide-react';
import {
  CERTIPORT_PASS_SCORE,
  ExamAttempt,
  MOCK_EXAM_DURATION_SECONDS,
  MOCK_EXAM_MAX_QUESTIONS,
  MOCK_EXAM_WARNING_THRESHOLD_SECONDS,
  QUESTION_TYPE_LABELS,
  Question,
  UserAccount,
  UserAnswer,
} from '../types/exam';
import {
  buildMockExamQuestionPool,
  buildProportionalExamPool,
  evaluateExamSet,
  evaluateQuestion,
  formatCountdownClock,
  getCorrectAnswerBreakdown,
  getUserAnswerBreakdown,
  isQuestionAnswered,
} from '../utils/scoring';
import { QuestionFontScale, QuestionRenderer } from './QuestionRenderer';
import { formatStudyDuration } from './StudentPortal';

interface MockExamViewProps {
  currentUser: UserAccount;
  questionsBank: Question[];
  bookmarkedIds: string[];
  onToggleBookmark: (questionId: string) => Promise<void>;
  onSaveAttempt: (attempt: ExamAttempt, wrongQuestionIds: string[]) => Promise<void>;
  onOpenMistakesTab: () => void;
  fontScale?: QuestionFontScale;
  onChangeFontScale?: (scale: QuestionFontScale) => void;
  isFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onExamPhaseChange?: (inProgress: boolean) => void;
}

type MockExamPhase = 'intro' | 'in_progress' | 'submitted';
type ReviewFilterType = 'ALL' | 'WRONG' | 'CORRECT';

export const MockExamView: React.FC<MockExamViewProps> = ({
  currentUser,
  questionsBank,
  bookmarkedIds,
  onToggleBookmark,
  onSaveAttempt,
  onOpenMistakesTab,
  fontScale = 'large',
  onChangeFontScale,
  isFocusMode = false,
  onToggleFocusMode,
  onExamPhaseChange,
}) => {
  const [phase, setPhase] = useState<MockExamPhase>('intro');
  const [desiredQuestionCount, setDesiredQuestionCount] = useState<number>(
    MOCK_EXAM_MAX_QUESTIONS
  );
  // 50 phút chuẩn Certiport (0 = Không giới hạn thời gian)
  const [desiredTimeMinutes, setDesiredTimeMinutes] = useState<number>(50);
  const [elapsedExamSeconds, setElapsedExamSeconds] = useState<number>(0);
  const [isNavigatorCollapsed, setIsNavigatorCollapsed] = useState<boolean>(false);

  const [examQuestions, setExamQuestions] = useState<Question[]>(() =>
    buildMockExamQuestionPool(questionsBank, MOCK_EXAM_MAX_QUESTIONS)
  );
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<string, UserAnswer>>({});
  const [flaggedMap, setFlaggedMap] = useState<Record<string, boolean>>({});
  const [remainingSeconds, setRemainingSeconds] = useState<number>(
    MOCK_EXAM_DURATION_SECONDS
  );
  const [showConfirmSubmitModal, setShowConfirmSubmitModal] = useState<boolean>(false);
  const [autoSubmittedOnTimeout, setAutoSubmittedOnTimeout] = useState<boolean>(false);
  const [reviewFilter, setReviewFilter] = useState<ReviewFilterType>('ALL');
  const [selectedReviewIndex, setSelectedReviewIndex] = useState<number>(0);

  const isSubmittingRef = useRef(false);

  useEffect(() => {
    onExamPhaseChange?.(phase === 'in_progress');
  }, [phase, onExamPhaseChange]);

  // Xem trước tỷ lệ bốc câu hỏi theo Chuyên đề trong Ngân hàng
  const proportionalPreview = useMemo(
    () => buildProportionalExamPool(questionsBank, desiredQuestionCount),
    [questionsBank, desiredQuestionCount]
  );

  // Tính toán thống kê trực tiếp của bài thi hiện tại
  const evaluation = useMemo(
    () => evaluateExamSet(examQuestions, userAnswers, flaggedMap),
    [examQuestions, userAnswers, flaggedMap]
  );

  // Bắt đầu bài thi thử mới: Bốc ngẫu nhiên theo đúng tỷ lệ Chuyên đề & Dạng câu hỏi trong Ngân hàng
  const handleStartNewMockExam = useCallback(() => {
    const drawResult = buildProportionalExamPool(
      questionsBank,
      desiredQuestionCount
    );
    const configuredDurationSec =
      desiredTimeMinutes > 0 ? desiredTimeMinutes * 60 : 0;
    setExamQuestions(drawResult.questions);
    setCurrentIndex(0);
    setUserAnswers({});
    setFlaggedMap({});
    setElapsedExamSeconds(0);
    setRemainingSeconds(configuredDurationSec);
    setShowConfirmSubmitModal(false);
    setAutoSubmittedOnTimeout(false);
    setReviewFilter('ALL');
    setSelectedReviewIndex(0);
    isSubmittingRef.current = false;
    setPhase('in_progress');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [questionsBank, desiredQuestionCount, desiredTimeMinutes]);

  // Hàm thực thi nộp bài chính thức & lưu lên Firestore
  const finalizeAndSubmitExam = useCallback(
    async (isTimeoutAutoSubmit: boolean = false) => {
      if (isSubmittingRef.current || examQuestions.length === 0) return;
      isSubmittingRef.current = true;

      setShowConfirmSubmitModal(false);
      setAutoSubmittedOnTimeout(isTimeoutAutoSubmit);
      setPhase('submitted');
      window.scrollTo({ top: 0, behavior: 'smooth' });

      const summary = evaluateExamSet(examQuestions, userAnswers, flaggedMap);
      const configuredLimitSeconds =
        desiredTimeMinutes > 0 ? desiredTimeMinutes * 60 : 0;
      const computedDuration =
        configuredLimitSeconds > 0
          ? isTimeoutAutoSubmit
            ? configuredLimitSeconds
            : Math.max(1, configuredLimitSeconds - remainingSeconds)
          : Math.max(1, elapsedExamSeconds);

      const attemptPayload: ExamAttempt = {
        id: `mock_${Date.now()}_${currentUser.id}`,
        userId: currentUser.id,
        username: currentUser.username,
        fullName: currentUser.fullName,
        examSet: `Đề Thi thử Ngẫu nhiên (${summary.totalQuestions} câu)`,
        mode: isTimeoutAutoSubmit
          ? `Thi thử Certiport (${summary.totalQuestions} câu · Tự động nộp khi hết giờ)`
          : desiredTimeMinutes === 0
            ? `Thi thử Certiport (${summary.totalQuestions} câu · Không giới hạn thời gian)`
            : `Thi thử Certiport (${summary.totalQuestions} câu · ${desiredTimeMinutes} phút)`,
        correctCount: summary.score,
        score: summary.score,
        totalQuestions: summary.totalQuestions,
        certiportScore: summary.certiportScore,
        percentage: summary.percentage,
        passed: summary.passed,
        wrongQuestionIds: summary.wrongQuestionIds,
        questionOrderIds: examQuestions.map((q) => q.id),
        questionResults: summary.questionResults,
        topicBreakdown: summary.topicBreakdown,
        typeBreakdown: summary.typeBreakdown,
        durationSeconds: computedDuration,
        timeLimitSeconds: configuredLimitSeconds || MOCK_EXAM_DURATION_SECONDS,
        autoSubmittedOnTimeout: isTimeoutAutoSubmit,
        completedAt: new Date().toISOString(),
      };

      await onSaveAttempt(attemptPayload, summary.wrongQuestionIds);
    },
    [
      examQuestions,
      userAnswers,
      flaggedMap,
      remainingSeconds,
      elapsedExamSeconds,
      desiredTimeMinutes,
      currentUser,
      onSaveAttempt,
    ]
  );

  const finalizeRef = useRef(finalizeAndSubmitExam);
  useEffect(() => {
    finalizeRef.current = finalizeAndSubmitExam;
  }, [finalizeAndSubmitExam]);

  // Đồng hồ đếm ngược (hoặc đếm tăng nếu chọn Không giới hạn thời gian)
  useEffect(() => {
    if (phase !== 'in_progress') return;

    const timer = window.setInterval(() => {
      setElapsedExamSeconds((e) => e + 1);
      if (desiredTimeMinutes > 0) {
        setRemainingSeconds((prev) => {
          if (prev <= 1) {
            window.clearInterval(timer);
            finalizeRef.current(true);
            return 0;
          }
          return prev - 1;
        });
      }
    }, 1000);

    return () => window.clearInterval(timer);
  }, [phase, desiredTimeMinutes]);

  // Phím tắt bàn phím nhanh (← Câu trước, → Câu tiếp theo) khi đang trong phòng thi
  useEffect(() => {
    if (phase !== 'in_progress' || showConfirmSubmitModal) return;
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
        setCurrentIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setCurrentIndex((i) => Math.min(examQuestions.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [phase, showConfirmSubmitModal, examQuestions.length]);

  const activeQuestion = examQuestions[currentIndex] ?? examQuestions[0] ?? null;
  const isUnderFiveMinutes =
    desiredTimeMinutes > 0 &&
    remainingSeconds <= MOCK_EXAM_WARNING_THRESHOLD_SECONDS;

  // Danh sách câu hỏi chưa trả lời để cảnh báo trong hộp thoại xác nhận nộp bài
  const unansweredIndices = useMemo(() => {
    const list: number[] = [];
    examQuestions.forEach((q, idx) => {
      if (!isQuestionAnswered(q, userAnswers[q.id])) {
        list.push(idx);
      }
    });
    return list;
  }, [examQuestions, userAnswers]);

  // Danh sách câu hỏi lọc khi Xem lại bài thi sau khi nộp
  const filteredReviewItems = useMemo(() => {
    return examQuestions
      .map((q, idx) => ({
        question: q,
        orderNumber: idx + 1,
        userAnswer: userAnswers[q.id],
        answered: isQuestionAnswered(q, userAnswers[q.id]),
        flagged: Boolean(flaggedMap[q.id]),
        isCorrect: evaluateQuestion(q, userAnswers[q.id]),
      }))
      .filter((item) => {
        if (reviewFilter === 'WRONG') return !item.isCorrect;
        if (reviewFilter === 'CORRECT') return item.isCorrect;
        return true;
      });
  }, [examQuestions, userAnswers, flaggedMap, reviewFilter]);

  const activeReviewItem =
    filteredReviewItems[selectedReviewIndex] ?? filteredReviewItems[0] ?? null;

  // ===========================================================================
  // GIAI ĐOẠN 1: MÀN HÌNH CHUẨN BỊ & BẮT ĐẦU THI THỬ (MOCK EXAM INTRO)
  // ===========================================================================
  if (phase === 'intro') {
    const targetQuestionCount = proportionalPreview.targetCount;
    const countOptions = Array.from(
      new Set([5, 10, 20, 35, MOCK_EXAM_MAX_QUESTIONS, questionsBank.length])
    )
      .filter((n) => n > 0 && n <= Math.max(MOCK_EXAM_MAX_QUESTIONS, questionsBank.length))
      .sort((a, b) => a - b);

    return (
      <div className="space-y-6">
        <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 shadow-2xs space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
            <div className="space-y-2 max-w-2xl">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-teal-50 border border-teal-200 text-xs font-bold text-teal-800">
                <Award className="w-4 h-4" />
                <span>CHẾ ĐỘ THI THỬ · GIAO DIỆN PHÒNG THI TẬP TRUNG</span>
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900">
                Bài Thi Thử Chứng Chỉ Certiport Generative AI
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Hệ thống tự động <strong>bốc ngẫu nhiên câu hỏi theo đúng tỉ lệ Chuyên đề trong Ngân hàng đề</strong>, tối ưu giao diện tập trung không xao nhãng và chấm điểm theo thang 1000 (All-or-Nothing).
              </p>
            </div>

            <div className="flex flex-wrap items-end gap-3 shrink-0">
              <div>
                <label
                  htmlFor="mock-exam-count-select"
                  className="block text-[11px] font-bold text-slate-600 mb-1"
                >
                  1. Chọn số câu hỏi:
                </label>
                <select
                  id="mock-exam-count-select"
                  value={desiredQuestionCount}
                  onChange={(e) =>
                    setDesiredQuestionCount(parseInt(e.target.value, 10) || MOCK_EXAM_MAX_QUESTIONS)
                  }
                  className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-slate-900"
                >
                  {countOptions.map((cnt) => (
                    <option key={cnt} value={cnt}>
                      {cnt === MOCK_EXAM_MAX_QUESTIONS && cnt !== questionsBank.length
                        ? `Chuẩn Certiport (${Math.min(cnt, questionsBank.length)} câu theo tỉ lệ)`
                        : cnt === questionsBank.length
                          ? `Làm tất cả các câu (${cnt} câu)`
                          : `Đề ${cnt} câu (bốc theo tỉ lệ ngân hàng)`}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="mock-exam-time-select"
                  className="block text-[11px] font-bold text-slate-600 mb-1"
                >
                  2. Thời gian làm bài:
                </label>
                <select
                  id="mock-exam-time-select"
                  value={desiredTimeMinutes}
                  onChange={(e) => setDesiredTimeMinutes(parseInt(e.target.value, 10) || 0)}
                  className="px-3 py-2.5 rounded-xl border border-slate-300 bg-white text-xs sm:text-sm font-bold text-slate-900"
                >
                  <option value={50}>50 phút (Chuẩn phòng thi Certiport)</option>
                  <option value={30}>30 phút (Luyện tốc độ)</option>
                  <option value={60}>60 phút (Mở rộng)</option>
                  <option value={0}>∞ Không giới hạn thời gian</option>
                </select>
              </div>

              <button
                type="button"
                data-testid="start-mock-exam-btn"
                disabled={questionsBank.length === 0}
                onClick={handleStartNewMockExam}
                className="px-6 py-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:bg-slate-300 disabled:text-slate-500 disabled:cursor-not-allowed text-white text-sm sm:text-base font-bold transition-all inline-flex items-center gap-2.5 shadow-sm cursor-pointer shrink-0"
              >
                <PlayCircle className="w-5 h-5" />
                <span>
                  {questionsBank.length === 0
                    ? 'Ngân hàng đề đang trống (0 câu)'
                    : `Vào Phòng Thi (${targetQuestionCount} câu)`}
                </span>
              </button>
            </div>
          </div>

          {/* 4 Quy chuẩn phòng thi Certiport */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums">
            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-800">
                <Shuffle className="w-4 h-4" />
                <span>BỐC ĐỀ THEO TỈ LỆ NGÂN HÀNG</span>
              </div>
              <div className="text-xl font-bold font-mono text-slate-900">
                {targetQuestionCount} / {questionsBank.length} câu
              </div>
              <p className="text-xs text-slate-600">
                Tự động phân bổ số câu hỏi của từng Chuyên đề khớp chính xác với tỉ trọng câu hỏi trong Ngân hàng đề.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-800">
                <Clock className="w-4 h-4" />
                <span>THỜI GIAN LÀM BÀI</span>
              </div>
              <div className="text-xl font-bold font-mono text-slate-900">
                {desiredTimeMinutes > 0
                  ? `${desiredTimeMinutes} phút (${desiredTimeMinutes}:00)`
                  : '∞ Không giới hạn'}
              </div>
              <p className="text-xs text-slate-600">
                {desiredTimeMinutes > 0
                  ? 'Đổi màu cảnh báo đỏ khi còn dưới 5 phút và tự động nộp bài ngay khi hết giờ.'
                  : 'Cho phép làm bài thoải mái không giới hạn thời gian cho đến khi bấm Nộp bài.'}
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-800">
                <FileCheck2 className="w-4 h-4" />
                <span>THANG ĐIỂM CERTIPORT</span>
              </div>
              <div className="text-xl font-bold font-mono text-slate-900">
                &ge; {CERTIPORT_PASS_SCORE} / 1000
              </div>
              <p className="text-xs text-slate-600">
                Quy đổi ra thang 1000 điểm chuẩn. Đúng 100% các ý trong câu mới được tính điểm.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-1.5">
              <div className="flex items-center gap-2 text-xs font-bold text-teal-800">
                <ShieldAlert className="w-4 h-4" />
                <span>GIAO DIỆN TẬP TRUNG CAO</span>
              </div>
              <div className="text-xl font-bold font-mono text-slate-900">
                Focus Mode + Cỡ chữ
              </div>
              <p className="text-xs text-slate-600">
                Tự động thu gọn thanh phụ, hỗ trợ phóng chữ (A-/A/A+) và phím tắt điều hướng nhanh.
              </p>
            </div>
          </div>

          {/* Bảng Cấu trúc Tỉ lệ Bốc câu hỏi từ Ngân hàng theo 4 Chuyên đề */}
          <div className="p-5 rounded-xl bg-sky-50/60 border border-sky-200 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs sm:text-sm font-bold text-teal-900 flex items-center gap-2">
                <Layers className="w-4 h-4 text-teal-700" />
                <span>
                  Cấu trúc Bốc câu hỏi Ngẫu nhiên theo Tỉ lệ Ngân hàng ({targetQuestionCount} câu được bốc / {questionsBank.length} câu trong kho)
                </span>
              </div>
              <span className="text-xs text-slate-600 font-medium">
                Phương pháp phân bổ tỉ lệ Hamilton (Largest Remainder)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 tabular-nums">
              {proportionalPreview.topicAllocations.map((alloc) => (
                <div
                  key={alloc.topic}
                  className="bg-white border border-slate-200 rounded-lg p-3.5 space-y-1.5"
                >
                  <div className="text-xs font-bold text-slate-900 line-clamp-1">
                    {alloc.topic}
                  </div>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-slate-500">
                      Trong ngân hàng: <strong>{alloc.bankCount} câu</strong> ({alloc.bankPercentage}%)
                    </span>
                    <span className="font-mono font-bold text-teal-800 text-sm">
                      Bốc {alloc.allocatedCount} câu
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-teal-600 rounded-full"
                      style={{ width: `${Math.max(4, alloc.bankPercentage)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ===========================================================================
  // GIAI ĐOẠN 2: ĐANG LÀM BÀI THI THỬ (IN PROGRESS — FOCUS ROOM + STICKY BAR)
  // ===========================================================================
  if (phase === 'in_progress') {
    const progressPercent =
      examQuestions.length > 0
        ? Math.round((evaluation.answeredCount / examQuestions.length) * 100)
        : 0;

    return (
      <div data-testid="mock-exam-focus-workspace" className="space-y-4">
        {/* Thanh Header Phòng Thi Tập Trung (Sticky Countdown & Focus Controls) */}
        <div
          data-testid="mock-exam-sticky-bar"
          className={`sticky ${
            isFocusMode ? 'top-2' : 'top-[57px]'
          } z-20 rounded-xl border p-3.5 sm:px-5 shadow-sm transition-colors space-y-2.5 ${
            isUnderFiveMinutes
              ? 'bg-rose-50 border-rose-400'
              : 'bg-white/95 backdrop-blur-xs border-slate-200'
          }`}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <span className="px-3 py-1.5 rounded-lg bg-teal-800 text-white text-xs font-bold tracking-wide">
                PHÒNG THI CERTIPORT · CÂU {currentIndex + 1}/{examQuestions.length}
              </span>
              <div className="text-xs sm:text-sm font-medium text-slate-700 tabular-nums">
                Đã làm:{' '}
                <strong className="font-mono text-teal-800">
                  {evaluation.answeredCount}/{examQuestions.length}
                </strong>{' '}
                ({progressPercent}%) · Chưa làm:{' '}
                <strong className="font-mono text-slate-900">
                  {evaluation.unansweredCount}
                </strong>{' '}
                · Gắn cờ:{' '}
                <strong className="font-mono text-amber-700">
                  {evaluation.flaggedCount}
                </strong>
              </div>
            </div>

            {/* Bộ công cụ Tối ưu Quan sát (Cỡ chữ A-/A/A+, Ẩn/Hiện Bảng câu hỏi, Chế độ Tập trung) + Đồng hồ */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Tùy chỉnh cỡ chữ đề thi */}
              {onChangeFontScale && (
                <div
                  className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs"
                  role="group"
                  aria-label="Chỉnh cỡ chữ đề thi"
                >
                  <button
                    type="button"
                    onClick={() => onChangeFontScale('normal')}
                    className={`px-2 py-1 rounded-md font-bold transition-colors cursor-pointer ${
                      fontScale === 'normal'
                        ? 'bg-white text-teal-800 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    A-
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeFontScale('large')}
                    className={`px-2 py-1 rounded-md font-bold transition-colors cursor-pointer ${
                      fontScale === 'large'
                        ? 'bg-white text-teal-800 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    A
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeFontScale('xlarge')}
                    className={`px-2 py-1 rounded-md font-bold transition-colors cursor-pointer ${
                      fontScale === 'xlarge'
                        ? 'bg-white text-teal-800 shadow-2xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    A+
                  </button>
                </div>
              )}

              {/* Nút Mở rộng / Thu gọn bảng danh sách câu hỏi */}
              <button
                type="button"
                onClick={() => setIsNavigatorCollapsed((prev) => !prev)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                {isNavigatorCollapsed
                  ? 'Hiện bảng câu hỏi (1→N)'
                  : 'Mở rộng khung đề (Ẩn bảng số)'}
              </button>

              {onToggleFocusMode && (
                <button
                  type="button"
                  onClick={onToggleFocusMode}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
                    isFocusMode
                      ? 'border-teal-600 bg-teal-50 text-teal-900'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {isFocusMode ? 'Hiện thanh menu trên' : 'Tập trung tối đa'}
                </button>
              )}

              <div
                data-testid="mock-exam-countdown"
                className={`px-3.5 py-2 rounded-lg font-mono text-xs sm:text-sm font-bold tabular-nums inline-flex items-center gap-2 transition-all ${
                  isUnderFiveMinutes
                    ? 'bg-rose-600 text-white ring-2 ring-rose-300 animate-pulse'
                    : 'bg-slate-900 text-white'
                }`}
              >
                <Clock className="w-4 h-4 shrink-0" />
                <span>
                  {desiredTimeMinutes > 0
                    ? `Còn lại: ${formatCountdownClock(remainingSeconds)}`
                    : `∞ Tự do · ${formatCountdownClock(elapsedExamSeconds)}`}
                </span>
                {isUnderFiveMinutes && (
                  <span className="text-[11px] bg-white text-rose-700 px-1.5 py-0.5 rounded font-sans font-bold">
                    &lt; 5 PHÚT!
                  </span>
                )}
              </div>

              <button
                type="button"
                data-testid="open-submit-modal-btn"
                onClick={() => setShowConfirmSubmitModal(true)}
                className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold transition-colors inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
              >
                <Send className="w-4 h-4" />
                <span>Nộp bài</span>
              </button>
            </div>
          </div>

          {/* Thanh tiến độ trực quan mỏng */}
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-teal-600 transition-all duration-200 rounded-full"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Giao diện Phòng Thi Tập Trung (Mở rộng 12/12 khi thu gọn bảng câu hỏi hoặc 8/12 + 4/12) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Cột hiển thị câu hỏi (TUYỆT ĐỐI KHÔNG HIỂN THỊ ĐÁP ÁN HAY ĐÚNG/SAI) */}
          <div
            className={`${
              isNavigatorCollapsed
                ? 'lg:col-span-12 max-w-5xl w-full mx-auto'
                : 'lg:col-span-8'
            } space-y-4`}
          >
            {activeQuestion && (
              <>
                <QuestionRenderer
                  question={activeQuestion}
                  questionNumber={currentIndex + 1}
                  totalQuestions={examQuestions.length}
                  userAnswer={userAnswers[activeQuestion.id]}
                  onChangeAnswer={(ans) => {
                    setUserAnswers((prev) => ({
                      ...prev,
                      [activeQuestion.id]: ans,
                    }));
                  }}
                  showFeedback={false}
                  readOnly={false}
                  isBookmarked={bookmarkedIds.includes(activeQuestion.id)}
                  onToggleBookmark={(qId) => onToggleBookmark(qId)}
                  fontScale={fontScale}
                />

                {/* Thanh điều hướng câu hỏi & Nút Gắn cờ xem lại (Mark for Review) */}
                <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={currentIndex === 0}
                      onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
                      className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-40 text-xs sm:text-sm font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" /> Câu trước (←)
                    </button>

                    <button
                      type="button"
                      disabled={currentIndex >= examQuestions.length - 1}
                      onClick={() =>
                        setCurrentIndex((i) =>
                          Math.min(examQuestions.length - 1, i + 1)
                        )
                      }
                      className="px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-xs sm:text-sm font-semibold text-white inline-flex items-center gap-1 cursor-pointer"
                    >
                      Câu tiếp theo (→) <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <button
                      type="button"
                      data-testid="toggle-review-flag-btn"
                      onClick={() =>
                        setFlaggedMap((prev) => ({
                          ...prev,
                          [activeQuestion.id]: !prev[activeQuestion.id],
                        }))
                      }
                      className={`px-4 py-2.5 rounded-lg border text-xs font-bold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                        flaggedMap[activeQuestion.id]
                          ? 'border-amber-500 bg-amber-100 text-amber-950 ring-1 ring-amber-500'
                          : 'border-slate-300 bg-white text-slate-700 hover:border-amber-500 hover:text-amber-800'
                      }`}
                    >
                      <Flag
                        className={`w-3.5 h-3.5 ${
                          flaggedMap[activeQuestion.id]
                            ? 'fill-amber-500 text-amber-600'
                            : ''
                        }`}
                      />
                      <span>
                        {flaggedMap[activeQuestion.id]
                          ? 'Đã gắn cờ xem lại (Mark for Review)'
                          : 'Gắn cờ xem lại (Mark for Review)'}
                      </span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Cột phải (4/12): Bảng Danh sách Câu hỏi (Question Navigator 1 -> N) */}
          {!isNavigatorCollapsed && (
            <aside className="lg:col-span-4 bg-white border border-slate-200 rounded-xl p-5 space-y-5 sticky top-28">
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-slate-900">
                  Bảng Danh sách Câu hỏi (1 → {examQuestions.length})
                </h3>
                <p className="text-xs text-slate-500">
                  Bấm vào số thứ tự bất kỳ hoặc dùng phím ← / → để chuyển nhanh.
                </p>
              </div>

              {/* Chú giải 3 màu sắc rõ ràng: Đã làm | Chưa làm | Gắn cờ xem lại */}
              <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs tabular-nums">
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-teal-600 border border-teal-700 shrink-0" />
                  <span className="text-slate-700 font-medium">
                    Đã làm ({evaluation.answeredCount})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-white border border-slate-300 shrink-0" />
                  <span className="text-slate-700 font-medium">
                    Chưa làm ({evaluation.unansweredCount})
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-3.5 h-3.5 rounded bg-amber-200 border border-amber-500 shrink-0" />
                  <span className="text-amber-900 font-medium">
                    Gắn cờ ({evaluation.flaggedCount})
                  </span>
                </div>
              </div>

              {/* Lưới nút câu hỏi 1 -> N (có thanh cuộn gọn nếu đề tất cả các câu > 60 câu) */}
              <div className="grid grid-cols-5 gap-2 max-h-[380px] overflow-y-auto pr-1">
                {examQuestions.map((q, idx) => {
                  const isCurrent = idx === currentIndex;
                  const answered = isQuestionAnswered(q, userAnswers[q.id]);
                  const flagged = Boolean(flaggedMap[q.id]);

                  let cellStyle =
                    'bg-white border-slate-300 text-slate-700 hover:border-teal-600';
                  if (flagged) {
                    cellStyle =
                      'bg-amber-100 border-amber-500 text-amber-950 font-bold';
                  } else if (answered) {
                    cellStyle =
                      'bg-teal-600 border-teal-700 text-white font-bold';
                  }

                  if (isCurrent) {
                    cellStyle += ' ring-2 ring-slate-900 ring-offset-1';
                  }

                  return (
                    <button
                      key={q.id}
                      type="button"
                      aria-label={`Chuyển đến câu ${idx + 1}${
                        flagged
                          ? ' (Đang gắn cờ xem lại)'
                          : answered
                            ? ' (Đã trả lời)'
                            : ' (Chưa làm)'
                      }`}
                      onClick={() => setCurrentIndex(idx)}
                      className={`py-2 px-1 rounded-lg border text-xs font-mono tabular-nums transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${cellStyle}`}
                    >
                      <span>{idx + 1}</span>
                      <span className="text-[9px] font-sans leading-none">
                        {flagged ? '⚑ Cờ' : answered ? '✓ Đã làm' : 'Trống'}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="text-xs text-slate-500 leading-relaxed">
                  Lưu ý: Trong chế độ Thi thử, hệ thống ẩn toàn bộ gợi ý và kết quả đúng/sai cho
                  đến khi bạn xác nhận nộp bài.
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmSubmitModal(true)}
                  className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors inline-flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>Hoàn tất & Nộp bài thi</span>
                </button>
              </div>
            </aside>
          )}
        </div>

        {/* Hộp thoại Xác nhận Nộp bài & Cảnh báo nếu còn câu chưa làm */}
        {showConfirmSubmitModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-submit-title"
            className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
          >
            <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-5">
              <div className="space-y-1.5">
                <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-teal-800">
                  <Send className="w-4 h-4" />
                  <span>Xác nhận Nộp bài Thi thử Certiport</span>
                </div>
                <h3
                  id="confirm-submit-title"
                  className="text-lg font-bold text-slate-900"
                >
                  Bạn có chắc chắn muốn nộp bài thi ngay bây giờ?
                </h3>
              </div>

              {/* Bảng tóm tắt trạng thái làm bài trước khi nộp */}
              <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-center tabular-nums">
                <div>
                  <div className="text-xs text-slate-500">Đã trả lời</div>
                  <div className="text-lg font-bold font-mono text-teal-800">
                    {evaluation.answeredCount}/{examQuestions.length}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Chưa làm</div>
                  <div className="text-lg font-bold font-mono text-rose-700">
                    {evaluation.unansweredCount}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Đang gắn cờ</div>
                  <div className="text-lg font-bold font-mono text-amber-700">
                    {evaluation.flaggedCount}
                  </div>
                </div>
              </div>

              {/* Cảnh báo nổi bật nếu còn câu chưa làm */}
              {unansweredIndices.length > 0 ? (
                <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 space-y-2.5">
                  <div className="flex items-start gap-2 text-xs sm:text-sm font-bold text-amber-950">
                    <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                    <span>
                      Cảnh báo: Bạn còn {unansweredIndices.length} câu hỏi chưa hoàn thành! Các
                      câu bỏ trống sẽ bị tính 0 điểm.
                    </span>
                  </div>
                  <div className="text-xs text-amber-900">
                    Bấm vào số câu bên dưới để quay lại làm nốt trước khi nộp:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {unansweredIndices.map((idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setCurrentIndex(idx);
                          setShowConfirmSubmitModal(false);
                        }}
                        className="px-2.5 py-1 rounded-md bg-white border border-amber-400 text-xs font-mono font-bold text-amber-900 hover:bg-amber-100 cursor-pointer"
                      >
                        Câu {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-xs sm:text-sm font-medium text-emerald-900 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>
                    Bạn đã hoàn thành đầy đủ {examQuestions.length}/{examQuestions.length} câu
                    hỏi trong đề thi.
                  </span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmSubmitModal(false)}
                  className="px-4 py-2.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Quay lại kiểm tra bài
                </button>
                <button
                  type="button"
                  data-testid="confirm-submit-exam-btn"
                  onClick={() => finalizeAndSubmitExam(false)}
                  className="px-5 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold cursor-pointer"
                >
                  Xác nhận Nộp bài & Chấm điểm
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===========================================================================
  // GIAI ĐOẠN 3: BẢNG KẾT QUẢ TỔNG QUAN & XEM LẠI CHI TIẾT TỪNG CÂU
  // ===========================================================================
  const elapsedCompletedSeconds = autoSubmittedOnTimeout
    ? MOCK_EXAM_DURATION_SECONDS
    : Math.max(1, MOCK_EXAM_DURATION_SECONDS - remainingSeconds);

  return (
    <div className="space-y-6">
      {/* 1. BẢNG KẾT QUẢ TỔNG QUAN CHUẨN CERTIPORT (THANG ĐIỂM 1000 - PASS >= 700) */}
      <section
        data-testid="mock-exam-score-report"
        className={`rounded-2xl border-2 p-6 sm:p-8 space-y-6 ${
          evaluation.passed
            ? 'bg-emerald-50/70 border-emerald-500'
            : 'bg-rose-50/70 border-rose-400'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`px-3 py-1 rounded-md text-xs font-bold uppercase tracking-wider ${
                  evaluation.passed
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {evaluation.passed
                  ? 'ĐẠT CHỨNG CHỈ - PASS (≥ 700/1000)'
                  : 'CHƯA ĐẠT - FAIL (< 700/1000)'}
              </span>
              {autoSubmittedOnTimeout && (
                <span className="px-2.5 py-1 rounded-md bg-amber-100 border border-amber-300 text-amber-900 text-xs font-semibold">
                  Hệ thống tự động thu bài khi hết 50 phút
                </span>
              )}
            </div>

            <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">
              Bảng Kết Quả Thi Thử Certiport Generative AI
            </h2>

            <p className="text-xs sm:text-sm text-slate-700">
              Đã lưu toàn bộ kết quả & chi tiết từng câu lên{' '}
              <strong>Firebase Firestore</strong> để giáo viên theo dõi.{' '}
              {evaluation.wrongQuestionIds.length > 0 && (
                <span>
                  Đồng thời đã tự động cập nhật{' '}
                  <strong className="text-rose-700">
                    {evaluation.wrongQuestionIds.length} câu làm sai
                  </strong>{' '}
                  vào <strong>Kho câu sai</strong> của bạn.
                </span>
              )}
            </p>
          </div>

          {/* 3 Hộp chỉ số điểm chuẩn Certiport */}
          <div className="flex flex-wrap items-center gap-3 tabular-nums">
            <div className="px-5 py-3.5 rounded-xl bg-white border border-slate-200 text-center shadow-2xs">
              <div className="text-xs font-semibold text-slate-500">
                Điểm quy đổi Certiport
              </div>
              <div
                className={`text-2xl sm:text-3xl font-bold font-mono ${
                  evaluation.passed ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {evaluation.certiportScore} / 1000
              </div>
              <div className="text-[11px] text-slate-500">
                Chuẩn Đạt: &ge; {CERTIPORT_PASS_SCORE}/1000
              </div>
            </div>

            <div className="px-5 py-3.5 rounded-xl bg-white border border-slate-200 text-center shadow-2xs">
              <div className="text-xs font-semibold text-slate-500">
                Số câu đúng 100%
              </div>
              <div className="text-2xl sm:text-3xl font-bold font-mono text-teal-800">
                {evaluation.score} / {evaluation.totalQuestions}
              </div>
              <div className="text-[11px] text-slate-500">
                Tỷ lệ chính xác: {evaluation.percentage}%
              </div>
            </div>

            <div className="px-5 py-3.5 rounded-xl bg-white border border-slate-200 text-center shadow-2xs">
              <div className="text-xs font-semibold text-slate-500">
                Thời gian hoàn thành
              </div>
              <div className="text-lg sm:text-xl font-bold font-mono text-slate-900 mt-1">
                {formatStudyDuration(elapsedCompletedSeconds)}
              </div>
              <div className="text-[11px] text-slate-500">Giới hạn: 50 phút</div>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-black/10">
          <button
            type="button"
            onClick={handleStartNewMockExam}
            className="px-4 py-2.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
            <span>Thi thử đề ngẫu nhiên mới</span>
          </button>

          {evaluation.wrongQuestionIds.length > 0 && (
            <button
              type="button"
              onClick={onOpenMistakesTab}
              className="px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 cursor-pointer"
            >
              <AlertTriangle className="w-4 h-4" />
              <span>
                Vào Kho câu sai ôn lại {evaluation.wrongQuestionIds.length} câu sai
              </span>
            </button>
          )}
        </div>
      </section>

      {/* 2. THỐNG KÊ TỶ LỆ ĐÚNG THEO TỪNG CHUYÊN ĐỀ & TỪNG DẠNG CÂU HỎI */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Tỷ lệ đúng theo từng Chuyên đề */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-teal-700" />
              <span>Tỷ lệ đúng theo từng Chuyên đề kiến thức</span>
            </h3>
            <span className="text-xs text-slate-500">4 chuyên đề Certiport</span>
          </div>

          <div className="space-y-3.5 tabular-nums">
            {evaluation.topicBreakdown.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="font-semibold text-slate-800">{item.label}</span>
                  <span className="font-mono font-bold text-teal-800">
                    {item.correct} / {item.total} câu ({item.percentage}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      item.percentage >= 70
                        ? 'bg-emerald-600'
                        : item.percentage >= 40
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Tỷ lệ đúng theo từng Dạng câu hỏi */}
        <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Layers className="w-4 h-4 text-teal-700" />
              <span>Tỷ lệ đúng theo từng Dạng câu hỏi</span>
            </h3>
            <span className="text-xs text-slate-500">Chuẩn All-or-Nothing</span>
          </div>

          <div className="space-y-3.5 tabular-nums">
            {evaluation.typeBreakdown.map((item) => (
              <div key={item.key} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs sm:text-sm">
                  <span className="font-semibold text-slate-800">{item.label}</span>
                  <span className="font-mono font-bold text-teal-800">
                    {item.correct} / {item.total} câu ({item.percentage}%)
                  </span>
                </div>
                <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      item.percentage >= 70
                        ? 'bg-teal-600'
                        : item.percentage >= 40
                          ? 'bg-amber-500'
                          : 'bg-rose-500'
                    }`}
                    style={{ width: `${item.percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 3. XEM LẠI CHI TIẾT TỪNG CÂU TRONG ĐỀ THI VỪA LÀM (SO SÁNH BÀI LÀM VỚI ĐÁP ÁN ĐÚNG + GIẢI THÍCH) */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Xem lại Chi tiết Từng câu trong Đề thi ({filteredReviewItems.length} câu)
            </h3>
            <p className="text-xs text-slate-500">
              So sánh trực tiếp câu trả lời của bạn với Đáp án đúng chuẩn Certiport và Giải thích
              ngắn gọn.
            </p>
          </div>

          {/* Bộ lọc Xem lại: Tất cả | Câu làm SAI | Câu làm ĐÚNG */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setReviewFilter('ALL');
                setSelectedReviewIndex(0);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                reviewFilter === 'ALL'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
              }`}
            >
              Tất cả ({examQuestions.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setReviewFilter('WRONG');
                setSelectedReviewIndex(0);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                reviewFilter === 'WRONG'
                  ? 'bg-rose-600 text-white border-rose-600'
                  : 'bg-white text-rose-700 border-rose-200 hover:bg-rose-50'
              }`}
            >
              Câu làm SAI ({evaluation.wrongQuestionIds.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setReviewFilter('CORRECT');
                setSelectedReviewIndex(0);
              }}
              className={`px-3.5 py-2 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                reviewFilter === 'CORRECT'
                  ? 'bg-emerald-600 text-white border-emerald-600'
                  : 'bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50'
              }`}
            >
              Câu làm ĐÚNG ({evaluation.score})
            </button>
          </div>
        </div>

        {/* Thanh chọn nhanh câu cần xem lại */}
        {filteredReviewItems.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {filteredReviewItems.map((item, idx) => (
              <button
                key={item.question.id}
                type="button"
                onClick={() => setSelectedReviewIndex(idx)}
                className={`px-3 py-1.5 rounded-lg border text-xs font-mono font-bold tabular-nums transition-all cursor-pointer ${
                  item.isCorrect
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
                    : 'border-rose-500 bg-rose-50 text-rose-900'
                } ${
                  idx === selectedReviewIndex ? 'ring-2 ring-slate-900 ring-offset-1' : ''
                }`}
              >
                Câu {item.orderNumber} {item.isCorrect ? '✓' : '✗'}
              </button>
            ))}
          </div>
        )}

        {/* Chi tiết câu hỏi đang chọn xem lại */}
        {activeReviewItem && (
          <div className="space-y-4">
            {/* Bảng so sánh 2 cột: Câu trả lời của Học sinh vs Đáp án đúng chuẩn Certiport */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Cột 1: Câu trả lời của Học sinh */}
              <div
                className={`p-4 rounded-xl border-2 space-y-2.5 ${
                  activeReviewItem.isCorrect
                    ? 'bg-emerald-50/60 border-emerald-400'
                    : 'bg-rose-50/60 border-rose-400'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                    Câu trả lời của bạn (Câu {activeReviewItem.orderNumber})
                  </span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                      activeReviewItem.isCorrect
                        ? 'bg-emerald-600 text-white'
                        : 'bg-rose-600 text-white'
                    }`}
                  >
                    {activeReviewItem.isCorrect ? 'ĐÚNG 100% (1/1)' : 'SAI / THIẾU Ý (0/1)'}
                  </span>
                </div>

                <div className="space-y-1.5">
                  {getUserAnswerBreakdown(
                    activeReviewItem.question,
                    activeReviewItem.userAnswer
                  ).map((uItem, idx) => (
                    <div
                      key={idx}
                      className="text-xs sm:text-sm bg-white/90 p-2 rounded border border-black/5 flex flex-wrap items-baseline justify-between gap-2"
                    >
                      <span className="text-slate-600 font-medium">{uItem.label}:</span>
                      <span
                        className={`font-bold ${
                          activeReviewItem.isCorrect ? 'text-emerald-900' : 'text-rose-900'
                        }`}
                      >
                        {uItem.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Cột 2: Đáp án đúng chuẩn Certiport */}
              <div className="p-4 rounded-xl border-2 border-emerald-500 bg-emerald-50/40 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-950">
                    Đáp án đúng chuẩn Certiport
                  </span>
                  <span className="text-xs font-semibold text-emerald-800">
                    Yêu cầu đúng tất cả các ý
                  </span>
                </div>

                <div className="space-y-1.5">
                  {getCorrectAnswerBreakdown(activeReviewItem.question).map(
                    (cItem, idx) => (
                      <div
                        key={idx}
                        className="text-xs sm:text-sm bg-white p-2 rounded border border-emerald-200 flex flex-wrap items-baseline justify-between gap-2"
                      >
                        <span className="text-slate-600 font-medium">{cItem.label}:</span>
                        <span className="font-bold text-emerald-800">{cItem.value}</span>
                      </div>
                    )
                  )}
                </div>
              </div>
            </div>

            {/* Khung Giải thích ngắn gọn + Xem trên giao diện câu hỏi */}
            <QuestionRenderer
              question={activeReviewItem.question}
              questionNumber={activeReviewItem.orderNumber}
              totalQuestions={examQuestions.length}
              userAnswer={activeReviewItem.userAnswer}
              onChangeAnswer={() => {}}
              showFeedback={true}
              readOnly={true}
              isBookmarked={bookmarkedIds.includes(activeReviewItem.question.id)}
              onToggleBookmark={(qId) => onToggleBookmark(qId)}
            />
          </div>
        )}
      </section>
    </div>
  );
};
