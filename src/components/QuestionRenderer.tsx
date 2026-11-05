import React, { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Bookmark,
  Check,
  CheckCircle2,
  GripVertical,
  HelpCircle,
  Link2,
  Puzzle,
  RotateCcw,
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
      // Đổi chỗ hoặc chèn vào vị trí đích
      current.splice(existingIdx, 1);
      const insertAt = Math.min(targetSlotIdx, current.length);
      current.splice(insertAt, 0, stepId);
      onChangeAnswer(current);
    } else {
      // Kéo từ kho bên trái vào vị trí đích
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

  const promptTextSizeClass =
    fontScale === 'xlarge'
      ? 'text-xl sm:text-2xl leading-relaxed'
      : fontScale === 'large'
        ? 'text-lg sm:text-xl leading-relaxed'
        : 'text-base sm:text-lg leading-relaxed';

  const optionTextSizeClass =
    fontScale === 'xlarge'
      ? 'text-base sm:text-lg leading-relaxed'
      : fontScale === 'large'
        ? 'text-base sm:text-[17px] leading-relaxed'
        : 'text-sm sm:text-base leading-relaxed';

  return (
    <div
      data-testid="question-renderer-card"
      data-font-scale={fontScale}
      className="bg-white border border-slate-200 rounded-xl shadow-xs overflow-hidden"
    >
      {/* Thanh thông tin câu hỏi theo chuẩn phòng thi Certiport */}
      <div className="px-6 py-4 bg-sky-50/80 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <span className="font-bold text-teal-800 bg-white border border-teal-200 px-2.5 py-1 rounded-md tabular-nums">
            {questionNumber !== undefined && totalQuestions !== undefined
              ? `Câu ${questionNumber} / ${totalQuestions}`
              : `Mã câu: ${question.id.toUpperCase()}`}
          </span>
          <span aria-hidden="true">·</span>
          <span className="text-slate-700 font-semibold">{question.topic}</span>
          <span aria-hidden="true">·</span>
          <span className="text-teal-700 font-semibold">
            {QUESTION_TYPE_LABELS[question.type]}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden sm:inline text-xs text-slate-500 tabular-nums">
            Chuẩn Certiport: Đúng 100% = 1 điểm · Sai 1 ý = 0 điểm
          </span>

          {onToggleBookmark && (
            <button
              type="button"
              onClick={() => onToggleBookmark(question.id)}
              aria-label={
                isBookmarked
                  ? 'Bỏ đánh dấu câu hỏi (Bookmark)'
                  : 'Đánh dấu câu hỏi (Bookmark)'
              }
              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer ${
                isBookmarked
                  ? 'border-amber-400 bg-amber-50 text-amber-800 shadow-2xs'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-teal-600 hover:text-teal-800'
              }`}
            >
              <Star
                className={`w-3.5 h-3.5 ${
                  isBookmarked ? 'fill-amber-400 text-amber-500' : 'text-slate-400'
                }`}
              />
              <span>{isBookmarked ? 'Đã lưu Bookmark' : 'Đánh dấu (Bookmark)'}</span>
            </button>
          )}
        </div>
      </div>

      {/* Nội dung câu hỏi chính */}
      <div className="p-6 sm:p-7 space-y-6">
        <div className="space-y-2.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <p className={`${promptTextSizeClass} font-semibold text-slate-900`}>
              {question.prompt}
              {question.type === 'mcq_multiple' && !promptHasChooseNote && (
                <span className="ml-2 inline-block text-teal-800 font-bold">
                  (Chọn {maxAllowedMultiple})
                </span>
              )}
            </p>
          </div>

          {question.instruction && (
            <p className="text-xs text-slate-500 italic">{question.instruction}</p>
          )}

          {question.imageUrl && (
            <div
              data-testid="question-rendered-image-box"
              className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3.5 space-y-2"
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
                  Bấm vào ảnh để phóng to ↗
                </button>
              </div>
              <div className="flex justify-center bg-white rounded-lg border border-slate-200/80 p-2">
                <img
                  src={question.imageUrl}
                  alt={`Hình minh họa cho câu hỏi ${question.id.toUpperCase()}`}
                  referrerPolicy="no-referrer"
                  onClick={() => setIsZoomedImageOpen(true)}
                  className="max-h-72 w-auto rounded object-contain cursor-zoom-in"
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
              className="fixed inset-0 z-50 bg-slate-900/80 flex items-center justify-center p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="bg-white rounded-2xl max-w-5xl w-full max-h-[92vh] p-4 flex flex-col gap-3 shadow-2xl"
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
           ===================================================================== */}
        {question.type === 'mcq_single' && question.options && (
          <div className="space-y-3" role="radiogroup" aria-label={question.prompt}>
            <div className="text-xs font-medium text-slate-500 flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 rounded-full border-2 border-teal-700" />
              <span>Dạng 1 (Radio Button): Chọn duy nhất 1 phương án đúng</span>
            </div>

            <div className="space-y-2.5">
              {question.options.map((opt, idx) => {
                const isSelected = userAnswer === opt.id;
                const isOptionCorrect = question.correctAnswer === opt.id;
                const letter = String.fromCharCode(65 + idx);

                let containerClass =
                  'border-slate-200 bg-white hover:border-teal-500/70 hover:bg-sky-50/40';
                if (isSelected) {
                  containerClass = 'border-teal-600 bg-teal-50/60 ring-1 ring-teal-600';
                }
                if (showFeedback) {
                  if (isOptionCorrect) {
                    containerClass =
                      'border-emerald-600 bg-emerald-50/80 ring-1 ring-emerald-600';
                  } else if (isSelected && !isOptionCorrect) {
                    containerClass = 'border-rose-600 bg-rose-50/80 ring-1 ring-rose-600';
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
                    className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all flex items-start gap-3.5 cursor-pointer disabled:cursor-default ${containerClass}`}
                  >
                    {/* Radio Button Tròn */}
                    <span
                      className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 border-2 transition-colors ${
                        showFeedback && isOptionCorrect
                          ? 'border-emerald-600 bg-white'
                          : showFeedback && isSelected && !isOptionCorrect
                            ? 'border-rose-600 bg-white'
                            : isSelected
                              ? 'border-teal-700 bg-white'
                              : 'border-slate-400 bg-white'
                      }`}
                    >
                      {isSelected && (
                        <span
                          className={`w-2.5 h-2.5 rounded-full ${
                            showFeedback
                              ? isOptionCorrect
                                ? 'bg-emerald-600'
                                : 'bg-rose-600'
                              : 'bg-teal-700'
                          }`}
                        />
                      )}
                    </span>

                    <div className={`flex-1 ${optionTextSizeClass} text-slate-800`}>
                      <span className="font-mono font-bold text-slate-700 mr-2">
                        {letter}.
                      </span>
                      <span>{opt.text}</span>
                    </div>

                    {showFeedback && isOptionCorrect && (
                      <span className="text-xs font-semibold text-emerald-700 shrink-0 flex items-center gap-1 bg-emerald-100/80 px-2.5 py-1 rounded-md">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Đáp án đúng
                      </span>
                    )}
                    {showFeedback && isSelected && !isOptionCorrect && (
                      <span className="text-xs font-semibold text-rose-700 shrink-0 flex items-center gap-1 bg-rose-100/80 px-2.5 py-1 rounded-md">
                        <XCircle className="w-3.5 h-3.5" /> Bạn chọn sai
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* =====================================================================
            DẠNG 1B: TRẮC NGHIỆM NHIỀU LỰA CHỌN (CHECKBOX VUÔNG CHUẨN CERTIPORT)
           ===================================================================== */}
        {question.type === 'mcq_multiple' && question.options && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 bg-sky-50/90 border border-sky-200 px-4 py-2.5 rounded-lg">
              <div className="flex items-center gap-2">
                <span className="inline-block w-3.5 h-3.5 rounded-xs border-2 border-teal-700" />
                <span>
                  Dạng 1 (Checkbox vuông): Hãy chọn chính xác{' '}
                  <strong className="text-teal-900 tabular-nums">
                    {maxAllowedMultiple} phương án đúng (Chọn {maxAllowedMultiple})
                  </strong>
                </span>
              </div>
              <span className="font-mono tabular-nums font-semibold text-teal-800 bg-white px-2.5 py-0.5 rounded border border-sky-200">
                Đã chọn: {Array.isArray(userAnswer) ? userAnswer.length : 0} /{' '}
                {maxAllowedMultiple}
              </span>
            </div>

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
                  'border-slate-200 bg-white hover:border-teal-500/70 hover:bg-sky-50/40';
                if (isSelected) {
                  containerClass = 'border-teal-600 bg-teal-50/60 ring-1 ring-teal-600';
                }
                if (showFeedback) {
                  if (isOptionCorrect) {
                    containerClass =
                      'border-emerald-600 bg-emerald-50/80 ring-1 ring-emerald-600';
                  } else if (isSelected && !isOptionCorrect) {
                    containerClass = 'border-rose-600 bg-rose-50/80 ring-1 ring-rose-600';
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
                    className={`w-full text-left px-4 py-3.5 rounded-xl border transition-all flex items-start gap-3.5 cursor-pointer disabled:cursor-default ${containerClass}`}
                  >
                    {/* Checkbox Vuông */}
                    <span
                      className={`mt-0.5 w-5 h-5 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${
                        showFeedback && isOptionCorrect
                          ? 'border-emerald-600 bg-emerald-600 text-white'
                          : showFeedback && isSelected && !isOptionCorrect
                            ? 'border-rose-600 bg-rose-600 text-white'
                            : isSelected
                              ? 'border-teal-700 bg-teal-700 text-white'
                              : 'border-slate-400 bg-white'
                      }`}
                    >
                      {isSelected && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </span>

                    <div className={`flex-1 ${optionTextSizeClass} text-slate-800`}>
                      <span className="font-mono font-bold text-slate-700 mr-2">
                        {letter}.
                      </span>
                      <span>{opt.text}</span>
                    </div>

                    {showFeedback && isOptionCorrect && (
                      <span className="text-xs font-semibold text-emerald-700 shrink-0 flex items-center gap-1 bg-emerald-100/80 px-2.5 py-1 rounded-md">
                        <CheckCircle2 className="w-3.5 h-3.5" /> Đáp án chuẩn
                      </span>
                    )}
                    {showFeedback && isSelected && !isOptionCorrect && (
                      <span className="text-xs font-semibold text-rose-700 shrink-0 flex items-center gap-1 bg-rose-100/80 px-2.5 py-1 rounded-md">
                        <XCircle className="w-3.5 h-3.5" /> Chọn thừa / sai
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* =====================================================================
            DẠNG 2: MENU THẢ XUỐNG (- Select - DROPDOWN CHUẨN PHÒNG THI CERTIPORT)
           ===================================================================== */}
        {question.type === 'dropdown' && question.subItems && (
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <div className="grid grid-cols-12 bg-slate-100 px-5 py-3 text-xs font-bold text-slate-700 border-b border-slate-200">
              <div className="col-span-12 sm:col-span-7">
                {question.dropdownColumns?.[0] || 'Mệnh đề / Nhận định đánh giá'}
              </div>
              <div className="col-span-12 sm:col-span-5 mt-1 sm:mt-0">
                {question.dropdownColumns?.[1] || 'Hộp chọn thả xuống (- Select -)'}
              </div>
            </div>

            <div className="divide-y divide-slate-200">
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
                    className="grid grid-cols-12 items-center gap-4 px-5 py-4 bg-white hover:bg-sky-50/30 transition-colors"
                  >
                    <div className="col-span-12 sm:col-span-7 flex items-start gap-3">
                      <span className="w-6 h-6 rounded-md bg-slate-100 border border-slate-200 text-xs font-mono font-semibold text-slate-600 flex items-center justify-center shrink-0 tabular-nums mt-0.5">
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
                        className={`w-full px-3.5 py-2.5 text-sm rounded-lg border bg-white font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer disabled:cursor-default ${
                          showFeedback
                            ? subCorrect
                              ? 'border-emerald-600 bg-emerald-50/70 text-emerald-900'
                              : 'border-rose-500 bg-rose-50/70 text-rose-900'
                            : selectedVal
                              ? 'border-teal-600 text-teal-900 bg-teal-50/40'
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
                        <div className="flex items-center justify-between text-xs px-1">
                          {subCorrect ? (
                            <span className="text-emerald-700 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Chính xác ({expectedVal})
                            </span>
                          ) : (
                            <span className="text-rose-700 font-semibold flex items-center gap-1">
                              <XCircle className="w-3.5 h-3.5" /> Đáp án đúng:{' '}
                              <strong className="underline">{expectedVal}</strong>
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
            DẠNG 3: KÉO THẢ NỐI CÂU (DRAG & DROP PUZZLE MATCHING 2 CỘT)
           ===================================================================== */}
        {question.type === 'matching' && question.pairs && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 bg-sky-50/90 border border-sky-200 px-4 py-3 rounded-xl">
              <div className="flex items-center gap-2">
                <Puzzle className="w-4 h-4 text-teal-700 shrink-0" />
                <span>
                  <strong>Cách thao tác Puzzle Matching:</strong> Kéo thả trực tiếp thẻ mảnh ghép ở{' '}
                  <strong>Kho mảnh ghép (Cột phải)</strong> vào ô khớp nối bên cạnh{' '}
                  <strong>Cột trái</strong>, hoặc bấm chọn dòng cột trái rồi bấm mảnh ghép tương ứng.
                </span>
              </div>
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => onChangeAnswer({})}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Xóa tất cả cặp nối
                </button>
              )}
            </div>

            {/* Kho mảnh ghép nguồn để kéo thả hoặc bấm chọn nhanh */}
            <div className="p-4 bg-slate-100/90 rounded-xl border border-slate-200 space-y-2.5">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span>Kho thẻ mảnh ghép (Kéo thẻ thả vào ô bên dưới hoặc bấm để nối):</span>
                <span className="font-mono text-teal-800 tabular-nums">
                  Đã ghép:{' '}
                  {userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
                    ? Object.keys(userAnswer).length
                    : 0}{' '}
                  / {question.pairs.length} cặp
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {rightChoices.map((rightText) => {
                  const currentMap =
                    userAnswer && typeof userAnswer === 'object' && !Array.isArray(userAnswer)
                      ? (userAnswer as Record<string, string>)
                      : {};
                  const matchedLeftId = Object.keys(currentMap).find(
                    (k) => currentMap[k] === rightText
                  );
                  const isUsed = Boolean(matchedLeftId);

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
                      className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-medium border text-left transition-all flex items-center justify-between gap-2 select-none ${
                        readOnly ? 'cursor-default' : 'cursor-grab active:cursor-grabbing'
                      } ${
                        isUsed
                          ? 'bg-teal-50/80 border-teal-600/60 text-teal-950'
                          : 'bg-white border-slate-300 text-slate-800 hover:border-teal-600 shadow-2xs'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <GripVertical className="w-4 h-4 text-slate-400 shrink-0" />
                        <Puzzle className="w-4 h-4 text-teal-700 shrink-0" />
                        <span className="leading-snug">{rightText}</span>
                      </div>
                      {isUsed && (
                        <span className="text-[11px] font-mono font-semibold bg-teal-700 text-white px-2 py-0.5 rounded shrink-0">
                          Đã nối
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bảng 2 Cột Mảnh Ghép (Cột Trái có mấu Puzzle Connector -> Cột Phải nhận mảnh ghép) */}
            <div className="space-y-3">
              <div className="hidden lg:grid lg:grid-cols-12 gap-4 px-2 text-xs font-bold text-slate-600">
                <div className="lg:col-span-6">CỘT TRÁI: MỆNH ĐỀ / KỊCH BẢN GỐC</div>
                <div className="lg:col-span-6">
                  CỘT PHẢI: MẢNH GHÉP TƯƠNG ỨNG (KÉO THẢ HOẶC CHỌN)
                </div>
              </div>

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
                const pairCorrect = showFeedback && matchedRight === expectedRight;

                return (
                  <div
                    key={pair.id}
                    className="grid grid-cols-1 lg:grid-cols-12 gap-0 lg:gap-3 items-stretch"
                  >
                    {/* Cột trái: Thẻ gốc có khớp nối Puzzle lồi ở bên phải */}
                    <button
                      type="button"
                      disabled={readOnly}
                      onClick={() =>
                        setSelectedLeftPairId(isSelectedLeft ? null : pair.id)
                      }
                      className={`lg:col-span-6 relative p-4 rounded-t-xl lg:rounded-xl border text-left transition-all flex items-center justify-between gap-3 cursor-pointer disabled:cursor-default ${
                        isSelectedLeft
                          ? 'border-teal-600 bg-sky-50 ring-2 ring-teal-600/30'
                          : 'border-slate-300 bg-slate-50/90 hover:bg-sky-50/50'
                      }`}
                    >
                      <div className="flex items-start gap-3 pr-3">
                        <span className="w-6 h-6 rounded-md bg-teal-800 text-white text-xs font-mono font-bold flex items-center justify-center shrink-0 tabular-nums mt-0.5">
                          #{idx + 1}
                        </span>
                        <span className="text-sm sm:text-base font-semibold text-slate-900 leading-snug">
                          {pair.left}
                        </span>
                      </div>

                      {/* Khớp nối mảnh ghép (Puzzle Connector Tab) */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 ${
                            matchedRight
                              ? 'bg-teal-700 text-white'
                              : isSelectedLeft
                                ? 'bg-sky-700 text-white'
                                : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          <Puzzle className="w-3.5 h-3.5" />
                          <span className="hidden sm:inline">
                            {matchedRight ? 'Đã khớp' : isSelectedLeft ? 'Đang chọn' : 'Khớp nối'}
                          </span>
                        </span>
                      </div>
                    </button>

                    {/* Cột phải: Ô đích nhận mảnh ghép Puzzle + Nút xóa từng cặp nối */}
                    <div
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
                      className={`lg:col-span-6 p-3.5 rounded-b-xl lg:rounded-xl border-2 transition-all flex flex-col justify-center gap-2 ${
                        showFeedback
                          ? pairCorrect
                            ? 'border-emerald-600 bg-emerald-50/70'
                            : 'border-rose-500 bg-rose-50/70'
                          : isDragOver
                            ? 'border-teal-600 bg-sky-100/70 ring-2 ring-teal-500/40'
                            : matchedRight
                              ? 'border-teal-600 bg-teal-50/40'
                              : 'border-dashed border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Link2
                          className={`w-4 h-4 shrink-0 ${
                            matchedRight ? 'text-teal-700' : 'text-slate-400'
                          }`}
                        />
                        <select
                          aria-label={`Ghép nối cho: ${pair.left}`}
                          disabled={readOnly}
                          value={matchedRight}
                          onChange={(e) => handleAssignMatch(pair.id, e.target.value)}
                          className="flex-1 px-3 py-2 text-sm font-semibold bg-white border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 cursor-pointer disabled:cursor-default"
                        >
                          <option value="">
                            -- Kéo mảnh ghép thả vào đây hoặc chọn --
                          </option>
                          {rightChoices.map((choice) => (
                            <option key={choice} value={choice}>
                              {choice}
                            </option>
                          ))}
                        </select>

                        {/* Nút xóa từng cặp nối để làm lại */}
                        {!readOnly && matchedRight && (
                          <button
                            type="button"
                            onClick={() => handleClearSingleMatch(pair.id)}
                            aria-label={`Xóa cặp nối của ${pair.left}`}
                            title="Gỡ mảnh ghép này để nối lại"
                            className="p-2 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 transition-colors shrink-0 cursor-pointer"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>

                      {showFeedback && (
                        <div className="text-xs px-1 flex items-center justify-between">
                          {pairCorrect ? (
                            <span className="text-emerald-700 font-semibold flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Ghép chính xác
                            </span>
                          ) : (
                            <span className="text-rose-700 font-semibold">
                              Đáp án đúng: <strong className="underline">{expectedRight}</strong>
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
            DẠNG 4: SẮP XẾP THỨ TỰ (ORDERING — KÉO THẢ + NÚT LÊN/XUỐNG 1, 2, 3, 4...)
           ===================================================================== */}
        {question.type === 'ordering' && question.steps && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700 bg-sky-50/90 border border-sky-200 px-4 py-3 rounded-xl">
              <span>
                <strong>Hướng dẫn Sắp xếp thứ tự (Ordering):</strong> Kéo thả (hoặc bấm chọn) các
                thanh bước hành động sang khung trả lời đánh số{' '}
                <strong>1 → {question.steps.length}</strong>, sau đó kéo đổi chỗ hoặc dùng nút{' '}
                <strong>Lên / Xuống</strong>.
              </span>
              {!readOnly && (
                <div className="flex items-center gap-2 shrink-0">
                  {availablePoolSteps.length > 0 && (
                    <button
                      type="button"
                      onClick={handleAutoOrderAll}
                      className="px-3 py-1.5 rounded-lg bg-teal-700 text-white text-xs font-semibold hover:bg-teal-800 whitespace-nowrap cursor-pointer"
                    >
                      Đưa nhanh tất cả sang khung xếp
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onChangeAnswer([])}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 whitespace-nowrap cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" /> Đặt lại thứ tự
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Cột trái: Các thanh bước hành động khả dụng */}
              <div className="border border-slate-200 rounded-xl p-4 bg-slate-50/70 space-y-3">
                <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>CÁC BƯỚC HÀNH ĐỘNG KHẢ DỤNG (KÉO HOẶC BẤM)</span>
                  <span className="font-mono tabular-nums text-slate-500">
                    Còn lại: {availablePoolSteps.length}
                  </span>
                </div>

                {availablePoolSteps.length === 0 ? (
                  <div className="py-10 px-4 text-center text-xs text-slate-500 border border-dashed border-slate-200 rounded-xl bg-white">
                    Toàn bộ {question.steps.length} bước đã được đưa vào khung trả lời bên phải.
                    Bạn có thể kéo thả hoặc bấm nút Lên/Xuống để tinh chỉnh thứ tự.
                  </div>
                ) : (
                  <div className="space-y-2.5">
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
                        className="w-full text-left px-4 py-3.5 rounded-xl border border-slate-300 bg-white hover:border-teal-600 hover:bg-sky-50/40 transition-all flex items-center justify-between gap-3 shadow-2xs cursor-grab active:cursor-grabbing select-none"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <GripVertical className="w-4 h-4 text-slate-400 shrink-0" />
                          <span className="text-sm font-medium text-slate-800">
                            {step.text}
                          </span>
                        </div>
                        <span className="text-xs font-semibold text-teal-700 bg-teal-50 px-2.5 py-1 rounded-md whitespace-nowrap shrink-0">
                          + Bước {orderedStepIds.length + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cột phải: Khung trả lời đánh số 1, 2, 3, 4... */}
              <div className="border border-slate-200 rounded-xl p-4 bg-white space-y-3">
                <div className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>KHUNG TRẢ LỜI THEO THỨ TỰ QUY TRÌNH (1 → {question.steps.length})</span>
                  <span className="font-mono tabular-nums text-teal-800">
                    Đã xếp: {orderedStepIds.length} / {question.steps.length}
                  </span>
                </div>

                <div className="space-y-2.5">
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
                        className={`rounded-xl transition-all ${
                          isDragOverSlot ? 'ring-2 ring-teal-600 bg-sky-50' : ''
                        }`}
                      >
                        {!stepObj ? (
                          <div className="px-4 py-3.5 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/60 text-xs text-slate-400 flex items-center gap-3">
                            <span className="w-7 h-7 rounded-lg bg-slate-200 text-slate-700 font-mono font-bold flex items-center justify-center tabular-nums">
                              {slotIdx + 1}
                            </span>
                            <span>
                              Vị trí bước {slotIdx + 1} — Kéo bước thả vào đây hoặc bấm từ cột trái
                            </span>
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
                            className={`px-3.5 py-3 rounded-xl border-2 flex flex-col gap-1.5 ${
                              readOnly ? '' : 'cursor-grab active:cursor-grabbing'
                            } ${
                              showFeedback
                                ? isSlotCorrect
                                  ? 'border-emerald-600 bg-emerald-50/70'
                                  : 'border-rose-500 bg-rose-50/70'
                                : 'border-teal-600/80 bg-teal-50/30'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <GripVertical className="w-4 h-4 text-slate-400 shrink-0" />
                                <span className="w-7 h-7 rounded-lg bg-teal-800 text-white text-xs font-mono font-bold flex items-center justify-center shrink-0 tabular-nums">
                                  {slotIdx + 1}
                                </span>
                                <span className="text-sm font-semibold text-slate-900">
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
                                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                  >
                                    <ArrowUp className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Di chuyển bước ${slotIdx + 1} xuống`}
                                    disabled={slotIdx === orderedStepIds.length - 1}
                                    onClick={() => handleMoveOrderedStep(slotIdx, 1)}
                                    className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer"
                                  >
                                    <ArrowDown className="w-3.5 h-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Gỡ bước ${stepObj.text}`}
                                    onClick={() => handleRemoveStepFromOrder(stepObj.id)}
                                    className="p-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 cursor-pointer"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              )}
                            </div>

                            {showFeedback && !isSlotCorrect && expectedStepObj && (
                              <div className="text-xs text-rose-800 font-medium pl-9">
                                Đúng ở vị trí #{slotIdx + 1} phải là:{' '}
                                <strong className="underline">{expectedStepObj.text}</strong>
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
          </div>
        )}

        {/* =====================================================================
            KHUNG HIỂN THỊ KẾT QUẢ CHẤM CHUẨN CERTIPORT, ĐÁP ÁN ĐÚNG & GIẢI THÍCH
           ===================================================================== */}
        {showFeedback && (
          <div
            data-testid="question-feedback-box"
            className={`p-5 rounded-xl border-2 space-y-4 ${
              isCorrect
                ? 'bg-emerald-50/80 border-emerald-500 text-emerald-950'
                : 'bg-rose-50/80 border-rose-500 text-rose-950'
            }`}
          >
            {/* Thông báo trạng thái Chính xác! / Chưa chính xác */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 font-bold text-base">
                {isCorrect ? (
                  <>
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    <span className="text-emerald-900">
                      Chính xác! (Đạt 1 / 1 điểm chuẩn Certiport)
                    </span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-6 h-6 text-rose-600 shrink-0" />
                    <span className="text-rose-900">
                      Chưa chính xác (0 / 1 điểm — Chuẩn Certiport yêu cầu đúng 100% các ý)
                    </span>
                  </>
                )}
              </div>

              <span
                className={`text-xs font-mono font-bold px-2.5 py-1 rounded-md ${
                  isCorrect
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                }`}
              >
                {isCorrect ? '+1 ĐIỂM' : '0 ĐIỂM'}
              </span>
            </div>

            {/* Khung chi tiết Đáp án đúng (chỉ rõ từng ý đúng) */}
            <div className="bg-white/90 rounded-lg border border-slate-200 p-4 space-y-2">
              <div className="text-xs font-bold uppercase tracking-wider text-teal-800 flex items-center gap-1.5">
                <Bookmark className="w-3.5 h-3.5" />
                <span>Đáp án đúng (Chi tiết từng ý chuẩn Certiport):</span>
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {correctBreakdown.map((item, idx) => (
                  <div
                    key={idx}
                    className="text-xs sm:text-sm text-slate-800 flex flex-wrap items-baseline justify-between gap-2 py-1 border-b border-slate-100 last:border-b-0"
                  >
                    <span className="font-medium text-slate-600">{item.label}:</span>
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded">
                      {item.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Giải thích ngắn gọn */}
            <div className="text-sm text-slate-800 leading-relaxed pt-1 flex items-start gap-2.5">
              <HelpCircle className="w-5 h-5 text-teal-700 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-900">Giải thích ngắn gọn: </span>
                <span>{question.explanation}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
