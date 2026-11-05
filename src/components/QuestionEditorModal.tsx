import React, { useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Image as ImageIcon,
  Plus,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  CERTIPORT_TOPICS,
  QUESTION_TYPE_LABELS,
  Question,
  QuestionType,
} from '../types/exam';
import {
  QuestionFormDraft,
  buildQuestionFromDraft,
  compressImageFileToBase64,
  createDraftFromQuestion,
  createEmptyQuestionDraft,
  parseChoicesText,
} from '../utils/questionBankUtils';

interface QuestionEditorModalProps {
  initialQuestion: Question | null; // null = Thêm mới, có dữ liệu = Chỉnh sửa
  nextQuestionNumber: number;
  availableExamSets?: string[];
  onClose: () => void;
  onSave: (question: Question) => Promise<void>;
}

export const QuestionEditorModal: React.FC<QuestionEditorModalProps> = ({
  initialQuestion,
  nextQuestionNumber,
  onClose,
  onSave,
}) => {
  const isEditing = Boolean(initialQuestion);
  const [draft, setDraft] = useState<QuestionFormDraft>(() =>
    initialQuestion
      ? createDraftFromQuestion(initialQuestion)
      : createEmptyQuestionDraft(nextQuestionNumber)
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isCompressingImage, setIsCompressingImage] = useState(false);
  const [isDraggingImage, setIsDraggingImage] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const processImageFile = async (file: File | Blob) => {
    setErrorMsg(null);
    if (file.type && !file.type.startsWith('image/')) {
      setErrorMsg('Vui lòng chọn tệp hình ảnh hợp lệ (.png, .jpg, .jpeg, .webp, .svg).');
      return;
    }
    setIsCompressingImage(true);
    try {
      const base64DataUrl = await compressImageFileToBase64(file);
      setDraft((prev) => ({ ...prev, imageUrl: base64DataUrl }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Không thể xử lý hình ảnh đã tải lên.'
      );
    } finally {
      setIsCompressingImage(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Xử lý tải ảnh từ máy tính -> Base64 đã nén
  const handleImageFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    await processImageFile(file);
  };

  // Xử lý Dán ảnh trực tiếp từ Clipboard (Ctrl+V khi chụp màn hình đề thi)
  const handleModalPaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          await processImageFile(blob);
        }
        return;
      }
    }
  };

  // Xử lý lưu câu hỏi
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    try {
      const builtQuestion = buildQuestionFromDraft(draft);
      setIsSaving(true);
      await onSave(builtQuestion);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Dữ liệu câu hỏi chưa hợp lệ. Vui lòng kiểm tra lại.'
      );
    } finally {
      setIsSaving(false);
    }
  };

  // =========================================================================
  // HANDLERS CHO TRẮC NGHIỆM (MCQ SINGLE / MULTIPLE)
  // =========================================================================
  const handleAddMcqOption = () => {
    setDraft((prev) => ({
      ...prev,
      mcqOptions: [
        ...prev.mcqOptions,
        {
          id: `${prev.id}_opt${prev.mcqOptions.length + 1}_${Date.now() % 1000}`,
          text: '',
          isCorrect: false,
        },
      ],
    }));
  };

  const handleRemoveMcqOption = (idx: number) => {
    if (draft.mcqOptions.length <= 2) return;
    setDraft((prev) => {
      const next = prev.mcqOptions.filter((_, i) => i !== idx);
      if (prev.type === 'mcq_single' && !next.some((o) => o.isCorrect) && next[0]) {
        next[0] = { ...next[0], isCorrect: true };
      }
      return { ...prev, mcqOptions: next };
    });
  };

  const handleToggleMcqCorrect = (idx: number) => {
    setDraft((prev) => {
      if (prev.type === 'mcq_single') {
        return {
          ...prev,
          mcqOptions: prev.mcqOptions.map((o, i) => ({
            ...o,
            isCorrect: i === idx,
          })),
        };
      }
      return {
        ...prev,
        mcqOptions: prev.mcqOptions.map((o, i) =>
          i === idx ? { ...o, isCorrect: !o.isCorrect } : o
        ),
      };
    });
  };

  // =========================================================================
  // HANDLERS CHO DROPDOWN (- SELECT -)
  // =========================================================================
  const handleAddDropdownRow = () => {
    const defaultChoices = draft.dropdownRows[0]?.choicesText || 'Đúng, Sai';
    const parsed = parseChoicesText(defaultChoices);
    setDraft((prev) => ({
      ...prev,
      dropdownRows: [
        ...prev.dropdownRows,
        {
          id: `${prev.id}_sub${prev.dropdownRows.length + 1}_${Date.now() % 1000}`,
          statement: '',
          choicesText: defaultChoices,
          correctChoice: parsed[0] || 'Đúng',
        },
      ],
    }));
  };

  const handleRemoveDropdownRow = (idx: number) => {
    if (draft.dropdownRows.length <= 1) return;
    setDraft((prev) => ({
      ...prev,
      dropdownRows: prev.dropdownRows.filter((_, i) => i !== idx),
    }));
  };

  const handleApplyDropdownPresetAll = (presetText: string) => {
    const parsed = parseChoicesText(presetText);
    const defaultCorrect = parsed[0] || 'Đúng';
    setDraft((prev) => ({
      ...prev,
      dropdownRows: prev.dropdownRows.map((row) => ({
        ...row,
        choicesText: presetText,
        correctChoice: parsed.includes(row.correctChoice)
          ? row.correctChoice
          : defaultCorrect,
      })),
    }));
  };

  // =========================================================================
  // HANDLERS CHO NỐI CÂU (MATCHING)
  // =========================================================================
  const handleAddMatchingPair = () => {
    setDraft((prev) => ({
      ...prev,
      matchingPairs: [
        ...prev.matchingPairs,
        {
          id: `${prev.id}_pair${prev.matchingPairs.length + 1}_${Date.now() % 1000}`,
          left: '',
          right: '',
        },
      ],
    }));
  };

  const handleRemoveMatchingPair = (idx: number) => {
    if (draft.matchingPairs.length <= 2) return;
    setDraft((prev) => ({
      ...prev,
      matchingPairs: prev.matchingPairs.filter((_, i) => i !== idx),
    }));
  };

  // =========================================================================
  // HANDLERS CHO SẮP XẾP THỨ TỰ (ORDERING)
  // =========================================================================
  const handleAddOrderingStep = () => {
    setDraft((prev) => ({
      ...prev,
      orderingSteps: [
        ...prev.orderingSteps,
        {
          id: `${prev.id}_step${prev.orderingSteps.length + 1}_${Date.now() % 1000}`,
          text: '',
        },
      ],
    }));
  };

  const handleRemoveOrderingStep = (idx: number) => {
    if (draft.orderingSteps.length <= 2) return;
    setDraft((prev) => ({
      ...prev,
      orderingSteps: prev.orderingSteps.filter((_, i) => i !== idx),
    }));
  };

  const handleMoveOrderingStep = (idx: number, direction: -1 | 1) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= draft.orderingSteps.length) return;
    setDraft((prev) => {
      const next = [...prev.orderingSteps];
      const temp = next[idx];
      next[idx] = next[targetIdx];
      next[targetIdx] = temp;
      return { ...prev, orderingSteps: next };
    });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="question-editor-modal-title"
      onPaste={handleModalPaste}
      className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-xl overflow-hidden my-auto">
        {/* Header Modal */}
        <div className="px-6 py-4 bg-sky-50/80 border-b border-slate-200 flex items-center justify-between gap-4 shrink-0">
          <div>
            <div className="text-xs font-bold text-teal-800 uppercase tracking-wider">
              {isEditing
                ? `Chỉnh sửa câu hỏi · Mã ${draft.id.toUpperCase()}`
                : 'Thêm mới câu hỏi vào Ngân hàng Đề'}
            </div>
            <h2
              id="question-editor-modal-title"
              className="text-base sm:text-lg font-bold text-slate-900"
            >
              {isEditing
                ? 'Cập nhật Nội dung, Hình ảnh & Cấu hình Đáp án Chuẩn Certiport'
                : 'Tạo Câu hỏi Mới (Hỗ trợ đủ 5 dạng bài thi Certiport & Đính kèm ảnh)'}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng cửa sổ"
            className="p-2 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body Form cuộn dọc */}
        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-6 overflow-y-auto flex-1"
        >
          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-xs sm:text-sm text-rose-900 font-medium flex items-center gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* 1. Cấu hình Phân loại: Mã câu, Loại câu hỏi, Chuyên đề (Không cần chọn Đề — lưu thẳng vào Ngân hàng chung) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label
                htmlFor="q-editor-id"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                Mã câu hỏi (ID)
              </label>
              <input
                id="q-editor-id"
                type="text"
                required
                disabled={isEditing}
                value={draft.id}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, id: e.target.value }))
                }
                placeholder="Ví dụ: q9"
                className="w-full px-3 py-2 text-xs sm:text-sm font-mono rounded-lg border border-slate-300 bg-white disabled:bg-slate-100 text-slate-900"
              />
            </div>

            <div>
              <label
                htmlFor="q-editor-type"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                Loại câu hỏi Certiport
              </label>
              <select
                id="q-editor-type"
                data-testid="question-editor-type-select"
                value={draft.type}
                onChange={(e) => {
                  const nextType = e.target.value as QuestionType;
                  setDraft((prev) => {
                    const nextOpts =
                      nextType === 'mcq_single'
                        ? prev.mcqOptions.map((o, idx) => ({
                            ...o,
                            isCorrect:
                              idx ===
                              Math.max(
                                0,
                                prev.mcqOptions.findIndex((x) => x.isCorrect)
                              ),
                          }))
                        : prev.mcqOptions;
                    return {
                      ...prev,
                      type: nextType,
                      mcqOptions: nextOpts,
                    };
                  });
                }}
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-teal-600 bg-teal-50/40 text-slate-900 font-semibold"
              >
                {(Object.keys(QUESTION_TYPE_LABELS) as QuestionType[]).map((t) => (
                  <option key={t} value={t}>
                    {QUESTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="q-editor-topic"
                className="block text-xs font-bold text-slate-700 mb-1"
              >
                Chuyên đề kiến thức
              </label>
              <select
                id="q-editor-topic"
                value={draft.topic}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, topic: e.target.value }))
                }
                className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 bg-white text-slate-900"
              >
                {CERTIPORT_TOPICS.map((topic) => (
                  <option key={topic} value={topic}>
                    {topic}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="px-3.5 py-2.5 rounded-lg bg-teal-50/70 border border-teal-200 text-xs text-teal-900">
            Câu hỏi sẽ được lưu trực tiếp vào <strong>Ngân hàng Câu hỏi chung</strong>. Khi học sinh muốn làm đề, hệ thống sẽ tự động <strong>bốc ngẫu nhiên số câu hỏi theo đúng tỉ lệ Chuyên đề & Dạng câu hỏi</strong> trong ngân hàng.
          </div>

          {/* 2. Nội dung câu hỏi (Prompt) & Hướng dẫn phụ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-8 space-y-3">
              <div>
                <label
                  htmlFor="q-editor-prompt"
                  className="block text-xs font-bold text-slate-700 mb-1"
                >
                  Nội dung câu hỏi (Prompt) *
                </label>
                <textarea
                  id="q-editor-prompt"
                  data-testid="question-editor-prompt-input"
                  rows={3}
                  required
                  value={draft.prompt}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, prompt: e.target.value }))
                  }
                  placeholder="Nhập đề bài câu hỏi tiếng Việt sát chuẩn đề thi Certiport Generative AI..."
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-slate-300 focus:border-teal-600 focus:outline-none text-slate-900"
                />
              </div>

              <div>
                <label
                  htmlFor="q-editor-instruction"
                  className="block text-xs font-semibold text-slate-600 mb-1"
                >
                  Ghi chú hướng dẫn thao tác (Tùy chọn)
                </label>
                <input
                  id="q-editor-instruction"
                  type="text"
                  value={draft.instruction}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, instruction: e.target.value }))
                  }
                  placeholder="Ví dụ: Chọn 2 phương án đúng / Kéo mảnh ghép từ cột phải sang cột trái..."
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 text-slate-800"
                />
              </div>
            </div>

            {/* 3. Tải hình ảnh minh họa từ máy tính / Kéo thả / Dán Ctrl+V / Nhập URL */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingImage(true);
              }}
              onDragLeave={() => setIsDraggingImage(false)}
              onDrop={async (e) => {
                e.preventDefault();
                setIsDraggingImage(false);
                const file = e.dataTransfer.files?.[0];
                if (file) {
                  await processImageFile(file);
                }
              }}
              className={`lg:col-span-4 rounded-xl p-4 flex flex-col justify-between space-y-3 border transition-colors ${
                isDraggingImage
                  ? 'bg-teal-50 border-teal-600 ring-2 ring-teal-500/30'
                  : 'bg-slate-50 border-slate-200'
              }`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <ImageIcon className="w-4 h-4 text-teal-700" />
                    <span>Hình ảnh minh họa đề thi</span>
                  </span>
                  {draft.imageUrl && (
                    <button
                      type="button"
                      data-testid="remove-uploaded-image-btn"
                      onClick={() => setDraft((prev) => ({ ...prev, imageUrl: '' }))}
                      className="text-xs font-semibold text-rose-600 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Xóa ảnh</span>
                    </button>
                  )}
                </div>
                <p className="text-[11px] text-slate-500">
                  Hỗ trợ: <strong>Tải ảnh từ máy</strong>, <strong>Kéo thả ảnh</strong>, bấm{' '}
                  <strong>Ctrl+V</strong> dán ảnh chụp màn hình hoặc nhập link URL ảnh.
                </p>
              </div>

              {draft.imageUrl ? (
                <div className="rounded-lg border border-slate-200 bg-white p-2 flex flex-col items-center gap-1.5">
                  <img
                    src={draft.imageUrl}
                    alt="Xem trước ảnh minh họa"
                    referrerPolicy="no-referrer"
                    className="max-h-32 w-auto object-contain rounded"
                  />
                  <span className="text-[11px] font-mono text-emerald-700">
                    Đã đính kèm ảnh đề thi
                  </span>
                </div>
              ) : (
                <div className="border border-dashed border-slate-300 rounded-lg p-3.5 text-center text-xs text-slate-500 bg-white">
                  Chưa có ảnh · Kéo thả ảnh vào đây hoặc bấm <strong>Ctrl+V</strong> để dán ảnh chụp màn hình
                </div>
              )}

              <div className="space-y-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageFileChange}
                  className="hidden"
                  id="question-image-upload-input"
                  data-testid="question-image-upload-input"
                />
                <label
                  htmlFor="question-image-upload-input"
                  className="w-full py-2 px-3 rounded-lg bg-white border border-teal-600 text-teal-800 hover:bg-teal-50 text-xs font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {isCompressingImage
                      ? 'Đang xử lý ảnh...'
                      : draft.imageUrl
                        ? 'Đổi tệp ảnh khác từ máy'
                        : 'Chọn tệp ảnh từ máy tính'}
                  </span>
                </label>

                <input
                  type="text"
                  data-testid="question-editor-image-url-input"
                  value={draft.imageUrl.startsWith('data:image/') ? '' : draft.imageUrl}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, imageUrl: e.target.value }))
                  }
                  placeholder="Hoặc dán trực tiếp URL hình ảnh (https://...)"
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
                />
              </div>
            </div>
          </div>

          {/* 4. GIAO DIỆN NHẬP ĐÁP ÁN ĐỘNG (DYNAMIC FORM THEO 5 LOẠI CÂU HỎI) */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 space-y-4">
            {/* LOẠI 1 & 2: TRẮC NGHIỆM 1 ĐÁP ÁN HOẶC NHIỀU ĐÁP ÁN */}
            {(draft.type === 'mcq_single' || draft.type === 'mcq_multiple') && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      {draft.type === 'mcq_single'
                        ? 'Cấu hình Phương án Trắc nghiệm 1 Đáp án đúng (Radio)'
                        : 'Cấu hình Phương án Trắc nghiệm Nhiều Đáp án đúng (Checkbox)'}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {draft.type === 'mcq_single'
                        ? 'Nhập nội dung các phương án và tích chọn 1 phương án đúng duy nhất.'
                        : 'Nhập nội dung các phương án và tích chọn tất cả các phương án đúng (ví dụ: Chọn 2, Chọn 3).'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddMcqOption}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm phương án</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {draft.mcqOptions.map((opt, idx) => (
                    <div
                      key={opt.id}
                      className={`p-3 rounded-xl border flex items-center gap-3 transition-colors ${
                        opt.isCorrect
                          ? 'bg-emerald-50/70 border-emerald-400'
                          : 'bg-white border-slate-200'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => handleToggleMcqCorrect(idx)}
                        aria-label={`Chọn phương án ${String.fromCharCode(65 + idx)} là đáp án đúng`}
                        className={`px-2.5 py-1.5 rounded-lg border text-xs font-bold inline-flex items-center gap-1.5 shrink-0 cursor-pointer ${
                          opt.isCorrect
                            ? 'bg-emerald-600 border-emerald-700 text-white'
                            : 'bg-slate-100 border-slate-300 text-slate-600 hover:border-teal-600'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>
                          {String.fromCharCode(65 + idx)} ·{' '}
                          {opt.isCorrect ? 'Đáp án ĐÚNG' : 'Đặt làm Đúng'}
                        </span>
                      </button>

                      <input
                        type="text"
                        value={opt.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((prev) => ({
                            ...prev,
                            mcqOptions: prev.mcqOptions.map((o, i) =>
                              i === idx ? { ...o, text: val } : o
                            ),
                          }));
                        }}
                        placeholder={`Nhập nội dung phương án ${String.fromCharCode(65 + idx)}...`}
                        className="flex-1 px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300 bg-white text-slate-900"
                      />

                      <button
                        type="button"
                        disabled={draft.mcqOptions.length <= 2}
                        onClick={() => handleRemoveMcqOption(idx)}
                        aria-label={`Xóa phương án ${String.fromCharCode(65 + idx)}`}
                        className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LOẠI 3: MENU THẢ XUỐNG (DROPDOWN - SELECT -) */}
            {draft.type === 'dropdown' && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Cấu hình Các mệnh đề & Menu thả xuống (Dropdown - Select -)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Nhập từng mệnh đề, danh sách lựa chọn cách nhau dấu phẩy và chọn đáp án đúng cho từng dòng.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleApplyDropdownPresetAll('Đúng, Sai')}
                      className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-teal-600 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      Mẫu: Đúng / Sai
                    </button>
                    <button
                      type="button"
                      onClick={() => handleApplyDropdownPresetAll('Yes, No')}
                      className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-teal-600 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      Mẫu: Yes / No
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleApplyDropdownPresetAll('Thiên kiến, Không thiên kiến')
                      }
                      className="px-2.5 py-1 rounded-md bg-white border border-slate-300 hover:border-teal-600 text-xs font-semibold text-slate-700 cursor-pointer"
                    >
                      Mẫu: Thiên kiến / Không thiên kiến
                    </button>
                    <button
                      type="button"
                      onClick={handleAddDropdownRow}
                      className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Thêm mệnh đề</span>
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  {draft.dropdownRows.map((row, idx) => {
                    const parsedChoices = parseChoicesText(row.choicesText);
                    const finalChoices =
                      parsedChoices.length >= 2 ? parsedChoices : ['Đúng', 'Sai'];

                    return (
                      <div
                        key={row.id}
                        className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-bold font-mono text-teal-800">
                            Mệnh đề #{idx + 1}
                          </span>
                          <button
                            type="button"
                            disabled={draft.dropdownRows.length <= 1}
                            onClick={() => handleRemoveDropdownRow(idx)}
                            aria-label={`Xóa mệnh đề ${idx + 1}`}
                            className="text-xs text-slate-400 hover:text-rose-600 disabled:opacity-30 inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Xóa dòng</span>
                          </button>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
                          <div className="lg:col-span-6">
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                              Nội dung mệnh đề / câu hỏi con
                            </label>
                            <input
                              type="text"
                              value={row.statement}
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraft((prev) => ({
                                  ...prev,
                                  dropdownRows: prev.dropdownRows.map((r, i) =>
                                    i === idx ? { ...r, statement: val } : r
                                  ),
                                }));
                              }}
                              placeholder="Nhập nội dung mệnh đề cần chọn trong Dropdown..."
                              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300"
                            />
                          </div>

                          <div className="lg:col-span-3">
                            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                              Các lựa chọn (ngăn cách dấu phẩy)
                            </label>
                            <input
                              type="text"
                              value={row.choicesText}
                              onChange={(e) => {
                                const nextText = e.target.value;
                                const nextList = parseChoicesText(nextText);
                                setDraft((prev) => ({
                                  ...prev,
                                  dropdownRows: prev.dropdownRows.map((r, i) =>
                                    i === idx
                                      ? {
                                          ...r,
                                          choicesText: nextText,
                                          correctChoice: nextList.includes(
                                            r.correctChoice
                                          )
                                            ? r.correctChoice
                                            : nextList[0] || '',
                                        }
                                      : r
                                  ),
                                }));
                              }}
                              placeholder="Ví dụ: Đúng, Sai"
                              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300"
                            />
                          </div>

                          <div className="lg:col-span-3">
                            <label className="block text-[11px] font-semibold text-emerald-700 mb-1">
                              Đáp án đúng của dòng này
                            </label>
                            <select
                              aria-label={`Đáp án đúng mệnh đề ${idx + 1}`}
                              value={
                                finalChoices.includes(row.correctChoice)
                                  ? row.correctChoice
                                  : finalChoices[0]
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setDraft((prev) => ({
                                  ...prev,
                                  dropdownRows: prev.dropdownRows.map((r, i) =>
                                    i === idx ? { ...r, correctChoice: val } : r
                                  ),
                                }));
                              }}
                              className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-emerald-500 bg-emerald-50/50 text-emerald-950 font-bold"
                            >
                              {finalChoices.map((ch) => (
                                <option key={ch} value={ch}>
                                  {ch}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* LOẠI 4: NỐI CÂU (MATCHING - VẾ TRÁI & VẾ PHẢI TƯƠNG ỨNG) */}
            {draft.type === 'matching' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Cấu hình Các cặp ghép nối (Matching: Vế trái — Vế phải tương ứng)
                    </h3>
                    <p className="text-xs text-slate-500">
                      Nhập từng cặp Vế trái và Vế phải đúng tương ứng. Khi thi, hệ thống sẽ tự động xáo trộn các mảnh ghép ở cột phải.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddMatchingPair}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm cặp ghép nối</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {draft.matchingPairs.map((pair, idx) => (
                    <div
                      key={pair.id}
                      className="p-3 rounded-xl bg-white border border-slate-200 grid grid-cols-1 lg:grid-cols-12 gap-3 items-center"
                    >
                      <div className="lg:col-span-5">
                        <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                          Vế trái #{idx + 1} (Khái niệm / Kỹ thuật)
                        </label>
                        <input
                          type="text"
                          value={pair.left}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraft((prev) => ({
                              ...prev,
                              matchingPairs: prev.matchingPairs.map((p, i) =>
                                i === idx ? { ...p, left: val } : p
                              ),
                            }));
                          }}
                          placeholder="Ví dụ: Few-shot Prompting"
                          className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300"
                        />
                      </div>

                      <div className="lg:col-span-6">
                        <label className="block text-[11px] font-semibold text-emerald-700 mb-1">
                          Vế phải tương ứng #{idx + 1} (Định nghĩa / Ví dụ ghép đúng)
                        </label>
                        <input
                          type="text"
                          value={pair.right}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraft((prev) => ({
                              ...prev,
                              matchingPairs: prev.matchingPairs.map((p, i) =>
                                i === idx ? { ...p, right: val } : p
                              ),
                            }));
                          }}
                          placeholder="Ví dụ: Cung cấp 2-3 cặp ví dụ mẫu trước khi yêu cầu AI..."
                          className="w-full px-3 py-2 text-xs sm:text-sm rounded-lg border border-emerald-400 bg-emerald-50/30"
                        />
                      </div>

                      <div className="lg:col-span-1 flex justify-end pt-4">
                        <button
                          type="button"
                          disabled={draft.matchingPairs.length <= 2}
                          onClick={() => handleRemoveMatchingPair(idx)}
                          aria-label={`Xóa cặp nối ${idx + 1}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* LOẠI 5: SẮP XẾP THỨ TỰ (ORDERING 1, 2, 3, 4...) */}
            {draft.type === 'ordering' && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">
                      Cấu hình Các bước theo đúng Thứ tự chuẩn (Ordering: Bước 1 → Bước {draft.orderingSteps.length})
                    </h3>
                    <p className="text-xs text-slate-500">
                      Nhập các bước theo đúng thứ tự chuẩn (1, 2, 3, 4...). Khi học sinh làm bài, hệ thống sẽ tự động xáo trộn vị trí các bước này.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddOrderingStep}
                    className="px-3 py-1.5 rounded-lg bg-teal-700 hover:bg-teal-800 text-white text-xs font-semibold inline-flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Thêm bước tiếp theo</span>
                  </button>
                </div>

                <div className="space-y-2.5">
                  {draft.orderingSteps.map((step, idx) => (
                    <div
                      key={step.id}
                      className="p-3 rounded-xl bg-white border border-slate-200 flex items-center gap-3"
                    >
                      <span className="px-3 py-1.5 rounded-lg bg-teal-800 text-white text-xs font-mono font-bold shrink-0">
                        Bước {idx + 1}
                      </span>

                      <input
                        type="text"
                        value={step.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((prev) => ({
                            ...prev,
                            orderingSteps: prev.orderingSteps.map((s, i) =>
                              i === idx ? { ...s, text: val } : s
                            ),
                          }));
                        }}
                        placeholder={`Nhập nội dung chuẩn của Bước ${idx + 1}...`}
                        className="flex-1 px-3 py-2 text-xs sm:text-sm rounded-lg border border-slate-300"
                      />

                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMoveOrderingStep(idx, -1)}
                          aria-label={`Đưa bước ${idx + 1} lên trên`}
                          className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === draft.orderingSteps.length - 1}
                          onClick={() => handleMoveOrderingStep(idx, 1)}
                          aria-label={`Đưa bước ${idx + 1} xuống dưới`}
                          className="p-1.5 rounded border border-slate-200 hover:bg-slate-100 disabled:opacity-30 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={draft.orderingSteps.length <= 2}
                          onClick={() => handleRemoveOrderingStep(idx)}
                          aria-label={`Xóa bước ${idx + 1}`}
                          className="p-1.5 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 disabled:opacity-30 cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 5. Giải thích ngắn gọn */}
          <div>
            <label
              htmlFor="q-editor-explanation"
              className="block text-xs font-bold text-slate-700 mb-1"
            >
              Giải thích đáp án ngắn gọn (Explanation) *
            </label>
            <textarea
              id="q-editor-explanation"
              data-testid="question-editor-explanation-input"
              rows={2}
              value={draft.explanation}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, explanation: e.target.value }))
              }
              placeholder="Giải thích ngắn gọn vì sao đáp án trên là chính xác để hiển thị cho học sinh khi ôn tập..."
              className="w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border border-slate-300 text-slate-900"
            />
          </div>

          {/* Footer Modal Actions */}
          <div className="pt-4 border-t border-slate-200 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs sm:text-sm font-semibold text-slate-700 cursor-pointer"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              data-testid="save-question-modal-btn"
              disabled={isSaving}
              className="px-5 py-2.5 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs sm:text-sm font-bold inline-flex items-center gap-2 shadow-xs cursor-pointer"
            >
              <Save className="w-4 h-4" />
              <span>
                {isSaving
                  ? 'Đang lưu lên Firestore...'
                  : isEditing
                    ? 'Lưu cập nhật câu hỏi'
                    : 'Tạo câu hỏi & Lưu Firestore'}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
