import {
  BreakdownStatItem,
  CERTIPORT_PASS_SCORE,
  CERTIPORT_TOPICS,
  MOCK_EXAM_MAX_QUESTIONS,
  MockExamQuestionResult,
  QUESTION_TYPE_LABELS,
  Question,
  QuestionType,
  QuestionTypeFilter,
  UserAnswer,
} from '../types/exam';

/**
 * Cơ chế chấm điểm Chuẩn Certiport (Strict All-or-Nothing Scoring):
 * Một câu hỏi chỉ được tính là ĐÚNG (true = 1 điểm) khi học sinh chọn đúng 100%
 * tất cả các ý / mảnh ghép / thứ tự trong câu đó.
 * Nếu sai hoặc thiếu bất kỳ 1 ý nhỏ nào thì cả câu đó tính là SAI (false = 0 điểm).
 */
export function evaluateQuestion(
  question: Question,
  userAnswer: UserAnswer | undefined | null
): boolean {
  if (userAnswer === undefined || userAnswer === null) {
    return false;
  }

  switch (question.type) {
    case 'mcq_single': {
      if (typeof userAnswer !== 'string' || typeof question.correctAnswer !== 'string') {
        return false;
      }
      const trimmedUser = userAnswer.trim();
      const trimmedCorrect = question.correctAnswer.trim();
      if (!trimmedUser) return false;
      return trimmedUser === trimmedCorrect;
    }

    case 'mcq_multiple': {
      if (!Array.isArray(userAnswer) || !Array.isArray(question.correctAnswer)) {
        return false;
      }
      const expectedList = question.correctAnswer.map((item) => item.trim()).filter(Boolean);
      const actualList = userAnswer.map((item) => String(item).trim()).filter(Boolean);

      if (expectedList.length === 0 || actualList.length !== expectedList.length) {
        return false;
      }

      const expectedSet = new Set(expectedList);
      const actualSet = new Set(actualList);

      if (expectedSet.size !== actualSet.size) {
        return false;
      }

      for (const expectedItem of expectedSet) {
        if (!actualSet.has(expectedItem)) {
          return false;
        }
      }
      return true;
    }

    case 'dropdown': {
      if (
        typeof userAnswer !== 'object' ||
        Array.isArray(userAnswer) ||
        typeof question.correctAnswer !== 'object' ||
        Array.isArray(question.correctAnswer)
      ) {
        return false;
      }

      const expectedMap = question.correctAnswer as Record<string, string>;
      const actualMap = userAnswer as Record<string, string>;
      const requiredKeys = question.subItems?.map((item) => item.id) ?? Object.keys(expectedMap);

      if (requiredKeys.length === 0) {
        return false;
      }

      for (const key of requiredKeys) {
        const expectedVal = expectedMap[key];
        const actualVal = actualMap[key];
        if (!expectedVal || !actualVal || actualVal.trim() !== expectedVal.trim()) {
          return false;
        }
      }
      return true;
    }

    case 'matching': {
      if (
        typeof userAnswer !== 'object' ||
        Array.isArray(userAnswer) ||
        typeof question.correctAnswer !== 'object' ||
        Array.isArray(question.correctAnswer)
      ) {
        return false;
      }

      const expectedMap = question.correctAnswer as Record<string, string>;
      const actualMap = userAnswer as Record<string, string>;
      const requiredKeys = question.pairs?.map((pair) => pair.id) ?? Object.keys(expectedMap);

      if (requiredKeys.length === 0) {
        return false;
      }

      for (const key of requiredKeys) {
        const expectedVal = expectedMap[key];
        const actualVal = actualMap[key];
        if (!expectedVal || !actualVal || actualVal.trim() !== expectedVal.trim()) {
          return false;
        }
      }
      return true;
    }

    case 'ordering': {
      if (!Array.isArray(userAnswer) || !Array.isArray(question.correctAnswer)) {
        return false;
      }

      const expectedSequence = question.correctAnswer;
      if (expectedSequence.length === 0 || userAnswer.length !== expectedSequence.length) {
        return false;
      }

      for (let i = 0; i < expectedSequence.length; i++) {
        if (String(userAnswer[i]).trim() !== String(expectedSequence[i]).trim()) {
          return false;
        }
      }
      return true;
    }

    default:
      return false;
  }
}

/**
 * Kiểm tra xem học sinh đã điền đầy đủ các phần của câu hỏi chưa
 */
