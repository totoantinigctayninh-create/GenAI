import test from 'node:test';
import assert from 'node:assert/strict';
import { TEST_FIXTURE_QUESTIONS } from '../data/seedData';
import { evaluateQuestion } from './scoring';
import {
  applyImageToQuestion,
  autoDistributeExamSets,
  buildQuestionFromDraft,
  buildSampleExcelWorkbookBytes,
  createDraftFromQuestion,
  createEmptyQuestionDraft,
  exportQuestionsToExcelBytes,
  parseQuestionsFromExcelBytes,
  parseQuestionsFromJson,
  serializeQuestionsToJson,
} from './questionBankUtils';

test('autoDistributeExamSets divides 175 questions into Đề 1..Đề 5 with 35 questions each', () => {
  const mock175 = Array.from({ length: 175 }, (_, idx) => ({
    ...TEST_FIXTURE_QUESTIONS[idx % TEST_FIXTURE_QUESTIONS.length],
    id: `q_${idx + 1}`,
  }));

  const { updatedQuestions, summary } = autoDistributeExamSets(mock175, {
    strategy: 'by_size',
    questionsPerSet: 35,
  });

  assert.equal(updatedQuestions.length, 175);
  assert.equal(summary.length, 5);
  assert.deepEqual(
    summary.map((s) => ({ examSet: s.examSet, count: s.count })),
    [
      { examSet: 'Đề 1', count: 35 },
      { examSet: 'Đề 2', count: 35 },
      { examSet: 'Đề 3', count: 35 },
      { examSet: 'Đề 4', count: 35 },
      { examSet: 'Đề 5', count: 35 },
    ]
  );
});

test('autoDistributeExamSets balanced strategy divides questions evenly across 5 exam sets', () => {
  const { updatedQuestions, summary } = autoDistributeExamSets(TEST_FIXTURE_QUESTIONS, {
    strategy: 'by_set_count',
    targetSetCount: 5,
  });

  assert.equal(updatedQuestions.length, TEST_FIXTURE_QUESTIONS.length);
  assert.equal(summary.length, 5);
  const totalAssigned = summary.reduce((acc, s) => acc + s.count, 0);
  assert.equal(totalAssigned, TEST_FIXTURE_QUESTIONS.length);
});

test('createDraftFromQuestion and buildQuestionFromDraft round-trip all 5 question types and preserve imageUrl', () => {
  for (const seedQ of TEST_FIXTURE_QUESTIONS) {
    const draft = createDraftFromQuestion({
      ...seedQ,
      imageUrl:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    });
    const rebuilt = buildQuestionFromDraft(draft);
    assert.equal(rebuilt.id, seedQ.id);
    assert.equal(rebuilt.type, seedQ.type);
    assert.ok(rebuilt.imageUrl?.startsWith('data:image/png;base64,'));
    assert.equal(evaluateQuestion(rebuilt, rebuilt.correctAnswer), true);
  }
});

test('applyImageToQuestion attaches, updates, and removes imageUrl on any question in the bank', () => {
  const baseQ = TEST_FIXTURE_QUESTIONS[0];
  const sampleBase64 =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

  const withImg = applyImageToQuestion(baseQ, sampleBase64);
  assert.equal(withImg.imageUrl, sampleBase64);

  const clearedImg = applyImageToQuestion(withImg, '   ');
  assert.equal(clearedImg.imageUrl, undefined);
});

test('buildQuestionFromDraft validates required prompt and options', () => {
  const emptyDraft = createEmptyQuestionDraft(99);
  assert.throws(() => buildQuestionFromDraft(emptyDraft), /Vui lòng nhập nội dung câu hỏi/);
});

test('serializeQuestionsToJson and parseQuestionsFromJson round-trip all questions', () => {
  const json = serializeQuestionsToJson(TEST_FIXTURE_QUESTIONS);
  const parsed = parseQuestionsFromJson(json);
  assert.equal(parsed.length, TEST_FIXTURE_QUESTIONS.length);
  for (const q of parsed) {
    assert.equal(evaluateQuestion(q, q.correctAnswer), true);
  }
});

test('SheetJS sample Excel (.xlsx) generation and parsing produces 5 valid Certiport questions', () => {
  const bytes = buildSampleExcelWorkbookBytes();
  assert.ok(bytes.byteLength > 1000);

  const imported = parseQuestionsFromExcelBytes(bytes);
  assert.equal(imported.length, 5);
  assert.deepEqual(
    imported.map((q) => q.type),
    ['mcq_single', 'mcq_multiple', 'dropdown', 'matching', 'ordering']
  );

  for (const q of imported) {
    assert.equal(evaluateQuestion(q, q.correctAnswer), true);
  }
});

test('SheetJS exportQuestionsToExcelBytes and parseQuestionsFromExcelBytes round-trip questions including imageUrl', () => {
  const questionsWithImages = TEST_FIXTURE_QUESTIONS.map((q, idx) =>
    idx === 0
      ? applyImageToQuestion(q, 'https://example.com/certiport-diagram-1.png')
      : q
  );
  const bytes = exportQuestionsToExcelBytes(questionsWithImages);
  const reimported = parseQuestionsFromExcelBytes(bytes);
  assert.equal(reimported.length, TEST_FIXTURE_QUESTIONS.length);
  assert.equal(reimported[0].imageUrl, 'https://example.com/certiport-diagram-1.png');
  for (const q of reimported) {
    assert.equal(evaluateQuestion(q, q.correctAnswer), true);
  }
});
