import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Download,
  FileSpreadsheet,
  Filter,
  GitCompare,
  HelpCircle,
  Info,
  Printer,
  Search,
  ShieldAlert,
  Table,
  Users,
  X,
} from 'lucide-react';
import { UserAccount } from '../types/exam';
import {
  ExamSessionRecord,
  SessionAttemptRecord,
  ViolationEventRecord,
} from '../types/examSession';
import { examSessionApi } from '../services/examSessionApi';
import {
  buildRawScoreTableRows,
  buildSessionQuestionAnalysis,
  buildSessionResultsExcelBytes,
  buildStudentDrawerDetail,
  compareTwoExamSessions,
  computeSessionClassAnalytics,
  filterAndSortStudentScoreRows,
  QuestionDifficultyGroup,
  RawScoreTableRow,
  ScoreHistogramBin,
  SessionComparisonSummary,
  SessionQuestionAnalysisItem,
  StudentTableSortField,
  StudentTableStatusFilter,
  TimeVsScoreScatterPoint,
  TopicOverviewBar,
  verifyAnalyticsAgainstRawScoreTable,
} from '../utils/sessionResultsAnalytics';

declare global {
  interface Window {
    __lastExportedSessionExcelBytes?: Uint8Array;
    __lastExportedSessionExcelFilename?: string;
  }
}

interface TeacherSessionResultsOverviewProps {
  currentUser?: UserAccount;
  session: ExamSessionRecord;
  attempts: SessionAttemptRecord[];
  violations?: ViolationEventRecord[];
  serverNowIso?: string;
  isSimulating?: boolean;
  onSimulateCohort?: (counts: {
    inProgressCount: number;
    submittedCount: number;
    notEnteredCount: number;
    label: string;
  }) => void;
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

function formatDurationMmSs(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  if (mins === 0) return `${secs}s`;
  return `${mins}p ${String(secs).padStart(2, '0')}s`;
}

export const TeacherSessionResultsOverview: React.FC<
  TeacherSessionResultsOverviewProps
> = ({
  currentUser,
  session,
  attempts,
  violations = [],
  serverNowIso,
  isSimulating = false,
  onSimulateCohort,
}) => {
  // Bộ lọc khoảng điểm từ Histogram (7A -> liên kết bảng học sinh 7B)
  const [selectedScoreBinIndex, setSelectedScoreBinIndex] = useState<
    number | null
  >(null);
  const [hoveredBin, setHoveredBin] = useState<ScoreHistogramBin | null>(null);
  const [hoveredPassFailSegment, setHoveredPassFailSegment] = useState<
    'pass' | 'fail' | null
  >(null);
  const [hoveredTopic, setHoveredTopic] = useState<TopicOverviewBar | null>(
    null
  );
  const [activeScatterPoint, setActiveScatterPoint] =
    useState<TimeVsScoreScatterPoint | null>(null);
  const [showAccessibleTables, setShowAccessibleTables] =
    useState<boolean>(false);

  // State cho mục 1 (7B): Phân tích từng câu hỏi + Drawer câu hỏi
  const [difficultyFilter, setDifficultyFilter] = useState<
    'all' | QuestionDifficultyGroup
  >('all');
  const [selectedQuestionForDrawer, setSelectedQuestionForDrawer] =
    useState<SessionQuestionAnalysisItem | null>(null);

  // State cho mục 2 (7B): Bảng học sinh chính (lọc trạng thái, tìm kiếm, sắp xếp)
  const [studentStatusFilter, setStudentStatusFilter] =
    useState<StudentTableStatusFilter>('all');
  const [studentSearchQuery, setStudentSearchQuery] = useState<string>('');
  const [studentSortField, setStudentSortField] =
    useState<StudentTableSortField>('rank');
  const [studentSortDirection, setStudentSortDirection] = useState<
    'asc' | 'desc'
  >('asc');

  // State cho mục 3 (7B): Drawer chi tiết học sinh
  const [selectedStudentRowForDrawer, setSelectedStudentRowForDrawer] =
    useState<RawScoreTableRow | null>(null);

  // State cho mục 4 (7B): Báo cáo PDF khổ A4 & thông báo xuất Excel
  const [isPdfReportOpen, setIsPdfReportOpen] = useState<boolean>(false);
  const [exportBannerText, setExportBannerText] = useState<string | null>(null);

  // State cho mục 5 (7B - Tùy chọn): So sánh 2 ca thi
  const [otherSessions, setOtherSessions] = useState<ExamSessionRecord[]>([]);
  const [compareTargetSessionId, setCompareTargetSessionId] =
    useState<string>('');
  const [comparisonSummary, setComparisonSummary] =
    useState<SessionComparisonSummary | null>(null);
  const [isLoadingCompare, setIsLoadingCompare] = useState<boolean>(false);

  const rawRows = useMemo(
    () => buildRawScoreTableRows(attempts, session, serverNowIso),
    [attempts, session, serverNowIso]
  );

  const analytics = useMemo(
    () => computeSessionClassAnalytics(rawRows, session),
    [rawRows, session]
  );

  const reconciliation = useMemo(
    () =>
      verifyAnalyticsAgainstRawScoreTable(
        analytics,
        rawRows,
        session.passScore
      ),
    [analytics, rawRows, session.passScore]
  );

  const questionAnalysis = useMemo(
    () => buildSessionQuestionAnalysis(rawRows),
    [rawRows]
  );

  const filteredQuestions = useMemo(() => {
    if (difficultyFilter === 'all') return questionAnalysis;
    return questionAnalysis.filter(
      (q) => q.difficultyGroup === difficultyFilter
    );
  }, [questionAnalysis, difficultyFilter]);

  const difficultyCounts = useMemo(() => {
    let hard = 0;
    let medium = 0;
    let easy = 0;
    for (const q of questionAnalysis) {
      if (q.difficultyGroup === 'hard') hard += 1;
      else if (q.difficultyGroup === 'medium') medium += 1;
      else easy += 1;
    }
    return { hard, medium, easy };
  }, [questionAnalysis]);

  const filteredStudentRows = useMemo(
    () =>
      filterAndSortStudentScoreRows({
        rows: rawRows,
        selectedBinIndex: selectedScoreBinIndex,
        statusFilter: studentStatusFilter,
        searchQuery: studentSearchQuery,
        sortField: studentSortField,
        sortDirection: studentSortDirection,
      }),
    [
      rawRows,
      selectedScoreBinIndex,
      studentStatusFilter,
      studentSearchQuery,
      studentSortField,
      studentSortDirection,
    ]
  );

  const studentStatusCounts = useMemo(() => {
    const passed = rawRows.filter((r) => r.passed).length;
    const failed = rawRows.length - passed;
    const violationSubmitted = rawRows.filter(
      (r) => r.submitReason === 'violation'
    ).length;
    return {
      all: rawRows.length,
      passed,
      failed,
      violationSubmitted,
    };
  }, [rawRows]);

  const activeStudentDrawerData = useMemo(() => {
    if (!selectedStudentRowForDrawer) return null;
    const latestRow =
      rawRows.find(
        (r) => r.attemptId === selectedStudentRowForDrawer.attemptId
      ) ?? selectedStudentRowForDrawer;
    return buildStudentDrawerDetail(latestRow, analytics, violations);
  }, [selectedStudentRowForDrawer, rawRows, analytics, violations]);

  const activeQuestionDrawerData = useMemo(() => {
    if (!selectedQuestionForDrawer) return null;
    return (
      questionAnalysis.find(
        (q) => q.questionId === selectedQuestionForDrawer.questionId
      ) ?? selectedQuestionForDrawer
    );
  }, [selectedQuestionForDrawer, questionAnalysis]);

  const selectedBinObj =
    selectedScoreBinIndex !== null
      ? analytics.histogram.bins[selectedScoreBinIndex] ?? null
      : null;

  // Tải danh sách các ca thi khác của giáo viên để phục vụ mục 5: So sánh 2 ca thi
  useEffect(() => {
    if (!currentUser) return;
    const teacherId = currentUser.id || currentUser.username;
    let mounted = true;
    examSessionApi
      .listSessions(teacherId)
      .then((res) => {
        if (!mounted) return;
        const list = Array.isArray(res?.sessions) ? res.sessions : [];
        const others = list.filter((s) => s.id !== session.id);
        setOtherSessions(others);
      })
      .catch(() => {
        // Bỏ qua nếu không tải được danh sách so sánh
      });
    return () => {
      mounted = false;
    };
  }, [currentUser, session.id]);

  // Khi giáo viên chọn 1 ca thi để so sánh
  useEffect(() => {
    if (!compareTargetSessionId || !currentUser) {
      setComparisonSummary(null);
      return;
    }
    const teacherId = currentUser.id || currentUser.username;
    let mounted = true;
    setIsLoadingCompare(true);
    examSessionApi
      .getSessionDetail(teacherId, compareTargetSessionId)
      .then((targetDetail) => {
        if (!mounted) return;
        const targetRows = buildRawScoreTableRows(
          targetDetail.attempts || [],
          targetDetail.session,
          targetDetail.serverNow
        );
        const targetAnalytics = computeSessionClassAnalytics(
          targetRows,
          targetDetail.session
        );
        setComparisonSummary(
          compareTwoExamSessions({
            currentSession: session,
            currentAnalytics: analytics,
            targetSession: targetDetail.session,
            targetAnalytics,
          })
        );
      })
      .catch(() => {
        if (mounted) setComparisonSummary(null);
      })
      .finally(() => {
        if (mounted) setIsLoadingCompare(false);
      });
    return () => {
      mounted = false;
    };
  }, [compareTargetSessionId, currentUser, session, analytics]);

  // Đóng Drawer / Modal bằng phím Esc
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (selectedQuestionForDrawer) {
          setSelectedQuestionForDrawer(null);
        } else if (selectedStudentRowForDrawer) {
          setSelectedStudentRowForDrawer(null);
        } else if (isPdfReportOpen) {
          setIsPdfReportOpen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectedQuestionForDrawer,
    selectedStudentRowForDrawer,
    isPdfReportOpen,
  ]);

  const handleToggleBinFilter = (binIndex: number) => {
    setSelectedScoreBinIndex((prev) => (prev === binIndex ? null : binIndex));
  };