export function isQuestionAnswered(
  question: Question,
  userAnswer: UserAnswer | undefined | null
): boolean {
  if (userAnswer === undefined || userAnswer === null) {
    return false;
  }

  switch (question.type) {
    case 'mcq_single':
      return typeof userAnswer === 'string' && userAnswer.trim().length > 0;

    case 'mcq_multiple': {
      if (!Array.isArray(userAnswer)) return false;
      const requiredCount =
        question.maxSelect ??
        question.maxSelections ??
        (Array.isArray(question.correctAnswer) ? question.correctAnswer.length : 1);
      return userAnswer.length >= requiredCount;
    }

    case 'dropdown': {
      if (typeof userAnswer !== 'object' || Array.isArray(userAnswer)) return false;
      const keys = question.subItems?.map((s) => s.id) ?? [];
      return keys.length > 0 && keys.every((k) => Boolean((userAnswer as Record<string, string>)[k]));
    }

    case 'matching': {
      if (typeof userAnswer !== 'object' || Array.isArray(userAnswer)) return false;
      const keys = question.pairs?.map((p) => p.id) ?? [];
      return keys.length > 0 && keys.every((k) => Boolean((userAnswer as Record<string, string>)[k]));
    }

    case 'ordering': {
      if (!Array.isArray(userAnswer)) return false;
      const totalSteps = question.steps?.length ?? 0;
      return totalSteps > 0 && userAnswer.length === totalSteps && userAnswer.every(Boolean);
    }

    default:
      return false;
  }
}

export interface CorrectAnswerBreakdownItem {
  label: string;
  value: string;
}

/**
 * Trích xuất danh sách chi tiết Đáp án đúng của từng ý trong câu hỏi để hiển thị rõ ràng
 */
export function getCorrectAnswerBreakdown(question: Question): CorrectAnswerBreakdownItem[] {
  switch (question.type) {
    case 'mcq_single': {
      const targetId = String(question.correctAnswer);
      const idx = question.options?.findIndex((o) => o.id === targetId) ?? -1;
      const opt = idx >= 0 && question.options ? question.options[idx] : undefined;
      const letter = idx >= 0 ? String.fromCharCode(65 + idx) : '';
      return [
        {
          label: 'Phương án đúng',
          value: opt ? `${letter}. ${opt.text}` : targetId,
        },
      ];
    }

    case 'mcq_multiple': {
      const targetIds = Array.isArray(question.correctAnswer) ? question.correctAnswer : [];
      return targetIds.map((id, orderIdx) => {
        const idx = question.options?.findIndex((o) => o.id === id) ?? -1;
        const opt = idx >= 0 && question.options ? question.options[idx] : undefined;
        const letter = idx >= 0 ? String.fromCharCode(65 + idx) : '';
        return {
          label: `Ý đúng ${orderIdx + 1}`,
          value: opt ? `${letter}. ${opt.text}` : id,
        };
      });
    }

    case 'dropdown': {
      const expectedMap =
        typeof question.correctAnswer === 'object' && !Array.isArray(question.correctAnswer)
          ? (question.correctAnswer as Record<string, string>)
          : {};
      if (question.subItems && question.subItems.length > 0) {
        return question.subItems.map((sub, idx) => ({
          label: `Mệnh đề ${idx + 1}: "${sub.statement}"`,
          value: expectedMap[sub.id] ?? '',
        }));
      }
      return Object.entries(expectedMap).map(([k, v]) => ({
        label: k,
        value: v,
      }));
    }

    case 'matching': {
      const expectedMap =
        typeof question.correctAnswer === 'object' && !Array.isArray(question.correctAnswer)
          ? (question.correctAnswer as Record<string, string>)
          : {};
      if (question.pairs && question.pairs.length > 0) {
        return question.pairs.map((pair, idx) => ({
          label: `Cặp #${idx + 1}: ${pair.left}`,
          value: expectedMap[pair.id] ?? pair.right,
        }));
      }
      return Object.entries(expectedMap).map(([k, v]) => ({
        label: k,
        value: v,
      }));
    }

    case 'ordering': {
      const expectedSeq = Array.isArray(question.correctAnswer) ? question.correctAnswer : [];
      return expectedSeq.map((stepId, idx) => {
        const stepObj = question.steps?.find((s) => s.id === stepId);
        return {
          label: `Bước ${idx + 1}`,
          value: stepObj ? stepObj.text : stepId,
        };
      });
    }

    default:
      return [];
  }
}

