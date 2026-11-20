import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  FileSpreadsheet,
  Filter,
  Printer,
  RotateCcw,
  Search,
  TrendingDown,
  TrendingUp,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import {
  CERTIPORT_PASS_SCORE,
  ExamAttempt,
  QUESTION_TYPE_LABELS,
  Question,
  UserAccount,
} from '../types/exam';
import {
  buildPracticeResultsExcelBytes,
  computePracticeAnalytics,
  EnrichedPracticeAttempt,
  enrichPracticeAttempts,
  filterAndSortPracticeAttempts,
  formatAnswerReadable,
  formatPracticeDuration,
  PracticeAttemptSource,
  PracticeDateRangeFilter,
  PracticeResultFilter,
  PracticeSortField,
} from '../utils/practiceResultsUtils';

interface TeacherPracticeResultsTabProps {
  questions: Question[];
  users: UserAccount[];
  attempts: ExamAttempt[];
  onExportWholeSchoolExcel?: () => void;
}

const PAGE_SIZE = 25;

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const TeacherPracticeResultsTab: React.FC<
  TeacherPracticeResultsTabProps
> = ({ questions, users, attempts }) => {
  const [viewMode, setViewMode] = useState<'attempts' | 'students'>('attempts');
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState<string>('ALL');
  const [sourceFilter, setSourceFilter] = useState<'ALL' | PracticeAttemptSource>(
    'ALL'
  );
  const [examSetFilter, setExamSetFilter] = useState<string>('ALL');
  const [resultFilter, setResultFilter] = useState<PracticeResultFilter>('ALL');
  const [dateRangeFilter, setDateRangeFilter] =
    useState<PracticeDateRangeFilter>('ALL');
  const [scoreBinIndex, setScoreBinIndex] = useState<number | null>(null);
  const [sortField, setSortField] = useState<PracticeSortField>('completedAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [showCharts, setShowCharts] = useState<boolean>(true);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  // Slide-over Drawer: Chi tiết bài làm học sinh
  const [selectedAttempt, setSelectedAttempt] =
    useState<EnrichedPracticeAttempt | null>(null);
  const [drawerQuestionFilter, setDrawerQuestionFilter] = useState<
    'all' | 'wrong' | 'correct'
  >('all');

  // Modal In báo cáo A4
  const [isPrintModalOpen, setIsPrintModalOpen] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedAttempt && !isPrintModalOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isPrintModalOpen) {
          setIsPrintModalOpen(false);
        } else if (selectedAttempt) {
          setSelectedAttempt(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAttempt, isPrintModalOpen]);

  const enrichedAll = useMemo(
    () => enrichPracticeAttempts(attempts, users),
    [attempts, users]
  );

  const questionById = useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of questions) map.set(q.id, q);
    return map;
  }, [questions]);

  const availableClasses = useMemo(() => {
    const set = new Set<string>();
    for (const r of enrichedAll) {
      if (r.className) set.add(r.className);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [enrichedAll]);

  const availableExamSets = useMemo(() => {
    const set = new Set<string>();
    for (const r of enrichedAll) {
      if (r.examSet) set.add(r.examSet);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'vi'));
  }, [enrichedAll]);

  // Tập dữ liệu trước khi lọc theo cột histogram (để histogram luôn giữ bối cảnh phân bố đầy đủ)
  const baseFilteredAttempts = useMemo(
    () =>
      filterAndSortPracticeAttempts(enrichedAll, {
        searchQuery,
        classFilter,
        sourceFilter,
        examSetFilter,
        resultFilter,
        dateRangeFilter,
        scoreBinIndex: null,
        sortField,
        sortDirection,
      }),
    [
      enrichedAll,
      searchQuery,
      classFilter,
      sourceFilter,
      examSetFilter,
      resultFilter,
      dateRangeFilter,
      sortField,
      sortDirection,
    ]
  );

  const filteredAttempts = useMemo(() => {
    if (scoreBinIndex === null) return baseFilteredAttempts;
    return filterAndSortPracticeAttempts(enrichedAll, {
      searchQuery,
      classFilter,
      sourceFilter,
      examSetFilter,
      resultFilter,
      dateRangeFilter,
      scoreBinIndex,
      sortField,
      sortDirection,
    });
  }, [
    baseFilteredAttempts,
    enrichedAll,
    searchQuery,
    classFilter,
    sourceFilter,
    examSetFilter,
    resultFilter,
    dateRangeFilter,
    scoreBinIndex,
    sortField,
    sortDirection,
  ]);

  const analytics = useMemo(
    () => computePracticeAnalytics(baseFilteredAttempts, questions),
    [baseFilteredAttempts, questions]
  );

  const filteredAnalytics = useMemo(
    () => computePracticeAnalytics(filteredAttempts, questions),
    [filteredAttempts, questions]
  );

  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    classFilter !== 'ALL' ||
    sourceFilter !== 'ALL' ||
    examSetFilter !== 'ALL' ||
    resultFilter !== 'ALL' ||
    dateRangeFilter !== 'ALL' ||
    scoreBinIndex !== null;

  const resetAllFilters = () => {
    setSearchQuery('');
    setClassFilter('ALL');
    setSourceFilter('ALL');
    setExamSetFilter('ALL');
    setResultFilter('ALL');
    setDateRangeFilter('ALL');
    setScoreBinIndex(null);
    setCurrentPage(1);
  };

  const handleToggleSort = (field: PracticeSortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection(field === 'name' ? 'asc' : 'desc');
    }
    setCurrentPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filteredAttempts.length / PAGE_SIZE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedAttempts = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return filteredAttempts.slice(start, start + PAGE_SIZE);
  }, [filteredAttempts, safePage]);

  const maxBinCount = useMemo(
    () => Math.max(1, ...analytics.histogram.map((b) => b.count)),
    [analytics.histogram]
  );

  const handleExportFilteredExcel = async () => {
    const bytes = await buildPracticeResultsExcelBytes(
      filteredAttempts,
      filteredAnalytics
    );
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const dateStr = new Date().toISOString().slice(0, 10);
    triggerDownload(
      blob,
      `Ket_Qua_Luyen_Thi_Certiport_GenAI_${dateStr}.xlsx`
    );
    setExportNotice(
      `Đã xuất file Excel gồm 3 trang tính (Lịch sử ${filteredAttempts.length} lượt, Tổng hợp ${filteredAnalytics.leaderboard.length} học sinh, Phân tích chuyên đề).`
    );
    window.setTimeout(() => setExportNotice(null), 5000);
  };

  const renderSortIcon = (field: PracticeSortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-teal-700" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-teal-700" />
    );
  };

  // Dữ liệu chi tiết câu hỏi cho Drawer
  const selectedAttemptDetailRows = useMemo(() => {
    if (!selectedAttempt) return [];
    const att = selectedAttempt.attempt;

    if (Array.isArray(att.questionResults) && att.questionResults.length > 0) {
      return att.questionResults.map((qr, idx) => {
        const bankQ = questionById.get(qr.questionId);
        return {
          key: `${qr.questionId}_${idx}`,
          orderNumber: qr.orderNumber || idx + 1,
          questionId: qr.questionId,
          topic: qr.topic || bankQ?.topic || 'Chuyên đề GenAI',
          type: qr.type || bankQ?.type || 'mcq_single',
          prompt: qr.prompt || bankQ?.prompt || `Câu hỏi ${qr.questionId}`,
          isCorrect: qr.isCorrect,
          answered: qr.answered,
          userAnswerText: formatAnswerReadable(qr.userAnswer, bankQ),
          correctAnswerText: bankQ
            ? formatAnswerReadable(bankQ.correctAnswer, bankQ)
            : '—',
          explanation: bankQ?.explanation || '',
        };
      });
    }

    if (Array.isArray(att.wrongQuestionIds) && att.wrongQuestionIds.length > 0) {
      return att.wrongQuestionIds.map((qId, idx) => {
        const bankQ = questionById.get(qId);
        return {
          key: `${qId}_${idx}`,
          orderNumber: idx + 1,
          questionId: qId,
          topic: bankQ?.topic || 'Chuyên đề GenAI',
          type: bankQ?.type || 'mcq_single',
          prompt: bankQ?.prompt || `Câu hỏi ${qId}`,
          isCorrect: false,
          answered: true,
          userAnswerText: 'Sai (bản ghi cũ chỉ lưu mã câu sai)',
          correctAnswerText: bankQ
            ? formatAnswerReadable(bankQ.correctAnswer, bankQ)
            : '—',
          explanation: bankQ?.explanation || '',
        };
      });
    }

    return [];
  }, [selectedAttempt, questionById]);

  const filteredDrawerQuestions = useMemo(() => {
    if (drawerQuestionFilter === 'wrong') {
      return selectedAttemptDetailRows.filter((q) => !q.isCorrect);
    }
    if (drawerQuestionFilter === 'correct') {
      return selectedAttemptDetailRows.filter((q) => q.isCorrect);
    }
    return selectedAttemptDetailRows;
  }, [selectedAttemptDetailRows, drawerQuestionFilter]);

  const selectedAttemptTopics = useMemo(() => {
    if (!selectedAttempt) return [];
    const att = selectedAttempt.attempt;
    if (Array.isArray(att.topicBreakdown) && att.topicBreakdown.length > 0) {
      return att.topicBreakdown.map((t) => ({
        topic: t.label || t.key,
        correct: t.correct,
        total: t.total,
        percentage:
          t.total > 0 ? Math.round((t.correct / t.total) * 100) : t.percentage,
      }));
    }
    if (selectedAttemptDetailRows.length > 0) {
      const map = new Map<string, { correct: number; total: number }>();
      for (const row of selectedAttemptDetailRows) {
        const cur = map.get(row.topic) ?? { correct: 0, total: 0 };
        cur.total += 1;
        if (row.isCorrect) cur.correct += 1;
        map.set(row.topic, cur);
      }
      return Array.from(map.entries()).map(([topic, s]) => ({
        topic,
        correct: s.correct,
        total: s.total,
        percentage: s.total > 0 ? Math.round((s.correct / s.total) * 100) : 0,
      }));
    }
    return [];
  }, [selectedAttempt, selectedAttemptDetailRows]);

  return (
    <div className="space-y-5" data-testid="teacher-practice-results-tab">
      {/* 1. Đầu trang & Nút hành động chính */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
            Kết quả Luyện thi & Thi thử
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Phân tích kết quả chuẩn Certiport (thang 1000 điểm, đạt từ{' '}
            <strong className="text-slate-800">{CERTIPORT_PASS_SCORE}/1000</strong>),
            theo dõi tiến bộ và xem chi tiết từng bài làm của học sinh.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowCharts((prev) => !prev)}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <BarChart3 className="w-4 h-4 text-teal-700" />
            <span>{showCharts ? 'Ẩn biểu đồ' : 'Hiện biểu đồ'}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsPrintModalOpen(true)}
            disabled={filteredAttempts.length === 0}
            data-testid="practice-print-report-btn"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <Printer className="w-4 h-4 text-slate-600" />
            <span>In báo cáo A4</span>
          </button>

          <button
            type="button"
            onClick={handleExportFilteredExcel}
            disabled={filteredAttempts.length === 0}
            data-testid="practice-export-excel-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-bold shadow-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
          >
            <FileSpreadsheet className="w-4 h-4" />
            <span>Xuất Excel (.xlsx)</span>
          </button>
        </div>
      </div>

      {/* Thông báo xuất dữ liệu */}
      {exportNotice && (
        <div
          data-testid="practice-export-notice"
          className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg border border-teal-200 bg-teal-50 text-teal-900 text-xs font-medium"
        >
          <span>{exportNotice}</span>
          <button
            type="button"
            onClick={() => setExportNotice(null)}
            className="p-1 text-teal-700 hover:text-teal-900 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 2. Dải chỉ số KPI gọn (Single-elevation, không lồng thẻ, số lớn nhãn nhỏ) */}
      <div
        className="bg-white border border-slate-200 rounded-xl grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-slate-200"
        data-testid="practice-kpi-strip"
      >
        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">
            Tổng lượt nộp bài
          </div>
          <div
            className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1"
            data-testid="kpi-total-attempts"
          >
            {filteredAnalytics.totalAttempts}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {filteredAnalytics.uniqueStudents} học sinh tham gia
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">
            Tỉ lệ Đạt (&ge;{CERTIPORT_PASS_SCORE})
          </div>
          <div
            className="text-2xl font-extrabold text-teal-700 tabular-nums mt-1"
            data-testid="kpi-pass-rate"
          >
            {filteredAnalytics.passRatePercent}%
          </div>
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            {filteredAnalytics.passCount} đạt · {filteredAnalytics.failCount} chưa
            đạt
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">
            Điểm trung bình
          </div>
          <div
            className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1"
            data-testid="kpi-avg-score"
          >
            {filteredAnalytics.avgScore}
            <span className="text-sm font-semibold text-slate-400">/1000</span>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            Trung vị: {filteredAnalytics.medianScore} điểm
          </div>
        </div>

        <div className="p-4">
          <div className="text-xs font-medium text-slate-500">
            Biên độ điểm số
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
            {filteredAnalytics.maxScore}
          </div>
          <div className="text-xs text-slate-500 mt-0.5 tabular-nums">
            Cao nhất · Thấp nhất: {filteredAnalytics.minScore}
          </div>
        </div>

        <div className="p-4 col-span-2 sm:col-span-1">
          <div className="text-xs font-medium text-slate-500">
            Thời gian làm TB
          </div>
          <div className="text-2xl font-extrabold text-slate-900 tabular-nums mt-1">
            {formatPracticeDuration(filteredAnalytics.avgDurationSeconds)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Mỗi lượt nộp bài
          </div>
        </div>
      </div>

      {/* 3. Khu vực Biểu đồ trực quan: Phổ điểm (bấm để lọc) + Độ chính xác 4 chuyên đề */}
      {showCharts && enrichedAll.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Phổ điểm 0-1000 */}
          <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-bold text-slate-900">
                  Phổ điểm luyện thi (thang 1000)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Bấm vào một cột khoảng điểm để lọc nhanh danh sách bài làm bên
                  dưới.
                </p>
              </div>
              {scoreBinIndex !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setScoreBinIndex(null);
                    setCurrentPage(1);
                  }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-teal-300 bg-teal-50 text-teal-800 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <span>Khoảng {analytics.histogram[scoreBinIndex]?.label}</span>
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* 10 cột histogram */}
            <div
              className="grid grid-cols-10 gap-1.5 items-end h-36 pt-4"
              role="group"
              aria-label="Phổ điểm theo khoảng 100 điểm"
            >
              {analytics.histogram.map((bin) => {
                const heightPct =
                  bin.count > 0
                    ? Math.max(12, Math.round((bin.count / maxBinCount) * 100))
                    : 4;
                const isSelected = scoreBinIndex === bin.binIndex;
                return (
                  <button
                    key={bin.binIndex}
                    type="button"
                    onClick={() => {
                      setScoreBinIndex((prev) =>
                        prev === bin.binIndex ? null : bin.binIndex
                      );
                      setCurrentPage(1);
                    }}
                    data-testid={`practice-hist-bin-${bin.binIndex}`}
                    title={`Khoảng ${bin.label} điểm: ${bin.count} lượt (${bin.percent}%)`}
                    className="flex flex-col items-center justify-end h-full group cursor-pointer focus:outline-none"
                  >
                    <span
                      className={`text-[11px] font-bold tabular-nums mb-1 ${
                        bin.count > 0
                          ? isSelected
                            ? 'text-teal-700'
                            : 'text-slate-700'
                          : 'text-slate-300'
                      }`}
                    >
                      {bin.count > 0 ? bin.count : ''}
                    </span>
                    <div
                      style={{ height: `${heightPct}%` }}
                      className={`w-full rounded-t-md transition-all ${
                        isSelected
                          ? 'bg-teal-700 ring-2 ring-teal-500 ring-offset-1'
                          : bin.count === 0
                            ? 'bg-slate-100'
                            : bin.isPassZone
                              ? 'bg-teal-600/90 group-hover:bg-teal-700'
                              : 'bg-slate-300 group-hover:bg-slate-400'
                      }`}
                    />
                    <span className="text-[10px] font-mono text-slate-500 mt-1.5 tabular-nums">
                      {bin.min}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Thanh xếp chồng Đạt / Chưa đạt */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs tabular-nums">
                <span className="font-semibold text-teal-800">
                  Đạt (&ge;700): {analytics.passCount} lượt ({analytics.passRatePercent}%)
                </span>
                <span className="font-semibold text-rose-700">
                  Chưa đạt (&lt;700): {analytics.failCount} lượt (
                  {analytics.totalAttempts > 0 ? 100 - analytics.passRatePercent : 0}%)
                </span>
              </div>
              <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
                {analytics.totalAttempts > 0 && (
                  <>
                    <div
                      style={{ width: `${analytics.passRatePercent}%` }}
                      className="h-full bg-teal-600 transition-all"
                    />
                    <div
                      style={{ width: `${100 - analytics.passRatePercent}%` }}
                      className="h-full bg-rose-400 transition-all"
                    />
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Tỉ lệ đúng theo 4 chuyên đề */}
          <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Độ chính xác theo 4 Chuyên đề
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tổng hợp trên các lượt nộp bài có dữ liệu chi tiết từng câu.
              </p>
            </div>

            <div className="space-y-3">
              {analytics.topicAggregates.map((tp) => (
                <div key={tp.topic} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className={`font-semibold truncate ${
                        tp.isWeakest ? 'text-rose-700' : 'text-slate-800'
                      }`}
                      title={tp.topic}
                    >
                      {tp.topic}
                    </span>
                    <span className="font-mono font-bold tabular-nums shrink-0 text-slate-700">
                      {tp.total > 0 ? `${tp.accuracyPercent}%` : '—'}
                      {tp.total > 0 && (
                        <span className="text-[11px] font-normal text-slate-400 ml-1">
                          ({tp.correct}/{tp.total})
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      style={{ width: `${tp.total > 0 ? tp.accuracyPercent : 0}%` }}
                      className={`h-full rounded-full transition-all ${
                        tp.isWeakest
                          ? 'bg-rose-500'
                          : tp.accuracyPercent >= 80
                            ? 'bg-teal-700'
                            : 'bg-teal-500'
                      }`}
                    />
                  </div>
                </div>
              ))}
            </div>

            <div className="pt-2 border-t border-slate-100 text-xs text-slate-600">
              {analytics.weakestTopic ? (
                <span>
                  Cần tập trung ôn bổ sung:{' '}
                  <strong className="text-rose-700">
                    {analytics.weakestTopic.topic}
                  </strong>{' '}
                  (đúng{' '}
                  <strong className="tabular-nums">
                    {analytics.weakestTopic.accuracyPercent}%
                  </strong>
                  ).
                </span>
              ) : (
                <span>
                  Chưa có thống kê chuyên đề chi tiết cho tập lượt thi đang lọc.
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 4. Thanh công cụ lọc & Chuyển đổi chế độ xem */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Segmented tabs chuyển chế độ xem */}
          <div
            className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-1 self-start"
            role="tablist"
            aria-label="Chế độ xem kết quả luyện thi"
          >
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'attempts'}
              onClick={() => setViewMode('attempts')}
              data-testid="practice-view-attempts-btn"
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                viewMode === 'attempts'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Lịch sử lượt thi ({filteredAttempts.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'students'}
              onClick={() => setViewMode('students')}
              data-testid="practice-view-students-btn"
              className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                viewMode === 'students'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-700 hover:text-slate-900'
              }`}
            >
              Tổng hợp theo học sinh ({filteredAnalytics.leaderboard.length})
            </button>
          </div>

          {/* Ô tìm kiếm */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Tìm tên HS, tài khoản, lớp, bộ đề..."
              data-testid="practice-search-input"
              className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Hàng bộ lọc chi tiết (gọn 1 hàng trên desktop) */}
        <div className="flex flex-wrap xl:flex-nowrap items-center gap-2 pt-2 border-t border-slate-100">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 shrink-0">
            <Filter className="w-3.5 h-3.5" />
            Lọc:
          </span>

          <select
            aria-label="Lọc theo lớp"
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setCurrentPage(1);
            }}
            data-testid="practice-class-filter"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 max-w-[165px] focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="ALL">Tất cả lớp</option>
            {availableClasses.map((cls) => (
              <option key={cls} value={cls}>
                {cls.toLowerCase().startsWith('lớp') || cls === 'Chưa phân lớp'
                  ? cls
                  : `Lớp ${cls}`}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo nguồn thi"
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value as 'ALL' | PracticeAttemptSource);
              setCurrentPage(1);
            }}
            data-testid="practice-source-filter"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="ALL">Mọi nguồn</option>
            <option value="practice">Thi thử tự do</option>
            <option value="live_session">Ca thi trực tuyến</option>
          </select>

          <select
            aria-label="Lọc theo bộ đề"
            value={examSetFilter}
            onChange={(e) => {
              setExamSetFilter(e.target.value);
              setCurrentPage(1);
            }}
            data-testid="practice-examset-filter"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 max-w-[170px] focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="ALL">Tất cả bộ đề</option>
            {availableExamSets.map((es) => (
              <option key={es} value={es}>
                {es}
              </option>
            ))}
          </select>

          <select
            aria-label="Lọc theo kết quả đạt hay chưa đạt"
            value={resultFilter}
            onChange={(e) => {
              setResultFilter(e.target.value as PracticeResultFilter);
              setCurrentPage(1);
            }}
            data-testid="practice-result-filter"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="ALL">Đạt & Chưa đạt</option>
            <option value="PASS">Chỉ Đạt (&ge;700)</option>
            <option value="FAIL">Chỉ Chưa đạt (&lt;700)</option>
          </select>

          <select
            aria-label="Lọc theo thời gian"
            value={dateRangeFilter}
            onChange={(e) => {
              setDateRangeFilter(e.target.value as PracticeDateRangeFilter);
              setCurrentPage(1);
            }}
            data-testid="practice-date-filter"
            className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="ALL">Mọi thời điểm</option>
            <option value="TODAY">Hôm nay</option>
            <option value="7D">7 ngày qua</option>
            <option value="30D">30 ngày qua</option>
          </select>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetAllFilters}
              data-testid="practice-reset-filters-btn"
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer ml-auto whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Xóa lọc</span>
            </button>
          )}
        </div>
      </div>

      {/* 5A. Bảng Lịch sử lượt thi (High-density sortable table) */}
      {viewMode === 'attempts' ? (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredAttempts.length === 0 ? (
            <div
              className="p-12 text-center space-y-3"
              data-testid="practice-empty-state"
            >
              <p className="text-sm font-semibold text-slate-700">
                {enrichedAll.length === 0
                  ? 'Chưa có lượt nộp bài luyện thi nào từ học sinh.'
                  : 'Không tìm thấy lượt thi nào khớp với bộ lọc hiện tại.'}
              </p>
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetAllFilters}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Đặt lại bộ lọc
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table
                  className="w-full text-left border-collapse"
                  data-testid="practice-attempts-table"
                >
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 whitespace-nowrap">
                      <th className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('completedAt')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                        >
                          <span>Thời gian nộp</span>
                          {renderSortIcon('completedAt')}
                        </button>
                      </th>
                      <th className="py-2.5 px-3">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('name')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer"
                        >
                          <span>Học sinh / Lớp</span>
                          {renderSortIcon('name')}
                        </button>
                      </th>
                      <th className="py-2.5 px-3">Chế độ / Bộ đề</th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('percentage')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer ml-auto"
                        >
                          <span>Câu đúng</span>
                          {renderSortIcon('percentage')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('score')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer ml-auto"
                        >
                          <span>Điểm</span>
                          {renderSortIcon('score')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5 text-right">
                        <button
                          type="button"
                          onClick={() => handleToggleSort('duration')}
                          className="inline-flex items-center gap-1 hover:text-slate-900 cursor-pointer ml-auto"
                        >
                          <span>Thời lượng</span>
                          {renderSortIcon('duration')}
                        </button>
                      </th>
                      <th className="py-2.5 px-2.5">Đánh giá</th>
                      <th className="py-2.5 px-3 text-right">Bài làm</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
                    {paginatedAttempts.map((row) => (
                      <tr
                        key={row.id}
                        data-testid={`practice-attempt-row-${row.id}`}
                        onClick={() => {
                          setSelectedAttempt(row);
                          setDrawerQuestionFilter('all');
                        }}
                        className="hover:bg-slate-50/80 transition-colors cursor-pointer"
                      >
                        <td className="py-2.5 px-3 text-xs font-mono text-slate-600 whitespace-nowrap">
                          {new Date(row.completedAt).toLocaleString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </td>
                        <td className="py-2.5 px-3 max-w-[180px]">
                          <div className="font-bold text-slate-900 truncate" title={row.fullName}>
                            {row.fullName}
                          </div>
                          <div className="text-xs text-slate-500 truncate">
                            <span className="font-mono text-teal-800 font-semibold">
                              @{row.username}
                            </span>{' '}
                            · {row.className}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 max-w-[195px]">
                          <div
                            className="font-medium text-slate-800 truncate"
                            title={row.modeLabel}
                          >
                            {row.modeLabel}
                          </div>
                          <div className="text-[11px] text-slate-500">
                            {row.source === 'live_session'
                              ? 'Ca thi trực tuyến'
                              : 'Luyện đề tự do'}
                          </div>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-xs sm:text-sm font-semibold text-slate-800 whitespace-nowrap">
                          {row.correctCount}/{row.totalQuestions}{' '}
                          <span className="text-xs text-slate-500">
                            ({row.percentage}%)
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-extrabold whitespace-nowrap">
                          <span
                            className={
                              row.passed ? 'text-teal-800' : 'text-rose-700'
                            }
                          >
                            {row.certiportScore}
                          </span>
                          <span className="text-[11px] font-normal text-slate-400">
                            /1000
                          </span>
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono text-xs text-slate-600 whitespace-nowrap">
                          {formatPracticeDuration(row.durationSeconds)}
                        </td>
                        <td className="py-2.5 px-2.5 whitespace-nowrap">
                          {row.passed ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Đạt
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md border border-rose-200 bg-rose-50 text-rose-800 text-xs font-bold">
                              <XCircle className="w-3.5 h-3.5" />
                              Chưa đạt
                            </span>
                          )}
                        </td>
                        <td
                          className="py-2.5 px-3 text-right whitespace-nowrap"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedAttempt(row);
                              setDrawerQuestionFilter('all');
                            }}
                            data-testid={`open-attempt-detail-btn-${row.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-teal-50 hover:border-teal-300 text-slate-700 hover:text-teal-800 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Chi tiết</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Phân trang */}
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50/70 flex items-center justify-between text-xs text-slate-600 tabular-nums">
                  <span>
                    Hiển thị {(safePage - 1) * PAGE_SIZE + 1}–
                    {Math.min(safePage * PAGE_SIZE, filteredAttempts.length)} /{' '}
                    {filteredAttempts.length} lượt thi
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold cursor-pointer"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Trước
                    </button>
                    <span className="px-2 font-bold text-slate-800">
                      Trang {safePage} / {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={safePage >= totalPages}
                      onClick={() =>
                        setCurrentPage((p) => Math.min(totalPages, p + 1))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold cursor-pointer"
                    >
                      Sau
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* 5B. Bảng Tổng hợp theo học sinh (Leaderboard & tiến bộ) */
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {filteredAnalytics.leaderboard.length === 0 ? (
            <div className="p-12 text-center text-sm text-slate-500">
              Chưa có dữ liệu học sinh khớp với bộ lọc hiện tại.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table
                className="w-full text-left border-collapse"
                data-testid="practice-students-leaderboard-table"
              >
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600 whitespace-nowrap">
                    <th className="py-3 px-4">Hạng</th>
                    <th className="py-3 px-4">Học sinh / Lớp</th>
                    <th className="py-3 px-4 text-right">Số lượt thi</th>
                    <th className="py-3 px-4 text-right">Tỉ lệ Đạt</th>
                    <th className="py-3 px-4 text-right">Điểm cao nhất</th>
                    <th className="py-3 px-4 text-right">Điểm TB</th>
                    <th className="py-3 px-4 text-right">Tiến bộ</th>
                    <th className="py-3 px-4 text-right">Tổng thời gian</th>
                    <th className="py-3 px-4 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
                  {filteredAnalytics.leaderboard.map((st, idx) => (
                    <tr key={st.username} className="hover:bg-slate-50/80">
                      <td className="py-3 px-4 font-mono font-bold text-slate-700">
                        #{idx + 1}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-bold text-slate-900">
                          {st.fullName}
                        </div>
                        <div className="text-xs text-slate-500">
                          <span className="font-mono font-semibold text-teal-800">
                            @{st.username}
                          </span>{' '}
                          · {st.className}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-800">
                        {st.attemptCount}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-700">
                        {st.passCount}/{st.attemptCount} ({st.passRatePercent}%)
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-extrabold text-teal-800">
                        {st.bestScore}/1000
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-semibold text-slate-700">
                        {st.avgScore}/1000
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs font-bold whitespace-nowrap">
                        {st.attemptCount < 2 ? (
                          <span className="text-slate-400">Lần đầu</span>
                        ) : st.improvementDelta > 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-emerald-700">
                            <TrendingUp className="w-3.5 h-3.5" />+
                            {st.improvementDelta}
                          </span>
                        ) : st.improvementDelta < 0 ? (
                          <span className="inline-flex items-center gap-0.5 text-rose-700">
                            <TrendingDown className="w-3.5 h-3.5" />
                            {st.improvementDelta}
                          </span>
                        ) : (
                          <span className="text-slate-500">0</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs text-slate-600">
                        {formatPracticeDuration(st.totalDurationSeconds)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => {
                            setSearchQuery(st.username);
                            setViewMode('attempts');
                            setCurrentPage(1);
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-teal-50 hover:border-teal-300 text-slate-700 hover:text-teal-800 text-xs font-semibold cursor-pointer"
                        >
                          <Users className="w-3.5 h-3.5" />
                          Xem các lượt
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* 6. SLIDE-OVER DRAWER: CHI TIẾT BÀI LÀM CỦA HỌC SINH */}
      {selectedAttempt && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/50 backdrop-blur-[1px]"
          data-testid="practice-attempt-detail-drawer"
          onClick={() => setSelectedAttempt(null)}
        >
          <div
            className="w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header Drawer */}
            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50/80 flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900">
                    Chi tiết bài làm: {selectedAttempt.fullName}
                  </h2>
                  {selectedAttempt.passed ? (
                    <span className="px-2 py-0.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold">
                      Đạt ({selectedAttempt.certiportScore}/1000)
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md border border-rose-200 bg-rose-50 text-rose-800 text-xs font-bold">
                      Chưa đạt ({selectedAttempt.certiportScore}/1000)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 tabular-nums">
                  @{selectedAttempt.username} · {selectedAttempt.className} ·{' '}
                  {selectedAttempt.modeLabel} · Nộp lúc{' '}
                  {new Date(selectedAttempt.completedAt).toLocaleString('vi-VN')}
                </p>
              </div>
              <button
                type="button"
                aria-label="Đóng chi tiết bài làm"
                onClick={() => setSelectedAttempt(null)}
                data-testid="close-practice-detail-drawer-btn"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/70 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Nội dung cuộn của Drawer */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* 4 chỉ số tóm tắt bài làm */}
              <div className="grid grid-cols-2 sm:grid-cols-4 border border-slate-200 rounded-xl divide-y sm:divide-y-0 sm:divide-x divide-slate-200 bg-slate-50/40 tabular-nums">
                <div className="p-3">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Điểm Certiport
                  </div>
                  <div className="text-lg font-extrabold text-teal-800 mt-0.5">
                    {selectedAttempt.certiportScore}/1000
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Số câu đúng
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                    {selectedAttempt.correctCount}/{selectedAttempt.totalQuestions}
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Tỉ lệ chính xác
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                    {selectedAttempt.percentage}%
                  </div>
                </div>
                <div className="p-3">
                  <div className="text-[11px] font-semibold text-slate-500">
                    Thời gian làm
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 mt-0.5 inline-flex items-center gap-1">
                    <Clock className="w-4 h-4 text-slate-400" />
                    {formatPracticeDuration(selectedAttempt.durationSeconds)}
                  </div>
                </div>
              </div>

              {/* Kết quả theo chuyên đề của lượt thi này */}
              {selectedAttemptTopics.length > 0 && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-3">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <BookOpen className="w-3.5 h-3.5 text-teal-700" />
                    Kết quả theo chuyên đề trong bài làm
                  </h3>
                  <div className="space-y-2.5">
                    {selectedAttemptTopics.map((tp) => (
                      <div key={tp.topic} className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-slate-700 truncate pr-2">
                            {tp.topic}
                          </span>
                          <span className="font-mono font-bold tabular-nums text-slate-800 shrink-0">
                            {tp.correct}/{tp.total} ({tp.percentage}%)
                          </span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${tp.percentage}%` }}
                            className={`h-full rounded-full ${
                              tp.percentage >= 70 ? 'bg-teal-600' : 'bg-rose-500'
                            }`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Danh sách từng câu hỏi đã làm */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-bold text-slate-800">
                    Chi tiết từng câu hỏi ({selectedAttemptDetailRows.length} câu)
                  </h3>
                  {selectedAttemptDetailRows.length > 0 && (
                    <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
                      {(
                        [
                          {
                            id: 'all',
                            label: `Tất cả (${selectedAttemptDetailRows.length})`,
                          },
                          {
                            id: 'wrong',
                            label: `Câu sai (${selectedAttemptDetailRows.filter((q) => !q.isCorrect).length})`,
                          },
                          {
                            id: 'correct',
                            label: `Câu đúng (${selectedAttemptDetailRows.filter((q) => q.isCorrect).length})`,
                          },
                        ] as const
                      ).map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          onClick={() => setDrawerQuestionFilter(tab.id)}
                          className={`px-2.5 py-1 rounded-md font-semibold cursor-pointer tabular-nums ${
                            drawerQuestionFilter === tab.id
                              ? 'bg-teal-700 text-white'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {selectedAttemptDetailRows.length === 0 ? (
                  <div className="p-6 rounded-xl border border-slate-200 bg-slate-50/70 text-center space-y-1.5">
                    <AlertTriangle className="w-5 h-5 text-amber-600 mx-auto" />
                    <p className="text-xs font-semibold text-slate-700">
                      Bản ghi lượt thi này chỉ lưu điểm tổng hợp, không có danh
                      sách đáp án từng câu.
                    </p>
                    <p className="text-xs text-slate-500">
                      Các lượt thi mới sau này đều lưu chi tiết câu hỏi để giáo
                      viên tra cứu trực tiếp tại đây.
                    </p>
                  </div>
                ) : filteredDrawerQuestions.length === 0 ? (
                  <div className="p-6 rounded-xl border border-slate-200 text-center text-xs text-slate-500">
                    Không có câu hỏi nào thuộc bộ lọc này.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredDrawerQuestions.map((item) => (
                      <div
                        key={item.key}
                        className={`rounded-xl border p-4 space-y-2.5 ${
                          item.isCorrect
                            ? 'border-emerald-200 bg-emerald-50/40'
                            : 'border-rose-200 bg-rose-50/40'
                        }`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span className="font-bold text-slate-800 tabular-nums">
                            Câu {item.orderNumber} ·{' '}
                            <span className="font-medium text-slate-600">
                              {item.topic}
                            </span>
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-bold ${
                              item.isCorrect
                                ? 'text-emerald-700'
                                : 'text-rose-700'
                            }`}
                          >
                            {item.isCorrect ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Đúng
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5" />
                                Sai
                              </>
                            )}
                          </span>
                        </div>

                        <div className="text-xs text-slate-500">
                          {QUESTION_TYPE_LABELS[item.type] || item.type}
                        </div>

                        <div className="text-sm font-medium text-slate-900 whitespace-pre-wrap break-words leading-relaxed">
                          {item.prompt}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-xs">
                          <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                            <div className="text-[11px] font-semibold text-slate-500 mb-0.5">
                              Học sinh đã chọn
                            </div>
                            <div
                              className={`font-semibold whitespace-pre-wrap break-words ${
                                item.isCorrect
                                  ? 'text-emerald-800'
                                  : 'text-rose-800'
                              }`}
                            >
                              {item.userAnswerText}
                            </div>
                          </div>
                          <div className="p-2.5 rounded-lg bg-white border border-slate-200">
                            <div className="text-[11px] font-semibold text-slate-500 mb-0.5">
                              Đáp án chuẩn Certiport
                            </div>
                            <div className="font-semibold text-teal-800 whitespace-pre-wrap break-words">
                              {item.correctAnswerText}
                            </div>
                          </div>
                        </div>

                        {item.explanation && (
                          <div className="p-2.5 rounded-lg bg-amber-50/60 border border-amber-200 text-xs text-slate-700 whitespace-pre-wrap break-words">
                            <strong className="text-amber-900">Giải thích: </strong>
                            {item.explanation}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 7. MODAL BÁO CÁO IN KHỔ A4 */}
      {isPrintModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto"
          data-testid="practice-print-report-modal"
          onClick={() => setIsPrintModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl border border-slate-200 max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50 print:hidden">
              <h3 className="text-sm font-bold text-slate-900">
                Xem trước Báo cáo Kết quả Luyện thi (Khổ A4)
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold cursor-pointer"
                >
                  <Printer className="w-3.5 h-3.5" />
                  In / Lưu PDF
                </button>
                <button
                  type="button"
                  onClick={() => setIsPrintModalOpen(false)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-5 text-slate-900">
              <div className="border-b border-slate-300 pb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase text-teal-800">
                    Tổ Toán - Tin · Trường TH-THCS-THPT IGC Tây Ninh
                  </div>
                  <h2 className="text-xl font-extrabold mt-0.5">
                    Báo cáo Tổng hợp Kết quả Luyện thi Certiport GenAI
                  </h2>
                </div>
                <div className="text-right text-xs text-slate-500 tabular-nums">
                  Ngày xuất: {new Date().toLocaleDateString('vi-VN')}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 text-center border border-slate-200 rounded-lg p-3 tabular-nums">
                <div>
                  <div className="text-xs text-slate-500">Tổng lượt thi</div>
                  <div className="text-lg font-extrabold">
                    {filteredAnalytics.totalAttempts}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Tỉ lệ Đạt</div>
                  <div className="text-lg font-extrabold text-teal-800">
                    {filteredAnalytics.passRatePercent}%
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Điểm trung bình</div>
                  <div className="text-lg font-extrabold">
                    {filteredAnalytics.avgScore}/1000
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Điểm cao nhất</div>
                  <div className="text-lg font-extrabold">
                    {filteredAnalytics.maxScore}/1000
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-xs font-bold uppercase text-slate-600 mb-2">
                  Bảng tổng hợp theo học sinh ({filteredAnalytics.leaderboard.length}{' '}
                  học sinh)
                </h4>
                <div className="w-full overflow-x-auto -mx-1 px-1">
                  <table className="w-full text-left border-collapse text-xs tabular-nums">
                    <thead>
                      <tr className="border-y border-slate-300 bg-slate-50">
                        <th className="py-2 px-2">Hạng</th>
                        <th className="py-2 px-2">Học sinh</th>
                        <th className="py-2 px-2">Lớp</th>
                        <th className="py-2 px-2 text-right">Lượt thi</th>
                        <th className="py-2 px-2 text-right">Cao nhất</th>
                        <th className="py-2 px-2 text-right">Trung bình</th>
                        <th className="py-2 px-2 text-right">Đạt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {filteredAnalytics.leaderboard.map((st, idx) => (
                        <tr key={st.username}>
                          <td className="py-1.5 px-2 font-mono">#{idx + 1}</td>
                          <td className="py-1.5 px-2 font-semibold">
                            {st.fullName} (@{st.username})
                          </td>
                          <td className="py-1.5 px-2">{st.className}</td>
                          <td className="py-1.5 px-2 text-right">{st.attemptCount}</td>
                          <td className="py-1.5 px-2 text-right font-bold">
                            {st.bestScore}
                          </td>
                          <td className="py-1.5 px-2 text-right">{st.avgScore}</td>
                          <td className="py-1.5 px-2 text-right">
                            {st.passCount}/{st.attemptCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
