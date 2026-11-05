import * as XLSX from 'xlsx';
import {
  CERTIPORT_TOPICS,
  DropdownSubItem,
  MatchingPair,
  OrderingStep,
  Question,
  QuestionOption,
  QuestionType,
} from '../types/exam';
import { evaluateQuestion } from './scoring';

export type DistributionStrategy = 'by_size' | 'by_set_count';

export interface DistributionSummaryItem {
  examSet: string;
  count: number;
  questionIds: string[];
}

export interface AutoDistributeResult {
  updatedQuestions: Question[];
  summary: DistributionSummaryItem[];
}

/**
 * Tự động phân bổ danh sách câu hỏi thành các Đề nhỏ (Đề 1, Đề 2, Đề 3, Đề 4, Đề 5...)
 * - Nếu strategy === 'by_size' (mặc định 35 câu/đề): Ví dụ 175 câu -> Đề 1..Đề 5 (mỗi đề 35 câu).
 *   Nếu tổng số câu ít hơn hoặc bằng questionsPerSet nhưng người dùng chọn chia đều thành minSets đề,
 *   hoặc chọn strategy === 'by_set_count', hệ thống chia đều vào các Đề 1..Đề N.
 */
export function autoDistributeExamSets(
  questions: Question[],
  options: {
    strategy?: DistributionStrategy;
    questionsPerSet?: number;
    targetSetCount?: number;
  } = {}
): AutoDistributeResult {
  const strategy = options.strategy ?? 'by_size';
  const questionsPerSet = Math.max(1, options.questionsPerSet ?? 35);
  const targetSetCount = Math.max(1, options.targetSetCount ?? 5);

  if (questions.length === 0) {
    return { updatedQuestions: [], summary: [] };
  }

  const updatedQuestions: Question[] = questions.map((q, idx) => {
    let setNumber = 1;
    if (strategy === 'by_size') {
      setNumber = Math.floor(idx / questionsPerSet) + 1;
    } else {
      // Chia đều tuần tự vào targetSetCount đề (Đề 1 -> Đề N)
      const baseSize = Math.floor(questions.length / targetSetCount);
      const remainder = questions.length % targetSetCount;
      if (baseSize === 0) {
        setNumber = (idx % targetSetCount) + 1;
      } else {
        // Phân bổ theo khối liên tiếp cân bằng
        let cumulative = 0;
        for (let s = 1; s <= targetSetCount; s++) {
          const sizeForThisSet = baseSize + (s <= remainder ? 1 : 0);
          if (idx < cumulative + sizeForThisSet) {
            setNumber = s;
            break;
          }
          cumulative += sizeForThisSet;
        }
      }
    }
    return {
      ...q,
      examSet: `Đề ${setNumber}`,
    };
  });

  const map = new Map<string, string[]>();
  for (const q of updatedQuestions) {
    const key = String(q.examSet);
    const list = map.get(key) ?? [];
    list.push(q.id);
    map.set(key, list);
  }

  const summary: DistributionSummaryItem[] = Array.from(map.entries()).map(
    ([examSet, questionIds]) => ({
      examSet,
      count: questionIds.length,
      questionIds,
    })
  );

  return { updatedQuestions, summary };
}

// ============================================================================
// DYNAMIC FORM DRAFT CHO MODAL THÊM / SỬA CÂU HỎI THỦ CÔNG
// ============================================================================

export interface McqOptionDraft {
  id: string;
  text: string;
  isCorrect: boolean;
}

export interface DropdownRowDraft {
  id: string;
  statement: string;
  choicesText: string; // Ví dụ: "Đúng, Sai" hoặc "Thiên kiến, Không thiên kiến"
  correctChoice: string;
}

export interface MatchingPairDraft {
  id: string;
  left: string;
  right: string;
}

export interface OrderingStepDraft {
  id: string;
  text: string;
}

export interface QuestionFormDraft {
  id: string;
  type: QuestionType;
  topic: string;
  examSet: string;
  prompt: string;
  instruction: string;
  imageUrl: string;
  explanation: string;
  mcqOptions: McqOptionDraft[];
  dropdownRows: DropdownRowDraft[];
  matchingPairs: MatchingPairDraft[];
  orderingSteps: OrderingStepDraft[];
}