  const handleSortColumn = (field: StudentTableSortField) => {
    if (studentSortField === field) {
      setStudentSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setStudentSortField(field);
      setStudentSortDirection(field === 'rank' || field === 'name' ? 'asc' : 'desc');
    }
  };

  const handleExportExcel = () => {
    const bytes = buildSessionResultsExcelBytes({
      session,
      rawRows,
      questionAnalysis,
      violations,
    });
    const filename = `Ket_Qua_Ca_Thi_${session.code}_${rawRows.length}_HS.xlsx`;
    window.__lastExportedSessionExcelBytes = bytes;
    window.__lastExportedSessionExcelFilename = filename;

    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);

    setExportBannerText(
      `Đã xuất tệp Excel "${filename}" gồm 3 sheet: Bảng điểm (${rawRows.length} dòng), Phân tích câu hỏi (${questionAnalysis.length} câu), Nhật ký vi phạm (${violations.length} sự kiện).`
    );
  };

  const renderSortIcon = (field: StudentTableSortField) => {
    if (studentSortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-400 inline ml-1" />;
    }
    return studentSortDirection === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-teal-800 inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-teal-800 inline ml-1" />
    );
  };

  const hardestFiveQuestions = useMemo(
    () => questionAnalysis.slice(0, 5),
    [questionAnalysis]
  );

  const failedStudentsList = useMemo(
    () => rawRows.filter((r) => !r.passed),
    [rawRows]
  );

  return (
    <div
      className="space-y-6"
      data-testid="teacher-session-results-overview"
      data-reconciliation-matches={reconciliation.matches ? 'true' : 'false'}
    >
      {/* Thanh trạng thái & Xuất dữ liệu đầu tab Kết quả */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 print:hidden">
        <div className="flex flex-wrap items-center gap-2.5">
          {analytics.isProvisional ? (
            <span
              data-testid="results-provisional-banner"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-50 border border-teal-300 text-teal-900 text-xs font-bold"
            >
              <AlertCircle className="w-3.5 h-3.5 text-teal-700 shrink-0" />
              Số liệu tạm thời
            </span>
          ) : (
            <span
              data-testid="results-final-banner"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-teal-900 text-white text-xs font-bold"
            >
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              Số liệu chính thức
            </span>
          )}

          <span
            data-testid="results-reconciliation-badge"
            className="text-xs text-slate-500 tabular-nums"
          >
            {reconciliation.matches
              ? `Khớp 100% bảng điểm gốc (${rawRows.length} bài thi)`
              : `Cảnh báo lệch số liệu (${reconciliation.discrepancies.length})`}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onSimulateCohort && (
            <div
              className="inline-flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs"
              role="group"
              aria-label="Bộ dữ liệu kiểm thử nhanh"
            >
              <button
                type="button"
                disabled={isSimulating}
                onClick={() => {
                  setSelectedScoreBinIndex(null);
                  onSimulateCohort({
                    inProgressCount: 0,
                    submittedCount: 0,
                    notEnteredCount: 0,
                    label: '0 học sinh',
                  });
                }}
                data-testid="results-sim-0-btn"
                className="px-2 py-1 rounded-md font-semibold text-slate-600 hover:bg-white hover:text-teal-800 cursor-pointer disabled:opacity-50"
              >
                0 HS
              </button>
              <button
                type="button"
                disabled={isSimulating}
                onClick={() => {
                  setSelectedScoreBinIndex(null);
                  onSimulateCohort({
                    inProgressCount: 0,
                    submittedCount: 1,
                    notEnteredCount: 0,
                    label: '1 học sinh',
                  });
                }}
                data-testid="results-sim-1-btn"
                className="px-2 py-1 rounded-md font-semibold text-slate-600 hover:bg-white hover:text-teal-800 cursor-pointer disabled:opacity-50"
              >
                1 HS
              </button>
              <button
                type="button"
                disabled={isSimulating}
                onClick={() => {
                  setSelectedScoreBinIndex(null);
                  onSimulateCohort({
                    inProgressCount: 32,
                    submittedCount: 5,
                    notEnteredCount: 3,
                    label: '40 học sinh',
                  });
                }}
                data-testid="results-sim-40-btn"
                className="px-2 py-1 rounded-md font-semibold text-slate-600 hover:bg-white hover:text-teal-800 cursor-pointer disabled:opacity-50"
              >
                40 HS
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowAccessibleTables((prev) => !prev)}
            aria-expanded={showAccessibleTables}
            data-testid="toggle-accessible-tables-btn"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer ${
              showAccessibleTables
                ? 'bg-teal-800 text-white border-teal-800'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <Table className="w-3.5 h-3.5" />
            {showAccessibleTables
              ? 'Ẩn bảng số liệu thay thế'
              : 'Bảng số liệu thay thế'}
          </button>

          {/* 4) Nút Xuất PDF khổ A4 & Xuất Excel 3 sheet */}
          <button
            type="button"
            onClick={() => setIsPdfReportOpen(true)}
            data-testid="export-pdf-a4-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-teal-700 text-teal-800 hover:bg-teal-50 text-xs font-bold transition-colors cursor-pointer"
          >
            <Printer className="w-3.5 h-3.5" />
            Xuất PDF
          </button>

          <button
            type="button"
            onClick={handleExportExcel}
            data-testid="export-excel-3sheets-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Xuất Excel
          </button>
        </div>
      </div>

      {exportBannerText && (
        <div
          data-testid="export-excel-success-banner"
          className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-lg bg-teal-50 border border-teal-200 text-xs font-semibold text-teal-900 print:hidden"
        >
          <span>{exportBannerText}</span>
          <button
            type="button"
            onClick={() => setExportBannerText(null)}
            className="p-1 text-teal-700 hover:text-teal-950 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1) HÀNG CHỈ SỐ ĐẦU TRANG (KHÔNG THẺ, SỐ LỚN NHÃN NHỎ) */}
      <section
        aria-label="Chỉ số tổng quan ca thi"
        data-testid="results-kpi-strip"
        className="border-y border-slate-200 py-4 px-1 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-y-4 gap-x-6"
      >
        <div data-testid="kpi-participants">
          <div
            data-testid="kpi-participants-value"
            className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums tracking-tight"
          >
            {analytics.kpis.participantCount}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-0.5">
            Số thí sinh
          </div>
        </div>

        <div
          data-testid="kpi-average-score"
          className="sm:border-l sm:border-slate-200 sm:pl-5"
        >
          <div
            data-testid="kpi-average-score-value"
            className="text-2xl sm:text-3xl font-black text-teal-800 tabular-nums tracking-tight"
          >
            {analytics.kpis.averageScore}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-0.5">
            Điểm trung bình
          </div>
        </div>

        <div
          data-testid="kpi-median-score"
          className="lg:border-l lg:border-slate-200 lg:pl-5"
        >
          <div
            data-testid="kpi-median-score-value"
            className="text-2xl sm:text-3xl font-black text-slate-900 tabular-nums tracking-tight"
          >
            {analytics.kpis.medianScore}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-0.5">
            Điểm trung vị
          </div>
        </div>

        <div
          data-testid="kpi-highest-score"
          className="sm:border-l sm:border-slate-200 sm:pl-5"
        >
          <div
            data-testid="kpi-highest-score-value"
            className="text-2xl sm:text-3xl font-black text-teal-900 tabular-nums tracking-tight"
          >
            {analytics.kpis.highestScore}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-0.5">
            Điểm cao nhất
          </div>
        </div>

        <div
          data-testid="kpi-lowest-score"
          className="sm:border-l sm:border-slate-200 sm:pl-5"
        >
          <div
            data-testid="kpi-lowest-score-value"
            className="text-2xl sm:text-3xl font-black text-slate-700 tabular-nums tracking-tight"
          >
            {analytics.kpis.lowestScore}
          </div>
          <div className="text-xs font-medium text-slate-500 mt-0.5">
            Điểm thấp nhất
          </div>
        </div>

        <div
          data-testid="kpi-pass-rate"
          className="sm:border-l sm:border-slate-200 sm:pl-5"
        >
          <div
            data-testid="kpi-pass-rate-value"
            className="text-2xl sm:text-3xl font-black text-teal-700 tabular-nums tracking-tight"
          >
            {analytics.kpis.passRatePercent}%
          </div>
          <div className="text-xs font-medium text-slate-500 mt-0.5">
            Tỉ lệ đạt (≥{session.passScore})
          </div>
        </div>
      </section>

      {/* Lưới biểu đồ 7A: Phổ điểm (2) + Đạt & Không đạt (3) + Theo chuyên đề (4) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* 2) PHỔ ĐIỂM: HISTOGRAM 10 KHOẢNG 100 ĐIỂM (0–100, ..., 900–1000) */}
        <section
          aria-label="Biểu đồ phổ điểm theo khoảng 100 điểm"
          data-testid="chart-score-histogram"
          className="lg:col-span-7 bg-white rounded-xl border border-slate-200 p-4 sm:p-5 flex flex-col justify-between"
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Phổ điểm (0–1000)
                </h3>
                <p className="text-xs text-slate-500">
                  Bấm một cột để lọc bảng học sinh bên dưới theo khoảng điểm
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                <span className="inline-flex items-center gap-1.5 font-semibold text-teal-900">
                  <span className="w-3 h-0.5 bg-teal-900 inline-block" />
                  Đạt ({session.passScore})
                </span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-teal-600">
                  <span className="w-3 h-0 border-t-2 border-dashed border-teal-600 inline-block" />
                  TB ({analytics.kpis.averageScore})
                </span>
                {selectedScoreBinIndex !== null && (
                  <button
                    type="button"
                    onClick={() => setSelectedScoreBinIndex(null)}
                    data-testid="clear-histogram-filter-btn"
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-teal-50 border border-teal-300 text-teal-900 font-bold hover:bg-teal-100 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                    Bỏ lọc ({selectedBinObj?.label})
                  </button>
                )}
              </div>
            </div>

            <div
              data-testid="histogram-tooltip-box"
              className="min-h-[28px] mb-2 px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs text-slate-700 flex flex-wrap items-center justify-between gap-2"
            >
              {hoveredBin ? (
                <>
                  <span className="font-bold text-slate-900">
                    Khoảng {hoveredBin.label} điểm ({hoveredBin.rangeText})
                  </span>
                  <span className="font-semibold text-teal-800 tabular-nums">
                    {hoveredBin.count} học sinh ({hoveredBin.percentage}%) •{' '}
                    {hoveredBin.minScore >= session.passScore
                      ? 'Vùng Đạt'
                      : 'Vùng Chưa đạt'}
                  </span>
                </>
              ) : selectedBinObj ? (
                <>
                  <span className="font-bold text-teal-900">
                    Đang lọc khoảng {selectedBinObj.label} điểm
                  </span>
                  <span className="font-semibold text-teal-800 tabular-nums">
                    {selectedBinObj.count} học sinh ({selectedBinObj.percentage}
                    %)
                  </span>
                </>
              ) : (
                <span className="text-slate-500">
                  Di chuột hoặc dùng phím Tab vào cột để xem chi tiết từng khoảng
                  100 điểm
                </span>
              )}
            </div>

            <div className="relative pt-7 pb-2 px-1">
              <div className="relative h-44 border-b border-slate-300 grid grid-cols-10 gap-1 sm:gap-2 items-end">
                <div
                  data-testid="histogram-pass-line"
                  style={{ left: `${analytics.histogram.passScoreLinePercent}%` }}
                  className="pointer-events-none absolute top-0 bottom-0 z-20 border-l-2 border-teal-950"
                >
                  <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded bg-teal-950 text-white text-[10px] font-bold tabular-nums">
                    Đạt {session.passScore}
                  </span>
                </div>

                {analytics.kpis.participantCount > 0 && (
                  <div
                    data-testid="histogram-avg-line"
                    style={{
                      left: `${analytics.histogram.averageScoreLinePercent}%`,
                    }}
                    className="pointer-events-none absolute top-0 bottom-0 z-10 border-l-2 border-dashed border-teal-600"
                  >
                    <span className="absolute -top-6 -translate-x-1/2 whitespace-nowrap px-1.5 py-0.5 rounded bg-teal-50 border border-teal-400 text-teal-900 text-[10px] font-bold tabular-nums">
                      TB {analytics.kpis.averageScore}
                    </span>
                  </div>
                )}

                {analytics.histogram.bins.map((bin) => {
                  const heightPercent =
                    bin.count > 0
                      ? Math.max(
                          12,
                          Math.round(
                            (bin.count / analytics.histogram.maxBinCount) * 100
                          )
                        )
                      : 4;
                  const isSelected = selectedScoreBinIndex === bin.binIndex;
                  const isPassBin = bin.minScore >= session.passScore;

                  return (
                    <button
                      key={bin.binIndex}
                      type="button"
                      onClick={() => handleToggleBinFilter(bin.binIndex)}
                      onMouseEnter={() => setHoveredBin(bin)}
                      onMouseLeave={() => setHoveredBin(null)}
                      onFocus={() => setHoveredBin(bin)}
                      onBlur={() => setHoveredBin(null)}
                      aria-pressed={isSelected}
                      aria-label={`Khoảng điểm ${bin.label}: ${bin.count} học sinh (${bin.percentage}%). Bấm để lọc bảng học sinh.`}
                      data-testid={`histogram-bar-${bin.binIndex}`}
                      data-bin-count={bin.count}
                      className={`group relative h-full flex flex-col justify-end items-center focus:outline-none cursor-pointer rounded-t transition-opacity ${
                        selectedScoreBinIndex !== null && !isSelected
                          ? 'opacity-45 hover:opacity-80'
                          : 'opacity-100'
                      }`}
                    >
                      <span className="text-[11px] font-bold text-slate-700 tabular-nums mb-1">
                        {bin.count > 0 ? bin.count : ''}
                      </span>
                      <div
                        style={{ height: `${heightPercent}%` }}
                        className={`w-full rounded-t transition-all border ${
                          isSelected
                            ? 'bg-teal-900 border-teal-950 ring-2 ring-teal-500 ring-offset-1'
                            : bin.count === 0
                              ? 'bg-slate-100 border-slate-200'
                              : isPassBin
                                ? 'bg-teal-700 border-teal-800 group-hover:bg-teal-800'
                                : 'bg-teal-300/80 border-teal-500 group-hover:bg-teal-400'
                        }`}
                      />
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-10 gap-1 sm:gap-2 pt-2 text-center">
                {analytics.histogram.bins.map((bin) => {
                  const isSelected = selectedScoreBinIndex === bin.binIndex;
                  return (
                    <div
                      key={bin.binIndex}
                      className={`text-[10px] sm:text-[11px] tabular-nums leading-tight truncate ${
                        isSelected
                          ? 'font-black text-teal-900 underline'
                          : 'font-medium text-slate-600'
                      }`}
                      title={`Khoảng ${bin.label} điểm`}
                    >
                      {bin.minScore === 900 ? '900–1k' : bin.label}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div
            className={
              showAccessibleTables
                ? 'mt-4 pt-3 border-t border-slate-200'
                : 'sr-only'
            }
          >
            <div
              tabIndex={0}
              role="region"
              aria-label="Bảng số liệu thay thế cho biểu đồ Phổ điểm"
              data-testid="histogram-fallback-table-wrapper"
              className="overflow-x-auto focus:outline-none focus:ring-2 focus:ring-teal-600 rounded-lg"
            >
              <table
                data-testid="histogram-fallback-table"
                aria-label="Bảng số liệu phổ điểm theo khoảng 100 điểm"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                    <th className="py-1.5 px-2">Khoảng điểm</th>
                    <th className="py-1.5 px-2 text-right">Số thí sinh</th>
                    <th className="py-1.5 px-2 text-right">Tỉ lệ</th>
                    <th className="py-1.5 px-2">Nhóm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.histogram.bins.map((b) => (
                    <tr key={b.binIndex}>
                      <td className="py-1 px-2 font-medium text-slate-800 tabular-nums">
                        {b.label}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums font-semibold">
                        {b.count}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {b.percentage}%
                      </td>
                      <td className="py-1 px-2 text-slate-600">
                        {b.minScore >= session.passScore ? 'Đạt' : 'Chưa đạt'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* CỘT PHẢI: (3) ĐẠT VÀ KHÔNG ĐẠT + (4) THEO CHUYÊN ĐỀ */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          <section
            aria-label="Tỉ lệ Đạt và Không đạt"
            data-testid="chart-pass-fail-stacked-bar"
            className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-slate-900">
                Đạt và không đạt
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">
                Chuẩn đạt: {session.passScore}/1000
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div
                data-testid="pass-segment-summary"
                className="p-2.5 rounded-lg bg-teal-50/70 border border-teal-200 flex items-center justify-between"
              >
                <span className="inline-flex items-center gap-1.5 font-bold text-teal-950">
                  <span className="w-2.5 h-2.5 rounded-xs bg-teal-800 inline-block" />
                  Đạt
                </span>
                <span className="font-black text-teal-900 tabular-nums">
                  {analytics.passFailBar.passCount} HS (
                  {analytics.passFailBar.passRatePercent}%)
                </span>
              </div>

              <div
                data-testid="fail-segment-summary"
                className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between"
              >
                <span className="inline-flex items-center gap-1.5 font-bold text-slate-700">
                  <span className="w-2.5 h-2.5 rounded-xs bg-teal-200 border border-teal-600 inline-block" />
                  Chưa đạt
                </span>
                <span className="font-black text-slate-800 tabular-nums">
                  {analytics.passFailBar.failCount} HS (
                  {analytics.passFailBar.failRatePercent}%)
                </span>
              </div>
            </div>

            <div
              role="img"
              aria-label={`Thanh xếp chồng ngang: Đạt ${analytics.passFailBar.passCount} học sinh (${analytics.passFailBar.passRatePercent}%), Không đạt ${analytics.passFailBar.failCount} học sinh (${analytics.passFailBar.failRatePercent}%).`}
              className="w-full h-7 rounded-lg bg-slate-100 border border-slate-300 overflow-hidden flex"
            >
              {analytics.kpis.participantCount === 0 ? (
                <div className="w-full h-full flex items-center justify-center text-[11px] font-medium text-slate-400">
                  Chưa có thí sinh
                </div>
              ) : (
                <>
                  {analytics.passFailBar.passCount > 0 && (
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredPassFailSegment('pass')}
                      onMouseLeave={() => setHoveredPassFailSegment(null)}
                      onFocus={() => setHoveredPassFailSegment('pass')}
                      onBlur={() => setHoveredPassFailSegment(null)}
                      style={{
                        width: `${analytics.passFailBar.passRatePercent}%`,
                      }}
                      data-testid="stacked-bar-pass-segment"
                      aria-label={`Đạt: ${analytics.passFailBar.passCount} học sinh (${analytics.passFailBar.passRatePercent}%)`}
                      className="h-full bg-teal-800 hover:bg-teal-900 text-white text-[11px] font-bold tabular-nums flex items-center justify-center overflow-hidden transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {analytics.passFailBar.passRatePercent >= 14
                        ? `${analytics.passFailBar.passRatePercent}%`
                        : ''}
                    </button>
                  )}
                  {analytics.passFailBar.failCount > 0 && (
                    <button
                      type="button"
                      onMouseEnter={() => setHoveredPassFailSegment('fail')}
                      onMouseLeave={() => setHoveredPassFailSegment(null)}
                      onFocus={() => setHoveredPassFailSegment('fail')}
                      onBlur={() => setHoveredPassFailSegment(null)}
                      style={{
                        width: `${analytics.passFailBar.failRatePercent}%`,
                      }}
                      data-testid="stacked-bar-fail-segment"
                      aria-label={`Không đạt: ${analytics.passFailBar.failCount} học sinh (${analytics.passFailBar.failRatePercent}%)`}
                      className="h-full bg-teal-200 hover:bg-teal-300 text-teal-950 border-l-2 border-white text-[11px] font-bold tabular-nums flex items-center justify-center overflow-hidden transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-600"
                    >
                      {analytics.passFailBar.failRatePercent >= 14
                        ? `${analytics.passFailBar.failRatePercent}%`
                        : ''}
                    </button>
                  )}
                </>
              )}
            </div>

            <div
              data-testid="passfail-tooltip-box"
              className="text-xs text-slate-600 min-h-[20px]"
            >
              {hoveredPassFailSegment === 'pass' ? (
                <span className="font-semibold text-teal-900">
                  Đạt chuẩn (≥{session.passScore} điểm):{' '}
                  {analytics.passFailBar.passCount}/
                  {analytics.kpis.participantCount} học sinh (
                  {analytics.passFailBar.passRatePercent}%)
                </span>
              ) : hoveredPassFailSegment === 'fail' ? (
                <span className="font-semibold text-slate-800">
                  Không đạt (&lt;{session.passScore} điểm):{' '}
                  {analytics.passFailBar.failCount}/
                  {analytics.kpis.participantCount} học sinh (
                  {analytics.passFailBar.failRatePercent}%)
                </span>
              ) : (
                <span className="text-slate-500">
                  Tổng số: {analytics.kpis.participantCount} thí sinh dự thi
                </span>
              )}
            </div>

            <div
              className={
                showAccessibleTables
                  ? 'pt-2 border-t border-slate-200'
                  : 'sr-only'
              }
            >
              <table
                tabIndex={0}
                data-testid="passfail-fallback-table"
                aria-label="Bảng số liệu Đạt và Không đạt"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                    <th className="py-1 px-2">Phân loại</th>
                    <th className="py-1 px-2 text-right">Số học sinh</th>
                    <th className="py-1 px-2 text-right">Phần trăm</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  <tr>
                    <td className="py-1 px-2 font-medium">
                      Đạt (≥{session.passScore})
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-semibold">
                      {analytics.passFailBar.passCount}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      {analytics.passFailBar.passRatePercent}%
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1 px-2 font-medium">
                      Không đạt (&lt;{session.passScore})
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-semibold">
                      {analytics.passFailBar.failCount}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      {analytics.passFailBar.failRatePercent}%
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section
            aria-label="Tỉ lệ đúng theo 4 chuyên đề Certiport"
            data-testid="chart-topic-accuracy"
            className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-3 flex-1 flex flex-col justify-between"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-slate-900">
                  Theo chuyên đề
                </h3>
                <span
                  data-testid="weakest-topic-summary-line"
                  className="text-xs font-bold text-teal-900 bg-teal-50 border border-teal-300 px-2.5 py-1 rounded-md"
                >
                  {analytics.topics.weakestSummaryLine}
                </span>
              </div>

              <div className="space-y-2.5">
                {analytics.topics.bars.map((bar, idx) => {
                  const isWeakest = bar.isWeakest;
                  return (
                    <div
                      key={bar.topic}
                      onMouseEnter={() => setHoveredTopic(bar)}
                      onMouseLeave={() => setHoveredTopic(null)}
                      onFocus={() => setHoveredTopic(bar)}
                      onBlur={() => setHoveredTopic(null)}
                      tabIndex={0}
                      data-testid={`topic-bar-row-${idx + 1}`}
                      data-is-weakest={isWeakest ? 'true' : 'false'}
                      aria-label={`${bar.shortLabel}: đúng ${bar.accuracyPercent}% (${bar.correctCount}/${bar.totalCount} câu)${isWeakest ? ' - Chuyên đề yếu nhất' : ''}`}
                      className={`p-2 rounded-lg border transition-colors focus:outline-none focus:ring-2 focus:ring-teal-600 ${
                        isWeakest
                          ? 'bg-teal-50/80 border-teal-600 ring-1 ring-teal-600/30'
                          : 'bg-white border-slate-200/80 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                        <span className="font-bold text-slate-900 flex items-center gap-1.5">
                          <span>{bar.shortLabel}</span>
                          {isWeakest && (
                            <span
                              data-testid="weakest-topic-badge"
                              className="px-1.5 py-0.5 rounded bg-teal-900 text-white text-[10px] font-bold uppercase tracking-wider"
                            >
                              Yếu nhất
                            </span>
                          )}
                        </span>
                        <span className="font-black text-teal-900 tabular-nums">
                          {bar.accuracyPercent}%
                        </span>
                      </div>

                      <div className="w-full h-2.5 bg-slate-100 rounded-full overflow-hidden border border-slate-200">
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, bar.accuracyPercent))}%`,
                          }}
                          className={`h-full rounded-full transition-all ${
                            isWeakest ? 'bg-teal-500' : 'bg-teal-800'
                          }`}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                data-testid="topic-tooltip-box"
                className="text-xs text-slate-600 min-h-[18px]"
              >
                {hoveredTopic ? (
                  <span className="font-semibold text-teal-900 tabular-nums">
                    {hoveredTopic.shortLabel}: trả lời đúng{' '}
                    {hoveredTopic.correctCount}/{hoveredTopic.totalCount} câu (
                    {hoveredTopic.accuracyPercent}%)
                  </span>
                ) : (
                  <span className="text-slate-500">
                    Chạm hoặc di chuột vào thanh chuyên đề để xem tổng số câu
                    đúng của lớp
                  </span>
                )}
              </div>
            </div>

            <div
              className={
                showAccessibleTables
                  ? 'mt-3 pt-2 border-t border-slate-200'
                  : 'sr-only'
              }
            >
              <table
                tabIndex={0}
                data-testid="topics-fallback-table"
                aria-label="Bảng số liệu tỉ lệ đúng theo 4 chuyên đề"
                className="w-full text-left border-collapse text-xs"
              >
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                    <th className="py-1 px-2">Chuyên đề</th>
                    <th className="py-1 px-2 text-right">Câu đúng / Tổng</th>
                    <th className="py-1 px-2 text-right">Tỉ lệ đúng</th>
                    <th className="py-1 px-2">Đánh giá</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.topics.bars.map((b) => (
                    <tr key={b.topic}>
                      <td className="py-1 px-2 font-medium text-slate-800">
                        {b.shortLabel}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums">
                        {b.correctCount}/{b.totalCount}
                      </td>
                      <td className="py-1 px-2 text-right tabular-nums font-bold">
                        {b.accuracyPercent}%
                      </td>
                      <td className="py-1 px-2">
                        {b.isWeakest ? 'Yếu nhất' : 'Bình thường'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>

      {/* 5) THỜI GIAN LÀM BÀI SO VỚI ĐIỂM: BIỂU ĐỒ PHÂN TÁN (SCATTER PLOT) */}
      <section
        aria-label="Biểu đồ phân tán thời gian làm bài so với điểm số"
        data-testid="chart-time-vs-score-scatter"
        className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Thời gian làm bài so với điểm
            </h3>
            <p className="text-xs text-slate-500">
              Mỗi chấm là 1 học sinh • Phát hiện nhóm làm quá nhanh điểm thấp (
              {analytics.scatter.fastLowScoreCount}) và nhóm làm hết giờ (
              {analytics.scatter.nearTimeoutCount})
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="w-2.5 h-2.5 rotate-45 bg-teal-300 border-2 border-teal-950 inline-block" />
              Làm nhanh, điểm thấp ({analytics.scatter.fastLowScoreCount})
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="w-2.5 h-2.5 bg-teal-500 border-2 border-teal-950 inline-block" />
              Làm hết giờ ({analytics.scatter.nearTimeoutCount})
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-teal-800 inline-block" />
              Đạt chuẩn
            </span>
            <span className="inline-flex items-center gap-1.5 font-semibold">
              <span className="w-2.5 h-2.5 rounded-full bg-white border-2 border-teal-700 inline-block" />
              Chưa đạt
            </span>
          </div>
        </div>

        <div
          data-testid="scatter-tooltip-box"
          className="min-h-[30px] px-3 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs flex flex-wrap items-center justify-between gap-2"
        >
          {activeScatterPoint ? (
            <>
              <span className="font-bold text-slate-900">
                {activeScatterPoint.fullName} (@{activeScatterPoint.username}) •
                Lớp {activeScatterPoint.className}
              </span>
              <span className="font-bold text-teal-900 tabular-nums">
                {activeScatterPoint.score} điểm •{' '}
                {activeScatterPoint.durationMinutes} phút •{' '}
                <span className="underline">
                  {activeScatterPoint.categoryLabel}
                </span>
              </span>
            </>
          ) : (
            <span className="text-slate-500">
              Di chuột hoặc nhấn phím Tab vào từng điểm để xem tên học sinh,
              điểm số và thời gian làm bài
            </span>
          )}
        </div>

        <div className="relative pl-10 pr-3 pt-3 pb-7">
          <div className="pointer-events-none absolute left-0 top-3 bottom-7 w-9 flex flex-col justify-between text-right pr-1.5 text-[10px] font-semibold text-slate-500 tabular-nums">
            <span>1000</span>
            <span>{session.passScore}</span>
            <span>500</span>
            <span>0</span>
          </div>

          <div
            data-testid="scatter-plot-canvas"
            className="relative h-56 w-full border-l border-b border-slate-300 bg-slate-50/40 rounded-tr-lg overflow-visible"
          >
            <div
              style={{
                width: `${Math.min(
                  100,
                  (analytics.scatter.fastThresholdMinutes /
                    analytics.scatter.maxDurationMinutes) *
                    100
                )}%`,
                height: `${Math.min(100, (session.passScore / 1000) * 100)}%`,
              }}
              className="pointer-events-none absolute left-0 bottom-0 bg-teal-100/45 border-t border-r border-dashed border-teal-400 flex items-end justify-start p-1.5"
            >
              <span className="text-[10px] font-bold text-teal-900 bg-white/80 px-1.5 py-0.5 rounded">
                Làm quá nhanh, điểm thấp (≤
                {analytics.scatter.fastThresholdMinutes}p)
              </span>
            </div>

            <div
              style={{
                left: `${Math.min(
                  95,
                  (analytics.scatter.timeoutThresholdMinutes /
                    analytics.scatter.maxDurationMinutes) *
                    100
                )}%`,
              }}
              className="pointer-events-none absolute top-0 bottom-0 right-0 bg-teal-50/60 border-l border-dashed border-teal-500 flex items-start justify-end p-1.5"
            >
              <span className="text-[10px] font-bold text-teal-900 bg-white/80 px-1.5 py-0.5 rounded">
                Sát / hết giờ (≥{analytics.scatter.timeoutThresholdMinutes}p)
              </span>
            </div>

            <div
              style={{
                bottom: `${Math.min(100, (session.passScore / 1000) * 100)}%`,
              }}
              className="pointer-events-none absolute left-0 right-0 border-t border-teal-800/60"
            />

            {analytics.scatter.points.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 font-medium">
                Chưa có dữ liệu thời gian và điểm số của thí sinh
              </div>
            ) : (
              analytics.scatter.points.map((pt) => {
                const xPercent = Math.max(
                  2,
                  Math.min(
                    98,
                    (pt.durationMinutes /
                      analytics.scatter.maxDurationMinutes) *
                      100
                  )
                );
                const yPercent = Math.max(
                  3,
                  Math.min(97, (pt.score / 1000) * 100)
                );
                const isActive = activeScatterPoint?.attemptId === pt.attemptId;

                const shapeClasses =
                  pt.category === 'fast_low_score'
                    ? 'w-3.5 h-3.5 rotate-45 bg-teal-300 border-2 border-teal-950'
                    : pt.category === 'near_timeout'
                      ? 'w-3.5 h-3.5 rounded-none bg-teal-500 border-2 border-teal-950'
                      : pt.category === 'normal_pass'
                        ? 'w-3 h-3 rounded-full bg-teal-800 border border-white'
                        : 'w-3 h-3 rounded-full bg-white border-2 border-teal-700';

                return (
                  <button
                    key={pt.attemptId}
                    type="button"
                    onMouseEnter={() => setActiveScatterPoint(pt)}
                    onMouseLeave={() => setActiveScatterPoint(null)}
                    onFocus={() => setActiveScatterPoint(pt)}
                    onBlur={() => setActiveScatterPoint(null)}
                    style={{
                      left: `${xPercent}%`,
                      bottom: `${yPercent}%`,
                    }}
                    data-testid={`scatter-point-${pt.username}`}
                    data-scatter-category={pt.category}
                    aria-label={`${pt.fullName}: ${pt.score} điểm, thời gian ${pt.durationMinutes} phút (${pt.categoryLabel})`}
                    className={`absolute -translate-x-1/2 translate-y-1/2 transition-transform cursor-pointer focus:outline-none focus:ring-2 focus:ring-teal-600 ${shapeClasses} ${
                      isActive ? 'scale-150 z-30' : 'hover:scale-125 z-10'
                    }`}
                  />
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between pt-2 text-[10px] font-semibold text-slate-500 tabular-nums">
            <span>0 phút</span>
            <span>
              {Math.round(analytics.scatter.maxDurationMinutes * 0.25)} phút
            </span>
            <span>
              {Math.round(analytics.scatter.maxDurationMinutes * 0.5)} phút
            </span>
            <span>
              {Math.round(analytics.scatter.maxDurationMinutes * 0.75)} phút
            </span>
            <span>{analytics.scatter.maxDurationMinutes} phút</span>
          </div>
        </div>

        <div
          className={
            showAccessibleTables ? 'pt-3 border-t border-slate-200' : 'sr-only'
          }
        >
          <div
            tabIndex={0}
            role="region"
            aria-label="Bảng số liệu thay thế cho biểu đồ Thời gian làm bài so với điểm"
            className="overflow-x-auto max-h-60 focus:outline-none focus:ring-2 focus:ring-teal-600 rounded-lg"
          >
            <table
              data-testid="scatter-fallback-table"
              aria-label="Bảng số liệu thời gian làm bài và điểm số từng học sinh"
              className="w-full text-left border-collapse text-xs"
            >
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-bold text-slate-700">
                  <th className="py-1.5 px-2">Học sinh</th>
                  <th className="py-1.5 px-2 text-right">Thời gian (phút)</th>
                  <th className="py-1.5 px-2 text-right">Điểm số</th>
                  <th className="py-1.5 px-2">Phân nhóm</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {analytics.scatter.points.map((pt) => (
                  <tr key={pt.attemptId}>
                    <td className="py-1 px-2 font-medium text-slate-800">
                      {pt.fullName} (@{pt.username})
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums">
                      {pt.durationMinutes}
                    </td>
                    <td className="py-1 px-2 text-right tabular-nums font-bold">
                      {pt.score}
                    </td>
                    <td className="py-1 px-2 text-slate-600">
                      {pt.categoryLabel}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ========================================================================
          PHẦN 7B - MỤC 1: PHÂN TÍCH TỪNG CÂU HỎI (SẮP THEO TỈ LỆ ĐÚNG TỪ THẤP ĐẾN CAO)
          ======================================================================== */}
      <section
        aria-label="Phân tích từng câu hỏi"
        data-testid="section-question-item-analysis"
        className="bg-white rounded-xl border border-slate-200 overflow-hidden"
      >
        <div className="px-4 py-3.5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/70">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <HelpCircle className="w-4 h-4 text-teal-800" />
              Phân tích từng câu hỏi ({filteredQuestions.length}/
              {questionAnalysis.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Sắp theo tỉ lệ đúng từ thấp đến cao • Bấm một câu để mở bảng phân
              tích đáp án nhiễu và danh sách học sinh làm sai
            </p>
          </div>

          {/* Bộ lọc theo nhóm độ khó: Khó (<40%), Vừa (40–80%), Dễ (>80%) */}
          <div
            className="flex flex-wrap items-center gap-1.5 text-xs"
            role="group"
            aria-label="Lọc câu hỏi theo độ khó"
          >
            <button
              type="button"
              onClick={() => setDifficultyFilter('all')}
              data-testid="question-diff-filter-all"
              className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                difficultyFilter === 'all'
                  ? 'bg-teal-800 text-white border-teal-800'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Tất cả ({questionAnalysis.length})
            </button>
            <button
              type="button"
              onClick={() => setDifficultyFilter('hard')}
              data-testid="question-diff-filter-hard"
              className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                difficultyFilter === 'hard'
                  ? 'bg-rose-700 text-white border-rose-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Khó &lt;40% ({difficultyCounts.hard})
            </button>
            <button
              type="button"
              onClick={() => setDifficultyFilter('medium')}
              data-testid="question-diff-filter-medium"
              className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                difficultyFilter === 'medium'
                  ? 'bg-teal-700 text-white border-teal-700'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Vừa 40–80% ({difficultyCounts.medium})
            </button>
            <button
              type="button"
              onClick={() => setDifficultyFilter('easy')}
              data-testid="question-diff-filter-easy"
              className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                difficultyFilter === 'easy'
                  ? 'bg-teal-900 text-white border-teal-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
            >
              Dễ &gt;80% ({difficultyCounts.easy})
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-96">
          <table
            data-testid="question-analysis-table"
            className="w-full text-left border-collapse text-sm"
          >
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 whitespace-nowrap">
                <th className="py-2.5 px-4">Câu</th>
                <th className="py-2.5 px-4">Nội dung câu hỏi & Chuyên đề</th>
                <th className="py-2.5 px-4">Nhóm độ khó</th>
                <th className="py-2.5 px-4 min-w-[160px]">Tỉ lệ đúng</th>
                <th className="py-2.5 px-4">Đáp án nhiễu chính</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredQuestions.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    data-testid="question-analysis-empty"
                    className="py-8 px-4 text-center text-xs text-slate-500"
                  >
                    Chưa có dữ liệu câu hỏi trong nhóm độ khó này.
                  </td>
                </tr>
              ) : (
                filteredQuestions.map((q) => (
                  <tr
                    key={q.questionId}
                    onClick={() => setSelectedQuestionForDrawer(q)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedQuestionForDrawer(q);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Xem chi tiết câu ${q.orderNumber}: đúng ${q.accuracyPercent}%`}
                    data-testid={`question-analysis-row-${q.questionId}`}
                    data-accuracy={q.accuracyPercent}
                    className="hover:bg-teal-50/40 transition-colors cursor-pointer focus:outline-none focus:bg-teal-50/60"
                  >
                    <td className="py-2.5 px-4 font-mono font-bold text-slate-800 whitespace-nowrap tabular-nums">
                      #{q.orderNumber}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="font-semibold text-slate-900 line-clamp-1">
                        {q.prompt}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {q.shortTopicLabel} • Đáp án đúng:{' '}
                        <strong className="text-teal-900">
                          {q.correctAnswerDisplay}
                        </strong>
                      </div>
                    </td>
                    <td className="py-2.5 px-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold border ${
                          q.difficultyGroup === 'hard'
                            ? 'bg-rose-50 text-rose-900 border-rose-200'
                            : q.difficultyGroup === 'medium'
                              ? 'bg-teal-50 text-teal-900 border-teal-200'
                              : 'bg-slate-100 text-slate-800 border-slate-200'
                        }`}
                      >
                        {q.difficultyLabel}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 align-middle">
                      <div className="flex items-center justify-between text-xs font-bold text-slate-900 tabular-nums mb-1">
                        <span>{q.accuracyPercent}%</span>
                        <span className="text-slate-500 font-normal">
                          {q.correctCount}/{q.totalStudents} HS đúng
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, q.accuracyPercent))}%`,
                          }}
                          className={`h-full rounded-full ${
                            q.difficultyGroup === 'hard'
                              ? 'bg-teal-400'
                              : q.difficultyGroup === 'medium'
                                ? 'bg-teal-600'
                                : 'bg-teal-800'
                          }`}
                        />
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 max-w-[200px] truncate">
                      {q.topDistractorLabel || '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ========================================================================
          PHẦN 7B - MỤC 2: BẢNG HỌC SINH (BẢNG CHÍNH - LỌC, SẮP XẾP, LIÊN KẾT 7A)
          ======================================================================== */}
      <section
        aria-label="Bảng học sinh chính"
        data-testid="results-filtered-student-table-section"
        className="bg-white rounded-xl border border-slate-200 overflow-hidden"
      >
        <div className="p-4 border-b border-slate-200 space-y-3 bg-slate-50/70">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Users className="w-4 h-4 text-teal-800" />
              <h3 className="text-sm font-bold text-slate-900">
                Bảng học sinh ({filteredStudentRows.length}/{rawRows.length})
              </h3>
              {selectedBinObj && (
                <span
                  data-testid="active-score-bin-filter-chip"
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-teal-900 text-white text-xs font-bold"
                >
                  <Filter className="w-3 h-3" />
                  Khoảng điểm: {selectedBinObj.label}
                  <button
                    type="button"
                    onClick={() => setSelectedScoreBinIndex(null)}
                    aria-label="Xóa bộ lọc khoảng điểm"
                    className="ml-1 hover:text-teal-200 cursor-pointer"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              )}
            </div>

            <span className="text-xs text-slate-500 inline-flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-slate-400" />
              Bấm vào một dòng học sinh để mở Drawer chi tiết bài làm
            </span>
          </div>

          {/* Bộ lọc trạng thái + Ô tìm kiếm */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div
              className="flex flex-wrap items-center gap-1.5 text-xs"
              role="group"
              aria-label="Lọc học sinh theo trạng thái kết quả"
            >
              <button
                type="button"
                onClick={() => setStudentStatusFilter('all')}
                data-testid="student-status-filter-all"
                className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                  studentStatusFilter === 'all'
                    ? 'bg-teal-800 text-white border-teal-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Tất cả ({studentStatusCounts.all})
              </button>
              <button
                type="button"
                onClick={() => setStudentStatusFilter('passed')}
                data-testid="student-status-filter-passed"
                className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                  studentStatusFilter === 'passed'
                    ? 'bg-teal-800 text-white border-teal-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Đạt ({studentStatusCounts.passed})
              </button>
              <button
                type="button"
                onClick={() => setStudentStatusFilter('failed')}
                data-testid="student-status-filter-failed"
                className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                  studentStatusFilter === 'failed'
                    ? 'bg-teal-800 text-white border-teal-800'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Chưa đạt ({studentStatusCounts.failed})
              </button>
              <button
                type="button"
                onClick={() => setStudentStatusFilter('violation_submitted')}
                data-testid="student-status-filter-violation_submitted"
                className={`px-2.5 py-1.5 rounded-lg font-semibold border transition-colors cursor-pointer ${
                  studentStatusFilter === 'violation_submitted'
                    ? 'bg-rose-700 text-white border-rose-700'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                Tự nộp do vi phạm ({studentStatusCounts.violationSubmitted})
              </button>
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={studentSearchQuery}
                onChange={(e) => setStudentSearchQuery(e.target.value)}
                placeholder="Tìm tên, tài khoản, lớp..."
                data-testid="student-table-search-input"
                className="w-full pl-8 pr-7 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
              {studentSearchQuery && (
                <button
                  type="button"
                  onClick={() => setStudentSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Cột bắt buộc: Hạng, Tên, Lớp, Điểm, Số câu đúng, Thời gian, Số vi phạm, Kiểu nộp */}
        <div className="overflow-x-auto max-h-[460px]">
          <table
            data-testid="results-filtered-student-table"
            className="w-full text-left border-collapse text-sm"
          >
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-bold text-slate-600 whitespace-nowrap">
                <th className="py-2.5 px-3">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('rank')}
                    data-testid="sort-col-rank"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Hạng {renderSortIcon('rank')}
                  </button>
                </th>
                <th className="py-2.5 px-4">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('name')}
                    data-testid="sort-col-name"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Tên học sinh {renderSortIcon('name')}
                  </button>
                </th>
                <th className="py-2.5 px-3">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('className')}
                    data-testid="sort-col-class"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Lớp {renderSortIcon('className')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('score')}
                    data-testid="sort-col-score"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Điểm {renderSortIcon('score')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('correctCount')}
                    data-testid="sort-col-correct"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Số câu đúng {renderSortIcon('correctCount')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('duration')}
                    data-testid="sort-col-duration"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Thời gian {renderSortIcon('duration')}
                  </button>
                </th>
                <th className="py-2.5 px-3 text-right">
                  <button
                    type="button"
                    onClick={() => handleSortColumn('violations')}
                    data-testid="sort-col-violations"
                    className="inline-flex items-center font-bold hover:text-teal-900 cursor-pointer"
                  >
                    Số vi phạm {renderSortIcon('violations')}
                  </button>
                </th>
                <th className="py-2.5 px-4">Kiểu nộp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStudentRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    data-testid="results-student-table-empty"
                    className="py-8 px-4 text-center text-xs text-slate-500"
                  >
                    {selectedBinObj
                      ? `Không có học sinh nào trong khoảng ${selectedBinObj.label} điểm khớp bộ lọc.`
                      : 'Chưa có học sinh nào khớp điều kiện lọc.'}
                  </td>
                </tr>
              ) : (
                filteredStudentRows.map((row) => (
                  <tr
                    key={row.attemptId}
                    onClick={() => setSelectedStudentRowForDrawer(row)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedStudentRowForDrawer(row);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-label={`Xem chi tiết học sinh ${row.fullName}, hạng ${row.rank}, điểm ${row.score}`}
                    data-testid={`results-student-row-${row.username}`}
                    data-student-score={row.score}
                    data-student-correct={row.correctCount}
                    className="hover:bg-teal-50/45 transition-colors cursor-pointer focus:outline-none focus:bg-teal-50/70"
                  >
                    <td className="py-2.5 px-3 font-mono font-bold text-slate-700 tabular-nums">
                      #{row.rank}
                    </td>
                    <td className="py-2.5 px-4 font-semibold text-slate-900">
                      <div>{row.fullName}</div>
                      <div className="text-xs font-normal text-slate-500">
                        @{row.username}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-xs font-medium text-slate-700">
                      {row.className}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <span className="font-black text-teal-900 tabular-nums">
                        {row.score}
                      </span>
                      <span
                        className={`ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          row.passed
                            ? 'bg-teal-800 text-white'
                            : 'bg-teal-100 text-teal-950 border border-teal-400'
                        }`}
                      >
                        {row.passed ? 'Đạt' : 'Chưa đạt'}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-700 font-semibold tabular-nums">
                      {row.correctCount}/{row.totalQuestions}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-600 tabular-nums">
                      {row.durationMinutes} phút
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${
                          row.violationCount >= session.maxViolations
                            ? 'bg-rose-100 text-rose-900 border border-rose-300'
                            : row.violationCount > 0
                              ? 'bg-amber-50 text-amber-900 border border-amber-200'
                              : 'text-slate-500'
                        }`}
                      >
                        {row.violationCount}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 text-xs">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded font-semibold border ${
                          row.submitReason === 'violation'
                            ? 'bg-rose-50 text-rose-900 border-rose-200'
                            : row.submitReason === 'timeout'
                              ? 'bg-amber-50 text-amber-900 border-amber-200'
                              : row.status === 'in_progress'
                                ? 'bg-teal-50 text-teal-900 border-teal-200'
                                : 'bg-slate-100 text-slate-700 border-slate-200'
                        }`}
                      >
                        {row.submitReasonLabel}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ========================================================================
          PHẦN 7B - MỤC 5 (TÙY CHỌN): SO SÁNH 2 CA THI (ĐIỂM TRUNG BÌNH, TỈ LỆ ĐẠT)
          ======================================================================== */}
      <section
        aria-label="So sánh 2 ca thi"
        data-testid="session-comparison-section"
        className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 space-y-4 print:hidden"
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <GitCompare className="w-4 h-4 text-teal-800" />
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                So sánh 2 ca thi
              </h3>
              <p className="text-xs text-slate-500">
                Đối chiếu Điểm trung bình và Tỉ lệ đạt của ca thi này với một ca
                thi khác
              </p>
            </div>
          </div>

          <select
            value={compareTargetSessionId}
            onChange={(e) => setCompareTargetSessionId(e.target.value)}
            data-testid="compare-session-select"
            aria-label="Chọn ca thi để so sánh"
            className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-600"
          >
            <option value="">— Chọn ca thi đối chiếu —</option>
            {otherSessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.code})
              </option>
            ))}
          </select>
        </div>

        {isLoadingCompare ? (
          <div className="text-xs text-slate-500 py-3">
            Đang tải số liệu ca thi đối chiếu...
          </div>
        ) : comparisonSummary ? (
          <div
            data-testid="session-comparison-result"
            className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100"
          >
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Điểm trung bình</div>
              <div className="mt-1 flex items-baseline justify-between gap-2 tabular-nums">
                <span className="text-lg font-black text-slate-900">
                  {comparisonSummary.currentAverageScore}{' '}
                  <span className="text-xs font-normal text-slate-500">
                    so với {comparisonSummary.targetAverageScore}
                  </span>
                </span>
                <span
                  className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    comparisonSummary.averageScoreDelta >= 0
                      ? 'bg-teal-100 text-teal-900'
                      : 'bg-rose-100 text-rose-900'
                  }`}
                >
                  {comparisonSummary.averageScoreDelta >= 0 ? '+' : ''}
                  {comparisonSummary.averageScoreDelta} điểm
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Tỉ lệ đạt</div>
              <div className="mt-1 flex items-baseline justify-between gap-2 tabular-nums">
                <span className="text-lg font-black text-teal-800">
                  {comparisonSummary.currentPassRatePercent}%{' '}
                  <span className="text-xs font-normal text-slate-500">
                    so với {comparisonSummary.targetPassRatePercent}%
                  </span>
                </span>
                <span
                  className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                    comparisonSummary.passRateDelta >= 0
                      ? 'bg-teal-100 text-teal-900'
                      : 'bg-rose-100 text-rose-900'
                  }`}
                >
                  {comparisonSummary.passRateDelta >= 0 ? '+' : ''}
                  {comparisonSummary.passRateDelta}%
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
              <div className="text-xs text-slate-500">Số thí sinh dự thi</div>
              <div className="mt-1 flex items-baseline justify-between gap-2 tabular-nums">
                <span className="text-lg font-black text-slate-900">
                  {comparisonSummary.currentParticipantCount} HS
                </span>
                <span className="text-xs text-slate-600">
                  Ca đối chiếu: {comparisonSummary.targetParticipantCount} HS
                </span>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ========================================================================
          DRAWER 1 (7B): CHI TIẾT PHÂN TÍCH MỘT CÂU HỎI
          ======================================================================== */}
      {activeQuestionDrawerData && (
        <div
          data-testid="question-analysis-drawer-backdrop"
          onClick={() => setSelectedQuestionForDrawer(null)}
          className="fixed inset-0 z-50 bg-slate-900/45 flex justify-end print:hidden"
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Phân tích câu hỏi số ${activeQuestionDrawerData.orderNumber}`}
            data-testid="question-analysis-drawer"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <div>
                <div className="flex items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-teal-900 text-white text-xs font-mono font-bold">
                    Câu #{activeQuestionDrawerData.orderNumber}
                  </span>
                  <span className="text-xs font-semibold text-slate-600">
                    {activeQuestionDrawerData.shortTopicLabel}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-bold border ${
                      activeQuestionDrawerData.difficultyGroup === 'hard'
                        ? 'bg-rose-50 text-rose-900 border-rose-200'
                        : activeQuestionDrawerData.difficultyGroup === 'medium'
                          ? 'bg-teal-50 text-teal-900 border-teal-200'
                          : 'bg-slate-100 text-slate-800 border-slate-200'
                    }`}
                  >
                    {activeQuestionDrawerData.difficultyLabel}
                  </span>
                </div>
                <h4 className="text-sm font-bold text-slate-900 mt-1">
                  Tỉ lệ làm đúng:{' '}
                  <span
                    data-testid="drawer-question-accuracy"
                    className="text-teal-800 tabular-nums"
                  >
                    {activeQuestionDrawerData.accuracyPercent}%
                  </span>{' '}
                  ({activeQuestionDrawerData.correctCount}/
                  {activeQuestionDrawerData.totalStudents} học sinh)
                </h4>
              </div>

              <button
                type="button"
                onClick={() => setSelectedQuestionForDrawer(null)}
                data-testid="close-question-drawer-btn"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {/* Nội dung câu & Đáp án đúng */}
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2.5">
                <div
                  data-testid="drawer-question-prompt"
                  className="text-sm font-bold text-slate-900 leading-relaxed"
                >
                  {activeQuestionDrawerData.prompt}
                </div>
                <div className="text-xs text-teal-900 bg-teal-50 border border-teal-200 rounded-lg px-3 py-2">
                  <span className="font-semibold">Đáp án đúng: </span>
                  <strong data-testid="drawer-question-correct-answer">
                    {activeQuestionDrawerData.correctAnswerDisplay}
                  </strong>
                </div>
                {activeQuestionDrawerData.explanation && (
                  <p className="text-xs text-slate-600 leading-relaxed">
                    <strong>Giải thích:</strong>{' '}
                    {activeQuestionDrawerData.explanation}
                  </p>
                )}
              </div>

              {/* Tỉ lệ học sinh chọn từng đáp án (để thấy đáp án gây nhiễu) */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Tỉ lệ học sinh chọn từng phương án
                </h5>
                <div
                  data-testid="drawer-question-option-distribution"
                  className="space-y-2"
                >
                  {activeQuestionDrawerData.optionDistribution.map((opt) => (
                    <div
                      key={opt.optionKey}
                      data-testid={`drawer-option-stat-${opt.optionKey}`}
                      className={`p-2.5 rounded-lg border text-xs ${
                        opt.isCorrectOption
                          ? 'bg-teal-50/70 border-teal-500'
                          : opt.isTopDistractor
                            ? 'bg-rose-50/60 border-rose-300'
                            : 'bg-white border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="font-semibold text-slate-900 flex items-center gap-1.5">
                          <span>{opt.optionText}</span>
                          {opt.isCorrectOption && (
                            <span className="px-1.5 py-0.5 rounded bg-teal-800 text-white text-[10px] font-bold">
                              Đáp án đúng
                            </span>
                          )}
                          {opt.isTopDistractor && (
                            <span
                              data-testid="drawer-top-distractor-badge"
                              className="px-1.5 py-0.5 rounded bg-rose-700 text-white text-[10px] font-bold"
                            >
                              Gây nhiễu nhiều nhất
                            </span>
                          )}
                        </span>
                        <span className="font-black text-slate-900 tabular-nums whitespace-nowrap">
                          {opt.count} HS ({opt.percentage}%)
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, opt.percentage))}%`,
                          }}
                          className={`h-full rounded-full ${
                            opt.isCorrectOption
                              ? 'bg-teal-800'
                              : opt.isTopDistractor
                                ? 'bg-rose-500'
                                : 'bg-teal-400'
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Danh sách học sinh làm sai */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Danh sách học sinh làm sai (
                  <span data-testid="drawer-wrong-students-count">
                    {activeQuestionDrawerData.wrongStudents.length}
                  </span>
                  )
                </h5>
                {activeQuestionDrawerData.wrongStudents.length === 0 ? (
                  <div className="p-4 rounded-lg bg-teal-50 border border-teal-200 text-xs text-teal-900 font-medium">
                    100% học sinh trả lời đúng câu hỏi này.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table
                      data-testid="drawer-wrong-students-table"
                      className="w-full text-left border-collapse text-xs"
                    >
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                          <th className="py-2 px-3">Học sinh</th>
                          <th className="py-2 px-3">Phương án đã chọn</th>
                          <th className="py-2 px-3 text-right">Thời gian</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {activeQuestionDrawerData.wrongStudents.map((ws) => (
                          <tr key={ws.attemptId}>
                            <td className="py-2 px-3 font-semibold text-slate-900">
                              {ws.fullName}{' '}
                              <span className="font-normal text-slate-500">
                                ({ws.className})
                              </span>
                            </td>
                            <td className="py-2 px-3 text-rose-800 font-medium">
                              {ws.selectedAnswerDisplay}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-600 tabular-nums">
                              {ws.timeSpentSeconds}s
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ========================================================================
          DRAWER 2 (7B): CHI TIẾT BÀI LÀM CỦA MỘT HỌC SINH
          ======================================================================== */}
      {activeStudentDrawerData && (
        <div
          data-testid="student-detail-drawer-backdrop"
          onClick={() => setSelectedStudentRowForDrawer(null)}
          className="fixed inset-0 z-50 bg-slate-900/45 flex justify-end print:hidden"
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Chi tiết bài thi của ${activeStudentDrawerData.student.fullName}`}
            data-testid="student-detail-drawer"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl bg-white h-full shadow-2xl border-l border-slate-200 flex flex-col overflow-hidden"
          >
            {/* Header Drawer Học sinh */}
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3 bg-slate-50">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-teal-900 text-white text-xs font-mono font-bold">
                    Hạng #{activeStudentDrawerData.student.rank}
                  </span>
                  <h4
                    data-testid="student-drawer-fullname"
                    className="text-base font-bold text-slate-900"
                  >
                    {activeStudentDrawerData.student.fullName}
                  </h4>
                  <span className="text-xs text-slate-500">
                    (@{activeStudentDrawerData.student.username} • Lớp{' '}
                    {activeStudentDrawerData.student.className})
                  </span>
                </div>
                <div className="text-xs text-slate-600 mt-1 flex flex-wrap items-center gap-3 tabular-nums">
                  <span>
                    Điểm:{' '}
                    <strong
                      data-testid="student-drawer-score"
                      className="text-teal-900 font-black"
                    >
                      {activeStudentDrawerData.student.score}
                    </strong>
                    /1000 (
                    {activeStudentDrawerData.scoreDeltaVsClass >= 0 ? '+' : ''}
                    {activeStudentDrawerData.scoreDeltaVsClass} so với TB lớp{' '}
                    {activeStudentDrawerData.classAverageScore})
                  </span>
                  <span>•</span>
                  <span>
                    Đúng:{' '}
                    <strong data-testid="student-drawer-correct-count">
                      {activeStudentDrawerData.student.correctCount}
                    </strong>
                    /{activeStudentDrawerData.student.totalQuestions} câu
                  </span>
                  <span>•</span>
                  <span>
                    Thời gian: {activeStudentDrawerData.student.durationMinutes}{' '}
                    phút
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedStudentRowForDrawer(null)}
                data-testid="close-student-drawer-btn"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* 1. Điểm theo từng chuyên đề so với trung bình lớp */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  1. Điểm theo từng chuyên đề so với trung bình lớp
                </h5>
                <div
                  data-testid="student-drawer-topic-comparison"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                >
                  {activeStudentDrawerData.topicComparisons.map((tc) => (
                    <div
                      key={tc.topic}
                      className="p-3 rounded-lg border border-slate-200 bg-slate-50/60 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-slate-900">
                          {tc.shortLabel}
                        </span>
                        <span
                          className={`font-bold px-1.5 py-0.5 rounded text-[10px] tabular-nums ${
                            tc.deltaPercent >= 0
                              ? 'bg-teal-100 text-teal-900'
                              : 'bg-rose-100 text-rose-900'
                          }`}
                        >
                          {tc.deltaPercent >= 0 ? '+' : ''}
                          {tc.deltaPercent}% so với lớp
                        </span>
                      </div>

                      <div className="flex items-baseline justify-between text-xs tabular-nums">
                        <span className="font-black text-teal-900">
                          HS: {tc.studentAccuracyPercent}% ({tc.studentCorrect}/
                          {tc.studentTotal})
                        </span>
                        <span className="text-slate-500">
                          TB lớp: {tc.classAccuracyPercent}%
                        </span>
                      </div>

                      <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden">
                        <div
                          style={{
                            width: `${Math.min(100, Math.max(0, tc.studentAccuracyPercent))}%`,
                          }}
                          className="h-full bg-teal-800 rounded-full"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 2. Toàn bộ câu hỏi: câu đã chọn, đáp án đúng, đúng/sai, thời gian làm từng câu */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  2. Chi tiết toàn bộ câu hỏi (
                  {activeStudentDrawerData.questions.length} câu)
                </h5>
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <table
                    data-testid="student-drawer-questions-table"
                    className="w-full text-left border-collapse text-xs"
                  >
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-bold text-slate-600">
                        <th className="py-2 px-2.5">Câu</th>
                        <th className="py-2 px-2.5">Nội dung</th>
                        <th className="py-2 px-2.5">Đã chọn</th>
                        <th className="py-2 px-2.5">Đáp án đúng</th>
                        <th className="py-2 px-2.5">Kết quả</th>
                        <th className="py-2 px-2.5 text-right">Thời gian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeStudentDrawerData.questions.map((q) => (
                        <tr key={q.questionId}>
                          <td className="py-2 px-2.5 font-mono font-bold text-slate-700 tabular-nums">
                            #{q.orderNumber}
                          </td>
                          <td className="py-2 px-2.5 text-slate-900 max-w-[180px] truncate">
                            {q.prompt}
                          </td>
                          <td className="py-2 px-2.5 font-semibold text-slate-800">
                            {q.userAnswerDisplay}
                          </td>
                          <td className="py-2 px-2.5 font-bold text-teal-900">
                            {q.correctAnswerDisplay}
                          </td>
                          <td className="py-2 px-2.5 whitespace-nowrap">
                            {q.isCorrect ? (
                              <span className="px-1.5 py-0.5 rounded bg-teal-800 text-white font-bold text-[10px]">
                                Đúng
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-900 border border-rose-300 font-bold text-[10px]">
                                Sai
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap">
                            {formatDurationMmSs(q.timeSpentSeconds)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 3. Nhật ký vi phạm theo dòng thời gian (loại, giờ, thời gian rời đi) */}
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                  3. Nhật ký vi phạm theo dòng thời gian (
                  {activeStudentDrawerData.violationTimeline.length})
                </h5>
                {activeStudentDrawerData.violationTimeline.length === 0 ? (
                  <div
                    data-testid="student-drawer-no-violations"
                    className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600"
                  >
                    Học sinh không có sự kiện vi phạm nào trong suốt thời gian
                    làm bài.
                  </div>
                ) : (
                  <div
                    data-testid="student-drawer-violation-timeline"
                    className="space-y-2"
                  >
                    {activeStudentDrawerData.violationTimeline.map((v) => (
                      <div
                        key={v.id}
                        className="p-3 rounded-lg bg-rose-50/50 border border-rose-200 flex items-center justify-between gap-3 text-xs"
                      >
                        <div>
                          <div className="font-bold text-rose-950">
                            {v.typeLabel}
                          </div>
                          <div className="text-slate-600 mt-0.5">
                            Lúc {formatTimeHhMmSs(v.occurredAt)} • Đang ở câu #
                            {v.currentQuestionOrder}
                            {v.note ? ` • ${v.note}` : ''}
                          </div>
                        </div>
                        <span className="px-2 py-1 rounded bg-white border border-rose-200 font-mono font-bold text-rose-900 tabular-nums whitespace-nowrap">
                          <Clock className="w-3 h-3 inline mr-1" />
                          Rời đi {v.awaySeconds}s
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}

      {/* ========================================================================
          MODAL BÁO CÁO TÓM TẮT KHỔ A4 (XUẤT PDF CHUẨN IN ẤN KHỔ A4)
          ======================================================================== */}
      {isPdfReportOpen && (
        <div
          data-testid="pdf-a4-report-modal"
          className="fixed inset-0 z-50 bg-slate-900/60 overflow-y-auto p-4 sm:p-6 flex justify-center print:static print:bg-white print:p-0"
        >
          <style>{`
            @media print {
              @page {
                size: A4 portrait;
                margin: 12mm;
              }
              body * {
                visibility: hidden;
              }
              #a4-printable-sheet, #a4-printable-sheet * {
                visibility: visible;
              }
              #a4-printable-sheet {
                position: absolute;
                left: 0;
                top: 0;
                width: 190mm;
                box-shadow: none !important;
                border: none !important;
              }
            }
          `}</style>

          <div className="w-full max-w-[210mm] space-y-3">
            {/* Thanh điều khiển in (ẩn khi in) */}
            <div className="bg-slate-900 text-white rounded-xl px-4 py-3 flex items-center justify-between gap-3 print:hidden">
              <div className="text-xs font-semibold">
                Báo cáo tóm tắt kết quả ca thi (Chuẩn khổ giấy A4 dọc - 210mm ×
                297mm)
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  data-testid="trigger-print-a4-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  In / Lưu PDF khổ A4
                </button>
                <button
                  type="button"
                  onClick={() => setIsPdfReportOpen(false)}
                  data-testid="close-pdf-a4-modal-btn"
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  Đóng
                </button>
              </div>
            </div>

            {/* Tờ giấy A4 báo cáo tóm tắt của lớp */}
            <div
              id="a4-printable-sheet"
              data-testid="a4-printable-sheet"
              className="bg-white rounded-xl border border-slate-300 shadow-xl p-6 sm:p-8 space-y-5 text-slate-900 mx-auto w-full max-w-[210mm]"
            >
              {/* Đầu trang báo cáo A4 */}
              <div className="border-b-2 border-teal-900 pb-3 flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-teal-800">
                    BÁO CÁO KẾT QUẢ CA THI CERTIPORT GENERATIVE AI
                  </div>
                  <h2 className="text-lg font-black text-slate-900 mt-0.5">
                    {session.title} (Mã: {session.code})
                  </h2>
                  <p className="text-xs text-slate-600">
                    Lớp/Nhóm: {session.targetClass} • Thời lượng:{' '}
                    {session.durationMinutes} phút • Điểm đạt: ≥
                    {session.passScore}/1000
                  </p>
                </div>
                <div className="text-right text-xs text-slate-500 tabular-nums">
                  <div>
                    {analytics.isProvisional
                      ? 'Số liệu tạm thời'
                      : 'Số liệu chính thức'}
                  </div>
                  <div>Ngày xuất: {new Date().toLocaleDateString('vi-VN')}</div>
                </div>
              </div>

              {/* 1. Chỉ số đầu trang */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  1. Chỉ số tổng quan của lớp
                </h3>
                <div className="grid grid-cols-6 gap-2 border border-slate-200 rounded-lg p-3 text-center">
                  <div>
                    <div className="text-lg font-black tabular-nums">
                      {analytics.kpis.participantCount}
                    </div>
                    <div className="text-[11px] text-slate-500">Thí sinh</div>
                  </div>
                  <div>
                    <div className="text-lg font-black text-teal-800 tabular-nums">
                      {analytics.kpis.averageScore}
                    </div>
                    <div className="text-[11px] text-slate-500">Điểm TB</div>
                  </div>
                  <div>
                    <div className="text-lg font-black tabular-nums">
                      {analytics.kpis.medianScore}
                    </div>
                    <div className="text-[11px] text-slate-500">Trung vị</div>
                  </div>
                  <div>
                    <div className="text-lg font-black tabular-nums">
                      {analytics.kpis.highestScore}
                    </div>
                    <div className="text-[11px] text-slate-500">Cao nhất</div>
                  </div>
                  <div>
                    <div className="text-lg font-black tabular-nums">
                      {analytics.kpis.lowestScore}
                    </div>
                    <div className="text-[11px] text-slate-500">Thấp nhất</div>
                  </div>
                  <div>
                    <div className="text-lg font-black text-teal-800 tabular-nums">
                      {analytics.kpis.passRatePercent}%
                    </div>
                    <div className="text-[11px] text-slate-500">Tỉ lệ đạt</div>
                  </div>
                </div>
              </div>

              {/* 2. Phổ điểm & 3. Theo chuyên đề */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    2. Phổ điểm (khoảng 100 điểm)
                  </h3>
                  <div className="space-y-1 text-xs">
                    {analytics.histogram.bins.map((b) => (
                      <div
                        key={b.binIndex}
                        className="flex items-center justify-between gap-2 tabular-nums"
                      >
                        <span className="w-16 font-medium text-slate-700">
                          {b.label}
                        </span>
                        <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden">
                          <div
                            style={{ width: `${b.percentage}%` }}
                            className="h-full bg-teal-700"
                          />
                        </div>
                        <span className="w-20 text-right font-semibold">
                          {b.count} ({b.percentage}%)
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    3. Tỉ lệ đúng theo chuyên đề
                  </h3>
                  <div className="space-y-2 text-xs">
                    {analytics.topics.bars.map((tb) => (
                      <div key={tb.topic} className="space-y-1">
                        <div className="flex justify-between font-semibold">
                          <span>
                            {tb.shortLabel}{' '}
                            {tb.isWeakest ? '(Yếu nhất)' : ''}
                          </span>
                          <span className="tabular-nums">
                            {tb.accuracyPercent}% ({tb.correctCount}/
                            {tb.totalCount})
                          </span>
                        </div>
                        <div className="w-full h-2 bg-slate-100 rounded overflow-hidden">
                          <div
                            style={{ width: `${tb.accuracyPercent}%` }}
                            className="h-full bg-teal-800"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* 4. 5 câu khó nhất */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  4. 5 câu hỏi khó nhất của ca thi
                </h3>
                <table
                  data-testid="a4-hardest-questions-table"
                  className="w-full text-left border-collapse text-xs border border-slate-200"
                >
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 font-bold">
                      <th className="py-1.5 px-2">Câu</th>
                      <th className="py-1.5 px-2">Nội dung câu hỏi</th>
                      <th className="py-1.5 px-2">Chuyên đề</th>
                      <th className="py-1.5 px-2 text-right">Tỉ lệ đúng</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {hardestFiveQuestions.map((hq) => (
                      <tr key={hq.questionId}>
                        <td className="py-1.5 px-2 font-mono font-bold">
                          #{hq.orderNumber}
                        </td>
                        <td className="py-1.5 px-2">{hq.prompt}</td>
                        <td className="py-1.5 px-2">{hq.shortTopicLabel}</td>
                        <td className="py-1.5 px-2 text-right font-bold tabular-nums">
                          {hq.accuracyPercent}% ({hq.correctCount}/
                          {hq.totalStudents})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 5. Danh sách học sinh chưa đạt */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  5. Danh sách học sinh chưa đạt ({failedStudentsList.length}{' '}
                  học sinh)
                </h3>
                {failedStudentsList.length === 0 ? (
                  <div className="p-3 border border-slate-200 rounded-lg text-xs text-slate-600">
                    Tất cả học sinh dự thi đều đạt chuẩn ≥{session.passScore}{' '}
                    điểm.
                  </div>
                ) : (
                  <table
                    data-testid="a4-failed-students-table"
                    className="w-full text-left border-collapse text-xs border border-slate-200"
                  >
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 font-bold">
                        <th className="py-1.5 px-2">Hạng</th>
                        <th className="py-1.5 px-2">Họ và tên</th>
                        <th className="py-1.5 px-2">Lớp</th>
                        <th className="py-1.5 px-2 text-right">Điểm</th>
                        <th className="py-1.5 px-2 text-right">Câu đúng</th>
                        <th className="py-1.5 px-2">Kiểu nộp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {failedStudentsList.map((fs) => (
                        <tr key={fs.attemptId}>
                          <td className="py-1 px-2 font-mono">#{fs.rank}</td>
                          <td className="py-1 px-2 font-semibold">
                            {fs.fullName}
                          </td>
                          <td className="py-1 px-2">{fs.className}</td>
                          <td className="py-1 px-2 text-right font-bold tabular-nums">
                            {fs.score}
                          </td>
                          <td className="py-1 px-2 text-right tabular-nums">
                            {fs.correctCount}/{fs.totalQuestions}
                          </td>
                          <td className="py-1 px-2">{fs.submitReasonLabel}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