/**
 * Trích xuất câu trả lời thực tế của học sinh để so sánh trực quan với Đáp án đúng khi xem lại bài thi
 */
export function getUserAnswerBreakdown(
  question: Question,
  userAnswer: UserAnswer | undefined | null
): CorrectAnswerBreakdownItem[] {
  if (userAnswer === undefined || userAnswer === null) {
    return [{ label: 'Trạng thái trả lời', value: 'Chưa trả lời (Bỏ trống)' }];
  }

  switch (question.type) {
    case 'mcq_single': {
      const targetId = String(userAnswer).trim();
      if (!targetId) {
        return [{ label: 'Phương án bạn chọn', value: 'Chưa chọn phương án nào' }];
      }
      const idx = question.options?.findIndex((o) => o.id === targetId) ?? -1;
      const opt = idx >= 0 && question.options ? question.options[idx] : undefined;
      const letter = idx >= 0 ? String.fromCharCode(65 + idx) : '';
      return [
        {
          label: 'Phương án bạn chọn',
          value: opt ? `${letter}. ${opt.text}` : targetId,
        },
      ];
    }

    case 'mcq_multiple': {
      const selectedIds = Array.isArray(userAnswer) ? userAnswer : [];
      if (selectedIds.length === 0) {
        return [{ label: 'Phương án bạn chọn', value: 'Chưa chọn phương án nào' }];
      }
      return selectedIds.map((id, orderIdx) => {
        const idx = question.options?.findIndex((o) => o.id === id) ?? -1;
        const opt = idx >= 0 && question.options ? question.options[idx] : undefined;
        const letter = idx >= 0 ? String.fromCharCode(65 + idx) : '';
        return {
          label: `Lựa chọn ${orderIdx + 1} của bạn`,
          value: opt ? `${letter}. ${opt.text}` : id,
        };
      });
    }

    case 'dropdown': {
      const actualMap =
        typeof userAnswer === 'object' && !Array.isArray(userAnswer)
          ? (userAnswer as Record<string, string>)
          : {};
      if (question.subItems && question.subItems.length > 0) {
        return question.subItems.map((sub, idx) => ({
          label: `Mệnh đề ${idx + 1}: "${sub.statement}"`,
          value: actualMap[sub.id] || '(Chưa chọn - Select -)',
        }));
      }
      return [{ label: 'Lựa chọn của bạn', value: 'Chưa chọn' }];
    }

    case 'matching': {
      const actualMap =
        typeof userAnswer === 'object' && !Array.isArray(userAnswer)
          ? (userAnswer as Record<string, string>)
          : {};
      if (question.pairs && question.pairs.length > 0) {
        return question.pairs.map((pair, idx) => ({
          label: `Cặp #${idx + 1}: ${pair.left}`,
          value: actualMap[pair.id] || '(Chưa ghép mảnh ghép)',
        }));
      }
      return [{ label: 'Cặp ghép của bạn', value: 'Chưa ghép' }];
    }

    case 'ordering': {
      const actualSeq = Array.isArray(userAnswer) ? userAnswer : [];
      const totalSteps = question.steps?.length ?? 0;
      if (actualSeq.length === 0) {
        return [{ label: 'Thứ tự bạn xếp', value: 'Chưa sắp xếp bước nào' }];
      }
      return Array.from({ length: Math.max(totalSteps, actualSeq.length) }, (_, idx) => {
        const stepId = actualSeq[idx];
        const stepObj = question.steps?.find((s) => s.id === stepId);
        return {
          label: `Bước ${idx + 1} bạn xếp`,
          value: stepObj ? stepObj.text : '(Chưa chọn bước)',
        };
      });
    }

    default:
      return [];
  }
}

export interface PracticeFilterCriteria {
  topic: string;
  questionType: QuestionTypeFilter;
  examSet: string;
  onlyBookmarked: boolean;
}

/**
 * Lọc danh sách câu hỏi theo Bộ lọc 3 chiều (Chuyên đề + Dạng bài tập + Đề luyện tập) + Bookmark
 */
