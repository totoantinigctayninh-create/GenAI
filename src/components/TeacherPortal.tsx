import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  Eye,
  FileJson,
  FileSpreadsheet,
  Image as ImageIcon,
  Layers,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  CERTIPORT_TOPICS,
  ExamAttempt,
  QUESTION_TYPE_LABELS,
  Question,
  QuestionType,
  UserAccount,
  UserAnswer,
} from '../types/exam';
import {
  applyImageToQuestion,
  buildSampleExcelWorkbookBytes,
  compressImageFileToBase64,
  exportQuestionsToExcelBytes,
  parseQuestionsFromExcelBytes,
  parseQuestionsFromJson,
  serializeQuestionsToJson,
} from '../utils/questionBankUtils';
import { evaluateQuestion } from '../utils/scoring';
import { buildClassReportWorkbookBytes } from '../utils/teacherAnalytics';
import { ThemeToggleButton } from '../context/ThemeContext';
import { IgcToanTinDefaultEmblem } from './LoginScreen';
import { QuestionEditorModal } from './QuestionEditorModal';
import { QuestionRenderer } from './QuestionRenderer';
import { formatStudyDuration } from './StudentPortal';
import {
  TeacherClassAnalytics,
  TeacherStudentManager,
} from './TeacherAnalyticsAndStudents';

interface TeacherPortalProps {
  currentUser: UserAccount;
  users: UserAccount[];
  questions: Question[];
  attempts: ExamAttempt[];
  onLogout: () => Promise<void>;
  onSaveStudent: (student: UserAccount) => Promise<void>;
  onBatchSaveStudents: (students: UserAccount[]) => Promise<void>;
  onUpdateStudentPassword: (
    userId: string,
    newPassword: string
  ) => Promise<void>;
  onResetStudentProgress: (userId: string) => Promise<void>;
  onDeleteStudent: (userId: string) => Promise<void>;
  onSaveQuestion: (question: Question) => Promise<void>;
  onDeleteQuestion: (questionId: string) => Promise<void>;
  onBatchSaveQuestions: (
    questions: Question[],
    replaceAll?: boolean
  ) => Promise<void>;
  onResetSeedData: () => Promise<void>;
  departmentLogoUrl?: string;
  onUpdateDepartmentLogo?: (newLogoUrl: string) => Promise<void>;
}

type TeacherTab = 'overview' | 'questions' | 'students' | 'attempts';

function triggerBrowserDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export const TeacherPortal: React.FC<TeacherPortalProps> = ({
  currentUser,
  users,
  questions,
  attempts,
  onLogout,
  onSaveStudent,
  onBatchSaveStudents,
  onUpdateStudentPassword,
  onResetStudentProgress,
  onDeleteStudent,
  onSaveQuestion,
  onDeleteQuestion,
  onBatchSaveQuestions,
  onResetSeedData,
  departmentLogoUrl = '',
  onUpdateDepartmentLogo,
}) => {
  const [activeTab, setActiveTab] = useState<TeacherTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    if (
      tabParam === 'overview' ||
      tabParam === 'questions' ||
      tabParam === 'students' ||
      tabParam === 'attempts'
    ) {
      return tabParam;
    }
    return 'questions';
  });

  // =========================================================================
  // 1. STATE BỘ LỌC & QUẢN LÝ NGÂN HÀNG CÂU HỎI
  // =========================================================================
  const [searchQuery, setSearchQuery] = useState('');
  const [topicFilter, setTopicFilter] = useState<string>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [imageFilter, setImageFilter] = useState<
    'ALL' | 'WITH_IMAGE' | 'WITHOUT_IMAGE'
  >('ALL');
  const [previewQuestionId, setPreviewQuestionId] = useState<string>('q1');
  const [previewAnswer, setPreviewAnswer] = useState<UserAnswer | undefined>(
    undefined
  );
  const [showPreviewSolution, setShowPreviewSolution] = useState<boolean>(true);

  // State cho Khung Thêm / Cập nhật Hình ảnh Nhanh trực tiếp trên từng câu hỏi trong Ngân hàng
  const [quickImageUrlInput, setQuickImageUrlInput] = useState<string>('');
  const [isQuickUploadingImage, setIsQuickUploadingImage] =
    useState<boolean>(false);
  const [isQuickDraggingImage, setIsQuickDraggingImage] =
    useState<boolean>(false);
  const quickImageFileInputRef = useRef<HTMLInputElement | null>(null);

  // Modal Thêm / Sửa câu hỏi động
  const [isQuestionModalOpen, setIsQuestionModalOpen] = useState<boolean>(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);

  // Modal Xác nhận xóa câu hỏi
  const [questionToDelete, setQuestionToDelete] = useState<Question | null>(null);
  const [isDeletingQuestion, setIsDeletingQuestion] = useState<boolean>(false);

  // Thông báo trạng thái Thao tác Ngân hàng đề (Import / Export / CRUD)
  const [bankStatusMessage, setBankStatusMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [isImportingFile, setIsImportingFile] = useState<boolean>(false);
  const [isResettingSeed, setIsResettingSeed] = useState(false);

  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);

  const studentAccounts = useMemo(
    () => users.filter((u) => u.role === 'student'),
    [users]
  );

  const questionsWithImageCount = useMemo(
    () => questions.filter((q) => Boolean(q.imageUrl && q.imageUrl.trim())).length,
    [questions]
  );

  // Danh sách câu hỏi sau khi áp dụng Bộ lọc (Từ khóa, Chuyên đề, Loại câu hỏi, Hình ảnh)
  const filteredQuestions = useMemo(() => {
    return questions.filter((q) => {
      const matchTopic = topicFilter === 'ALL' || q.topic === topicFilter;
      const matchType = typeFilter === 'ALL' || q.type === typeFilter;
      const hasImg = Boolean(q.imageUrl && q.imageUrl.trim());
      const matchImage =
        imageFilter === 'ALL' ||
        (imageFilter === 'WITH_IMAGE' && hasImg) ||
        (imageFilter === 'WITHOUT_IMAGE' && !hasImg);
      const matchText =
        !searchQuery.trim() ||
        q.prompt.toLowerCase().includes(searchQuery.toLowerCase()) ||
        q.id.toLowerCase().includes(searchQuery.toLowerCase());
      return matchTopic && matchType && matchImage && matchText;
    });
  }, [questions, topicFilter, typeFilter, imageFilter, searchQuery]);

  const selectedPreviewQuestion = useMemo(
    () =>
      questions.find((q) => q.id === previewQuestionId) ??
      filteredQuestions[0] ??
      questions[0] ??
      null,
    [questions, previewQuestionId, filteredQuestions]
  );

  const handleSelectPreviewQuestion = (q: Question) => {
    setPreviewQuestionId(q.id);
    setPreviewAnswer(q.correctAnswer);
    setShowPreviewSolution(true);
    setQuickImageUrlInput(
      q.imageUrl && !q.imageUrl.startsWith('data:image/') ? q.imageUrl : ''
    );
  };

  // Xử lý gắn hoặc xóa hình ảnh trực tiếp cho câu hỏi đang chọn trong Ngân hàng đề
  const handleAttachImageToSelectedQuestion = async (
    targetQuestion: Question,
    newImageUrl: string
  ) => {
    const updated = applyImageToQuestion(targetQuestion, newImageUrl);
    await onSaveQuestion(updated);
    setPreviewQuestionId(updated.id);
    setBankStatusMessage({
      type: 'success',
      text: newImageUrl.trim()
        ? `Đã thêm/cập nhật hình ảnh đề thi cho câu hỏi "${updated.id.toUpperCase()}" và lưu lên Firebase Firestore!`
        : `Đã xóa hình ảnh khỏi câu hỏi "${updated.id.toUpperCase()}".`,
    });
  };

  const handleQuickImageFileUpload = async (file: File | Blob) => {
    if (!selectedPreviewQuestion) return;
    if (file.type && !file.type.startsWith('image/')) {
      setBankStatusMessage({
        type: 'error',
        text: 'Vui lòng chọn tệp hình ảnh hợp lệ (.png, .jpg, .jpeg, .webp, .svg).',
      });
      return;
    }
    setIsQuickUploadingImage(true);
    try {
      const base64DataUrl = await compressImageFileToBase64(file);
      await handleAttachImageToSelectedQuestion(
        selectedPreviewQuestion,
        base64DataUrl
      );
    } catch (err) {
      setBankStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể xử lý hình ảnh đã tải lên.',
      });
    } finally {
      setIsQuickUploadingImage(false);
      if (quickImageFileInputRef.current) {
        quickImageFileInputRef.current.value = '';
      }
    }
  };

  const handleQuickPasteImage = async (e: React.ClipboardEvent) => {
    if (!selectedPreviewQuestion) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          await handleQuickImageFileUpload(blob);
        }
        return;
      }
    }
  };

  // Mở Modal Thêm mới câu hỏi
  const handleOpenAddModal = () => {
    setEditingQuestion(null);
    setIsQuestionModalOpen(true);
  };

  // Mở Modal Chỉnh sửa câu hỏi
  const handleOpenEditModal = (q: Question) => {
    setEditingQuestion(q);
    setIsQuestionModalOpen(true);
  };

  // Lưu câu hỏi từ Modal (Thêm mới hoặc Cập nhật)
  const handleSaveQuestionFromModal = async (builtQuestion: Question) => {
    const isEdit = Boolean(editingQuestion);
    await onSaveQuestion(builtQuestion);
    setPreviewQuestionId(builtQuestion.id);
    setPreviewAnswer(builtQuestion.correctAnswer);
    setBankStatusMessage({
      type: 'success',
      text: isEdit
        ? `Đã cập nhật câu hỏi "${builtQuestion.id.toUpperCase()}" (${QUESTION_TYPE_LABELS[builtQuestion.type]}) lên Firebase Firestore.`
        : `Đã thêm mới câu hỏi "${builtQuestion.id.toUpperCase()}" (${QUESTION_TYPE_LABELS[builtQuestion.type]}) vào Ngân hàng câu hỏi chung trên Firebase Firestore.`,
    });
  };

  // Xác nhận Xóa câu hỏi
  const handleConfirmDeleteQuestion = async () => {
    if (!questionToDelete) return;
    setIsDeletingQuestion(true);
    try {
      const deletedId = questionToDelete.id;
      await onDeleteQuestion(deletedId);
      setQuestionToDelete(null);
      setBankStatusMessage({
        type: 'success',
        text: `Đã xóa câu hỏi "${deletedId.toUpperCase()}" khỏi Ngân hàng câu hỏi và Firebase Firestore.`,
      });
    } catch (err) {
      setBankStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể xóa câu hỏi. Vui lòng thử lại.',
      });
    } finally {
      setIsDeletingQuestion(false);
    }
  };

  // =========================================================================
  // 3. HANDLERS NHẬP / XUẤT HÀNG LOẠT (JSON & EXCEL .XLSX)
  // =========================================================================

  // Xuất toàn bộ Ngân hàng câu hỏi ra file JSON
  const handleExportJson = () => {
    const jsonString = serializeQuestionsToJson(questions);
    const blob = new Blob([jsonString], {
      type: 'application/json;charset=utf-8',
    });
    triggerBrowserDownload(
      blob,
      `Ngan_Hang_Cau_Hoi_Certiport_GenAI_${questions.length}_cau.json`
    );
    setBankStatusMessage({
      type: 'success',
      text: `Đã xuất thành công ${questions.length} câu hỏi ra file JSON.`,
    });
  };

  // Nhập Ngân hàng câu hỏi từ file JSON
  const handleImportJsonChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingFile(true);
    setBankStatusMessage(null);

    try {
      const text = await file.text();
      const importedQuestions = parseQuestionsFromJson(text);
      await onBatchSaveQuestions(importedQuestions, false);
      setPreviewQuestionId(importedQuestions[0].id);
      setPreviewAnswer(importedQuestions[0].correctAnswer);
      setBankStatusMessage({
        type: 'success',
        text: `Đã nhập thành công ${importedQuestions.length} câu hỏi từ file JSON "${file.name}" và đồng bộ lên Firebase Firestore!`,
      });
    } catch (err) {
      setBankStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể đọc file JSON. Vui lòng kiểm tra cấu trúc file.',
      });
    } finally {
      setIsImportingFile(false);
      if (jsonInputRef.current) jsonInputRef.current.value = '';
    }
  };

  // Tải về File Excel Mẫu (.xlsx)
  const handleDownloadSampleExcel = () => {
    const bytes = buildSampleExcelWorkbookBytes();
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerBrowserDownload(blob, 'Mau_Nhap_Cau_Hoi_Certiport_GenAI.xlsx');
    setBankStatusMessage({
      type: 'success',
      text: 'Đã tải về file Excel mẫu (.xlsx) gồm 5 câu hỏi mẫu đủ 5 dạng và Sheet Hướng dẫn nhập liệu.',
    });
  };

  // Xuất toàn bộ Ngân hàng câu hỏi ra Excel (.xlsx)
  const handleExportExcel = () => {
    const bytes = exportQuestionsToExcelBytes(questions);
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    triggerBrowserDownload(
      blob,
      `Ngan_Hang_Cau_Hoi_Certiport_GenAI_${questions.length}_cau.xlsx`
    );
    setBankStatusMessage({
      type: 'success',
      text: `Đã xuất toàn bộ ${questions.length} câu hỏi ra file Excel (.xlsx).`,
    });
  };

  // Nhập câu hỏi hàng loạt từ file Excel (.xlsx)
  const handleImportExcelChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImportingFile(true);
    setBankStatusMessage(null);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const importedQuestions = parseQuestionsFromExcelBytes(arrayBuffer);
      await onBatchSaveQuestions(importedQuestions, false);
      setPreviewQuestionId(importedQuestions[0].id);
      setPreviewAnswer(importedQuestions[0].correctAnswer);
      setBankStatusMessage({
        type: 'success',
        text: `Đã nạp thành công ${importedQuestions.length} câu hỏi từ file Excel "${file.name}" lên Firebase Firestore!`,
      });
    } catch (err) {
      setBankStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể nạp file Excel (.xlsx). Vui lòng dùng đúng cấu trúc cột trong file Excel mẫu.',
      });
    } finally {
      setIsImportingFile(false);
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const handleExportClassReportExcel = () => {
    const bytes = buildClassReportWorkbookBytes(questions, users, attempts);
    const blob = new Blob([bytes as unknown as BlobPart], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const dateStr = new Date().toISOString().slice(0, 10);
    triggerBrowserDownload(
      blob,
      `Bao_Cao_Ket_Qua_Lop_Hoc_Certiport_GenAI_${dateStr}.xlsx`
    );
  };

  const handleResetSeed = async () => {
    setIsResettingSeed(true);
    try {
      await onResetSeedData();
      setBankStatusMessage({
        type: 'success',
        text: 'Đã dọn sạch toàn bộ dữ liệu ảo (seed data) khỏi hệ thống và Firebase Firestore.',
      });
    } finally {
      setIsResettingSeed(false);
    }
  };

  const handleUploadDepartmentLogoFromAdmin = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateDepartmentLogo) return;
    try {
      const base64 = await compressImageFileToBase64(file);
      await onUpdateDepartmentLogo(base64);
      setBankStatusMessage({
        type: 'success',
        text: 'Đã cập nhật Logo Tổ Toán - Tin · Trường IGC Tây Ninh thành công!',
      });
    } catch (err) {
      setBankStatusMessage({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Không thể tải ảnh logo. Vui lòng thử lại.',
      });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row">
      {/* LEFT SIDEBAR CHO DESKTOP (GIÁO VIÊN / QUẢN TRỊ VIÊN) */}
      <aside
        data-testid="teacher-sidebar"
        aria-label="Thanh điều hướng Giáo viên"
        className="hidden md:flex md:flex-col md:w-64 lg:w-68 md:shrink-0 bg-white border-r border-slate-200 md:sticky md:top-0 md:h-screen z-30 select-none"
      >
        {/* Zone 1: Brand Wordmark & Logo Tổ Toán - Tin IGC Tây Ninh */}
        <div className="px-4 py-4 border-b border-slate-200">
          <a
            href="#teacher-home"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('overview');
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
                Quản trị Hệ thống GenAI
              </div>
            </div>
          </a>
        </div>

        {/* Thông tin Quản trị viên trong Sidebar */}
        <div className="px-4 py-3 border-b border-slate-200 bg-slate-50/70 space-y-2">
          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900 truncate">
              {currentUser.fullName}
            </div>
            <div className="text-[11px] text-slate-500 truncate">
              Tài khoản:{' '}
              <strong className="font-mono text-teal-800">
                {currentUser.username}
              </strong>{' '}
              · <span className="text-teal-700 font-semibold">Giáo viên</span>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5 pt-0.5 tabular-nums">
            <div className="px-2 py-1 rounded-md bg-white border border-slate-200/80">
              <span className="text-[10px] text-slate-400 block">Câu hỏi</span>
              <span className="font-mono font-bold text-xs text-teal-800">
                {questions.length} câu
              </span>
            </div>
            <div className="px-2 py-1 rounded-md bg-white border border-slate-200/80">
              <span className="text-[10px] text-slate-400 block">Tài khoản</span>
              <span className="font-mono font-bold text-xs text-slate-800">
                {users.length} TK
              </span>
            </div>
          </div>
        </div>

        {/* Zone 2: 4 Vertical Navigation Links */}
        <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto">
          <div className="px-2.5 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Phân hệ Quản trị
          </div>

          <button
            type="button"
            data-testid="teacher-nav-overview"
            onClick={() => setActiveTab('overview')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
              activeTab === 'overview'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="inline-flex items-center gap-2.5 truncate">
              <Layers className="w-4 h-4 shrink-0" />
              <span className="truncate">Tổng quan hệ thống</span>
            </span>
          </button>

          <button
            type="button"
            data-testid="teacher-nav-questions"
            onClick={() => setActiveTab('questions')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
              activeTab === 'questions'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="inline-flex items-center gap-2.5 truncate">
              <Database className="w-4 h-4 shrink-0" />
              <span className="truncate">Ngân hàng Câu hỏi</span>
            </span>
            <span
              className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md tabular-nums ${
                activeTab === 'questions'
                  ? 'bg-teal-800 text-teal-100'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {questions.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="teacher-nav-students"
            onClick={() => setActiveTab('students')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
              activeTab === 'students'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="inline-flex items-center gap-2.5 truncate">
              <Eye className="w-4 h-4 shrink-0" />
              <span className="truncate">Quản lý Tài khoản</span>
            </span>
            <span
              className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md tabular-nums ${
                activeTab === 'students'
                  ? 'bg-teal-800 text-teal-100'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {users.length}
            </span>
          </button>

          <button
            type="button"
            data-testid="teacher-nav-attempts"
            onClick={() => setActiveTab('attempts')}
            className={`w-full px-3 py-2.5 rounded-xl text-xs font-semibold transition-all flex items-center justify-between gap-2 cursor-pointer ${
              activeTab === 'attempts'
                ? 'bg-teal-700 text-white shadow-2xs'
                : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <span className="inline-flex items-center gap-2.5 truncate">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="truncate">Kết quả Luyện thi</span>
            </span>
            <span
              className={`px-1.5 py-0.5 text-[11px] font-mono font-bold rounded-md tabular-nums ${
                activeTab === 'attempts'
                  ? 'bg-teal-800 text-teal-100'
                  : 'bg-slate-100 text-slate-600'
              }`}
            >
              {attempts.length}
            </span>
          </button>
        </nav>

        {/* Zone 3: Sidebar Footer Action (Dark Mode + Logout) */}
        <div className="p-3 border-t border-slate-200 space-y-2 bg-slate-50/40">
          <ThemeToggleButton
            variant="sidebar"
            testId="teacher-sidebar-theme-toggle"
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

      {/* Mobile Top Bar & Tabs (< 768px) */}
      <div className="md:hidden bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
          <a
            href="#teacher-home"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('overview');
            }}
            className="text-sm font-extrabold tracking-tight text-teal-800"
          >
            Tổ Toán - Tin · IGC Tây Ninh
          </a>
          <div className="flex items-center gap-2">
            <ThemeToggleButton
              variant="compact"
              testId="teacher-mobile-theme-toggle"
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
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
              activeTab === 'overview'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600'
            }`}
          >
            Tổng quan
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('questions')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
              activeTab === 'questions'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600'
            }`}
          >
            Ngân hàng ({questions.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('students')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
              activeTab === 'students'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600'
            }`}
          >
            Quản lý Tài khoản ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('attempts')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap shrink-0 ${
              activeTab === 'attempts'
                ? 'bg-teal-700 text-white'
                : 'text-slate-600'
            }`}
          >
            Kết quả ({attempts.length})
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-1 min-w-0 max-w-7xl w-full mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-5">
        {/* Thanh trạng thái Quản trị viên Tổ Toán - Tin IGC Tây Ninh */}
        <section className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="text-xs text-slate-500">
              Đơn vị: <strong className="text-teal-800">Tổ Toán - Tin · Trường IGC Tây Ninh</strong> ·{' '}
              Quản trị viên:{' '}
              <strong className="text-slate-900">{currentUser.fullName}</strong> (
              <strong className="font-mono text-teal-800">
                {currentUser.username}
              </strong>
              )
            </div>
            <h1 className="text-lg sm:text-xl font-bold text-slate-900">
              Hệ thống Quản lý Ngân hàng Câu hỏi, Tài khoản & Khảo thí Certiport Generative AI
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {onUpdateDepartmentLogo && (
              <>
                <input
                  type="file"
                  accept="image/*"
                  id="admin-upload-logo-input"
                  onChange={handleUploadDepartmentLogoFromAdmin}
                  className="hidden"
                />
                <label
                  htmlFor="admin-upload-logo-input"
                  className="px-3.5 py-2 rounded-lg border border-teal-600/40 bg-teal-50/70 hover:bg-teal-100 text-xs font-bold text-teal-900 inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <ImageIcon className="w-3.5 h-3.5 text-teal-700" />
                  <span>Đổi Logo Tổ Toán - Tin</span>
                </label>
              </>
            )}
            <button
              type="button"
              disabled={isResettingSeed}
              onClick={handleResetSeed}
              className="px-3.5 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isResettingSeed ? 'animate-spin' : ''}`}
              />
              <span>Dọn sạch dữ liệu ảo</span>
            </button>
            <button
              type="button"
              data-testid="open-add-question-modal-btn"
              onClick={() => {
                setActiveTab('questions');
                handleOpenAddModal();
              }}
              className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-xs font-bold text-white inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm câu hỏi mới</span>
            </button>
          </div>
        </section>

        {/* TAB 1: THỐNG KÊ & PHÂN TÍCH HỌC TẬP CỦA LỚP + XUẤT BÁO CÁO EXCEL 3 SHEETS */}
        {activeTab === 'overview' && (
          <TeacherClassAnalytics
            questions={questions}
            users={users}
            attempts={attempts}
            onNavigateToTab={setActiveTab}
          />
        )}

        {/* =================================================================== */}
        {/* TAB 2: PHÂN HỆ QUẢN LÝ NGÂN HÀNG CÂU HỎI (CRUD + JSON/EXCEL) */}
        {/* =================================================================== */}
        {activeTab === 'questions' && (
          <div className="space-y-5">
            {/* Thanh công cụ Nhập/Xuất Hàng loạt (JSON / Excel .xlsx) */}
            <section className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-100 pb-4">
                <div className="space-y-1">
                  <h2 className="text-base font-bold text-slate-900">
                    Công cụ Quản trị Ngân hàng Câu hỏi ({questions.length} câu hiện có)
                  </h2>
                  <p className="text-xs text-slate-500">
                    Thêm/Sửa/Xóa câu hỏi thủ công hoặc Nhập/Xuất qua JSON & Excel (.xlsx). Không cần chia mã đề — hệ thống tự động bốc ngẫu nhiên câu hỏi theo tỉ lệ Chuyên đề trong ngân hàng khi học sinh làm bài.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={handleOpenAddModal}
                    className="px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Thêm câu hỏi thủ công</span>
                  </button>
                </div>
              </div>

              {/* Cụm nút Import / Export JSON & Excel (.xlsx - SheetJS) */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                {/* Nhóm JSON */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-600 mr-1">
                    Dữ liệu JSON:
                  </span>
                  <input
                    ref={jsonInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleImportJsonChange}
                    className="hidden"
                    id="import-json-file-input"
                    data-testid="import-json-file-input"
                  />
                  <label
                    htmlFor="import-json-file-input"
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-teal-700" />
                    <span>
                      {isImportingFile ? 'Đang nạp...' : 'Nhập từ JSON'}
                    </span>
                  </label>

                  <button
                    type="button"
                    data-testid="export-json-btn"
                    onClick={handleExportJson}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileJson className="w-3.5 h-3.5 text-teal-700" />
                    <span>Xuất ra JSON ({questions.length})</span>
                  </button>
                </div>

                {/* Nhóm Excel (.xlsx - SheetJS) */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-bold text-slate-600 mr-1">
                    Bảng tính Excel (.xlsx):
                  </span>
                  <input
                    ref={excelInputRef}
                    type="file"
                    accept=".xlsx,.xls"
                    onChange={handleImportExcelChange}
                    className="hidden"
                    id="import-excel-file-input"
                    data-testid="import-excel-file-input"
                  />
                  <label
                    htmlFor="import-excel-file-input"
                    className="px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-50/70 hover:bg-emerald-100 text-xs font-bold text-emerald-900 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />
                    <span>
                      {isImportingFile ? 'Đang đọc file...' : 'Nhập từ Excel (.xlsx)'}
                    </span>
                  </label>

                  <button
                    type="button"
                    data-testid="download-sample-excel-btn"
                    onClick={handleDownloadSampleExcel}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5 text-teal-700" />
                    <span>Tải file Excel mẫu (.xlsx)</span>
                  </button>

                  <button
                    type="button"
                    data-testid="export-excel-btn"
                    onClick={handleExportExcel}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-slate-600" />
                    <span>Xuất Ngân hàng ra Excel (.xlsx)</span>
                  </button>
                </div>
              </div>

              {/* Thông báo kết quả thao tác */}
              {bankStatusMessage && (
                <div
                  role="status"
                  data-testid="bank-status-banner"
                  className={`p-3.5 rounded-xl border text-xs sm:text-sm font-medium flex items-center justify-between gap-3 ${
                    bankStatusMessage.type === 'success'
                      ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
                      : 'bg-rose-50 border-rose-300 text-rose-950'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {bankStatusMessage.type === 'success' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                    )}
                    <span>{bankStatusMessage.text}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setBankStatusMessage(null)}
                    className="text-xs underline shrink-0 cursor-pointer"
                  >
                    Đóng
                  </button>
                </div>
              )}
            </section>

            {/* Thanh Bộ lọc 4 chiều: Tìm kiếm từ khóa + Chuyên đề + Dạng câu hỏi + Trạng thái Hình ảnh */}
            <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Tìm kiếm từ khóa hoặc mã câu (VD: RAG, q1)..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
                  />
                </div>

                <select
                  aria-label="Lọc theo chuyên đề"
                  value={topicFilter}
                  onChange={(e) => setTopicFilter(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 font-medium"
                >
                  <option value="ALL">Tất cả 4 Chuyên đề</option>
                  {CERTIPORT_TOPICS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>

                <select
                  aria-label="Lọc theo dạng câu hỏi"
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-800 font-medium"
                >
                  <option value="ALL">Tất cả 5 dạng câu hỏi</option>
                  {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map(
                    (k) => (
                      <option key={k} value={k}>
                        {QUESTION_TYPE_LABELS[k]}
                      </option>
                    )
                  )}
                </select>

                <select
                  aria-label="Lọc theo trạng thái hình ảnh"
                  data-testid="question-image-filter-select"
                  value={imageFilter}
                  onChange={(e) =>
                    setImageFilter(
                      e.target.value as 'ALL' | 'WITH_IMAGE' | 'WITHOUT_IMAGE'
                    )
                  }
                  className="px-3 py-2 text-xs rounded-lg border border-teal-500 bg-teal-50/40 text-teal-950 font-semibold"
                >
                  <option value="ALL">
                    Tất cả câu hỏi ({questionsWithImageCount}/{questions.length} có ảnh)
                  </option>
                  <option value="WITH_IMAGE">
                    Đã có hình ảnh ({questionsWithImageCount} câu)
                  </option>
                  <option value="WITHOUT_IMAGE">
                    Chưa có hình ảnh — Cần thêm ảnh ({questions.length - questionsWithImageCount} câu)
                  </option>
                </select>
              </div>

              {/* Hiển thị Tỉ trọng các Chuyên đề trong Ngân hàng câu hỏi */}
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 text-xs">
                <span className="font-semibold text-slate-600 flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5 text-teal-700" />
                  <span>Tỉ lệ bốc đề tự động theo Chuyên đề:</span>
                </span>
                {CERTIPORT_TOPICS.map((topic) => {
                  const count = questions.filter((q) => q.topic === topic).length;
                  const ratio =
                    questions.length > 0
                      ? Math.round((count / questions.length) * 100)
                      : 0;
                  return (
                    <span
                      key={topic}
                      className="px-2.5 py-1 rounded-md bg-slate-50 border border-slate-200 text-slate-700 tabular-nums"
                    >
                      {topic}:{' '}
                      <strong className="text-teal-800 font-mono">
                        {count} câu ({ratio}%)
                      </strong>
                    </span>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 pt-1">
                <span>
                  Đang hiển thị{' '}
                  <strong className="text-slate-900 font-mono">
                    {filteredQuestions.length} / {questions.length}
                  </strong>{' '}
                  câu hỏi trong ngân hàng ({questionsWithImageCount} câu đã đính kèm ảnh đề thi).
                </span>
                {(searchQuery ||
                  topicFilter !== 'ALL' ||
                  typeFilter !== 'ALL' ||
                  imageFilter !== 'ALL') && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      setTopicFilter('ALL');
                      setTypeFilter('ALL');
                      setImageFilter('ALL');
                    }}
                    className="text-teal-700 font-semibold hover:underline cursor-pointer"
                  >
                    Xóa toàn bộ bộ lọc
                  </button>
                )}
              </div>
            </section>

            {/* Bố cục 2 cột: Danh sách câu hỏi (kèm nút Thêm ảnh / Sửa / Xóa) & Khung Gắn ảnh + Xem trước trực tiếp */}
            <div
              onPaste={handleQuickPasteImage}
              className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
            >
              {/* Cột trái (5/12): Danh sách câu hỏi */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl divide-y divide-slate-200 overflow-hidden">
                {filteredQuestions.length === 0 ? (
                  <div className="p-8 text-center space-y-3">
                    <p className="text-sm text-slate-700 font-semibold">
                      {questions.length === 0
                        ? 'Ngân hàng câu hỏi hiện đang trống (đã xóa toàn bộ dữ liệu ảo).'
                        : 'Không tìm thấy câu hỏi nào khớp với bộ lọc hiện tại.'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Hãy bấm <strong>"Thêm câu hỏi thủ công"</strong> hoặc{' '}
                      <strong>"Nhập từ JSON / Excel (.xlsx)"</strong> để nạp bộ đề của bạn, sau đó gắn hình ảnh trực tiếp cho từng câu hỏi.
                    </p>
                    <button
                      type="button"
                      onClick={handleOpenAddModal}
                      className="px-4 py-2 rounded-lg bg-teal-700 text-white text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm câu hỏi mới kèm hình ảnh</span>
                    </button>
                  </div>
                ) : (
                  filteredQuestions.map((q, idx) => {
                    const isSelected = selectedPreviewQuestion?.id === q.id;
                    return (
                      <div
                        key={q.id}
                        className={`p-4 transition-colors space-y-2 ${
                          isSelected ? 'bg-sky-50/90' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <button
                            type="button"
                            onClick={() => handleSelectPreviewQuestion(q)}
                            className="font-mono font-bold text-teal-800 hover:underline text-left cursor-pointer"
                          >
                            Câu {idx + 1} ({q.id.toUpperCase()})
                          </button>

                          <div className="flex items-center gap-1.5">
                            {q.imageUrl ? (
                              <span
                                title="Câu hỏi đã có hình ảnh đề thi"
                                className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded"
                              >
                                <ImageIcon className="w-3 h-3" />
                                <span>Đã có ảnh</span>
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-400">
                                Chưa có ảnh
                              </span>
                            )}
                            <span className="font-medium text-slate-700">
                              {QUESTION_TYPE_LABELS[q.type]}
                            </span>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleSelectPreviewQuestion(q)}
                          className="w-full text-left space-y-1 cursor-pointer"
                        >
                          <div className="text-sm font-semibold text-slate-900 line-clamp-2">
                            {q.prompt}
                          </div>
                          <div className="text-xs text-slate-500">{q.topic}</div>
                        </button>

                        {/* Thanh thao tác Thêm ảnh / Xem thử / Sửa / Xóa trên từng câu hỏi */}
                        <div className="pt-1 flex flex-wrap items-center justify-end gap-1.5">
                          <button
                            type="button"
                            data-testid={`quick-image-btn-${q.id}`}
                            onClick={() => {
                              handleSelectPreviewQuestion(q);
                              window.setTimeout(() => {
                                quickImageFileInputRef.current?.click();
                              }, 50);
                            }}
                            className="px-2.5 py-1 rounded-md border border-sky-300 bg-sky-50 hover:bg-sky-100 text-xs font-bold text-sky-900 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <ImageIcon className="w-3 h-3 text-sky-700" />
                            <span>{q.imageUrl ? 'Đổi ảnh' : '+ Thêm ảnh'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectPreviewQuestion(q)}
                            className="px-2.5 py-1 rounded-md border border-slate-200 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Eye className="w-3 h-3" />
                            <span>Xem</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`edit-question-${q.id}`}
                            onClick={() => handleOpenEditModal(q)}
                            className="px-2.5 py-1 rounded-md border border-teal-300 bg-teal-50/70 hover:bg-teal-100 text-xs font-semibold text-teal-900 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            <span>Sửa</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`delete-question-${q.id}`}
                            onClick={() => setQuestionToDelete(q)}
                            className="px-2.5 py-1 rounded-md border border-rose-200 bg-rose-50/60 hover:bg-rose-100 text-xs font-semibold text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                            <span>Xóa</span>
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Cột phải (7/12): Khung Thêm Hình Ảnh Nhanh + Trình Xem trước & Kiểm thử câu hỏi trực tiếp */}
              <div className="lg:col-span-7 space-y-4">
                {!selectedPreviewQuestion ? (
                  <div className="bg-white border border-slate-200 rounded-xl p-8 text-center space-y-4">
                    <div className="w-12 h-12 rounded-2xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center mx-auto">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                    <div className="space-y-1 max-w-lg mx-auto">
                      <h3 className="text-base font-bold text-slate-900">
                        Sẵn sàng Tạo Đề & Đính kèm Hình ảnh Câu hỏi
                      </h3>
                      <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
                        Khi bạn thêm câu hỏi mới hoặc nhập bộ đề từ file JSON / Excel (.xlsx), bạn có thể chọn bất kỳ câu hỏi nào để <strong>Tải ảnh từ máy tính</strong>, <strong>Kéo thả ảnh</strong>, bấm <strong>Ctrl+V dán ảnh chụp màn hình</strong> hoặc <strong>Nhập link ảnh</strong> trực tiếp tại khung này.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* KHUNG THÊM / CẬP NHẬT HÌNH ẢNH TRỰC TIẾP CHO CÂU HỎI TRONG NGÂN HÀNG */}
                    <section
                      data-testid="quick-image-attachment-panel"
                      onDragOver={(e) => {
                        e.preventDefault();
                        setIsQuickDraggingImage(true);
                      }}
                      onDragLeave={() => setIsQuickDraggingImage(false)}
                      onDrop={async (e) => {
                        e.preventDefault();
                        setIsQuickDraggingImage(false);
                        const file = e.dataTransfer.files?.[0];
                        if (file) {
                          await handleQuickImageFileUpload(file);
                        }
                      }}
                      className={`bg-white border rounded-xl p-4 space-y-3 transition-all ${
                        isQuickDraggingImage
                          ? 'border-teal-600 bg-teal-50/50 ring-2 ring-teal-500/30'
                          : 'border-slate-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <ImageIcon className="w-4 h-4 text-teal-700 shrink-0" />
                          <h3 className="text-xs sm:text-sm font-bold text-slate-900">
                            Thêm / Cập nhật Hình ảnh cho Câu{' '}
                            <span className="font-mono text-teal-800">
                              {selectedPreviewQuestion.id.toUpperCase()}
                            </span>
                          </h3>
                          {selectedPreviewQuestion.imageUrl ? (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded">
                              Đã có hình ảnh trong đề
                            </span>
                          ) : (
                            <span className="text-[11px] font-medium text-amber-800 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
                              Chưa có ảnh
                            </span>
                          )}
                        </div>

                        {selectedPreviewQuestion.imageUrl && (
                          <button
                            type="button"
                            data-testid="quick-remove-image-btn"
                            onClick={() =>
                              handleAttachImageToSelectedQuestion(
                                selectedPreviewQuestion,
                                ''
                              )
                            }
                            className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-semibold text-rose-700 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa ảnh khỏi câu này</span>
                          </button>
                        )}
                      </div>

                      <p className="text-xs text-slate-500">
                        Chọn tệp ảnh từ máy tính, <strong>kéo thả ảnh vào khung này</strong>, bấm{' '}
                        <strong>Ctrl+V</strong> để dán ảnh vừa chụp màn hình đề thi, hoặc nhập đường dẫn URL ảnh bên dưới:
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-center">
                        <div className="sm:col-span-5">
                          <input
                            ref={quickImageFileInputRef}
                            type="file"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                handleQuickImageFileUpload(file);
                              }
                            }}
                            className="hidden"
                            id="quick-attach-image-file-input"
                            data-testid="quick-attach-image-file-input"
                          />
                          <label
                            htmlFor="quick-attach-image-file-input"
                            className="w-full py-2 px-3 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                          >
                            <Upload className="w-3.5 h-3.5" />
                            <span>
                              {isQuickUploadingImage
                                ? 'Đang lưu ảnh...'
                                : selectedPreviewQuestion.imageUrl
                                  ? 'Tải ảnh khác thay thế'
                                  : 'Tải ảnh từ máy tính'}
                            </span>
                          </label>
                        </div>

                        <div className="sm:col-span-7 flex items-center gap-2">
                          <input
                            type="text"
                            data-testid="quick-attach-image-url-input"
                            value={quickImageUrlInput}
                            onChange={(e) => setQuickImageUrlInput(e.target.value)}
                            placeholder="Hoặc dán link ảnh (https://... hoặc data:image/...)"
                            className="flex-1 px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900"
                          />
                          <button
                            type="button"
                            data-testid="quick-attach-image-url-btn"
                            disabled={!quickImageUrlInput.trim()}
                            onClick={() => {
                              if (!quickImageUrlInput.trim()) return;
                              handleAttachImageToSelectedQuestion(
                                selectedPreviewQuestion,
                                quickImageUrlInput.trim()
                              );
                            }}
                            className="px-3 py-2 rounded-lg border border-teal-600 bg-teal-50 hover:bg-teal-100 disabled:opacity-40 text-xs font-bold text-teal-900 whitespace-nowrap cursor-pointer"
                          >
                            Gắn link ảnh
                          </button>
                        </div>
                      </div>
                    </section>

                    <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                      <div className="text-xs text-slate-600">
                        Đang xem câu{' '}
                        <strong className="font-mono text-teal-800">
                          {selectedPreviewQuestion.id.toUpperCase()}
                        </strong>{' '}
                        · Chấm thử:{' '}
                        <strong className="text-slate-900">
                          {evaluateQuestion(
                            selectedPreviewQuestion,
                            previewAnswer
                          )
                            ? 'ĐÚNG 100% (1 điểm)'
                            : 'CHƯA ĐÚNG (0 điểm)'}
                        </strong>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenEditModal(selectedPreviewQuestion)
                          }
                          className="px-3 py-1.5 rounded-lg bg-teal-700 text-white hover:bg-teal-800 text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Chỉnh sửa câu này</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewAnswer(
                              selectedPreviewQuestion.correctAnswer
                            )
                          }
                          className="px-3 py-1.5 rounded-lg bg-teal-50 text-teal-800 hover:bg-teal-100 text-xs font-semibold cursor-pointer"
                        >
                          Điền sẵn Đáp án chuẩn
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewAnswer(undefined)}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs font-semibold cursor-pointer"
                        >
                          Xóa chọn
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPreviewSolution((v) => !v)}
                          className="px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 inline-flex items-center gap-1 cursor-pointer"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>
                            {showPreviewSolution ? 'Ẩn giải thích' : 'Hiện giải thích'}
                          </span>
                        </button>
                      </div>
                    </div>

                    <QuestionRenderer
                      question={selectedPreviewQuestion}
                      userAnswer={previewAnswer}
                      onChangeAnswer={setPreviewAnswer}
                      showFeedback={showPreviewSolution}
                    />
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: QUẢN LÝ TÀI KHOẢN & TIẾN ĐỘ HỌC SINH */}
        {activeTab === 'students' && (
          <TeacherStudentManager
            questions={questions}
            users={users}
            attempts={attempts}
            onSaveStudent={onSaveStudent}
            onBatchSaveStudents={onBatchSaveStudents}
            onUpdateStudentPassword={onUpdateStudentPassword}
            onResetStudentProgress={onResetStudentProgress}
            onDeleteStudent={onDeleteStudent}
          />
        )}

        {/* TAB 4: BẢNG KẾT QUẢ LUYỆN THI TOÀN TRƯỜNG */}
        {activeTab === 'attempts' && (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="p-5 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-bold text-slate-900">
                  Toàn bộ Lịch sử Thi thử & Luyện đề của Học sinh ({attempts.length} lượt)
                </h2>
                <p className="text-xs text-slate-500">
                  Kết quả chấm tự động theo quy tắc Certiport All-or-Nothing (Thang điểm 1000, &ge; 700/1000 là ĐẠT - PASS).
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleExportClassReportExcel}
                  className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-2xs cursor-pointer"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  <span>Xuất Báo Cáo Kết Quả Lớp Học (.xlsx)</span>
                </button>
                <Database className="w-5 h-5 text-teal-700" />
              </div>
            </div>

            {attempts.length === 0 ? (
              <div className="p-12 text-center text-sm text-slate-500">
                Chưa có lượt nộp bài nào từ học sinh.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                      <th className="py-3 px-4">Thời gian nộp</th>
                      <th className="py-3 px-4">Mã HS</th>
                      <th className="py-3 px-4">Họ và tên</th>
                      <th className="py-3 px-4">Chế độ / Bộ đề</th>
                      <th className="py-3 px-4">Số câu đúng</th>
                      <th className="py-3 px-4">Điểm Certiport</th>
                      <th className="py-3 px-4">Thời gian làm</th>
                      <th className="py-3 px-4">Đánh giá</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-sm tabular-nums">
                    {attempts.map((att) => {
                      const cScore =
                        att.certiportScore ??
                        Math.round(
                          ((att.score ?? att.correctCount) /
                            Math.max(1, att.totalQuestions)) *
                            1000
                        );
                      const isPassed = cScore >= 700;

                      return (
                        <tr key={att.id} className="hover:bg-slate-50/80">
                          <td className="py-3 px-4 text-xs font-mono text-slate-600">
                            {new Date(att.completedAt).toLocaleString('vi-VN')}
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-teal-800">
                            {att.username}
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-900">
                            {att.fullName}
                          </td>
                          <td className="py-3 px-4 text-slate-700">
                            {att.mode || att.examSet}
                          </td>
                          <td className="py-3 px-4 font-mono font-semibold text-slate-800">
                            {att.score ?? att.correctCount} /{' '}
                            {att.totalQuestions} ({att.percentage ?? 0}%)
                          </td>
                          <td className="py-3 px-4 font-mono font-bold text-teal-800">
                            {cScore} / 1000
                          </td>
                          <td className="py-3 px-4 font-mono text-xs text-slate-600">
                            {formatStudyDuration(att.durationSeconds)}
                          </td>
                          <td className="py-3 px-4 text-xs font-bold">
                            {isPassed ? (
                              <span className="text-emerald-700 inline-flex items-center gap-1">
                                <CheckCircle2 className="w-3.5 h-3.5" /> PASS
                                (&ge;700)
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
        )}
      </main>

      {/* MODAL 1: THÊM MỚI / CHỈNH SỬA CÂU HỎI ĐỘNG */}
      {isQuestionModalOpen && (
        <QuestionEditorModal
          initialQuestion={editingQuestion}
          nextQuestionNumber={questions.length + 1}
          onClose={() => {
            setIsQuestionModalOpen(false);
            setEditingQuestion(null);
          }}
          onSave={handleSaveQuestionFromModal}
        />
      )}

      {/* MODAL 2: HỘP THOẠI XÁC NHẬN XÓA CÂU HỎI */}
      {questionToDelete && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-question-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h3
                  id="delete-question-modal-title"
                  className="text-base font-bold text-slate-900"
                >
                  Xác nhận xóa câu hỏi {questionToDelete.id.toUpperCase()}?
                </h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Bạn sắp xóa vĩnh viễn câu hỏi{' '}
                  <strong>"{questionToDelete.prompt}"</strong> khỏi Ngân hàng câu hỏi và Firebase Firestore.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setQuestionToDelete(null)}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 cursor-pointer"
              >
                Giữ lại
              </button>
              <button
                type="button"
                data-testid="confirm-delete-question-btn"
                disabled={isDeletingQuestion}
                onClick={handleConfirmDeleteQuestion}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer"
              >
                {isDeletingQuestion ? 'Đang xóa...' : 'Xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
