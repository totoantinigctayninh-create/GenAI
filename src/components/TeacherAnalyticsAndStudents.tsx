import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileSpreadsheet,
  History,
  KeyRound,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import {
  ExamAttempt,
  QUESTION_TYPE_LABELS,
  Question,
  UserAccount,
  UserAnswer,
  UserRole,
} from '../types/exam';
import {
  StudentProgressSummary,
  buildClassReportWorkbookBytes,
  buildSampleStudentImportExcelBytes,
  computeClassAnalytics,
  parseStudentsFromExcelBytes,
} from '../utils/teacherAnalytics';
import { QuestionRenderer } from './QuestionRenderer';
import { formatStudyDuration } from './StudentPortal';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================================
// 1. PHÂN HỆ THỐNG KÊ & PHÂN TÍCH HỌC TẬP CỦA LỚP + TOP CÂU HỎI BẪY + BÁO CÁO EXCEL
// ============================================================================

interface TeacherClassAnalyticsProps {
  questions: Question[];
  users: UserAccount[];
  attempts: ExamAttempt[];
  onNavigateToTab: (tab: 'overview' | 'questions' | 'students' | 'attempts') => void;
}

export const TeacherClassAnalytics: React.FC<TeacherClassAnalyticsProps> = ({
  questions,
  users,
  attempts,
  onNavigateToTab,
}) => {
  const [quickReviewQuestion, setQuickReviewQuestion] = useState<Question | null>(
    null
  );
  const [quickReviewAnswer, setQuickReviewAnswer] = useState<
    UserAnswer | undefined
  >(undefined);
  const [showQuickReviewSolution, setShowQuickReviewSolution] =
    useState<boolean>(true);
  const [exportBanner, setExportBanner] = useState<string | null>(null);

  const analytics = useMemo(
    () => computeClassAnalytics(questions, users, attempts),
    [questions, users, attempts]
  );

  const totalStudySecondsAll = useMemo(
    () =>
      analytics.studentRows.reduce(
        (acc, r) => acc + (r.student.totalStudySeconds || 0),
        0
      ),
    [analytics.studentRows]
  );

  const avgStudySecondsPerStudent = useMemo(
    () =>
      analytics.studentRows.length > 0
        ? Math.round(totalStudySecondsAll / analytics.studentRows.length)
        : 0,
    [totalStudySecondsAll, analytics.studentRows.length]
  );

  const highestMockExamScore1000 = useMemo(() => {
    const scores = analytics.studentRows.map((r) => r.highestScore1000 || 0);
    return scores.length > 0 ? Math.max(...scores) : 0;
  }, [analytics.studentRows]);

  const bankCompletionPercent = useMemo(() => {
    if (analytics.studentRows.length === 0 || questions.length === 0) return 0;
    const totalPracticedRatio = analytics.studentRows.reduce(
      (sum, r) => sum + Math.min(1, r.practicedCount / Math.max(1, questions.length)),
      0
    );
    return Math.round((totalPracticedRatio / analytics.studentRows.length) * 100);
  }, [analytics.studentRows, questions.length]);

  const handleExportClassReportExcel = () => {
    const bytes = buildClassReportWorkbookBytes(questions, users, attempts);
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadBlob(
      blob,
      `Bao_Cao_Ket_Qua_Lop_Hoc_Certiport_GenAI_${dateTag}.xlsx`
    );
    setExportBanner(
      'Đã xuất thành công file "Bao_Cao_Ket_Qua_Lop_Hoc_Certiport_GenAI.xlsx" gồm 3 Sheet: (1) Tổng hợp kết quả học sinh, (2) Chi tiết lịch sử thi thử, (3) Thống kê câu hỏi hay sai.'
    );
  };

  const handleOpenQuickReview = (q: Question) => {
    setQuickReviewQuestion(q);
    setQuickReviewAnswer(q.correctAnswer);
    setShowQuickReviewSolution(true);
  };

  return (
    <div className="space-y-6">
      {/* Thanh tiêu đề Thống kê Lớp học & Nút Xuất Báo Cáo Excel (.xlsx) 3 Sheet */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="text-xs font-bold uppercase tracking-wider text-teal-800 flex items-center gap-1.5">
            <BarChart3 className="w-4 h-4" />
            <span>Thống kê & Phân tích Năng lực Lớp học Chuyên sâu</span>
          </div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900">
            Báo cáo Năng lực theo Chuyên đề, Top Câu hỏi Bẫy & Hồ sơ Giảng dạy
          </h2>
          <p className="text-xs text-slate-500">
            Tự động tổng hợp từ toàn bộ quá trình luyện tập, kho câu sai và lịch sử thi thử chuẩn Certiport của học sinh.
          </p>
        </div>

        <button
          type="button"
          data-testid="export-class-report-excel-btn"
          onClick={handleExportClassReportExcel}
          className="px-4 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-800 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 shadow-xs transition-colors cursor-pointer shrink-0"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Xuất Báo Cáo Kết Quả Lớp Học (.xlsx)</span>
        </button>
      </section>

      {exportBanner && (
        <div
          role="status"
          data-testid="export-class-report-banner"
          className="p-4 rounded-xl bg-emerald-50 border border-emerald-300 text-xs sm:text-sm font-medium text-emerald-950 flex items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{exportBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setExportBanner(null)}
            className="text-xs underline shrink-0 cursor-pointer"
          >
            Đóng
          </button>
        </div>
      )}

      {/* 4 Thẻ Chỉ Số Tổng Quan (Metric Cards) của Bảng điều khiển Giáo viên */}
      <div
        data-testid="teacher-metric-cards"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 tabular-nums"
      >
        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all duration-200 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Tổng số Học sinh</span>
            <Users className="w-4 h-4 text-teal-700" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">
            {analytics.studentRows.length} học sinh
          </div>
          <div className="text-xs text-emerald-700 font-medium flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
            <span>
              Đang Online: {analytics.totalActiveStudents} HS · Offline:{' '}
              {Math.max(0, analytics.studentRows.length - analytics.totalActiveStudents)} HS
            </span>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all duration-200 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Thời gian Ôn tập Trung bình</span>
            <Clock className="w-4 h-4 text-teal-700" />
          </div>
          <div className="text-2xl font-bold font-mono text-teal-800">
            {formatStudyDuration(avgStudySecondsPerStudent)}
          </div>
          <div className="text-xs text-slate-500">
            Tổng toàn lớp:{' '}
            <strong className="text-slate-800 font-mono">
              {formatStudyDuration(totalStudySecondsAll)}
            </strong>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all duration-200 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Điểm Thi thử Cao nhất</span>
            <Award className="w-4 h-4 text-teal-700" />
          </div>
          <div className="text-2xl font-bold font-mono text-teal-800">
            {highestMockExamScore1000} / 1000
          </div>
          <div className="text-xs text-slate-500">
            TB lớp:{' '}
            <strong className="text-slate-800 font-mono">
              {analytics.classAverageScore1000}/1000
            </strong>{' '}
            · Đạt chuẩn:{' '}
            <strong className="text-emerald-700">
              {analytics.classPassRatePercent}%
            </strong>
          </div>
        </div>

        <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-xs hover:shadow-md transition-all duration-200 space-y-1.5">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
            <span>Tỷ lệ Hoàn thành Ngân hàng đề</span>
            <BookOpen className="w-4 h-4 text-teal-700" />
          </div>
          <div className="text-2xl font-bold font-mono text-slate-900">
            {bankCompletionPercent}%
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-600 transition-all duration-300"
              style={{ width: `${Math.max(4, bankCompletionPercent)}%` }}
            />
          </div>
          <div className="text-xs text-slate-500">
            Ngân hàng đề: {questions.length} câu · Câu bẫy nhất:{' '}
            <strong className="text-rose-700 font-mono">
              {analytics.trapQuestions[0]
                ? `${analytics.trapQuestions[0].question.id.toUpperCase()} (${analytics.trapQuestions[0].wrongRatePercent}%)`
                : 'Chưa có'}
            </strong>
          </div>
        </div>
      </div>

      {/* BIỂU ĐỒ PHÂN TÍCH NĂNG LỰC THEO CHUYÊN ĐỀ & THEO DẠNG CÂU HỎI */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Cột 1 (6/12): Biểu đồ phân tích năng lực theo 4 Chuyên đề Certiport */}
        <section
          data-testid="class-topic-competency-chart"
          className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4 tabular-nums"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-teal-700" />
                <span>Biểu đồ Phân tích Năng lực Lớp theo 4 Chuyên đề</span>
              </h3>
              <p className="text-xs text-slate-500">
                Tỷ lệ trả lời đúng trung bình của cả lớp ở từng miền kiến thức Certiport.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              4 chuyên đề
            </span>
          </div>

          <div className="space-y-4">
            {analytics.topicCompetency.map((item) => {
              const barColor =
                item.accuracyPercent >= 75
                  ? 'bg-emerald-600'
                  : item.accuracyPercent >= 50
                    ? 'bg-teal-600'
                    : 'bg-amber-500';
              const levelText =
                item.accuracyPercent >= 75
                  ? 'Vững vàng'
                  : item.accuracyPercent >= 50
                    ? 'Đạt yêu cầu'
                    : 'Cần phụ đạo thêm';

              return (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-bold text-slate-800">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-500">
                        Đúng {item.correctChecks}/{item.totalChecks} lượt
                      </span>
                      <span className="font-bold text-teal-900">
                        {item.accuracyPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.max(4, item.accuracyPercent)}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>Ngân hàng đề: {item.questionCountInBank} câu</span>
                    <span>Đánh giá: {levelText}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Cột 2 (6/12): Biểu đồ phân tích năng lực theo 5 Dạng câu hỏi */}
        <section
          data-testid="class-type-competency-chart"
          className="lg:col-span-6 bg-white border border-slate-200 rounded-xl p-6 space-y-4 tabular-nums"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900 flex items-center gap-2">
                <Award className="w-4 h-4 text-teal-700" />
                <span>Biểu đồ Tỷ lệ Đúng theo từng Dạng Câu hỏi</span>
              </h3>
              <p className="text-xs text-slate-500">
                Đánh giá khả năng thao tác của học sinh trên 5 cấu trúc tương tác phòng thi.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-500">
              Chuẩn All-or-Nothing
            </span>
          </div>

          <div className="space-y-3.5">
            {analytics.typeCompetency.map((item) => {
              const barColor =
                item.accuracyPercent >= 75
                  ? 'bg-emerald-600'
                  : item.accuracyPercent >= 50
                    ? 'bg-teal-600'
                    : 'bg-rose-500';

              return (
                <div key={item.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-semibold text-slate-800">
                      {item.label}
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className="text-slate-500">
                        {item.correctChecks}/{item.totalChecks} lượt đúng
                      </span>
                      <span className="font-bold text-slate-900">
                        {item.accuracyPercent}%
                      </span>
                    </div>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${Math.max(4, item.accuracyPercent)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* BẢNG "TOP CÂU HỎI BẪY (HỌC SINH SAI NHIỀU NHẤT)" */}
      <section
        data-testid="top-trap-questions-table"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
              <span>
                Bảng "Top Câu Hỏi Bẫy (Học sinh sai nhiều nhất trong toàn lớp)"
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Sắp xếp theo số lượt trả lời sai và tỷ lệ % sai cao nhất. Bấm{' '}
              <strong>"Xem nhanh & Sửa bài"</strong> để trình chiếu câu hỏi và giải thích ngay trên lớp.
            </p>
          </div>

          <button
            type="button"
            onClick={() => onNavigateToTab('questions')}
            className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
          >
            Mở Ngân hàng câu hỏi →
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Hạng</th>
                <th className="py-3 px-4">Mã câu</th>
                <th className="py-3 px-4">Nội dung câu hỏi & Chuyên đề</th>
                <th className="py-3 px-4">Dạng bài</th>
                <th className="py-3 px-4">Số lượt làm sai</th>
                <th className="py-3 px-4">Tỷ lệ % sai</th>
                <th className="py-3 px-4 text-right">Sửa bài trên lớp</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
              {analytics.trapQuestions.map((item, idx) => {
                const isHighRisk =
                  item.wrongRatePercent >= 50 || item.wrongCount >= 2;
                return (
                  <tr key={item.question.id} className="hover:bg-slate-50/80">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-700">
                      #{idx + 1}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="font-mono font-bold text-teal-800">
                        {item.question.id.toUpperCase()}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 max-w-md">
                      <div className="font-semibold text-slate-900 line-clamp-2">
                        {item.question.prompt}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {item.question.topic}
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-xs font-medium text-slate-700">
                      {QUESTION_TYPE_LABELS[item.question.type]}
                    </td>
                    <td className="py-3.5 px-4 font-mono">
                      <div className="font-bold text-rose-700">
                        {item.wrongCount} lượt sai
                      </div>
                      <div className="text-xs text-slate-500">
                        / {item.totalChecks} tổng lượt làm ({item.studentsCurrentlyStruggling} HS đang vướng)
                      </div>
                    </td>
                    <td className="py-3.5 px-4 w-44">
                      <div className="space-y-1.5">
                        <span
                          className={`font-mono text-xs font-bold ${
                            isHighRisk ? 'text-rose-700' : 'text-rose-600'
                          }`}
                        >
                          {item.wrongRatePercent}% sai
                        </span>
                        <div className="w-full h-2.5 rounded-full bg-rose-100/80 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-300 ${
                              isHighRisk ? 'bg-rose-600' : 'bg-rose-500'
                            }`}
                            style={{
                              width: `${Math.max(6, item.wrongRatePercent)}%`,
                            }}
                          />
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        type="button"
                        data-testid={`quick-review-trap-${item.question.id}`}
                        onClick={() => handleOpenQuickReview(item.question)}
                        className="px-3.5 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs transition-all duration-200 cursor-pointer whitespace-nowrap"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Xem đề & Sửa bài</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* MODAL XEM NHANH CÂU HỎI BẪY ĐỂ GIÁO VIÊN SỬA BÀI TRÊN LỚP */}
      {quickReviewQuestion && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-review-trap-title"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-xl overflow-hidden my-auto">
            <div className="px-6 py-4 bg-sky-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-rose-700">
                  Chế độ Trình chiếu Sửa bài trên lớp · Câu hỏi Bẫy{' '}
                  {quickReviewQuestion.id.toUpperCase()}
                </div>
                <h3
                  id="quick-review-trap-title"
                  className="text-base sm:text-lg font-bold text-slate-900"
                >
                  Phân tích Đáp án Chuẩn & Giải thích cho Học sinh
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setQuickReviewAnswer(quickReviewQuestion.correctAnswer)
                  }
                  className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-bold cursor-pointer"
                >
                  Điền Đáp án Chuẩn
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setQuickReviewAnswer(undefined);
                    setShowQuickReviewSolution(false);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-white border border-slate-300 text-xs font-semibold text-slate-700 cursor-pointer"
                >
                  Ẩn đáp án để gọi HS trả lời
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickReviewSolution((v) => !v)}
                  className="px-3 py-1.5 rounded-lg border border-teal-600 text-teal-800 bg-white text-xs font-bold cursor-pointer"
                >
                  {showQuickReviewSolution ? 'Ẩn giải thích' : 'Hiện giải thích'}
                </button>
                <button
                  type="button"
                  onClick={() => setQuickReviewQuestion(null)}
                  aria-label="Đóng cửa sổ sửa bài"
                  className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              <QuestionRenderer
                question={quickReviewQuestion}
                userAnswer={quickReviewAnswer}
                onChangeAnswer={setQuickReviewAnswer}
                showFeedback={showQuickReviewSolution}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// 2. PHÂN HỆ QUẢN LÝ TÀI KHOẢN (GIÁO VIÊN QUẢN TRỊ & HỌC SINH) TOÀN DIỆN
// ============================================================================

interface TeacherStudentManagerProps {
  questions: Question[];
  users: UserAccount[];
  attempts: ExamAttempt[];
  onSaveStudent: (student: UserAccount) => Promise<void>;
  onBatchSaveStudents: (students: UserAccount[]) => Promise<void>;
  onUpdateStudentPassword: (userId: string, newPassword: string) => Promise<void>;
  onResetStudentProgress: (userId: string) => Promise<void>;
  onDeleteStudent: (userId: string) => Promise<void>;
}

export const TeacherStudentManager: React.FC<TeacherStudentManagerProps> = ({
  questions,
  users,
  attempts,
  onSaveStudent,
  onBatchSaveStudents,
  onUpdateStudentPassword,
  onResetStudentProgress,
  onDeleteStudent,
}) => {
  const [newAccountRole, setNewAccountRole] = useState<UserRole>('student');
  const [newStudentId, setNewStudentId] = useState('');
  const [newStudentName, setNewStudentName] = useState('');
  const [newStudentPassword, setNewStudentPassword] = useState('123456');
  const [newStudentClass, setNewStudentClass] = useState(
    'Lớp 12A1 - Đội tuyển GenAI'
  );
  const [accountRoleFilter, setAccountRoleFilter] = useState<
    'ALL' | 'TEACHER' | 'STUDENT'
  >('ALL');
  const [studentStatusFilter, setStudentStatusFilter] = useState<
    'ALL' | 'ONLINE' | 'OFFLINE'
  >('ALL');
  const [studentPage, setStudentPage] = useState<number>(1);
  const STUDENT_PAGE_SIZE = 8;
  const [studentSearch, setStudentSearch] = useState('');
  const [statusBanner, setStatusBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isImportingExcel, setIsImportingExcel] = useState(false);

  // Các Modal thao tác cho từng tài khoản
  const [historyStudentRow, setHistoryStudentRow] =
    useState<StudentProgressSummary | null>(null);
  const [passwordStudent, setPasswordStudent] = useState<UserAccount | null>(
    null
  );
  const [newPasswordValue, setNewPasswordValue] = useState('');
  const [resetStudentTarget, setResetStudentTarget] =
    useState<UserAccount | null>(null);
  const [deleteStudentTarget, setDeleteStudentTarget] =
    useState<UserAccount | null>(null);
  const [isProcessingAction, setIsProcessingAction] = useState(false);

  const excelStudentInputRef = useRef<HTMLInputElement | null>(null);

  const analytics = useMemo(
    () => computeClassAnalytics(questions, users, attempts),
    [questions, users, attempts]
  );

  const teacherAccounts = useMemo(
    () => users.filter((u) => u.role === 'teacher'),
    [users]
  );

  const filteredTeachers = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    if (!q) return teacherAccounts;
    return teacherAccounts.filter(
      (t) =>
        t.username.toLowerCase().includes(q) ||
        t.fullName.toLowerCase().includes(q) ||
        (t.className || '').toLowerCase().includes(q)
    );
  }, [teacherAccounts, studentSearch]);

  const filteredStudentRows = useMemo(() => {
    const q = studentSearch.trim().toLowerCase();
    return analytics.studentRows.filter((r) => {
      const st = r.student;
      const isOnline =
        st.activeStatus === 'studying' ||
        st.activeStatus === 'online' ||
        st.status === 'studying' ||
        st.status === 'online';

      if (studentStatusFilter === 'ONLINE' && !isOnline) return false;
      if (studentStatusFilter === 'OFFLINE' && isOnline) return false;

      if (!q) return true;
      return (
        st.username.toLowerCase().includes(q) ||
        st.fullName.toLowerCase().includes(q) ||
        (st.className || '').toLowerCase().includes(q)
      );
    });
  }, [analytics.studentRows, studentSearch, studentStatusFilter]);

  const totalStudentPages = Math.max(
    1,
    Math.ceil(filteredStudentRows.length / STUDENT_PAGE_SIZE)
  );
  const safeStudentPage = Math.min(studentPage, totalStudentPages);
  const paginatedStudentRows = useMemo(() => {
    const start = (safeStudentPage - 1) * STUDENT_PAGE_SIZE;
    return filteredStudentRows.slice(start, start + STUDENT_PAGE_SIZE);
  }, [filteredStudentRows, safeStudentPage]);

  const handleSelectRoleForCreate = (role: UserRole) => {
    setNewAccountRole(role);
    if (role === 'teacher') {
      setNewStudentPassword('igc123456');
      setNewStudentClass('Tổ Toán - Tin · Trường IGC Tây Ninh');
    } else {
      setNewStudentPassword('123456');
      setNewStudentClass('Lớp 12A1 - Đội tuyển GenAI');
    }
  };

  // Thêm tài khoản mới (Học sinh hoặc Giáo viên Quản trị)
  const handleCreateStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusBanner(null);
    if (
      !newStudentId.trim() ||
      !newStudentName.trim() ||
      !newStudentPassword.trim()
    ) {
      setStatusBanner({
        type: 'error',
        text: 'Vui lòng điền đầy đủ Mã định danh (Username), Họ tên và Mật khẩu.',
      });
      return;
    }

    const cleanId = newStudentId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId) {
      setStatusBanner({
        type: 'error',
        text: 'Mã tài khoản chỉ được chứa chữ cái không dấu, chữ số, dấu gạch ngang hoặc gạch dưới.',
      });
      return;
    }

    const isTeacher = newAccountRole === 'teacher';
    const account: UserAccount = {
      id: cleanId,
      username: cleanId,
      password: newStudentPassword.trim(),
      fullName: newStudentName.trim(),
      role: isTeacher ? 'teacher' : 'student',
      className:
        newStudentClass.trim() ||
        (isTeacher
          ? 'Tổ Toán - Tin · Trường IGC Tây Ninh'
          : 'Lớp Luyện thi Certiport'),
      lastLogin: new Date().toISOString(),
      status: 'offline',
      activeStatus: 'offline',
      totalStudyMinutes: 0,
      totalStudySeconds: 0,
      bookmarkedQuestions: [],
      wrongQuestions: [],
      masteredQuestions: [],
      practiceProgress: {},
      createdAt: new Date().toISOString(),
    };

    await onSaveStudent(account);
    setNewStudentId('');
    setNewStudentName('');
    setNewStudentPassword(isTeacher ? 'igc123456' : '123456');
    setStatusBanner({
      type: 'success',
      text: isTeacher
        ? `Đã tạo tài khoản Quản trị viên / Giáo viên "${account.fullName}" (${account.username}) thành công!`
        : `Đã tạo tài khoản Học sinh "${account.fullName}" (${account.username}) thành công!`,
    });
  };

  // Tải file Excel mẫu nhập danh sách học sinh
  const handleDownloadStudentSampleExcel = () => {
    const bytes = buildSampleStudentImportExcelBytes();
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    downloadBlob(blob, 'Mau_Danh_Sach_Hoc_Sinh_Certiport.xlsx');
    setStatusBanner({
      type: 'success',
      text: 'Đã tải về file Excel mẫu danh sách học sinh (Mau_Danh_Sach_Hoc_Sinh_Certiport.xlsx).',
    });
  };

  // Nhập danh sách học sinh hàng loạt từ file Excel
  const handleImportStudentsExcel = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingExcel(true);
    setStatusBanner(null);

    try {
      const buf = await file.arrayBuffer();
      const importedStudents = parseStudentsFromExcelBytes(buf);
      await onBatchSaveStudents(importedStudents);
      setStatusBanner({
        type: 'success',
        text: `Đã nhập thành công ${importedStudents.length} tài khoản học sinh từ file Excel "${file.name}"!`,
      });
    } catch (err) {
      setStatusBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể đọc file Excel danh sách học sinh.',
      });
    } finally {
      setIsImportingExcel(false);
      if (excelStudentInputRef.current) {
        excelStudentInputRef.current.value = '';
      }
    }
  };

  // Xuất Báo cáo Kết quả Lớp học (.xlsx) 3 Sheet
  const handleExportClassReportExcel = () => {
    const bytes = buildClassReportWorkbookBytes(questions, users, attempts);
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const dateTag = new Date().toISOString().slice(0, 10);
    downloadBlob(
      blob,
      `Bao_Cao_Ket_Qua_Lop_Hoc_Certiport_GenAI_${dateTag}.xlsx`
    );
    setStatusBanner({
      type: 'success',
      text: 'Đã xuất Báo cáo Kết quả Lớp học (.xlsx) gồm 3 Sheet: Tổng hợp học sinh, Chi tiết lịch sử thi thử và Thống kê câu hỏi hay sai.',
    });
  };

  // Xác nhận Đổi mật khẩu tài khoản (Giáo viên hoặc Học sinh)
  const handleConfirmChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordStudent || !newPasswordValue.trim()) return;
    setIsProcessingAction(true);
    try {
      await onUpdateStudentPassword(
        passwordStudent.id,
        newPasswordValue.trim()
      );
      setStatusBanner({
        type: 'success',
        text: `Đã đổi mật khẩu mới cho tài khoản ${
          passwordStudent.role === 'teacher' ? 'Giáo viên' : 'Học sinh'
        } ${passwordStudent.fullName} (${passwordStudent.username}).`,
      });
      setPasswordStudent(null);
      setNewPasswordValue('');
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Xác nhận Reset dữ liệu làm bài của học sinh
  const handleConfirmResetProgress = async () => {
    if (!resetStudentTarget) return;
    setIsProcessingAction(true);
    try {
      await onResetStudentProgress(resetStudentTarget.id);
      setStatusBanner({
        type: 'success',
        text: `Đã reset toàn bộ dữ liệu luyện tập, kho câu sai và lịch sử thi thử của học sinh ${resetStudentTarget.fullName} (${resetStudentTarget.username}).`,
      });
      setResetStudentTarget(null);
    } finally {
      setIsProcessingAction(false);
    }
  };

  // Xác nhận Xóa tài khoản (Giáo viên hoặc Học sinh)
  const handleConfirmDeleteStudent = async () => {
    if (!deleteStudentTarget) return;
    setIsProcessingAction(true);
    try {
      await onDeleteStudent(deleteStudentTarget.id);
      setStatusBanner({
        type: 'success',
        text: `Đã xóa tài khoản ${
          deleteStudentTarget.role === 'teacher' ? 'Giáo viên' : 'Học sinh'
        } ${deleteStudentTarget.fullName} (${deleteStudentTarget.username}) khỏi hệ thống.`,
      });
      setDeleteStudentTarget(null);
    } finally {
      setIsProcessingAction(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Thanh công cụ Quản lý Tài khoản (Giáo viên Quản trị & Học sinh) */}
      <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base sm:text-lg font-bold text-slate-900">
              Quản lý Tài khoản Giáo viên & Học sinh ({teacherAccounts.length}{' '}
              Giáo viên · {analytics.studentRows.length} Học sinh)
            </h2>
            <p className="text-xs text-slate-500">
              Cấp thêm tài khoản Quản trị viên cho Giáo viên Tổ Toán - Tin, thêm tài khoản Học sinh lẻ hoặc nhập hàng loạt từ Excel.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={excelStudentInputRef}
              type="file"
              accept=".xlsx,.xls"
              onChange={handleImportStudentsExcel}
              className="hidden"
              id="import-students-excel-input"
              data-testid="import-students-excel-input"
            />
            <label
              htmlFor="import-students-excel-input"
              className="px-3.5 py-2 rounded-lg border border-teal-600 bg-teal-50/70 hover:bg-teal-100 text-xs font-bold text-teal-900 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-teal-700" />
              <span>
                {isImportingExcel
                  ? 'Đang nhập...'
                  : 'Nhập DS Học sinh từ Excel (.xlsx)'}
              </span>
            </label>

            <button
              type="button"
              data-testid="download-student-sample-excel-btn"
              onClick={handleDownloadStudentSampleExcel}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-teal-700" />
              <span>Tải Excel mẫu DS Học sinh</span>
            </button>

            <button
              type="button"
              onClick={handleExportClassReportExcel}
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>Xuất Báo Cáo Kết Quả Lớp Học (.xlsx)</span>
            </button>
          </div>
        </div>

        {statusBanner && (
          <div
            role="status"
            data-testid="student-manager-status-banner"
            className={`p-3.5 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-between gap-3 ${
              statusBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                : 'bg-rose-50 border-rose-300 text-rose-950'
            }`}
          >
            <div className="flex items-center gap-2">
              {statusBanner.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              )}
              <span>{statusBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setStatusBanner(null)}
              className="text-xs underline shrink-0 cursor-pointer"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Bộ chọn Loại Tài khoản muốn cấp mới: Học sinh hoặc Giáo viên Quản trị */}
        <div className="pt-3 border-t border-slate-100 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-slate-100 border border-slate-200">
              <button
                type="button"
                data-testid="select-create-role-student"
                onClick={() => handleSelectRoleForCreate('student')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                  newAccountRole === 'student'
                    ? 'bg-teal-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Tạo Tài khoản Học sinh</span>
              </button>

              <button
                type="button"
                data-testid="select-create-role-teacher"
                onClick={() => handleSelectRoleForCreate('teacher')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                  newAccountRole === 'teacher'
                    ? 'bg-indigo-700 text-white shadow-2xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Tạo Tài khoản Quản trị (Giáo viên)</span>
              </button>
            </div>

            <span className="text-xs text-slate-500">
              {newAccountRole === 'teacher'
                ? 'Tài khoản Giáo viên có toàn quyền quản lý Ngân hàng câu hỏi, Tài khoản và Báo cáo lớp học.'
                : 'Tài khoản Học sinh dùng để ôn luyện từng câu, ôn Kho câu sai và làm bài Thi thử.'}
            </span>
          </div>

          {/* Form Thêm nhanh Tài khoản (Học sinh hoặc Giáo viên Quản trị) */}
          <form
            onSubmit={handleCreateStudent}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
          >
            <div>
              <label
                htmlFor="new-student-id"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {newAccountRole === 'teacher'
                  ? 'Tên đăng nhập Giáo viên *'
                  : 'Mã học sinh (Student ID) *'}
              </label>
              <input
                id="new-student-id"
                type="text"
                required
                value={newStudentId}
                onChange={(e) => setNewStudentId(e.target.value)}
                placeholder={
                  newAccountRole === 'teacher'
                    ? 'Ví dụ: gv_toantin01'
                    : 'Ví dụ: HS003'
                }
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="new-student-name"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {newAccountRole === 'teacher'
                  ? 'Họ và tên Giáo viên *'
                  : 'Họ và tên Học sinh *'}
              </label>
              <input
                id="new-student-name"
                type="text"
                required
                value={newStudentName}
                onChange={(e) => setNewStudentName(e.target.value)}
                placeholder={
                  newAccountRole === 'teacher'
                    ? 'Ví dụ: Thầy Nguyễn Văn A'
                    : 'Ví dụ: Lê Thị Bảo Ngọc'
                }
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300"
              />
            </div>

            <div>
              <label
                htmlFor="new-student-pass"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mật khẩu khởi tạo *
              </label>
              <input
                id="new-student-pass"
                type="text"
                required
                value={newStudentPassword}
                onChange={(e) => setNewStudentPassword(e.target.value)}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 font-mono"
              />
            </div>

            <div>
              <label
                htmlFor="new-student-class"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                {newAccountRole === 'teacher'
                  ? 'Tổ chuyên môn / Đơn vị'
                  : 'Lớp / Đội tuyển'}
              </label>
              <input
                id="new-student-class"
                type="text"
                value={newStudentClass}
                onChange={(e) => setNewStudentClass(e.target.value)}
                placeholder={
                  newAccountRole === 'teacher'
                    ? 'Tổ Toán - Tin · Trường IGC Tây Ninh'
                    : 'Ví dụ: Lớp 12A1'
                }
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300"
              />
            </div>

            <button
              type="submit"
              data-testid="add-single-student-btn"
              className={`py-2.5 px-3.5 rounded-lg text-white text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors cursor-pointer ${
                newAccountRole === 'teacher'
                  ? 'bg-indigo-700 hover:bg-indigo-800'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              {newAccountRole === 'teacher' ? (
                <>
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>Thêm Giáo viên</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4 shrink-0" />
                  <span>Thêm Học sinh</span>
                </>
              )}
            </button>
          </form>
        </div>
      </section>

      {/* Thanh Bộ lọc Loại tài khoản & Ô tìm kiếm chung */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-white border border-slate-200">
          <button
            type="button"
            onClick={() => setAccountRoleFilter('ALL')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              accountRoleFilter === 'ALL'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Tất cả tài khoản ({users.length})
          </button>
          <button
            type="button"
            data-testid="filter-accounts-teacher"
            onClick={() => setAccountRoleFilter('TEACHER')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              accountRoleFilter === 'TEACHER'
                ? 'bg-indigo-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Giáo viên Quản trị ({teacherAccounts.length})
          </button>
          <button
            type="button"
            data-testid="filter-accounts-student"
            onClick={() => setAccountRoleFilter('STUDENT')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              accountRoleFilter === 'STUDENT'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            Học sinh ({analytics.studentRows.length})
          </button>
        </div>

        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={studentSearch}
            onChange={(e) => setStudentSearch(e.target.value)}
            placeholder="Tìm Mã đăng nhập, Họ tên, Tổ hoặc Lớp..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 bg-white text-slate-900"
          />
        </div>
      </div>

      {/* BẢNG 1: DANH SÁCH TÀI KHOẢN QUẢN TRỊ VIÊN / GIÁO VIÊN TỔ TOÁN - TIN */}
      {(accountRoleFilter === 'ALL' || accountRoleFilter === 'TEACHER') && (
        <section
          data-testid="teacher-accounts-table"
          className="bg-white border border-slate-200 rounded-xl overflow-hidden"
        >
          <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-indigo-50/40">
            <div className="space-y-0.5">
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-700" />
                <span>
                  Danh sách Tài khoản Quản trị / Giáo viên Tổ Toán - Tin (
                  {filteredTeachers.length})
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Các tài khoản Giáo viên có quyền quản lý Ngân hàng câu hỏi, cấp tài khoản mới và xuất báo cáo kết quả lớp học.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                  <th className="py-3 px-4">Tài khoản (Username) & Họ tên</th>
                  <th className="py-3 px-4">Tổ chuyên môn / Đơn vị</th>
                  <th className="py-3 px-4">Phân quyền</th>
                  <th className="py-3 px-4">Đăng nhập gần nhất</th>
                  <th className="py-3 px-4 text-right">Thao tác quản trị</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
                {filteredTeachers.map((teacher) => {
                  const isRootAdmin =
                    teacher.id.toLowerCase() === 'admin' ||
                    teacher.username.toLowerCase() === 'admin';
                  return (
                    <tr key={teacher.id} className="hover:bg-slate-50/80">
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-indigo-800">
                            {teacher.username}
                          </span>
                          <span className="text-xs font-mono text-slate-400">
                            (MK: {teacher.password})
                          </span>
                          {isRootAdmin && (
                            <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 text-[10px] font-bold">
                              Quản trị gốc
                            </span>
                          )}
                        </div>
                        <div className="font-semibold text-slate-900">
                          {teacher.fullName}
                        </div>
                      </td>

                      <td className="py-3.5 px-4 text-xs text-slate-700 font-medium">
                        {teacher.className ||
                          'Tổ Toán - Tin · Trường IGC Tây Ninh'}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-50 border border-indigo-200 text-xs font-bold text-indigo-800">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Giáo viên Quản trị</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-xs font-mono text-slate-600">
                        {teacher.lastLogin
                          ? new Date(teacher.lastLogin).toLocaleString('vi-VN')
                          : 'Chưa đăng nhập'}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-testid={`change-password-${teacher.id}`}
                            onClick={() => {
                              setPasswordStudent(teacher);
                              setNewPasswordValue(teacher.password);
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                            <span>Đổi MK</span>
                          </button>

                          {!isRootAdmin && (
                            <button
                              type="button"
                              data-testid={`delete-teacher-${teacher.id}`}
                              onClick={() => setDeleteStudentTarget(teacher)}
                              className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-xs font-semibold text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Xóa</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* BẢNG 2: BẢNG THEO DÕI HỌC SINH TRỰC QUAN & THAO TÁC CHI TIẾT */}
      {(accountRoleFilter === 'ALL' || accountRoleFilter === 'STUDENT') && (
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-teal-700" />
              <span>
                Bảng Theo dõi Tài khoản & Tiến độ Học sinh ({filteredStudentRows.length})
              </span>
            </h3>
            <p className="text-xs text-slate-500">
              Theo dõi thời gian ôn tập, số câu đã luyện, kho câu sai, điểm thi thử cao nhất / trung bình và thao tác quản trị từng tài khoản học sinh.
            </p>
          </div>

          {/* Bộ lọc Trạng thái Đang Online / Offline */}
          <div
            data-testid="student-status-filter-group"
            className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-100 border border-slate-200"
          >
            <button
              type="button"
              data-testid="filter-student-status-all"
              onClick={() => {
                setStudentStatusFilter('ALL');
                setStudentPage(1);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                studentStatusFilter === 'ALL'
                  ? 'bg-teal-700 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tất cả ({analytics.studentRows.length})
            </button>
            <button
              type="button"
              data-testid="filter-student-status-online"
              onClick={() => {
                setStudentStatusFilter('ONLINE');
                setStudentPage(1);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all inline-flex items-center gap-1.5 cursor-pointer ${
                studentStatusFilter === 'ONLINE'
                  ? 'bg-emerald-700 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400" />
              <span>Đang Online ({analytics.totalActiveStudents})</span>
            </button>
            <button
              type="button"
              data-testid="filter-student-status-offline"
              onClick={() => {
                setStudentStatusFilter('OFFLINE');
                setStudentPage(1);
              }}
              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                studentStatusFilter === 'OFFLINE'
                  ? 'bg-slate-700 text-white shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Offline (
              {Math.max(
                0,
                analytics.studentRows.length - analytics.totalActiveStudents
              )}
              )
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                <th className="py-3 px-4">Mã HS & Họ tên</th>
                <th className="py-3 px-4">Trạng thái & Đăng nhập gần nhất</th>
                <th className="py-3 px-4">Tổng TG ôn tập</th>
                <th className="py-3 px-4">Tiến độ Luyện tập</th>
                <th className="py-3 px-4">Kho câu sai</th>
                <th className="py-3 px-4">Số lần Thi thử</th>
                <th className="py-3 px-4">Điểm Cao nhất / TB</th>
                <th className="py-3 px-4 text-right">Thao tác quản trị</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
              {paginatedStudentRows.map((row) => {
                const st = row.student;
                const isOnline =
                  st.activeStatus === 'studying' ||
                  st.activeStatus === 'online' ||
                  st.status === 'studying' ||
                  st.status === 'online';

                return (
                  <tr key={st.id} className="hover:bg-slate-50/80">
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-teal-800">
                          {st.username}
                        </span>
                        <span className="text-xs font-mono text-slate-400">
                          (MK: {st.password})
                        </span>
                      </div>
                      <div className="font-semibold text-slate-900">
                        {st.fullName}
                      </div>
                      <div className="text-xs text-slate-500">
                        {st.className || 'Lớp Luyện thi Certiport'}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 text-xs">
                      <div className="font-semibold">
                        {isOnline ? (
                          <span className="text-emerald-700">
                            Đang trực tuyến ({st.activeStatus || st.status})
                          </span>
                        ) : (
                          <span className="text-slate-500">Ngoại tuyến</span>
                        )}
                      </div>
                      <div className="text-slate-500 font-mono mt-0.5">
                        {new Date(st.lastLogin).toLocaleString('vi-VN')}
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs font-semibold text-slate-900">
                      {formatStudyDuration(st.totalStudySeconds || 0)}
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs">
                      <div className="font-bold text-teal-800">
                        {row.practicedCount} / {questions.length} câu
                      </div>
                      <div className="text-slate-500">
                        Đã khắc phục: {row.masteredCount} câu
                      </div>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs">
                      <span
                        className={`font-bold ${
                          row.wrongPoolCount > 0
                            ? 'text-rose-700'
                            : 'text-emerald-700'
                        }`}
                      >
                        {row.wrongPoolCount} câu sai
                      </span>
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs font-bold text-slate-900">
                      {row.attemptCount} đề
                    </td>

                    <td className="py-3.5 px-4 font-mono text-xs">
                      {row.attemptCount > 0 ? (
                        <div>
                          <div className="font-bold text-teal-900">
                            Cao nhất: {row.highestScore1000}/1000
                          </div>
                          <div className="text-slate-600">
                            Trung bình: {row.averageScore1000}/1000 (
                            {row.averagePercentage}%)
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-400">Chưa thi thử</span>
                      )}
                    </td>

                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button
                          type="button"
                          data-testid={`view-student-history-${st.id}`}
                          onClick={() => setHistoryStudentRow(row)}
                          className="px-2.5 py-1.5 rounded-lg border border-teal-300 bg-teal-50/70 hover:bg-teal-100 text-xs font-semibold text-teal-900 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <History className="w-3.5 h-3.5" />
                          <span>Lịch sử ({row.attemptCount})</span>
                        </button>

                        <button
                          type="button"
                          data-testid={`change-password-${st.id}`}
                          onClick={() => {
                            setPasswordStudent(st);
                            setNewPasswordValue(st.password);
                          }}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          <span>Đổi MK</span>
                        </button>

                        <button
                          type="button"
                          data-testid={`reset-progress-${st.id}`}
                          onClick={() => setResetStudentTarget(st)}
                          className="px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50/70 hover:bg-amber-100 text-xs font-semibold text-amber-900 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Reset bài</span>
                        </button>

                        <button
                          type="button"
                          data-testid={`delete-student-${st.id}`}
                          aria-label={`Xóa tài khoản ${st.username}`}
                          onClick={() => setDeleteStudentTarget(st)}
                          className="px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-xs font-semibold text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Thanh phân trang danh sách học sinh mượt mà */}
        <div
          data-testid="student-table-pagination"
          className="px-5 py-3 bg-slate-50/70 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-600 tabular-nums"
        >
          <span>
            Hiển thị{' '}
            <strong className="text-slate-900">
              {paginatedStudentRows.length}
            </strong>{' '}
            / <strong className="text-slate-900">{filteredStudentRows.length}</strong>{' '}
            học sinh · Trang <strong className="text-teal-800">{safeStudentPage}</strong> /{' '}
            {totalStudentPages}
          </span>

          <div className="inline-flex items-center gap-1.5">
            <button
              type="button"
              disabled={safeStudentPage <= 1}
              onClick={() => setStudentPage((p) => Math.max(1, p - 1))}
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold text-slate-700 cursor-pointer transition-all"
            >
              ← Trang trước
            </button>
            <button
              type="button"
              disabled={safeStudentPage >= totalStudentPages}
              onClick={() =>
                setStudentPage((p) => Math.min(totalStudentPages, p + 1))
              }
              className="px-3 py-1 rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-40 font-semibold text-slate-700 cursor-pointer transition-all"
            >
              Trang tiếp →
            </button>
          </div>
        </div>
      </section>
      )}

      {/* MODAL 1: XEM CHI TIẾT LỊCH SỬ BÀI LÀM CỦA HỌC SINH */}
      {historyStudentRow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="student-history-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4 overflow-y-auto"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-xl overflow-hidden my-auto">
            <div className="px-6 py-4 bg-sky-50/80 border-b border-slate-200 flex items-center justify-between gap-4">
              <div>
                <div className="text-xs font-bold uppercase tracking-wider text-teal-800">
                  Hồ sơ Học tập Chi tiết · Mã HS:{' '}
                  {historyStudentRow.student.username}
                </div>
                <h3
                  id="student-history-modal-title"
                  className="text-base sm:text-lg font-bold text-slate-900"
                >
                  {historyStudentRow.student.fullName} (
                  {historyStudentRow.student.className ||
                    'Lớp Luyện thi Certiport'}
                  )
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setHistoryStudentRow(null)}
                aria-label="Đóng cửa sổ lịch sử học sinh"
                className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6 overflow-y-auto flex-1 tabular-nums">
              {/* Tóm tắt 4 chỉ số của học sinh */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">Tổng TG ôn tập</div>
                  <div className="text-base font-bold font-mono text-teal-800">
                    {formatStudyDuration(
                      historyStudentRow.student.totalStudySeconds || 0
                    )}
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">Đã luyện tập</div>
                  <div className="text-base font-bold font-mono text-slate-900">
                    {historyStudentRow.practicedCount} / {questions.length} câu
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">
                    Còn trong Kho câu sai
                  </div>
                  <div className="text-base font-bold font-mono text-rose-700">
                    {historyStudentRow.wrongPoolCount} câu
                  </div>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                  <div className="text-xs text-slate-500">
                    Điểm Cao nhất / Trung bình
                  </div>
                  <div className="text-base font-bold font-mono text-teal-800">
                    {historyStudentRow.highestScore1000} /{' '}
                    {historyStudentRow.averageScore1000}
                  </div>
                </div>
              </div>

              {/* Danh sách câu hỏi đang nằm trong Kho câu sai của học sinh này */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-rose-600" />
                  <span>
                    Các câu hỏi học sinh đang còn sai trong Kho câu sai (
                    {historyStudentRow.wrongPoolCount} câu)
                  </span>
                </h4>
                {historyStudentRow.wrongPoolCount === 0 ? (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs text-emerald-900">
                    Học sinh hiện không có câu hỏi nào tồn đọng trong Kho câu sai.
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(historyStudentRow.student.wrongQuestions ?? []).map(
                      (qId) => {
                        const qObj = questions.find((q) => q.id === qId);
                        return (
                          <div
                            key={qId}
                            className="px-3 py-1.5 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-950"
                          >
                            <strong className="font-mono">
                              {qId.toUpperCase()}:
                            </strong>{' '}
                            <span>
                              {qObj
                                ? qObj.prompt.slice(0, 65) + '...'
                                : 'Câu hỏi trong ngân hàng'}
                            </span>
                          </div>
                        );
                      }
                    )}
                  </div>
                )}
              </div>

              {/* Bảng lịch sử các lượt thi thử của học sinh */}
              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-teal-700" />
                  <span>
                    Danh sách Lịch sử Thi thử ({historyStudentRow.attemptCount}{' '}
                    lượt)
                  </span>
                </h4>

                {historyStudentRow.studentAttempts.length === 0 ? (
                  <div className="p-6 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500">
                    Học sinh này chưa có lượt nộp bài thi thử nào.
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                          <th className="py-2.5 px-3">Ngày giờ nộp</th>
                          <th className="py-2.5 px-3">Bộ đề / Chế độ</th>
                          <th className="py-2.5 px-3">Số câu đúng</th>
                          <th className="py-2.5 px-3">Điểm Certiport</th>
                          <th className="py-2.5 px-3">Thời gian làm</th>
                          <th className="py-2.5 px-3">Kết quả</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 text-xs">
                        {historyStudentRow.studentAttempts.map((att) => {
                          const cScore =
                            att.certiportScore ??
                            Math.round(
                              ((att.score ?? att.correctCount) /
                                Math.max(1, att.totalQuestions)) *
                                1000
                            );
                          const passed = cScore >= 700;
                          return (
                            <tr key={att.id}>
                              <td className="py-2.5 px-3 font-mono text-slate-600">
                                {new Date(att.completedAt).toLocaleString(
                                  'vi-VN'
                                )}
                              </td>
                              <td className="py-2.5 px-3 font-medium text-slate-900">
                                {att.mode || att.examSet}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-bold text-slate-800">
                                {att.score ?? att.correctCount}/
                                {att.totalQuestions}
                              </td>
                              <td className="py-2.5 px-3 font-mono font-bold text-teal-800">
                                {cScore} / 1000
                              </td>
                              <td className="py-2.5 px-3 font-mono text-slate-600">
                                {formatStudyDuration(att.durationSeconds)}
                              </td>
                              <td className="py-2.5 px-3 font-bold">
                                {passed ? (
                                  <span className="text-emerald-700">
                                    PASS (&ge;700)
                                  </span>
                                ) : (
                                  <span className="text-rose-700">
                                    FAIL (&lt;700)
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: ĐỔI MẬT KHẨU TÀI KHOẢN (GIÁO VIÊN HOẶC HỌC SINH) */}
      {passwordStudent && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="change-password-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <form
            onSubmit={handleConfirmChangePassword}
            className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4"
          >
            <div className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-teal-800 flex items-center gap-1.5">
                <KeyRound className="w-4 h-4" />
                <span>
                  Cập nhật Mật khẩu{' '}
                  {passwordStudent.role === 'teacher' ? 'Giáo viên' : 'Học sinh'}
                </span>
              </div>
              <h3
                id="change-password-modal-title"
                className="text-base font-bold text-slate-900"
              >
                Đổi mật khẩu cho {passwordStudent.fullName} (
                {passwordStudent.username})
              </h3>
            </div>

            <div>
              <label
                htmlFor="student-new-password-input"
                className="block text-xs font-semibold text-slate-700 mb-1"
              >
                Mật khẩu mới
              </label>
              <input
                id="student-new-password-input"
                type="text"
                required
                value={newPasswordValue}
                onChange={(e) => setNewPasswordValue(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setPasswordStudent(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="submit"
                data-testid="confirm-change-password-btn"
                disabled={isProcessingAction}
                className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold cursor-pointer"
              >
                {isProcessingAction ? 'Đang lưu...' : 'Lưu mật khẩu mới'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MODAL 3: XÁC NHẬN RESET DỮ LIỆU LÀM BÀI CỦA HỌC SINH */}
      {resetStudentTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-student-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <RotateCcw className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3
                  id="reset-student-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Reset dữ liệu làm bài của {resetStudentTarget.fullName} (
                  {resetStudentTarget.username})?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Thao tác này sẽ đưa thời gian ôn tập, tiến độ luyện tập, kho câu sai và lịch sử thi thử của học sinh này về 0 để học sinh bắt đầu ôn luyện lại từ đầu. Tài khoản đăng nhập vẫn được giữ nguyên.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setResetStudentTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Hủy
              </button>
              <button
                type="button"
                data-testid="confirm-reset-progress-btn"
                disabled={isProcessingAction}
                onClick={handleConfirmResetProgress}
                className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold cursor-pointer"
              >
                {isProcessingAction
                  ? 'Đang reset...'
                  : 'Xác nhận Reset dữ liệu'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: XÁC NHẬN XÓA TÀI KHOẢN (GIÁO VIÊN HOẶC HỌC SINH) */}
      {deleteStudentTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-student-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3
                  id="delete-student-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Xóa tài khoản{' '}
                  {deleteStudentTarget.role === 'teacher'
                    ? 'Giáo viên'
                    : 'Học sinh'}{' '}
                  {deleteStudentTarget.fullName} ({deleteStudentTarget.username}
                  )?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Tài khoản này sẽ bị xóa khỏi hệ thống và không thể đăng nhập được nữa.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteStudentTarget(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Giữ lại
              </button>
              <button
                type="button"
                data-testid="confirm-delete-student-btn"
                disabled={isProcessingAction}
                onClick={handleConfirmDeleteStudent}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
              >
                {isProcessingAction ? 'Đang xóa...' : 'Xóa tài khoản'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