export function filterPracticeQuestions(
  questions: Question[],
  criteria: PracticeFilterCriteria,
  bookmarkedIds: string[]
): Question[] {
  const bookmarkSet = new Set(bookmarkedIds);

  return questions.filter((q) => {
    const matchTopic = criteria.topic === 'ALL' || q.topic === criteria.topic;
    const matchExamSet = criteria.examSet === 'ALL' || q.examSet === criteria.examSet;

    let matchType = true;
    if (criteria.questionType === 'mcq') {
      matchType = q.type === 'mcq_single' || q.type === 'mcq_multiple';
    } else if (criteria.questionType !== 'ALL') {
      matchType = q.type === criteria.questionType;
    }

    const matchBookmark = !criteria.onlyBookmarked || bookmarkSet.has(q.id);

    return matchTopic && matchExamSet && matchType && matchBookmark;
  });
}

/**
 * Cập nhật danh sách Kho câu sai (`wrongQuestions`) và Đã nắm vững (`masteredQuestions`)
 */
export function computeUpdatedWrongQuestions(
  currentWrongIds: string[],
  currentMasteredIds: string[],
  questionId: string,
  isCorrect: boolean,
  removeOnCorrect: boolean = false
): { wrongQuestions: string[]; masteredQuestions: string[] } {
  const wrongSet = new Set(currentWrongIds);
  const masteredSet = new Set(currentMasteredIds);

  if (!isCorrect) {
    wrongSet.add(questionId);
    masteredSet.delete(questionId);
  } else if (removeOnCorrect && wrongSet.has(questionId)) {
    wrongSet.delete(questionId);
    masteredSet.add(questionId);
  }

  return {
    wrongQuestions: Array.from(wrongSet),
    masteredQuestions: Array.from(masteredSet),
  };
}

export interface ProportionalTopicAllocationItem {
  topic: string;
  bankCount: number;
  bankPercentage: number;
  allocatedCount: number;
}

export interface ProportionalExamDrawResult {
  questions: Question[];
  totalBankSize: number;
  targetCount: number;
  topicAllocations: ProportionalTopicAllocationItem[];
}

function shuffleArrayWithRng<T>(items: T[], randomFn: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(randomFn() * (i + 1));
    const temp = copy[i];
    copy[i] = copy[j];
    copy[j] = temp;
  }
  return copy;
}

/**
 * Phân bổ số lượng phần tử cần lấy từ các nhóm theo phương pháp Phần dư lớn nhất (Hamilton / Largest Remainder)
 * sao cho tổng số câu lấy ra bằng đúng `targetTotal` và bám sát tỷ lệ thực tế trong ngân hàng câu hỏi.
 */
function allocateCountsProportionally(
  groupSizes: number[],
  targetTotal: number
): number[] {
  const totalAvailable = groupSizes.reduce((sum, n) => sum + n, 0);
  if (totalAvailable <= 0 || targetTotal <= 0) {
    return groupSizes.map(() => 0);
  }
  if (targetTotal >= totalAvailable) {
    return [...groupSizes];
  }

  const exactQuotas = groupSizes.map((size) => (size / totalAvailable) * targetTotal);
  const allocations = exactQuotas.map((q) => Math.floor(q));
  let remainderSlots =
    targetTotal - allocations.reduce((sum, count) => sum + count, 0);

  const indicesByRemainder = groupSizes
    .map((size, idx) => ({
      idx,
      size,
      remainder: exactQuotas[idx] - allocations[idx],
    }))
    .sort((a, b) => {
      if (Math.abs(b.remainder - a.remainder) > 1e-9) {
        return b.remainder - a.remainder;
      }
      return b.size - a.size;
    });

  for (const item of indicesByRemainder) {
    if (remainderSlots <= 0) break;
    if (allocations[item.idx] < item.size) {
      allocations[item.idx] += 1;
      remainderSlots -= 1;
    }
  }

  return allocations;
}

/**
 * Bốc ngẫu nhiên câu hỏi từ Ngân hàng theo đúng tỷ lệ Chuyên đề (Topic) và Dạng câu hỏi (Type)
 * hiện có trong Ngân hàng câu hỏi.
 */
