import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  GripVertical,
  Lightbulb,
  RotateCcw,
  Sparkles,
  Star,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { QUESTION_TYPE_LABELS, Question, UserAnswer } from '../types/exam';
import { evaluateQuestion, getCorrectAnswerBreakdown } from '../utils/scoring';

export type QuestionFontScale = 'normal' | 'large' | 'xlarge';

interface QuestionRendererProps {
  question: Question;
  questionNumber?: number;
  totalQuestions?: number;
  userAnswer: UserAnswer | undefined;
  onChangeAnswer: (answer: UserAnswer) => void;
  showFeedback?: boolean;
  readOnly?: boolean;
  isBookmarked?: boolean;
  onToggleBookmark?: (questionId: string) => void;
  fontScale?: QuestionFontScale;
}

export const QuestionRenderer: React.FC<QuestionRendererProps> = ({
  question,
  questionNumber,
  totalQuestions,
  userAnswer,
  onChangeAnswer,
  showFeedback = false,
  readOnly = false,
  isBookmarked = false,
  onToggleBookmark,
  fontScale = 'normal',
}) => {
  const [selectedLeftPairId, setSelectedLeftPairId] = useState<string | null>(null);
  const [draggedMatchText, setDraggedMatchText] = useState<string | null>(null);
  const [dragOverPairId, setDragOverPairId] = useState<string | null>(null);

  const [draggedStepId, setDraggedStepId] = useState<string | null>(null);
  const [dragOverSlotIndex, setDragOverSlotIndex] = useState<number | null>(null);
  const [isZoomedImageOpen, setIsZoomedImageOpen] = useState<boolean>(false);

  const isCorrect = useMemo(
    () => evaluateQuestion(question, userAnswer),
    [question, userAnswer]
  );

  const correctBreakdown = useMemo(
    () => getCorrectAnswerBreakdown(question),
    [question]
  );

  const maxAllowedMultiple = useMemo(() => {
    return (
      question.maxSelect ??
      question.maxSelections ??
      (Array.isArray(question.correctAnswer) ? question.correctAnswer.length : 2)
    );
  }, [question]);

  // Danh sách mảnh ghép cột phải cho câu hỏi Matching (cố định thứ tự hiển thị để không lộ đáp án)
  const rightChoices = useMemo(() => {
    if (question.type !== 'matching' || !question.pairs) return [];
    const list = question.pairs.map((p) => p.right);
    return [...list].sort((a, b) => a.localeCompare(b, 'vi'));
  }, [question]);

  // 1. Xử lý chọn 1 đáp án (mcq_single - Radio Button)
  const handleSelectSingle = (optId: string) => {
    if (readOnly) return;
    onChangeAnswer(optId);
  };

  // 2. Xử lý chọn nhiều đáp án (mcq_multiple - Checkbox vuông)
  const handleToggleMultiple = (optId: string) => {
    if (readOnly) return;
    const current = Array.isArray(userAnswer) ? [...userAnswer] : [];

    if (current.includes(optId)) {
      onChangeAnswer(current.filter((id) => id !== optId));
    } else {
      if (current.length >= maxAllowedMultiple) {
        onChangeAnswer([...current.slice(1), optId]);
      } else {
        onChangeAnswer([...current, optId]);
      }
    }
  };

  // 3. Xử lý chọn Dropdown (- Select -)
  const handleSelectDropdown = (subItemId: string, value: string) => {
    if (readOnly) return;
    const currentMap =
      userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
        ? { ...(userAnswer as Record<string, string>) }
        : {};
    if (!value) {
      delete currentMap[subItemId];
    } else {
      currentMap[subItemId] = value;
    }
    onChangeAnswer(currentMap);
  };

  // 4. Xử lý nối cặp Matching (Kéo thả Puzzle hoặc bấm chọn)
  const handleAssignMatch = (leftId: string, rightText: string) => {
    if (readOnly) return;
    const currentMap =
      userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
        ? { ...(userAnswer as Record<string, string>) }
        : {};

    // Gỡ mảnh ghép phải này nếu đang gắn ở một dòng khác
    for (const k of Object.keys(currentMap)) {
      if (currentMap[k] === rightText && k !== leftId) {
        delete currentMap[k];
      }
    }

    if (!rightText) {
      delete currentMap[leftId];
    } else {
      currentMap[leftId] = rightText;
    }
    onChangeAnswer(currentMap);
    setSelectedLeftPairId(null);
  };

  const handleClearSingleMatch = (leftId: string) => {
    if (readOnly) return;
    const currentMap =
      userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
        ? { ...(userAnswer as Record<string, string>) }
        : {};
    delete currentMap[leftId];
    onChangeAnswer(currentMap);
  };

  // 5. Xử lý Ordering (Sắp xếp thứ tự các bước: Kéo thả + Lên/Xuống)
  const orderedStepIds: string[] = useMemo(() => {
    if (question.type !== 'ordering' || !question.steps) return [];
    if (Array.isArray(userAnswer) && userAnswer.length > 0) {
      return userAnswer;
    }
    return [];
  }, [question, userAnswer]);

  const availablePoolSteps = useMemo(() => {
    if (question.type !== 'ordering' || !question.steps) return [];
    const usedSet = new Set(orderedStepIds);
    return [...question.steps]
      .filter((s) => !usedSet.has(s.id))
      .sort((a, b) => a.text.localeCompare(b.text, 'vi'));
  }, [question, orderedStepIds]);

  const handleAddStepToOrder = (stepId: string) => {
    if (readOnly) return;
    if (orderedStepIds.includes(stepId)) return;
    onChangeAnswer([...orderedStepIds, stepId]);
  };

  const handleRemoveStepFromOrder = (stepId: string) => {
    if (readOnly) return;
    onChangeAnswer(orderedStepIds.filter((id) => id !== stepId));
  };

  const handleMoveOrderedStep = (index: number, direction: -1 | 1) => {
    if (readOnly) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= orderedStepIds.length) return;
    const copy = [...orderedStepIds];
    const temp = copy[index];
    copy[index] = copy[targetIndex];
    copy[targetIndex] = temp;
    onChangeAnswer(copy);
  };

  const handleDropStepAtSlot = (stepId: string, targetSlotIdx: number) => {
    if (readOnly || !question.steps) return;
    const current = [...orderedStepIds];
    const existingIdx = current.indexOf(stepId);

    if (existingIdx !== -1) {
      current.splice(existingIdx, 1);
      const insertAt = Math.min(targetSlotIdx, current.length);
      current.splice(insertAt, 0, stepId);
      onChangeAnswer(current);
    } else {
      const insertAt = Math.min(targetSlotIdx, current.length);
      current.splice(insertAt, 0, stepId);
      onChangeAnswer(current);
    }
  };

  const handleAutoOrderAll = () => {
    if (readOnly || !question.steps) return;
    const remaining = availablePoolSteps.map((s) => s.id);
    onChangeAnswer([...orderedStepIds, ...remaining]);
  };

  // Kiểm tra xem đề bài mcq_multiple đã có chữ "(Chọn X)" chưa
  const promptHasChooseNote = useMemo(() => {
    if (question.type !== 'mcq_multiple') return false;
    return /\(\s*Chọn\s+\d+\s*\)/i.test(question.prompt);
  }, [question.prompt, question.type]);

  // Cỡ chữ chuẩn 16-17px dễ đọc khi ôn tập thời gian dài
  const promptTextSizeClass =
    fontScale === 'xlarge'
      ? 'text-lg sm:text-xl leading-relaxed'
      : fontScale === 'large'
        ? 'text-base sm:text-[18px] leading-relaxed'
        : 'text-[15px] sm:text-[17px] leading-relaxed';

  const optionTextSizeClass =
    fontScale === 'xlarge'
      ? 'text-base sm:text-lg leading-snug'
      : fontScale === 'large'
        ? 'text-sm sm:text-[16px] leading-snug'
        : 'text-[13px] sm:text-[15px] leading-snug';

  const selectedMultipleCount = Array.isArray(userAnswer) ? userAnswer.length : 0;
  const matchedPairCount =
    userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
      ? Object.keys(userAnswer).length
      : 0;

  return (
    <div
      data-testid="question-renderer-card"
      data-font-scale={fontScale}
      className="bg-white border border-slate-200/80 rounded-2xl shadow-sm hover:shadow-md transition-all duration-200 ease-in-out overflow-hidden"
    >
      {/* Thanh Header câu hỏi: Nhãn bo tròn mềm (rounded-full / rounded-lg) & phân cấp rõ ràng */}
      <div className="px-4 sm:px-6 py-3 bg-slate-50/90 border-b border-slate-200/80 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-extrabold text-teal-800 bg-teal-50 border border-teal-200/90 px-3 py-1 rounded-full tabular-nums shadow-2xs">
            {questionNumber !== undefined && totalQuestions !== undefined
              ? `Câu ${questionNumber} / ${totalQuestions}`
              : question.id.toUpperCase()}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-white border border-slate-200/80 text-slate-700 font-semibold">
            {question.topic}
          </span>
          <span className="px-2.5 py-1 rounded-lg bg-sky-50/80 border border-sky-200/70 text-teal-800 font-semibold">
            {QUESTION_TYPE_LABELS[question.type]}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Ghi chú ngắn gọn theo từng dạng bài ngay trên thanh tiêu đề */}
          {question.type === 'mcq_single' && (
            <span className="text-[11px] font-semibold text-slate-500 bg-white px-2.5 py-1 rounded-full border border-slate-200/70">
              Chọn 1 đáp án đúng
            </span>
          )}
          {question.type === 'mcq_multiple' && (
            <span className="text-[11px] font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full tabular-nums">
              Chọn {maxAllowedMultiple} · Đã chọn: {selectedMultipleCount}/{maxAllowedMultiple}
            </span>
          )}
          {question.type === 'dropdown' && (
            <span className="text-[11px] font-semibold text-slate-500 bg-white px-2.5 py-1 rounded-full border border-slate-200/70">
              Chọn từ hộp - Select -
            </span>
          )}
          {question.type === 'matching' && question.pairs && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full tabular-nums">
                Đã ghép: {matchedPairCount}/{question.pairs.length}
              </span>
              {!readOnly && matchedPairCount > 0 && (
                <button
                  type="button"
                  onClick={() => onChangeAnswer({})}
                  className="px-2.5 py-1 rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-all duration-200 inline-flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" /> Làm mới
                </button>
              )}
            </div>
          )}
          {question.type === 'ordering' && question.steps && (
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-mono font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2.5 py-1 rounded-full tabular-nums">
                Đã xếp: {orderedStepIds.length}/{question.steps.length}
              </span>
              {!readOnly && availablePoolSteps.length > 0 && (
                <button
                  type="button"
                  onClick={handleAutoOrderAll}
                  className="px-2.5 py-1 rounded-full bg-teal-700 text-white text-[11px] font-semibold hover:bg-teal-800 transition-all duration-200 cursor-pointer"
                >
                  + Đưa hết sang khung
                </button>
              )}
              {!readOnly && orderedStepIds.length > 0 && (
                <button
                  type="button"
                  onClick={() => onChangeAnswer([])}
                  className="px-2.5 py-1 rounded-full border border-slate-300 bg-white text-[11px] font-semibold text-slate-700 hover:bg-slate-100 transition-all duration-200 cursor-pointer"
                >
                  Đặt lại
                </button>
              )}
            </div>
          )}

          {onToggleBookmark && (
            <button
              type="button"
              onClick={() => onToggleBookmark(question.id)}
              aria-label={
                isBookmarked
                  ? 'Bỏ đánh dấu câu hỏi (Bookmark)'
                  : 'Đánh dấu câu hỏi (Bookmark)'
              }
              className={`px-3 py-1 rounded-full border text-xs font-semibold inline-flex items-center gap-1.5 transition-all duration-200 cursor-pointer ${
                isBookmarked
                  ? 'border-amber-400 bg-amber-50 text-amber-800 shadow-2xs'
                  : 'border-slate-300 bg-white text-slate-600 hover:border-teal-600 hover:text-teal-800'
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  isBookmarked ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                }`}
              />
              <span className="hidden sm:inline">
                {isBookmarked ? 'Đã lưu' : 'Đánh dấu'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Nội dung câu hỏi chính (Hệ thống khoảng cách 8pt chuẩn mực) */}
      <div className="p-4 sm:p-6 space-y-4">
        <div className="space-y-3">
          <p className={`${promptTextSizeClass} font-bold text-slate-900 tracking-tight`}>
            {question.prompt}
            {question.type === 'mcq_multiple' && !promptHasChooseNote && (
              <span className="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-teal-50 text-teal-800 border border-teal-200 align-middle">
                Chọn {maxAllowedMultiple}
              </span>
            )}
          </p>

          {question.imageUrl && (
            <div
              data-testid="question-rendered-image-box"
              className="rounded-xl border border-slate-200/80 bg-slate-50/80 p-3 space-y-2"
            >
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold text-teal-800">
                  Hình ảnh / Sơ đồ minh họa câu hỏi
                </span>
                <button
                  type="button"
                  onClick={() => setIsZoomedImageOpen(true)}
                  className="text-xs font-semibold text-teal-700 hover:underline cursor-pointer"
                >
                  Phóng to ảnh ↗
                </button>
              </div>
              <div className="flex justify-center bg-white rounded-lg border border-slate-200/80 p-2">
                <img
                  src={question.imageUrl}
                  alt={`Hình minh họa cho câu hỏi ${question.id.toUpperCase()}`}
                  referrerPolicy="no-referrer"
                  onClick={() => setIsZoomedImageOpen(true)}
                  className="max-h-52 w-auto rounded object-contain cursor-zoom-in"
                />
              </div>
            </div>
          )}

          {isZoomedImageOpen && question.imageUrl && (
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Xem phóng to hình ảnh câu hỏi"
              onClick={() => setIsZoomedImageOpen(false)}
              className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] p-4 flex flex-col gap-3 shadow-2xl border border-slate-200"
              >
                <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
                  <span className="text-sm font-bold text-slate-900">
                    Hình ảnh đề thi — Câu {question.id.toUpperCase()}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsZoomedImageOpen(false)}
                    className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
                  >
                    Đóng (ESC)
                  </button>
                </div>
                <div className="overflow-auto flex-1 flex items-center justify-center bg-slate-50 rounded-xl p-3">
                  <img
                    src={question.imageUrl}
                    alt={`Hình phóng to câu ${question.id.toUpperCase()}`}
                    referrerPolicy="no-referrer"
                    className="max-h-[78vh] w-auto object-contain rounded"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* =====================================================================
            DẠNG 1A: TRẮC NGHIỆM 1 LỰA CHỌN (RADIO BUTTON TRÒN CHUẨN CERTIPORT)
            Tối ưu hiển thị tô màu câu Đúng (Emerald Mint) / Sai (Rose Coral) dịu mắt
           ===================================================================== */}
        {question.type === 'mcq_single' && question.options && (
          <div className="space-y-2.5" role="radiogroup" aria-label={question.prompt}>
            {question.options.map((opt, idx) => {
              const isSelected = userAnswer === opt.id;
              const isOptionCorrect = question.correctAnswer === opt.id;
              const letter = String.fromCharCode(65 + idx);

              let containerClass =
                'border-slate-200/90 bg-white hover:border-teal-500/80 hover:bg-teal-50/25 hover:shadow-2xs';
              if (isSelected) {
                containerClass =
                  'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600/50 shadow-2xs';
              }
              if (showFeedback) {
                if (isOptionCorrect) {
                  containerClass =
                    'feedback-option-correct border-emerald-500 border-l-4 border-l-emerald-600 bg-emerald-50/85 ring-1 ring-emerald-500/20 shadow-2xs';
                } else if (isSelected && !isOptionCorrect) {
                  containerClass =
                    'feedback-option-wrong border-rose-400 border-l-4 border-l-rose-500 bg-rose-50/85 ring-1 ring-rose-400/20 shadow-2xs';
                } else {
                  containerClass =
                    'feedback-option-neutral border-slate-200/70 bg-slate-50/40 opacity-70';
                }
              }

              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  disabled={readOnly}
                  onClick={() => handleSelectSingle(opt.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ease-in-out flex items-start gap-3.5 cursor-pointer disabled:cursor-default ${containerClass}`}
                >
                  {/* Radio Button Tròn */}
                  <span
                    className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-all duration-200 ${
                      showFeedback && isOptionCorrect
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : showFeedback && isSelected && !isOptionCorrect
                          ? 'border-rose-500 bg-rose-500 text-white'
                          : isSelected
                            ? 'border-teal-700 bg-teal-700 text-white'
                            : 'border-slate-300 bg-white'
                    }`}
                  >
                    {showFeedback && isOptionCorrect ? (
                      <Check className="w-3 h-3 stroke-[3]" />
                    ) : showFeedback && isSelected && !isOptionCorrect ? (
                      <X className="w-3 h-3 stroke-[3]" />
                    ) : isSelected ? (
                      <span className="w-2 h-2 rounded-full bg-white" />
                    ) : null}
                  </span>

                  <div className={`flex-1 ${optionTextSizeClass} text-slate-800`}>
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-mono font-bold mr-2.5 ${
                        showFeedback && isOptionCorrect
                          ? 'bg-emerald-600 text-white'
                          : showFeedback && isSelected && !isOptionCorrect
                            ? 'bg-rose-500 text-white'
                            : isSelected
                              ? 'bg-teal-100 text-teal-900'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {letter}
                    </span>
                    <span
                      className={
                        showFeedback && isOptionCorrect
                          ? 'font-bold text-emerald-950'
                          : showFeedback && isSelected && !isOptionCorrect
                            ? 'font-semibold text-rose-950'
                            : isSelected
                              ? 'font-semibold text-slate-900'
                              : ''
                      }
                    >
                      {opt.text}
                    </span>
                  </div>

                  {showFeedback && isOptionCorrect && (
                    <span className="text-[11px] font-bold text-emerald-900 shrink-0 whitespace-nowrap inline-flex items-center gap-1 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{isSelected ? 'Bạn chọn đúng' : 'Đáp án đúng'}</span>
                    </span>
                  )}
                  {showFeedback && isSelected && !isOptionCorrect && (
                    <span className="text-[11px] font-bold text-rose-900 shrink-0 whitespace-nowrap inline-flex items-center gap-1 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-full">
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Bạn chọn sai</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* =====================================================================
            DẠNG 1B: TRẮC NGHIỆM NHIỀU LỰA CHỌN (CHECKBOX VUÔNG CHUẨN CERTIPORT)
            Tối ưu hiển thị tô màu câu Đúng / Sai dịu mắt, dễ phân biệt
           ===================================================================== */}
        {question.type === 'mcq_multiple' && question.options && (
          <div className="space-y-2.5">
            {question.options.map((opt, idx) => {
              const selectedArr = Array.isArray(userAnswer) ? userAnswer : [];
              const isSelected = selectedArr.includes(opt.id);
              const correctArr = Array.isArray(question.correctAnswer)
                ? question.correctAnswer
                : [];
              const isOptionCorrect = correctArr.includes(opt.id);
              const letter = String.fromCharCode(65 + idx);

              let containerClass =
                'border-slate-200/90 bg-white hover:border-teal-500/80 hover:bg-teal-50/25 hover:shadow-2xs';
              if (isSelected) {
                containerClass =
                  'border-teal-600 bg-teal-50/50 ring-1 ring-teal-600/50 shadow-2xs';
              }
              if (showFeedback) {
                if (isOptionCorrect) {
                  containerClass =
                    'feedback-option-correct border-emerald-500 border-l-4 border-l-emerald-600 bg-emerald-50/85 ring-1 ring-emerald-500/20 shadow-2xs';
                } else if (isSelected && !isOptionCorrect) {
                  containerClass =
                    'feedback-option-wrong border-rose-400 border-l-4 border-l-rose-500 bg-rose-50/85 ring-1 ring-rose-400/20 shadow-2xs';
                } else {
                  containerClass =
                    'feedback-option-neutral border-slate-200/70 bg-slate-50/40 opacity-70';
                }
              }

              return (
                <button
                  key={opt.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  disabled={readOnly}
                  onClick={() => handleToggleMultiple(opt.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl border transition-all duration-200 ease-in-out flex items-start gap-3.5 cursor-pointer disabled:cursor-default ${containerClass}`}
                >
                  {/* Checkbox Vuông */}
                  <span
                    className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2 transition-all duration-200 ${
                      showFeedback && isOptionCorrect
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : showFeedback && isSelected && !isOptionCorrect
                          ? 'border-rose-500 bg-rose-500 text-white'
                          : isSelected
                            ? 'border-teal-700 bg-teal-700 text-white'
                            : 'border-slate-300 bg-white'
                    }`}
                  >
                    {showFeedback && isOptionCorrect ? (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    ) : showFeedback && isSelected && !isOptionCorrect ? (
                      <X className="w-3.5 h-3.5 stroke-[3]" />
                    ) : isSelected ? (
                      <Check className="w-3.5 h-3.5 stroke-[3]" />
                    ) : null}
                  </span>

                  <div className={`flex-1 ${optionTextSizeClass} text-slate-800`}>
                    <span
                      className={`inline-flex items-center justify-center w-6 h-6 rounded-md text-xs font-mono font-bold mr-2.5 ${
                        showFeedback && isOptionCorrect
                          ? 'bg-emerald-600 text-white'
                          : showFeedback && isSelected && !isOptionCorrect
                            ? 'bg-rose-500 text-white'
                            : isSelected
                              ? 'bg-teal-100 text-teal-900'
                              : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {letter}
                    </span>
                    <span
                      className={
                        showFeedback && isOptionCorrect
                          ? 'font-bold text-emerald-950'
                          : showFeedback && isSelected && !isOptionCorrect
                            ? 'font-semibold text-rose-950'
                            : isSelected
                              ? 'font-semibold text-slate-900'
                              : ''
                      }
                    >
                      {opt.text}
                    </span>
                  </div>

                  {showFeedback && isOptionCorrect && (
                    <span className="text-[11px] font-bold text-emerald-900 shrink-0 whitespace-nowrap inline-flex items-center gap-1 bg-emerald-100 border border-emerald-300 px-2.5 py-0.5 rounded-full">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>{isSelected ? 'Chọn đúng' : 'Đáp án chuẩn'}</span>
                    </span>
                  )}
                  {showFeedback && isSelected && !isOptionCorrect && (
                    <span className="text-[11px] font-bold text-rose-900 shrink-0 whitespace-nowrap inline-flex items-center gap-1 bg-rose-100 border border-rose-300 px-2.5 py-0.5 rounded-full">
                      <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                      <span>Chọn sai</span>
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* =====================================================================
            DẠNG 2: MENU THẢ XUỐNG (- Select - DROPDOWN CHUẨN PHÒNG THI CERTIPORT)
           ===================================================================== */}
        {question.type === 'dropdown' && question.subItems && (
          <div className="border border-slate-200/90 rounded-2xl overflow-hidden shadow-2xs">
            <div className="grid grid-cols-12 bg-slate-100/90 px-4 py-2.5 text-xs font-bold text-slate-700 border-b border-slate-200/80">
              <div className="col-span-12 sm:col-span-7">
                {question.dropdownColumns?.[0] || 'Mệnh đề / Nhận định đánh giá'}
              </div>
              <div className="col-span-12 sm:col-span-5 mt-1 sm:mt-0">
                {question.dropdownColumns?.[1] || 'Hộp chọn thả xuống (- Select -)'}
              </div>
            </div>

            <div className="divide-y divide-slate-200/80">
              {question.subItems.map((sub, idx) => {
                const currentMap =
                  userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
                    ? (userAnswer as Record<string, string>)
                    : {};
                const selectedVal = currentMap[sub.id] || '';
                const expectedMap = question.correctAnswer as Record<string, string>;
                const expectedVal = expectedMap[sub.id];
                const choices =
                  sub.choices ?? sub.options ?? question.dropdownOptions ?? ['Yes', 'No'];
                const subCorrect = showFeedback && selectedVal === expectedVal;

                return (
                  <div
                    key={sub.id}
                    className={`grid grid-cols-12 items-center gap-3 px-4 py-3 transition-all duration-200 ${
                      showFeedback
                        ? subCorrect
                          ? 'feedback-option-correct bg-emerald-50/70 border-l-4 border-l-emerald-500'
                          : 'feedback-option-wrong bg-rose-50/70 border-l-4 border-l-rose-500'
                        : 'bg-white hover:bg-slate-50/80'
                    }`}
                  >
                    <div className="col-span-12 sm:col-span-7 flex items-start gap-3">
                      <span
                        className={`w-6 h-6 rounded-lg text-xs font-mono font-bold flex items-center justify-center shrink-0 tabular-nums mt-0.5 ${
                          showFeedback
                            ? subCorrect
                              ? 'bg-emerald-600 text-white'
                              : 'bg-rose-500 text-white'
                            : 'bg-slate-100 border border-slate-200 text-slate-700'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className={`${optionTextSizeClass} text-slate-800 font-medium`}>
                        {sub.statement}
                      </span>
                    </div>

                    <div className="col-span-12 sm:col-span-5 space-y-1.5">
                      <select
                        aria-label={`Chọn đáp án cho: ${sub.statement}`}
                        disabled={readOnly}
                        value={selectedVal}
                        onChange={(e) => handleSelectDropdown(sub.id, e.target.value)}
                        className={`w-full px-3.5 py-2 text-xs sm:text-sm rounded-xl border bg-white font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer disabled:cursor-default ${
                          showFeedback
                            ? subCorrect
                              ? 'border-emerald-500 bg-emerald-50/85 text-emerald-950'
                              : 'border-rose-400 bg-rose-50/85 text-rose-950'
                            : selectedVal
                              ? 'border-teal-600 text-teal-900 bg-teal-50/30'
                              : 'border-slate-300 text-slate-700'
                        }`}
                      >
                        <option value="">- Select -</option>
                        {choices.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>

                      {showFeedback && (
                        <div className="flex items-center justify-between text-[11px] px-1">
                          {subCorrect ? (
                            <span className="text-emerald-800 font-bold inline-flex items-center gap-1 bg-emerald-100/80 border border-emerald-200 px-2 py-0.5 rounded-full">
                              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <span>Chính xác ({expectedVal})</span>
                            </span>
                          ) : (
                            <span className="text-rose-800 font-bold inline-flex items-center gap-1 bg-rose-100/80 border border-rose-200 px-2 py-0.5 rounded-full">
                              <XCircle className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                              <span>
                                Đáp án đúng:{' '}
                                <strong className="underline text-emerald-800">{expectedVal}</strong>
                              </span>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =====================================================================
            DẠNG 3: KÉO THẢ NỐI CÂU (PUZZLE MATCHING — THUẦN KÉO THẢ GỌN GÀNG, KHÔNG DÙNG DROPDOWN SELECT)
            - Bố cục 2 cột ngang chuẩn Certiport: Cột trái (Kho thẻ kéo) · Cột phải (Mệnh đề & Ô thả)
            - Tiết kiệm tối đa diện tích dọc, thao tác Kéo-Thả hoặc Chạm-Thả trực tiếp
           ===================================================================== */}
        {question.type === 'matching' && question.pairs && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-start">
            {/* Cột trái (5/12): Kho thẻ nguồn để kéo sang phải */}
            <div className="md:col-span-5 p-3 bg-slate-50/90 rounded-xl border border-slate-200/90 space-y-2">
              <div className="flex items-center justify-between gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-600">
                <span>Kho mảnh ghép (Kéo sang ô phải)</span>
                <span className="font-mono text-teal-800">
                  Còn {Math.max(0, rightChoices.length - matchedPairCount)}/{rightChoices.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {rightChoices.map((rightText) => {
                  const currentMap =
                    userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
                      ? (userAnswer as Record<string, string>)
                      : {};
                  const matchedLeftIndex = question.pairs?.findIndex(
                    (p) => currentMap[p.id] === rightText
                  );
                  const isUsed = matchedLeftIndex !== undefined && matchedLeftIndex >= 0;

                  return (
                    <div
                      key={rightText}
                      draggable={!readOnly}
                      onDragStart={(e) => {
                        setDraggedMatchText(rightText);
                        e.dataTransfer.setData('text/plain', rightText);
                      }}
                      onDragEnd={() => {
                        setDraggedMatchText(null);
                        setDragOverPairId(null);
                      }}
                      onClick={() => {
                        if (readOnly) return;
                        const targetLeftId =
                          selectedLeftPairId ??
                          question.pairs?.find((p) => !currentMap[p.id])?.id ??
                          question.pairs?.[0]?.id;
                        if (targetLeftId) {
                          handleAssignMatch(targetLeftId, rightText);
                        }
                      }}
                      role="button"
                      tabIndex={readOnly ? -1 : 0}
                      onKeyDown={(e) => {
                        if (readOnly) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          const targetLeftId =
                            selectedLeftPairId ??
                            question.pairs?.find((p) => !currentMap[p.id])?.id ??
                            question.pairs?.[0]?.id;
                          if (targetLeftId) {
                            handleAssignMatch(targetLeftId, rightText);
                          }
                        }
                      }}
                      className={`px-2.5 py-2 rounded-lg text-xs sm:text-[13px] border transition-all duration-150 flex items-center justify-between gap-2 select-none ${
                        readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                      } ${
                        isUsed
                          ? 'bg-slate-100/80 border-dashed border-slate-300 text-slate-400 opacity-60'
                          : 'bg-white border-slate-300 text-slate-800 font-medium hover:border-teal-600 hover:bg-teal-50/30 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="leading-snug">{rightText}</span>
                      </div>
                      {isUsed && (
                        <span className="text-[10px] font-mono font-bold bg-teal-700 text-white px-1.5 py-0.5 rounded shrink-0">
                          #{matchedLeftIndex + 1}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Cột phải (7/12): Danh sách các hàng Mệnh đề gốc & Ô thả mảnh ghép (Thuần Drag & Drop, không có Dropdown Select) */}
            <div className="md:col-span-7 space-y-2">
              {question.pairs.map((pair, idx) => {
                const currentMap =
                  userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
                    ? (userAnswer as Record<string, string>)
                    : {};
                const matchedRight = currentMap[pair.id] || '';
                const expectedMap = question.correctAnswer as Record<string, string>;
                const expectedRight = expectedMap[pair.id];
                const isSelectedLeft = selectedLeftPairId === pair.id;
                const isDragOver = dragOverPairId === pair.id;
                const isTargetWaitingHighlight =
                  !readOnly &&
                  !showFeedback &&
                  (isSelectedLeft || (Boolean(draggedMatchText) && !matchedRight));
                const pairCorrect = showFeedback && matchedRight === expectedRight;

                return (
                  <div
                    key={pair.id}
                    className="p-2.5 rounded-xl border border-slate-200/90 bg-slate-50/50 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                  >
                    {/* Nửa trái: Mệnh đề gốc */}
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() =>
                        setSelectedLeftPairId(isSelectedLeft ? null : pair.id)
                      }
                      className={`sm:col-span-6 text-left flex items-start gap-2 pr-1 rounded-lg transition-colors cursor-pointer disabled:cursor-default ${
                        isSelectedLeft ? 'text-teal-900' : 'text-slate-900'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-md text-[11px] font-mono font-bold flex items-center justify-center shrink-0 tabular-nums mt-0.5 ${
                          matchedRight
                            ? 'bg-teal-700 text-white'
                            : isSelectedLeft
                              ? 'bg-amber-500 text-white'
                              : 'bg-slate-200 text-slate-700'
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="text-xs sm:text-[13px] font-semibold leading-snug">
                        {pair.left}
                      </span>
                    </button>

                    {/* Nửa phải: Ô thả mảnh ghép trực tiếp (Drop Zone) */}
                    <div
                      aria-label={`Ô thả ghép nối cho: ${pair.left}`}
                      onDragOver={(e) => {
                        if (readOnly) return;
                        e.preventDefault();
                        setDragOverPairId(pair.id);
                      }}
                      onDragLeave={() => {
                        if (dragOverPairId === pair.id) {
                          setDragOverPairId(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (readOnly) return;
                        e.preventDefault();
                        const droppedText =
                          draggedMatchText || e.dataTransfer.getData('text/plain');
                        if (droppedText) {
                          handleAssignMatch(pair.id, droppedText);
                        }
                        setDragOverPairId(null);
                        setDraggedMatchText(null);
                      }}
                      onClick={() => {
                        if (readOnly) return;
                        setSelectedLeftPairId(isSelectedLeft ? null : pair.id);
                      }}
                      className={`sm:col-span-6 min-h-[38px] px-2.5 py-1.5 rounded-lg border-2 transition-all duration-150 flex flex-col justify-center gap-1 ${
                        showFeedback
                          ? pairCorrect
                            ? 'feedback-option-correct border-emerald-500 bg-emerald-50/80'
                            : 'feedback-option-wrong border-rose-400 bg-rose-50/80'
                          : isDragOver
                            ? 'border-dashed border-teal-600 bg-teal-50/90 ring-2 ring-teal-500/25'
                            : isTargetWaitingHighlight
                              ? 'border-dashed border-teal-500 bg-teal-50/40 animate-pulse'
                              : matchedRight
                                ? 'border-teal-600/80 bg-white shadow-2xs'
                                : 'border-dashed border-slate-300 bg-white hover:border-teal-500/70 cursor-pointer'
                      }`}
                    >
                      {matchedRight ? (
                        <div
                          draggable={!readOnly}
                          onDragStart={(e) => {
                            setDraggedMatchText(matchedRight);
                            e.dataTransfer.setData('text/plain', matchedRight);
                          }}
                          onDragEnd={() => {
                            setDraggedMatchText(null);
                            setDragOverPairId(null);
                          }}
                          className="flex items-center justify-between gap-1.5 min-w-0"
                        >
                          <span className="text-xs sm:text-[13px] font-semibold text-teal-950 leading-snug">
                            {matchedRight}
                          </span>
                          {!readOnly && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleClearSingleMatch(pair.id);
                              }}
                              aria-label={`Xóa cặp nối của ${pair.left}`}
                              title="Gỡ mảnh ghép này"
                              className="p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      ) : (
                        <div className="text-[11px] text-slate-400 flex items-center justify-center gap-1.5 py-0.5 select-none">
                          <span>
                            {isSelectedLeft
                              ? 'Bấm chọn 1 mảnh bên trái để điền vào đây'
                              : 'Kéo thả mảnh ghép vào ô này'}
                          </span>
                        </div>
                      )}

                      {showFeedback && (
                        <div className="text-[11px] pt-0.5 border-t border-slate-200/60 flex items-center justify-between">
                          {pairCorrect ? (
                            <span className="text-emerald-800 font-bold inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />
                              <span>Chính xác</span>
                            </span>
                          ) : (
                            <span className="text-rose-800 font-bold">
                              Đúng:{' '}
                              <strong className="underline text-emerald-800">
                                {expectedRight}
                              </strong>
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* =====================================================================
            DẠNG 4: SẮP XẾP THỨ TỰ (ORDERING — KÉO THẢ GỌN GÀNG 2 CỘT)
           ===================================================================== */}
        {question.type === 'ordering' && question.steps && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 items-start">
            {/* Cột trái: Các bước khả dụng */}
            <div className="border border-slate-200/90 rounded-xl p-3 bg-slate-50/80 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                <span>Các bước khả dụng (Kéo sang phải)</span>
                <span className="font-mono tabular-nums text-slate-500">
                  Còn {availablePoolSteps.length}
                </span>
              </div>

              {availablePoolSteps.length === 0 ? (
                <div className="py-5 px-3 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg bg-white">
                  Đã đưa hết {question.steps.length} bước sang khung trả lời.
                </div>
              ) : (
                <div className="space-y-1.5">
                  {availablePoolSteps.map((step) => (
                    <div
                      key={step.id}
                      draggable={!readOnly}
                      onDragStart={(e) => {
                        setDraggedStepId(step.id);
                        e.dataTransfer.setData('text/plain', step.id);
                      }}
                      onDragEnd={() => {
                        setDraggedStepId(null);
                        setDragOverSlotIndex(null);
                      }}
                      onClick={() => handleAddStepToOrder(step.id)}
                      role="button"
                      tabIndex={readOnly ? -1 : 0}
                      onKeyDown={(e) => {
                        if (readOnly) return;
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleAddStepToOrder(step.id);
                        }
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg border border-slate-300 bg-white hover:border-teal-600 hover:bg-teal-50/30 transition-all duration-150 flex items-center justify-between gap-2 shadow-2xs cursor-grab active:cursor-grabbing select-none"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="text-xs sm:text-[13px] font-medium text-slate-800 leading-snug">
                          {step.text}
                        </span>
                      </div>
                      <span className="text-[10px] font-bold text-teal-800 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded whitespace-nowrap shrink-0">
                        + Bước {orderedStepIds.length + 1}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Cột phải: Khung trả lời đánh số 1, 2, 3, 4... */}
            <div className="border border-slate-200/90 rounded-xl p-3 bg-white space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center justify-between">
                <span>Trình tự trả lời (Bước 1 → {question.steps.length})</span>
                <span className="font-mono tabular-nums text-teal-800">
                  {orderedStepIds.length}/{question.steps.length}
                </span>
              </div>

              <div className="space-y-1.5">
                {question.steps.map((_, slotIdx) => {
                  const stepId = orderedStepIds[slotIdx];
                  const stepObj = question.steps?.find((s) => s.id === stepId);
                  const expectedArr = Array.isArray(question.correctAnswer)
                    ? question.correctAnswer
                    : [];
                  const expectedStepId = expectedArr[slotIdx];
                  const expectedStepObj = question.steps?.find(
                    (s) => s.id === expectedStepId
                  );
                  const isSlotCorrect = showFeedback && stepId === expectedStepId;
                  const isDragOverSlot = dragOverSlotIndex === slotIdx;

                  return (
                    <div
                      key={`slot-${slotIdx}`}
                      onDragOver={(e) => {
                        if (readOnly) return;
                        e.preventDefault();
                        setDragOverSlotIndex(slotIdx);
                      }}
                      onDragLeave={() => {
                        if (dragOverSlotIndex === slotIdx) {
                          setDragOverSlotIndex(null);
                        }
                      }}
                      onDrop={(e) => {
                        if (readOnly) return;
                        e.preventDefault();
                        const droppedId =
                          draggedStepId || e.dataTransfer.getData('text/plain');
                        if (droppedId) {
                          handleDropStepAtSlot(droppedId, slotIdx);
                        }
                        setDragOverSlotIndex(null);
                        setDraggedStepId(null);
                      }}
                      className={`rounded-lg transition-all duration-150 ${
                        isDragOverSlot ? 'ring-2 ring-teal-600 bg-teal-50/40' : ''
                      }`}
                    >
                      {!stepObj ? (
                        <div className="px-3 py-2 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50/60 text-xs text-slate-400 flex items-center gap-2.5">
                          <span className="w-5 h-5 rounded bg-slate-200 text-slate-700 font-mono text-[11px] font-bold flex items-center justify-center tabular-nums">
                            {slotIdx + 1}
                          </span>
                          <span>Kéo thả bước {slotIdx + 1} vào đây</span>
                        </div>
                      ) : (
                        <div
                          draggable={!readOnly}
                          onDragStart={(e) => {
                            setDraggedStepId(stepObj.id);
                            e.dataTransfer.setData('text/plain', stepObj.id);
                          }}
                          onDragEnd={() => {
                            setDraggedStepId(null);
                            setDragOverSlotIndex(null);
                          }}
                          className={`px-3 py-2 rounded-lg border-2 transition-all duration-150 flex flex-col gap-1 ${
                            readOnly ? '' : 'cursor-grab active:cursor-grabbing'
                          } ${
                            showFeedback
                              ? isSlotCorrect
                                ? 'feedback-option-correct border-emerald-500/80 bg-emerald-50/75'
                                : 'feedback-option-wrong border-rose-400/80 bg-rose-50/75'
                              : 'border-teal-600/70 bg-teal-50/30'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <GripVertical className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                              <span
                                className={`w-5 h-5 rounded text-[11px] font-mono font-bold flex items-center justify-center shrink-0 tabular-nums ${
                                  showFeedback
                                    ? isSlotCorrect
                                      ? 'bg-emerald-600 text-white'
                                      : 'bg-rose-500 text-white'
                                    : 'bg-teal-800 text-white'
                                }`}
                              >
                                {slotIdx + 1}
                              </span>
                              <span className="text-xs sm:text-[13px] font-semibold text-slate-900 leading-snug">
                                {stepObj.text}
                              </span>
                            </div>

                            {!readOnly && (
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  aria-label={`Di chuyển bước ${slotIdx + 1} lên`}
                                  disabled={slotIdx === 0}
                                  onClick={() => handleMoveOrderedStep(slotIdx, -1)}
                                  className="p-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                >
                                  <ArrowUp className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Di chuyển bước ${slotIdx + 1} xuống`}
                                  disabled={slotIdx === orderedStepIds.length - 1}
                                  onClick={() => handleMoveOrderedStep(slotIdx, 1)}
                                  className="p-1 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                >
                                  <ArrowDown className="w-3 h-3" />
                                </button>
                                <button
                                  type="button"
                                  aria-label={`Gỡ bước ${stepObj.text}`}
                                  onClick={() => handleRemoveStepFromOrder(stepObj.id)}
                                  className="p-1 rounded border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 cursor-pointer"
                                >
                                  <Trash2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}
                          </div>

                          {showFeedback && !isSlotCorrect && expectedStepObj && (
                            <div className="text-[11px] text-rose-800 font-medium pl-7">
                              Đúng ở #{slotIdx + 1}:{' '}
                              <strong className="underline text-emerald-800">
                                {expectedStepObj.text}
                              </strong>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* =====================================================================
            KHUNG GIẢI THÍCH & PHẢN HỒI ĐÁP ÁN (EXPLANATION PANEL 2 KHỐI TÁCH BIỆT)
            - Xuất hiện mượt mà (slide-down & fade-in)
            - Tối ưu màu sắc tinh tế: Khối Đáp án đúng (Check xanh ngọc) + Khối Giải thích bản chất (Lightbulb vàng hổ phách)
           ===================================================================== */}
        {showFeedback && (
          <div
            data-testid="question-feedback-box"
            className="animate-feedback-reveal rounded-2xl border border-slate-200/90 bg-white shadow-sm overflow-hidden"
          >
            {/* Dải trạng thái kết quả chấm ở đầu khung */}
            <div
              className={`px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2 ${
                isCorrect
                  ? 'feedback-banner-correct bg-emerald-50/85 border-emerald-200/90'
                  : 'feedback-banner-wrong bg-rose-50/85 border-rose-200/90'
              }`}
            >
              <div className="flex items-center gap-2.5 font-bold text-sm">
                {isCorrect ? (
                  <>
                    <span className="w-6 h-6 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <CheckCircle2 className="w-4 h-4" />
                    </span>
                    <span className="text-emerald-950">
                      Chính xác tuyệt đối! Bạn đạt trọn vẹn điểm câu hỏi này
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                      <XCircle className="w-4 h-4" />
                    </span>
                    <span className="text-rose-950">
                      Chưa chính xác — Quy chuẩn Certiport yêu cầu đúng 100% tất cả các ý
                    </span>
                  </>
                )}
              </div>

              <span
                className={`text-[11px] font-mono font-extrabold px-3 py-1 rounded-full tracking-wider whitespace-nowrap shrink-0 ${
                  isCorrect
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-500 text-white'
                }`}
              >
                {isCorrect ? '+1 ĐIỂM CERTIPORT' : '0 ĐIỂM (CẦN ÔN LẠI)'}
              </span>
            </div>

            {/* 2 Khối Tách Biệt: Khối Đáp Án Đúng (Check xanh) & Khối Giải Thích Bản Chất (Lightbulb vàng) */}
            <div className="p-4 grid grid-cols-1 xl:grid-cols-12 gap-4 bg-slate-50/40">
              {/* KHỐI 1: ĐÁP ÁN ĐÚNG CHUẨN CERTIPORT (ICON CHECK XANH NGỌC) */}
              <div className="xl:col-span-5 feedback-block-correct rounded-xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50/65 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-900">
                  <span className="w-6 h-6 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-2xs">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </span>
                  <span>Đáp án đúng chuẩn Certiport</span>
                </div>

                <div className="space-y-1.5">
                  {correctBreakdown.map((item, idx) => (
                    <div
                      key={idx}
                      className="text-xs bg-white border border-emerald-200/80 rounded-lg px-3 py-2 flex flex-wrap items-baseline justify-between gap-2 shadow-2xs"
                    >
                      <span className="font-semibold text-slate-600">{item.label}:</span>
                      <span className="font-bold text-emerald-800">
                        {item.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* KHỐI 2: GIẢI THÍCH BẢN CHẤT CỐT LÕI (ICON LIGHTBULB VÀNG HỔ PHÁCH) */}
              <div className="xl:col-span-7 feedback-block-explanation rounded-xl border border-amber-200 border-l-4 border-l-amber-500 bg-amber-50/65 p-4 flex flex-col justify-between space-y-2.5">
                <div className="space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-amber-900">
                      <span className="w-6 h-6 rounded-lg bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-2xs">
                        <Lightbulb className="w-3.5 h-3.5" />
                      </span>
                      <span>Giải thích bản chất & Ghi nhớ nhanh</span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 bg-amber-100/90 border border-amber-200/80 px-2.5 py-0.5 rounded-full whitespace-nowrap shrink-0">
                      <Sparkles className="w-3 h-3 text-amber-600 shrink-0" />
                      <span>Cốt lõi 3 giây</span>
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm text-slate-800 leading-relaxed font-medium pl-1">
                    {question.explanation ||
                      'Nắm vững từ khóa trong ngữ cảnh câu hỏi và đối chiếu trực tiếp với nguyên tắc an toàn, chính xác của mô hình Generative AI.'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