export function parseChoicesText(raw: string): string[] {
  return raw
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function createEmptyQuestionDraft(nextNumber: number = 9): QuestionFormDraft {
  const baseId = `q${nextNumber}`;
  return {
    id: baseId,
    type: 'mcq_single',
    topic: CERTIPORT_TOPICS[0],
    examSet: 'Ngân hàng chung',
    prompt: '',
    instruction: '',
    imageUrl: '',
    explanation: '',
    mcqOptions: [
      { id: `${baseId}_opt1`, text: '', isCorrect: true },
      { id: `${baseId}_opt2`, text: '', isCorrect: false },
      { id: `${baseId}_opt3`, text: '', isCorrect: false },
      { id: `${baseId}_opt4`, text: '', isCorrect: false },
    ],
    dropdownRows: [
      {
        id: `${baseId}_sub1`,
        statement: '',
        choicesText: 'Đúng, Sai',
        correctChoice: 'Đúng',
      },
      {
        id: `${baseId}_sub2`,
        statement: '',
        choicesText: 'Đúng, Sai',
        correctChoice: 'Sai',
      },
    ],
    matchingPairs: [
      { id: `${baseId}_pair1`, left: '', right: '' },
      { id: `${baseId}_pair2`, left: '', right: '' },
      { id: `${baseId}_pair3`, left: '', right: '' },
    ],
    orderingSteps: [
      { id: `${baseId}_step1`, text: '' },
      { id: `${baseId}_step2`, text: '' },
      { id: `${baseId}_step3`, text: '' },
      { id: `${baseId}_step4`, text: '' },
    ],
  };
}

export function createDraftFromQuestion(question: Question): QuestionFormDraft {
  const base = createEmptyQuestionDraft(1);
  const qId = question.id;

  // Khôi phục MCQ options
  let mcqOptions: McqOptionDraft[] = base.mcqOptions;
  if (question.options && question.options.length > 0) {
    const correctSet = new Set<string>(
      Array.isArray(question.correctAnswer)
        ? question.correctAnswer
        : typeof question.correctAnswer === 'string'
          ? [question.correctAnswer]
          : []
    );
    mcqOptions = question.options.map((opt) => ({
      id: opt.id,
      text: opt.text,
      isCorrect: correctSet.has(opt.id),
    }));
  }

  // Khôi phục Dropdown rows
  let dropdownRows: DropdownRowDraft[] = base.dropdownRows;
  if (question.subItems && question.subItems.length > 0) {
    const answerMap =
      question.correctAnswer &&
      typeof question.correctAnswer === 'object' &&
      !Array.isArray(question.correctAnswer)
        ? (question.correctAnswer as Record<string, string>)
        : {};
    dropdownRows = question.subItems.map((sub) => {
      const choices = sub.choices?.length
        ? sub.choices
        : sub.options?.length
          ? sub.options
          : question.dropdownOptions ?? ['Đúng', 'Sai'];
      const correctChoice = answerMap[sub.id] ?? choices[0] ?? '';
      return {
        id: sub.id,
        statement: sub.statement,
        choicesText: choices.join(', '),
        correctChoice,
      };
    });
  }

  // Khôi phục Matching pairs
  let matchingPairs: MatchingPairDraft[] = base.matchingPairs;
  if (question.pairs && question.pairs.length > 0) {
    const answerMap =
      question.correctAnswer &&
      typeof question.correctAnswer === 'object' &&
      !Array.isArray(question.correctAnswer)
        ? (question.correctAnswer as Record<string, string>)
        : {};
    matchingPairs = question.pairs.map((p) => ({
      id: p.id,
      left: p.left,
      right: answerMap[p.id] ?? p.right,
    }));
  }

  // Khôi phục Ordering steps theo đúng thứ tự đáp án chuẩn
  let orderingSteps: OrderingStepDraft[] = base.orderingSteps;
  if (question.steps && question.steps.length > 0) {
    const stepMap = new Map(question.steps.map((s) => [s.id, s]));
    if (Array.isArray(question.correctAnswer) && question.correctAnswer.length > 0) {
      const ordered = question.correctAnswer
        .map((stepId) => stepMap.get(stepId))
        .filter((s): s is OrderingStep => Boolean(s));
      if (ordered.length === question.steps.length) {
        orderingSteps = ordered.map((s) => ({ id: s.id, text: s.text }));
      } else {
        orderingSteps = question.steps.map((s) => ({ id: s.id, text: s.text }));
      }
    } else {
      orderingSteps = question.steps.map((s) => ({ id: s.id, text: s.text }));
    }
  }

  return {
    id: qId,
    type: question.type,
    topic: String(question.topic || CERTIPORT_TOPICS[0]),
    examSet: String(question.examSet || 'Ngân hàng chung'),
    prompt: question.prompt || '',
    instruction: question.instruction || '',
    imageUrl: question.imageUrl || '',
    explanation: question.explanation || '',
    mcqOptions,
    dropdownRows,
    matchingPairs,
    orderingSteps,
  };
}

/**
 * Chuyển đổi dữ liệu từ Form Động sang đối tượng `Question` chuẩn phòng thi Certiport
 */
export function buildQuestionFromDraft(draft: QuestionFormDraft): Question {
  const cleanId = draft.id.trim().replace(/[^a-zA-Z0-9_-]/g, '') || `q_${Date.now()}`;
  const prompt = draft.prompt.trim();
  if (!prompt) {
    throw new Error('Vui lòng nhập nội dung câu hỏi (Prompt).');
  }

  const explanation =
    draft.explanation.trim() ||
    'Đáp án chuẩn theo tài liệu khung năng lực Certiport Generative AI.';

  const baseQuestion: Question = {
    id: cleanId,
    type: draft.type,
    topic: draft.topic.trim() || CERTIPORT_TOPICS[0],
    examSet: draft.examSet.trim() || 'Ngân hàng chung',
    prompt,
    ...(draft.instruction.trim() ? { instruction: draft.instruction.trim() } : {}),
    ...(draft.imageUrl.trim() ? { imageUrl: draft.imageUrl.trim() } : {}),
    correctAnswer: '',
    explanation,
    createdAt: new Date().toISOString(),
  };

  if (draft.type === 'mcq_single') {
    const validOpts = draft.mcqOptions
      .map((o, i) => ({
        id: o.id.trim() || `${cleanId}_opt${i + 1}`,
        text: o.text.trim(),
        isCorrect: o.isCorrect,
      }))
      .filter((o) => o.text.length > 0);

    if (validOpts.length < 2) {
      throw new Error('Câu hỏi trắc nghiệm cần tối thiểu 2 phương án trả lời.');
    }

    const chosen = validOpts.find((o) => o.isCorrect) ?? validOpts[0];
    const options: QuestionOption[] = validOpts.map(({ id, text }) => ({ id, text }));

    return {
      ...baseQuestion,
      options,
      correctAnswer: chosen.id,
    };
  }

  if (draft.type === 'mcq_multiple') {
    const validOpts = draft.mcqOptions
      .map((o, i) => ({
        id: o.id.trim() || `${cleanId}_opt${i + 1}`,
        text: o.text.trim(),
        isCorrect: o.isCorrect,
      }))
      .filter((o) => o.text.length > 0);

    if (validOpts.length < 2) {
      throw new Error('Câu hỏi trắc nghiệm nhiều lựa chọn cần tối thiểu 2 phương án.');
    }

    const correctIds = validOpts.filter((o) => o.isCorrect).map((o) => o.id);
    if (correctIds.length < 1) {
      throw new Error('Vui lòng tích chọn ít nhất 1 phương án đúng.');
    }

    const options: QuestionOption[] = validOpts.map(({ id, text }) => ({ id, text }));
    return {
      ...baseQuestion,
      options,
      maxSelect: correctIds.length,
      maxSelections: correctIds.length,
      correctAnswer: correctIds,
    };
  }

  if (draft.type === 'dropdown') {
    const validRows = draft.dropdownRows
      .map((r, i) => {
        const choices = parseChoicesText(r.choicesText);
        const finalChoices = choices.length >= 2 ? choices : ['Đúng', 'Sai'];
        const correct = finalChoices.includes(r.correctChoice.trim())
          ? r.correctChoice.trim()
          : finalChoices[0];
        return {
          id: r.id.trim() || `${cleanId}_sub${i + 1}`,
          statement: r.statement.trim(),
          choices: finalChoices,
          correctChoice: correct,
        };
      })
      .filter((r) => r.statement.length > 0);

    if (validRows.length === 0) {
      throw new Error('Câu hỏi Dropdown cần ít nhất 1 mệnh đề / vị trí chọn.');
    }

    const subItems: DropdownSubItem[] = validRows.map((r) => ({
      id: r.id,
      statement: r.statement,
      choices: r.choices,
      options: r.choices,
    }));

    const correctAnswer: Record<string, string> = {};
    for (const r of validRows) {
      correctAnswer[r.id] = r.correctChoice;
    }

    return {
      ...baseQuestion,
      subItems,
      dropdownOptions: validRows[0].choices,
      correctAnswer,
    };
  }

  if (draft.type === 'matching') {
    const validPairs = draft.matchingPairs
      .map((p, i) => ({
        id: p.id.trim() || `${cleanId}_pair${i + 1}`,
        left: p.left.trim(),
        right: p.right.trim(),
      }))
      .filter((p) => p.left.length > 0 && p.right.length > 0);

    if (validPairs.length < 2) {
      throw new Error('Câu hỏi Nối câu (Matching) cần tối thiểu 2 cặp ghép nối.');
    }

    const pairs: MatchingPair[] = validPairs.map(({ id, left, right }) => ({
      id,
      left,
      right,
    }));

    const correctAnswer: Record<string, string> = {};
    for (const p of pairs) {
      correctAnswer[p.id] = p.right;
    }

    return {
      ...baseQuestion,
      pairs,
      correctAnswer,
    };
  }

  // ordering
  const validSteps = draft.orderingSteps
    .map((s, i) => ({
      id: s.id.trim() || `${cleanId}_step${i + 1}`,
      text: s.text.trim(),
    }))
    .filter((s) => s.text.length > 0);

  if (validSteps.length < 2) {
    throw new Error('Câu hỏi Sắp xếp thứ tự (Ordering) cần tối thiểu 2 bước.');
  }

  const steps: OrderingStep[] = validSteps.map(({ id, text }) => ({ id, text }));
  const correctAnswer: string[] = steps.map((s) => s.id);

  return {
    ...baseQuestion,
    steps,
    correctAnswer,
  };
}

// ============================================================================
// NHẬP / XUẤT DỮ LIỆU HÀNG LOẠT: JSON & EXCEL (.XLSX - SHEETJS)
// ============================================================================

export function serializeQuestionsToJson(questions: Question[]): string {
  return JSON.stringify(questions, null, 2);
}

/**
 * Chuẩn hóa & kiểm tra tính hợp lệ của 1 đối tượng câu hỏi bất kỳ từ JSON
 */
export function normalizeImportedQuestion(raw: Record<string, unknown>, fallbackIdx: number): Question {
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim().replace(/[^a-zA-Z0-9_-]/g, '')
      : `q_import_${fallbackIdx}`;

  const rawType = String(raw.type || 'mcq_single').trim() as QuestionType;
  const validTypes: QuestionType[] = [
    'mcq_single',
    'mcq_multiple',
    'dropdown',
    'matching',
    'ordering',
  ];
  const type: QuestionType = validTypes.includes(rawType) ? rawType : 'mcq_single';

  const topic =
    typeof raw.topic === 'string' && raw.topic.trim()
      ? raw.topic.trim()
      : CERTIPORT_TOPICS[0];

  const examSet =
    typeof raw.examSet === 'string' && raw.examSet.trim()
      ? raw.examSet.trim()
      : 'Ngân hàng chung';

  const prompt = typeof raw.prompt === 'string' ? raw.prompt.trim() : '';
  if (!prompt) {
    throw new Error(`Câu hỏi "${id}" thiếu nội dung câu hỏi (prompt).`);
  }

  const explanation =
    typeof raw.explanation === 'string' && raw.explanation.trim()
      ? raw.explanation.trim()
      : 'Đáp án chuẩn theo tài liệu Certiport Generative AI.';

  const question: Question = {
    id,
    type,
    topic,
    examSet,
    prompt,
    ...(typeof raw.instruction === 'string' && raw.instruction.trim()
      ? { instruction: raw.instruction.trim() }
      : {}),
    ...(typeof raw.imageUrl === 'string' && raw.imageUrl.trim()
      ? { imageUrl: raw.imageUrl.trim() }
      : {}),
    ...(Array.isArray(raw.options) ? { options: raw.options as QuestionOption[] } : {}),
    ...(typeof raw.maxSelect === 'number' ? { maxSelect: raw.maxSelect } : {}),
    ...(typeof raw.maxSelections === 'number' ? { maxSelections: raw.maxSelections } : {}),
    ...(Array.isArray(raw.subItems) ? { subItems: raw.subItems as DropdownSubItem[] } : {}),
    ...(Array.isArray(raw.dropdownOptions)
      ? { dropdownOptions: raw.dropdownOptions as string[] }
      : {}),
    ...(Array.isArray(raw.pairs) ? { pairs: raw.pairs as MatchingPair[] } : {}),
    ...(Array.isArray(raw.steps) ? { steps: raw.steps as OrderingStep[] } : {}),
    correctAnswer: (raw.correctAnswer as Question['correctAnswer']) ?? '',
    explanation,
    createdAt:
      typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
  };

  return question;
}

export function parseQuestionsFromJson(jsonText: string): Question[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error('File JSON không đúng cú pháp. Vui lòng kiểm tra lại định dạng JSON.');
  }

  const rawList: unknown[] = Array.isArray(parsed)
    ? parsed
    : parsed &&
        typeof parsed === 'object' &&
        Array.isArray((parsed as { questions?: unknown[] }).questions)
      ? (parsed as { questions: unknown[] }).questions
      : [];

  if (rawList.length === 0) {
    throw new Error('Không tìm thấy danh sách câu hỏi hợp lệ trong file JSON.');
  }

  return rawList.map((item, idx) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Phần tử thứ ${idx + 1} trong JSON không phải là đối tượng câu hỏi.`);
    }
    return normalizeImportedQuestion(item as Record<string, unknown>, idx + 1);
  });
}

// ============================================================================
// CẤU TRÚC CỘT EXCEL (.XLSX) RÕ RÀNG CHO GIÁO VIÊN
// ============================================================================

export interface QuestionExcelRow {
  'Mã câu (ID)': string;
  'Loại câu hỏi (Type)': QuestionType;
  'Chuyên đề (Topic)': string;
  'Nội dung câu hỏi (Prompt)': string;
  'Hướng dẫn phụ (Instruction)': string;
  'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)': string;
  'Đáp án đúng (CorrectAnswer)': string;
  'Giải thích (Explanation)': string;
  'Ảnh minh họa (ImageUrl)': string;
}

/**
 * Chuyển 1 câu hỏi sang dòng Excel dễ đọc và có thể chỉnh sửa trực tiếp trên Excel
 * (Không bắt buộc cột Mã đề vì hệ thống tự động bốc câu hỏi ngẫu nhiên theo tỉ lệ trong ngân hàng)
 */
export function questionToExcelRow(q: Question): QuestionExcelRow {
  let dataCell = '';
  let correctCell = '';

  if (q.type === 'mcq_single' || q.type === 'mcq_multiple') {
    const opts = q.options ?? [];
    dataCell = opts.map((o, idx) => `${idx + 1}. ${o.text}`).join('\n');
    const correctIds = Array.isArray(q.correctAnswer)
      ? q.correctAnswer
      : [String(q.correctAnswer)];
    const correctIndices = opts
      .map((o, idx) => (correctIds.includes(o.id) ? String(idx + 1) : null))
      .filter(Boolean);
    correctCell = correctIndices.join(', ') || String(q.correctAnswer);
  } else if (q.type === 'dropdown') {
    const subs = q.subItems ?? [];
    const ansMap =
      q.correctAnswer && typeof q.correctAnswer === 'object' && !Array.isArray(q.correctAnswer)
        ? (q.correctAnswer as Record<string, string>)
        : {};
    dataCell = subs
      .map((s) => {
        const ch = (s.choices ?? s.options ?? q.dropdownOptions ?? ['Đúng', 'Sai']).join(', ');
        return `${s.statement} [${ch}]`;
      })
      .join('\n');
    correctCell = subs.map((s) => ansMap[s.id] ?? '').join(' | ');
  } else if (q.type === 'matching') {
    const pairs = q.pairs ?? [];
    const ansMap =
      q.correctAnswer && typeof q.correctAnswer === 'object' && !Array.isArray(q.correctAnswer)
        ? (q.correctAnswer as Record<string, string>)
        : {};
    dataCell = pairs
      .map((p) => `${p.left} => ${ansMap[p.id] ?? p.right}`)
      .join('\n');
    correctCell = 'Tự động khớp theo cặp Vế trái => Vế phải';
  } else if (q.type === 'ordering') {
    const steps = q.steps ?? [];
    const stepMap = new Map(steps.map((s) => [s.id, s.text]));
    const orderedTexts = Array.isArray(q.correctAnswer)
      ? q.correctAnswer.map((id) => stepMap.get(id) ?? id)
      : steps.map((s) => s.text);
    dataCell = orderedTexts.map((t, i) => `${i + 1}. ${t}`).join('\n');
    correctCell = 'Tự động lấy theo thứ tự chuẩn 1 -> N';
  }

  return {
    'Mã câu (ID)': q.id,
    'Loại câu hỏi (Type)': q.type,
    'Chuyên đề (Topic)': String(q.topic),
    'Nội dung câu hỏi (Prompt)': q.prompt,
    'Hướng dẫn phụ (Instruction)': q.instruction ?? '',
    'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)': dataCell,
    'Đáp án đúng (CorrectAnswer)': correctCell,
    'Giải thích (Explanation)': q.explanation,
    'Ảnh minh họa (ImageUrl)': q.imageUrl ?? '',
  };
}

export function questionsToExcelRows(questions: Question[]): QuestionExcelRow[] {
  return questions.map(questionToExcelRow);
}

/**
 * Tạo danh sách 5 câu hỏi mẫu chuẩn Certiport cho File Excel Mẫu (.xlsx)
 * Không cần cột Mã đề — hệ thống tự động rút ngẫu nhiên theo tỉ lệ ngân hàng khi học sinh làm đề.
 */
export function buildSampleExcelRows(): QuestionExcelRow[] {
  return [
    {
      'Mã câu (ID)': 'q_excel_1',
      'Loại câu hỏi (Type)': 'mcq_single',
      'Chuyên đề (Topic)': '1. Tổng quan & Mô hình GenAI',
      'Nội dung câu hỏi (Prompt)':
        'Tham số nào giúp kiểm soát mức độ ngẫu nhiên (sáng tạo) của văn bản đầu ra trong mô hình ngôn ngữ lớn (LLM)?',
      'Hướng dẫn phụ (Instruction)': 'Chọn 1 đáp án chính xác nhất.',
      'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)':
        '1. Temperature (Nhiệt độ)\n2. Context Window (Cửa sổ ngữ cảnh)\n3. Token Limit (Giới hạn token)\n4. System Role (Vai trò hệ thống)',
      'Đáp án đúng (CorrectAnswer)': '1',
      'Giải thích (Explanation)':
        'Temperature điều chỉnh phân phối xác suất của token tiếp theo: giá trị thấp giúp câu trả lời ổn định, giá trị cao tăng tính đa dạng.',
      'Ảnh minh họa (ImageUrl)': '',
    },
    {
      'Mã câu (ID)': 'q_excel_2',
      'Loại câu hỏi (Type)': 'mcq_multiple',
      'Chuyên đề (Topic)': '2. Kỹ thuật viết Prompt',
      'Nội dung câu hỏi (Prompt)':
        'Hai thành phần nào sau đây giúp câu lệnh (Prompt) đạt hiệu quả cao nhất khi yêu cầu AI viết báo cáo? (Chọn 2)',
      'Hướng dẫn phụ (Instruction)': 'Chọn 2 phương án đúng.',
      'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)':
        '1. Xác định rõ đối tượng người đọc và ngữ cảnh (Context)\n2. Chỉ định định dạng đầu ra mong muốn (Output Format)\n3. Viết câu lệnh càng mơ hồ càng tốt\n4. Bỏ qua mọi ràng buộc về độ dài',
      'Đáp án đúng (CorrectAnswer)': '1, 2',
      'Giải thích (Explanation)':
        'Cung cấp ngữ cảnh (Context) và chỉ định định dạng đầu ra (Output Format) là hai nguyên tắc cốt lõi của Prompt Engineering.',
      'Ảnh minh họa (ImageUrl)': '',
    },
    {
      'Mã câu (ID)': 'q_excel_3',
      'Loại câu hỏi (Type)': 'dropdown',
      'Chuyên đề (Topic)': '3. Đạo đức, Pháp lý & Bảo mật',
      'Nội dung câu hỏi (Prompt)':
        'Hãy lựa chọn Đúng hoặc Sai ở mỗi mệnh đề về nguyên tắc bảo mật dữ liệu khi sử dụng công cụ AI công cộng:',
      'Hướng dẫn phụ (Instruction)': 'Chọn đáp án trong từng menu thả xuống (- Select -).',
      'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)':
        'Tuyệt đối không tải thông tin cá nhân nhạy cảm (PII) của khách hàng lên chatbot AI công cộng [Đúng, Sai]\nCó thể thoải mái dán mã nguồn bí mật của công ty lên AI công cộng mà không cần xin phép [Đúng, Sai]',
      'Đáp án đúng (CorrectAnswer)': 'Đúng | Sai',
      'Giải thích (Explanation)':
        'Dữ liệu đưa vào AI công cộng có thể được dùng để huấn luyện lại mô hình, do đó không được tải PII hoặc bí mật thương mại.',
      'Ảnh minh họa (ImageUrl)': '',
    },
    {
      'Mã câu (ID)': 'q_excel_4',
      'Loại câu hỏi (Type)': 'matching',
      'Chuyên đề (Topic)': '4. Ứng dụng & Công cụ thực tế',
      'Nội dung câu hỏi (Prompt)':
        'Hãy ghép nối mỗi kỹ thuật AI ở cột trái với mục đích ứng dụng tương ứng ở cột phải:',
      'Hướng dẫn phụ (Instruction)': 'Kéo thả từng mảnh ghép cột phải vào ô tương ứng.',
      'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)':
        'RAG (Retrieval-Augmented Generation) => Kết nối LLM với tài liệu nội bộ để trả lời chính xác và giảm ảo giác\nFine-tuning (Tinh chỉnh mô hình) => Huấn luyện bổ sung trên tập dữ liệu chuyên ngành để điều chỉnh phong cách\nZero-shot Prompting => Giao tác vụ trực tiếp cho mô hình mà không kèm ví dụ mẫu',
      'Đáp án đúng (CorrectAnswer)': 'Tự động khớp theo cặp Vế trái => Vế phải',
      'Giải thích (Explanation)':
        'RAG tra cứu tri thức ngoài, Fine-tuning cập nhật trọng số chuyên biệt, còn Zero-shot không dùng ví dụ mẫu.',
      'Ảnh minh họa (ImageUrl)': '',
    },
    {
      'Mã câu (ID)': 'q_excel_5',
      'Loại câu hỏi (Type)': 'ordering',
      'Chuyên đề (Topic)': '2. Kỹ thuật viết Prompt',
      'Nội dung câu hỏi (Prompt)':
        'Hãy sắp xếp quy trình cải tiến câu lệnh (Iterative Prompt Refinement) theo đúng thứ tự chuẩn từ bước 1 đến bước 4:',
      'Hướng dẫn phụ (Instruction)': 'Sắp xếp các bước từ 1 đến 4.',
      'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)':
        '1. Xác định mục tiêu đầu ra và viết câu lệnh (Prompt) khởi đầu\n2. Chạy thử câu lệnh và quan sát kết quả phản hồi của mô hình AI\n3. Phân tích các điểm thiếu sót, sai lệch hoặc chưa rõ ràng trong câu trả lời\n4. Bổ sung ngữ cảnh, ràng buộc hoặc ví dụ mẫu rồi thử lại',
      'Đáp án đúng (CorrectAnswer)': 'Tự động lấy theo thứ tự chuẩn 1 -> N',
      'Giải thích (Explanation)':
        'Quy trình tinh chỉnh câu lệnh lặp lại gồm: Viết prompt ban đầu -> Chạy thử -> Đánh giá đầu ra -> Bổ sung ràng buộc.',
      'Ảnh minh họa (ImageUrl)': '',
    },
  ];
}

function readRowField(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

function stripLeadingIndex(line: string): string {
  return line.replace(/^\s*(?:[0-9]+[.)]|[-*•]|[A-Da-d][.)])\s*/, '').trim();
}

/**
 * Đọc danh sách dòng từ SheetJS (Excel) và chuyển thành mảng `Question[]` chuẩn Certiport
 */
export function parseQuestionsFromExcelRows(rows: Record<string, unknown>[]): Question[] {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('File Excel không có dữ liệu câu hỏi.');
  }

  const parsedQuestions: Question[] = [];

  rows.forEach((row, idx) => {
    const prompt = readRowField(row, [
      'Nội dung câu hỏi (Prompt)',
      'Nội dung câu hỏi',
      'Prompt',
      'prompt',
      'CauHoi',
    ]);
    if (!prompt) return; // Bỏ qua dòng trống

    const rawId = readRowField(row, ['Mã câu (ID)', 'Mã câu', 'ID', 'id']);
    const id =
      rawId.replace(/[^a-zA-Z0-9_-]/g, '') || `q_xlsx_${Date.now()}_${idx + 1}`;

    const rawType = readRowField(row, [
      'Loại câu hỏi (Type)',
      'Loại câu hỏi',
      'Type',
      'type',
    ]).toLowerCase();

    let type: QuestionType = 'mcq_single';
    if (
      rawType === 'mcq_multiple' ||
      rawType === 'multiple' ||
      rawType.includes('nhiều')
    ) {
      type = 'mcq_multiple';
    } else if (rawType === 'dropdown' || rawType.includes('thả xuống')) {
      type = 'dropdown';
    } else if (
      rawType === 'matching' ||
      rawType.includes('nối') ||
      rawType.includes('ghép')
    ) {
      type = 'matching';
    } else if (rawType === 'ordering' || rawType.includes('sắp xếp')) {
      type = 'ordering';
    }

    const topic =
      readRowField(row, ['Chuyên đề (Topic)', 'Chuyên đề', 'Topic', 'topic']) ||
      CERTIPORT_TOPICS[0];

    const examSet =
      readRowField(row, ['Mã đề (ExamSet)', 'Mã đề', 'ExamSet', 'examSet', 'Đề']) ||
      'Ngân hàng chung';

    const instruction = readRowField(row, [
      'Hướng dẫn phụ (Instruction)',
      'Hướng dẫn',
      'Instruction',
      'instruction',
    ]);

    const explanation =
      readRowField(row, [
        'Giải thích (Explanation)',
        'Giải thích',
        'Explanation',
        'explanation',
      ]) || 'Đáp án chuẩn theo tài liệu khung năng lực Certiport Generative AI.';

    const imageUrl = readRowField(row, [
      'Ảnh minh họa (ImageUrl)',
      'Ảnh minh họa',
      'ImageUrl',
      'imageUrl',
    ]);

    const dataRaw = readRowField(row, [
      'Dữ liệu Phương án / Mệnh đề / Cặp nối / Thứ tự (Data)',
      'Dữ liệu (Data)',
      'Data',
      'data',
      'Phương án',
    ]);

    const correctRaw = readRowField(row, [
      'Đáp án đúng (CorrectAnswer)',
      'Đáp án đúng',
      'CorrectAnswer',
      'correctAnswer',
    ]);

    const lines = dataRaw
      .split(/\r?\n|\s*\|\|\s*/)
      .map((l) => l.trim())
      .filter(Boolean);

    if (type === 'mcq_single' || type === 'mcq_multiple') {
      // Hỗ trợ cả cột riêng lẻ Phương án A, B, C, D nếu giáo viên dùng bảng cột rời
      const colOpts = [
        readRowField(row, ['Phương án A', 'Option A', 'A']),
        readRowField(row, ['Phương án B', 'Option B', 'B']),
        readRowField(row, ['Phương án C', 'Option C', 'C']),
        readRowField(row, ['Phương án D', 'Option D', 'D']),
      ].filter(Boolean);

      const optionTexts =
        lines.length >= 2 ? lines.map(stripLeadingIndex) : colOpts;

      if (optionTexts.length < 2) {
        throw new Error(
          `Dòng ${idx + 2} (Mã câu "${id}"): Câu trắc nghiệm cần tối thiểu 2 phương án.`
        );
      }

      const tokens = correctRaw
        .split(/[,;|]+/)
        .map((t) => t.trim())
        .filter(Boolean);

      const letterToIndex: Record<string, number> = {
        A: 0,
        B: 1,
        C: 2,
        D: 3,
        E: 4,
        F: 5,
      };

      const matchedIndices = new Set<number>();
      for (const tok of tokens) {
        const upper = tok.toUpperCase();
        if (upper in letterToIndex) {
          matchedIndices.add(letterToIndex[upper]);
        } else if (/^\d+$/.test(tok)) {
          matchedIndices.add(Math.max(0, parseInt(tok, 10) - 1));
        } else {
          const byTextIdx = optionTexts.findIndex(
            (t) => t.toLowerCase() === tok.toLowerCase()
          );
          if (byTextIdx !== -1) matchedIndices.add(byTextIdx);
        }
      }

      if (matchedIndices.size === 0) {
        matchedIndices.add(0);
      }

      const draft = createEmptyQuestionDraft(idx + 1);
      draft.id = id;
      draft.type = type;
      draft.topic = topic;
      draft.examSet = examSet;
      draft.prompt = prompt;
      draft.instruction = instruction;
      draft.imageUrl = imageUrl;
      draft.explanation = explanation;
      draft.mcqOptions = optionTexts.map((text, optIdx) => ({
        id: `${id}_opt${optIdx + 1}`,
        text,
        isCorrect: matchedIndices.has(optIdx),
      }));

      parsedQuestions.push(buildQuestionFromDraft(draft));
      return;
    }

    if (type === 'dropdown') {
      if (lines.length === 0) {
        throw new Error(
          `Dòng ${idx + 2} (Mã câu "${id}"): Câu hỏi Dropdown cần ít nhất 1 dòng mệnh đề.`
        );
      }
      const correctParts = correctRaw
        .split(/\s*\|\s*|\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const draft = createEmptyQuestionDraft(idx + 1);
      draft.id = id;
      draft.type = 'dropdown';
      draft.topic = topic;
      draft.examSet = examSet;
      draft.prompt = prompt;
      draft.instruction = instruction;
      draft.imageUrl = imageUrl;
      draft.explanation = explanation;
      draft.dropdownRows = lines.map((line, rIdx) => {
        const bracketMatch = line.match(/^(.*?)\[([^\]]+)\]\s*$/);
        const statement = bracketMatch
          ? stripLeadingIndex(bracketMatch[1])
          : stripLeadingIndex(line);
        const choicesText = bracketMatch ? bracketMatch[2].trim() : 'Đúng, Sai';
        const choices = parseChoicesText(choicesText);
        const correctChoice = correctParts[rIdx] || choices[0] || 'Đúng';
        return {
          id: `${id}_sub${rIdx + 1}`,
          statement,
          choicesText,
          correctChoice,
        };
      });

      parsedQuestions.push(buildQuestionFromDraft(draft));
      return;
    }

    if (type === 'matching') {
      const pairs = lines
        .map((line, pIdx) => {
          const parts = line.split(/\s*(?:=>|->|:|=|-)\s*/);
          if (parts.length < 2) return null;
          const left = stripLeadingIndex(parts[0]);
          const right = parts.slice(1).join(' - ').trim();
          return {
            id: `${id}_pair${pIdx + 1}`,
            left,
            right,
          };
        })
        .filter((p): p is MatchingPairDraft => Boolean(p && p.left && p.right));

      if (pairs.length < 2) {
        throw new Error(
          `Dòng ${idx + 2} (Mã câu "${id}"): Câu hỏi Matching cần ít nhất 2 cặp theo cú pháp "Vế trái => Vế phải".`
        );
      }

      const draft = createEmptyQuestionDraft(idx + 1);
      draft.id = id;
      draft.type = 'matching';
      draft.topic = topic;
      draft.examSet = examSet;
      draft.prompt = prompt;
      draft.instruction = instruction;
      draft.imageUrl = imageUrl;
      draft.explanation = explanation;
      draft.matchingPairs = pairs;

      parsedQuestions.push(buildQuestionFromDraft(draft));
      return;
    }

    // ordering
    const stepTexts = lines.map(stripLeadingIndex).filter(Boolean);
    if (stepTexts.length < 2) {
      throw new Error(
        `Dòng ${idx + 2} (Mã câu "${id}"): Câu hỏi Ordering cần ít nhất 2 bước theo thứ tự.`
      );
    }

    const draft = createEmptyQuestionDraft(idx + 1);
    draft.id = id;
    draft.type = 'ordering';
    draft.topic = topic;
    draft.examSet = examSet;
    draft.prompt = prompt;
    draft.instruction = instruction;
    draft.imageUrl = imageUrl;
    draft.explanation = explanation;
    draft.orderingSteps = stepTexts.map((text, sIdx) => ({
      id: `${id}_step${sIdx + 1}`,
      text,
    }));

    parsedQuestions.push(buildQuestionFromDraft(draft));
  });

  if (parsedQuestions.length === 0) {
    throw new Error('Không tìm thấy dòng câu hỏi hợp lệ nào trong file Excel.');
  }

  // Đảm bảo tất cả câu hỏi tạo ra đều chấm đúng 100% với đáp án chuẩn của chính nó
  for (const q of parsedQuestions) {
    if (!evaluateQuestion(q, q.correctAnswer)) {
      throw new Error(`Câu hỏi "${q.id}" có cấu hình đáp án đúng chưa khớp với dữ liệu.`);
    }
  }

  return parsedQuestions;
}

/**
 * Tạo mảng byte `.xlsx` cho File Excel Mẫu (kèm sheet Hướng dẫn nhập liệu chi tiết)
 */
export function buildSampleExcelWorkbookBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const sampleRows = buildSampleExcelRows();
  const wsQuestions = XLSX.utils.json_to_sheet(sampleRows);
  wsQuestions['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 28 },
    { wch: 12 },
    { wch: 46 },
    { wch: 26 },
    { wch: 52 },
    { wch: 24 },
    { wch: 42 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, wsQuestions, 'DanhSachCauHoi');

  const guideRows = [
    {
      'Loại câu hỏi (Type)': 'mcq_single',
      'Mô tả': 'Trắc nghiệm chọn 1 đáp án đúng (Radio)',
      'Cách ghi cột Dữ liệu (Data)':
        'Mỗi phương án 1 dòng (ví dụ: 1. Phương án A \\n 2. Phương án B)',
      'Cách ghi cột Đáp án đúng': 'Số thứ tự (1, 2, 3, 4) hoặc chữ cái (A, B, C, D)',
    },
    {
      'Loại câu hỏi (Type)': 'mcq_multiple',
      'Mô tả': 'Trắc nghiệm chọn nhiều đáp án đúng (Checkbox)',
      'Cách ghi cột Dữ liệu (Data)':
        'Mỗi phương án 1 dòng (ví dụ: 1. Ý đúng 1 \\n 2. Ý đúng 2 \\n 3. Ý nhiễu)',
      'Cách ghi cột Đáp án đúng': 'Các số thứ tự cách nhau dấu phẩy, ví dụ: 1, 2 hoặc A, B',
    },
    {
      'Loại câu hỏi (Type)': 'dropdown',
      'Mô tả': 'Menu thả xuống (- Select -)',
      'Cách ghi cột Dữ liệu (Data)':
        'Mỗi mệnh đề 1 dòng kèm danh sách lựa chọn trong ngoặc vuông: Mệnh đề 1 [Đúng, Sai]',
      'Cách ghi cột Đáp án đúng':
        'Đáp án đúng từng mệnh đề ngăn cách bởi dấu "|", ví dụ: Đúng | Sai',
    },
    {
      'Loại câu hỏi (Type)': 'matching',
      'Mô tả': 'Kéo thả nối câu (Puzzle Matching)',
      'Cách ghi cột Dữ liệu (Data)':
        'Mỗi cặp nối 1 dòng theo cú pháp: Vế trái => Vế phải tương ứng',
      'Cách ghi cột Đáp án đúng': 'Để mặc định (hệ thống tự khớp Vế trái => Vế phải)',
    },
    {
      'Loại câu hỏi (Type)': 'ordering',
      'Mô tả': 'Sắp xếp thứ tự các bước (Ordering)',
      'Cách ghi cột Dữ liệu (Data)':
        'Nhập mỗi bước trên 1 dòng theo đúng thứ tự chuẩn từ bước 1 đến bước cuối',
      'Cách ghi cột Đáp án đúng': 'Để mặc định (hệ thống tự lấy thứ tự 1 -> N)',
    },
  ];
  const wsGuide = XLSX.utils.json_to_sheet(guideRows);
  wsGuide['!cols'] = [{ wch: 18 }, { wch: 36 }, { wch: 52 }, { wch: 46 }];
  XLSX.utils.book_append_sheet(wb, wsGuide, 'HuongDanNhapLieu');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}

/**
 * Xuất toàn bộ ngân hàng câu hỏi hiện tại ra mảng byte `.xlsx`
 */
export function exportQuestionsToExcelBytes(questions: Question[]): Uint8Array {
  const wb = XLSX.utils.book_new();
  const rows = questionsToExcelRows(questions);
  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 16 },
    { wch: 28 },
    { wch: 12 },
    { wch: 46 },
    { wch: 26 },
    { wch: 52 },
    { wch: 24 },
    { wch: 42 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'NganHangCauHoi');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}

/**
 * Đọc mảng byte `.xlsx` và chuyển đổi thành danh sách `Question[]`
 */
export function parseQuestionsFromExcelBytes(bytes: ArrayBuffer | Uint8Array): Question[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('File Excel không có trang tính (Sheet) nào.');
  }
  const sheet = wb.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
  });
  return parseQuestionsFromExcelRows(rows);
}

/**
 * Gắn hoặc xóa hình ảnh minh họa (`imageUrl`) trực tiếp cho một câu hỏi trong Ngân hàng đề
 */
export function applyImageToQuestion(question: Question, imageUrl: string): Question {
  const trimmed = imageUrl.trim();
  const next: Question = {
    ...question,
  };
  if (trimmed) {
    next.imageUrl = trimmed;
  } else {
    delete next.imageUrl;
  }
  return next;
}

/**
 * Nén tệp hình ảnh (từ máy tính, Kéo thả hoặc Dán Clipboard Ctrl+V) thành chuỗi Base64 sắc nét,
 * tối ưu dung lượng (tối đa 1200px) để lưu trực tiếp vào trường `imageUrl` trên Firestore.
 */
export async function compressImageFileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Không thể đọc tệp hình ảnh đã chọn.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const mimeType = file.type || 'image/png';
      // Nếu ảnh đã nhỏ (< 120KB) hoặc là SVG, giữ nguyên chất lượng gốc
      if (dataUrl.length < 120_000 || mimeType === 'image/svg+xml') {
        resolve(dataUrl);
        return;
      }

      const img = new Image();
      img.onerror = () => resolve(dataUrl);
      img.onload = () => {
        const maxDim = 1200;
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(dataUrl);
          return;
        }
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', 0.85);
        resolve(compressed);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