export function buildProportionalExamPool(
  bank: Question[],
  maxQuestions: number = MOCK_EXAM_MAX_QUESTIONS,
  randomFn: () => number = Math.random
): ProportionalExamDrawResult {
  if (bank.length === 0) {
    return {
      questions: [],
      totalBankSize: 0,
      targetCount: 0,
      topicAllocations: CERTIPORT_TOPICS.map((topic) => ({
        topic,
        bankCount: 0,
        bankPercentage: 0,
        allocatedCount: 0,
      })),
    };
  }

  const targetCount = Math.min(Math.max(1, maxQuestions), bank.length);

  // Gom nhóm câu hỏi theo Chuyên đề (giữ thứ tự 4 chuyên đề chuẩn Certiport + chuyên đề mở rộng nếu có)
  const topicOrder: string[] = [...CERTIPORT_TOPICS];
  for (const q of bank) {
    if (!topicOrder.includes(q.topic)) {
      topicOrder.push(q.topic);
    }
  }

  const questionsByTopic = new Map<string, Question[]>();
  for (const topic of topicOrder) {
    questionsByTopic.set(topic, []);
  }
  for (const q of bank) {
    const list = questionsByTopic.get(q.topic) ?? [];
    list.push(q);
    questionsByTopic.set(q.topic, list);
  }

  const groupSizes = topicOrder.map(
    (topic) => (questionsByTopic.get(topic) ?? []).length
  );
  const topicCounts = allocateCountsProportionally(groupSizes, targetCount);

  const selectedQuestions: Question[] = [];
  const topicAllocations: ProportionalTopicAllocationItem[] = [];

  topicOrder.forEach((topic, tIdx) => {
    const topicQuestions = questionsByTopic.get(topic) ?? [];
    const bankCount = topicQuestions.length;
    const allocatedCount = topicCounts[tIdx] ?? 0;
    const bankPercentage =
      bank.length > 0 ? Math.round((bankCount / bank.length) * 100) : 0;

    topicAllocations.push({
      topic,
      bankCount,
      bankPercentage,
      allocatedCount,
    });

    if (allocatedCount <= 0 || bankCount === 0) return;

    // Bên trong mỗi Chuyên đề, tiếp tục lấy cân bằng theo tỷ lệ Dạng câu hỏi (Type)
    const typeBuckets = new Map<QuestionType, Question[]>();
    for (const q of topicQuestions) {
      const list = typeBuckets.get(q.type) ?? [];
      list.push(q);
      typeBuckets.set(q.type, list);
    }

    const typeKeys = Array.from(typeBuckets.keys());
    const typeSizes = typeKeys.map((k) => (typeBuckets.get(k) ?? []).length);
    const typeAllocations = allocateCountsProportionally(
      typeSizes,
      allocatedCount
    );

    typeKeys.forEach((tKey, kIdx) => {
      const bucket = typeBuckets.get(tKey) ?? [];
      const takeCount = typeAllocations[kIdx] ?? 0;
      if (takeCount > 0) {
        const shuffledBucket = shuffleArrayWithRng(bucket, randomFn);
        selectedQuestions.push(...shuffledBucket.slice(0, takeCount));
      }
    });
  });

  // Xáo trộn toàn bộ đề thi sau khi đã lấy đủ số câu theo đúng tỷ lệ
  const shuffledExam = shuffleArrayWithRng(selectedQuestions, randomFn);

  return {
    questions: shuffledExam,
    totalBankSize: bank.length,
    targetCount,
    topicAllocations,
  };
}

/**
 * Lấy ngẫu nhiên tối đa `maxQuestions` câu hỏi theo tỷ lệ Chuyên đề & Dạng câu hỏi từ ngân hàng
 * và xáo trộn thứ tự câu hỏi.
 */
export function buildMockExamQuestionPool(
  bank: Question[],
  maxQuestions: number = MOCK_EXAM_MAX_QUESTIONS,
  randomFn: () => number = Math.random
): Question[] {
  return buildProportionalExamPool(bank, maxQuestions, randomFn).questions;
}

/**
 * Định dạng đồng hồ đếm ngược MM:SS (ví dụ: 50:00, 04:59, 00:00)
 */
export function formatCountdownClock(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Quy đổi điểm chuẩn phòng thi Certiport (Thang 0 - 1000, điểm đạt chuẩn là >= 700/1000)
 */
export function calculateCertiportScore(correctCount: number, totalQuestions: number): number {
  if (totalQuestions <= 0) return 0;
  return Math.round((correctCount / totalQuestions) * 1000);
}

export interface ExamEvaluationSummary {
  score: number;
  totalQuestions: number;
  certiportScore: number;
  percentage: number;
  passed: boolean;
  answeredCount: number;
  unansweredCount: number;
  flaggedCount: number;
  resultsByQuestionId: Record<string, boolean>;
  wrongQuestionIds: string[];
  questionResults: MockExamQuestionResult[];
  topicBreakdown: BreakdownStatItem[];
  typeBreakdown: BreakdownStatItem[];
}

/**
 * Chấm điểm toàn diện bài Thi thử (Mock Exam) theo chuẩn Certiport:
 * - Quy tắc All-or-Nothing cho từng câu
 * - Quy đổi thang điểm 1000 (>= 700/1000 là ĐẠT - PASS)
 * - Thống kê tỷ lệ đúng theo từng Chuyên đề và từng Dạng câu hỏi
 * - Lưu chi tiết từng câu đúng/sai kèm câu trả lời của học sinh
 */
export function evaluateExamSet(
  questions: Question[],
  answers: Record<string, UserAnswer>,
  flaggedMap: Record<string, boolean> = {}
): ExamEvaluationSummary {
  const resultsByQuestionId: Record<string, boolean> = {};
  const wrongQuestionIds: string[] = [];
  const questionResults: MockExamQuestionResult[] = [];

  let score = 0;
  let answeredCount = 0;
  let flaggedCount = 0;

  const topicMap = new Map<string, { label: string; correct: number; total: number }>();
  for (const t of CERTIPORT_TOPICS) {
    topicMap.set(t, { label: t, correct: 0, total: 0 });
  }

  const typeOrder: QuestionType[] = [
    'mcq_single',
    'mcq_multiple',
    'dropdown',
    'matching',
    'ordering',
  ];
  const typeMap = new Map<QuestionType, { label: string; correct: number; total: number }>();
  for (const qt of typeOrder) {
    typeMap.set(qt, { label: QUESTION_TYPE_LABELS[qt], correct: 0, total: 0 });
  }

  questions.forEach((q, idx) => {
    const rawAns = answers[q.id];
    const answered = isQuestionAnswered(q, rawAns);
    const flagged = Boolean(flaggedMap[q.id]);
    const isCorrect = evaluateQuestion(q, rawAns);

    resultsByQuestionId[q.id] = isCorrect;
    if (answered) answeredCount += 1;
    if (flagged) flaggedCount += 1;

    if (isCorrect) {
      score += 1;
    } else {
      wrongQuestionIds.push(q.id);
    }

    questionResults.push({
      questionId: q.id,
      orderNumber: idx + 1,
      topic: q.topic,
      type: q.type,
      prompt: q.prompt,
      answered,
      flagged,
      isCorrect,
      userAnswer: rawAns !== undefined ? rawAns : null,
    });

    // Cập nhật thống kê theo Chuyên đề
    const tStat = topicMap.get(q.topic) ?? {
      label: q.topic,
      correct: 0,
      total: 0,
    };
    tStat.total += 1;
    if (isCorrect) tStat.correct += 1;
    topicMap.set(q.topic, tStat);

    // Cập nhật thống kê theo Dạng câu hỏi
    const qtStat = typeMap.get(q.type) ?? {
      label: QUESTION_TYPE_LABELS[q.type] || q.type,
      correct: 0,
      total: 0,
    };
    qtStat.total += 1;
    if (isCorrect) qtStat.correct += 1;
    typeMap.set(q.type, qtStat);
  });

  const totalQuestions = questions.length;
  const certiportScore = calculateCertiportScore(score, totalQuestions);
  const percentage = totalQuestions > 0 ? Math.round((score / totalQuestions) * 100) : 0;
  const passed = certiportScore >= CERTIPORT_PASS_SCORE;
  const unansweredCount = Math.max(0, totalQuestions - answeredCount);

  const topicBreakdown: BreakdownStatItem[] = Array.from(topicMap.entries())
    .filter(([, val]) => val.total > 0)
    .map(([key, val]) => ({
      key,
      label: val.label,
      correct: val.correct,
      total: val.total,
      percentage: Math.round((val.correct / val.total) * 100),
    }));

  const typeBreakdown: BreakdownStatItem[] = Array.from(typeMap.entries())
    .filter(([, val]) => val.total > 0)
    .map(([key, val]) => ({
      key,
      label: val.label,
      correct: val.correct,
      total: val.total,
      percentage: Math.round((val.correct / val.total) * 100),
    }));

  return {
    score,
    totalQuestions,
    certiportScore,
    percentage,
    passed,
    answeredCount,
    unansweredCount,
    flaggedCount,
    resultsByQuestionId,
    wrongQuestionIds,
    questionResults,
    topicBreakdown,
    typeBreakdown,
  };
}
