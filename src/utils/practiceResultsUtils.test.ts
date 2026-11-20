import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { ExamAttempt, Question, UserAccount } from '../types/exam';
import {
  buildPracticeResultsExcelBytes,
  computePracticeAnalytics,
  enrichPracticeAttempts,
  filterAndSortPracticeAttempts,
  formatAnswerReadable,
} from './practiceResultsUtils';

const MOCK_USERS: UserAccount[] = [
  {
    id: 'hs1',
    username: 'hs01',
    password: '123',
    fullName: 'Nguyễn Minh An',
    role: 'student',
    className: '12A1',
    lastLogin: '2026-05-01T08:00:00.000Z',
    status: 'online',
    totalStudyMinutes: 40,
  },
  {
    id: 'hs2',
    username: 'hs02',
    password: '123',
    fullName: 'Trần Bảo Châu',
    role: 'student',
    className: '12A2',
    lastLogin: '2026-05-01T08:00:00.000Z',
    status: 'offline',
    totalStudyMinutes: 30,
  },
];

const MOCK_QUESTIONS: Question[] = [
  {
    id: 'q1',
    type: 'mcq_single',
    topic: '1. Tổng quan & Mô hình GenAI',
    examSet: 'Đề 1',
    prompt: 'LLM là viết tắt của cụm từ nào?',
    options: [
      { id: 'a', text: 'Large Language Model' },
      { id: 'b', text: 'Local Logic Machine' },
    ],
    correctAnswer: 'a',
    explanation: 'Large Language Model.',
  },
  {
    id: 'q2',
    type: 'ordering',
    topic: '2. Kỹ thuật viết Prompt',
    examSet: 'Đề 1',
    prompt: 'Sắp xếp các bước tạo prompt hiệu quả',
    steps: [
      { id: 's1', text: 'Xác định mục tiêu' },
      { id: 's2', text: 'Cung cấp ngữ cảnh' },
    ],
    correctAnswer: ['s1', 's2'],
    explanation: 'Đi từ mục tiêu đến ngữ cảnh.',
  },
];

const MOCK_ATTEMPTS: ExamAttempt[] = [
  {
    id: 'att1',
    userId: 'hs1',
    username: 'hs01',
    fullName: 'Nguyễn Minh An',
    examSet: 'Đề 1',
    mode: 'Thi thử Đề 1',
    correctCount: 30,
    totalQuestions: 45,
    certiportScore: 667,
    percentage: 67,
    passed: false,
    durationSeconds: 1500,
    completedAt: '2026-05-01T08:00:00.000Z',
    topicBreakdown: [
      { key: 't1', label: '1. Tổng quan & Mô hình GenAI', correct: 8, total: 10, percentage: 80 },
      { key: 't2', label: '2. Kỹ thuật viết Prompt', correct: 5, total: 10, percentage: 50 },
    ],
  },
  {
    id: 'att2',
    userId: 'hs1',
    username: 'hs01',
    fullName: 'Nguyễn Minh An',
    examSet: 'Đề 2',
    mode: 'Thi thử Đề 2',
    correctCount: 38,
    totalQuestions: 45,
    certiportScore: 844,
    percentage: 84,
    passed: true,
    durationSeconds: 1800,
    completedAt: '2026-05-05T08:00:00.000Z',
    topicBreakdown: [
      { key: 't1', label: '1. Tổng quan & Mô hình GenAI', correct: 9, total: 10, percentage: 90 },
      { key: 't2', label: '2. Kỹ thuật viết Prompt', correct: 7, total: 10, percentage: 70 },
    ],
  },
  {
    id: 'att3',
    userId: 'hs2',
    username: 'hs02',
    fullName: 'Trần Bảo Châu',
    examSet: 'Kiểm tra giữa kỳ',
    mode: 'Ca thi: Kiểm tra giữa kỳ (AB12CD)',
    correctCount: 41,
    totalQuestions: 45,
    certiportScore: 911,
    percentage: 91,
    passed: true,
    durationSeconds: 1200,
    completedAt: '2026-05-06T09:00:00.000Z',
    topicBreakdown: [
      { key: 't1', label: '1. Tổng quan & Mô hình GenAI', correct: 10, total: 10, percentage: 100 },
      { key: 't2', label: '2. Kỹ thuật viết Prompt', correct: 4, total: 10, percentage: 40 },
    ],
  },
];

test('enrichPracticeAttempts maps user classes and detects practice vs live_session source', () => {
  const enriched = enrichPracticeAttempts(MOCK_ATTEMPTS, MOCK_USERS);
  assert.equal(enriched.length, 3);
  assert.equal(enriched[0].className, '12A1');
  assert.equal(enriched[0].source, 'practice');
  assert.equal(enriched[2].className, '12A2');
  assert.equal(enriched[2].source, 'live_session');
});

test('filterAndSortPracticeAttempts filters by class, source, result, score bin, and sorts properly', () => {
  const enriched = enrichPracticeAttempts(MOCK_ATTEMPTS, MOCK_USERS);

  const onlyPass = filterAndSortPracticeAttempts(enriched, {
    searchQuery: '',
    classFilter: 'ALL',
    sourceFilter: 'ALL',
    examSetFilter: 'ALL',
    resultFilter: 'PASS',
    dateRangeFilter: 'ALL',
    scoreBinIndex: null,
    sortField: 'score',
    sortDirection: 'desc',
    nowMs: new Date('2026-05-07T00:00:00.000Z').getTime(),
  });
  assert.deepEqual(
    onlyPass.map((r) => r.id),
    ['att3', 'att2']
  );

  const bin900 = filterAndSortPracticeAttempts(enriched, {
    searchQuery: '',
    classFilter: 'ALL',
    sourceFilter: 'live_session',
    examSetFilter: 'ALL',
    resultFilter: 'ALL',
    dateRangeFilter: '7D',
    scoreBinIndex: 9,
    sortField: 'completedAt',
    sortDirection: 'desc',
    nowMs: new Date('2026-05-07T00:00:00.000Z').getTime(),
  });
  assert.equal(bin900.length, 1);
  assert.equal(bin900[0].id, 'att3');
});

test('computePracticeAnalytics calculates KPIs, weakest topic, and improvement delta accurately', () => {
  const enriched = enrichPracticeAttempts(MOCK_ATTEMPTS, MOCK_USERS);
  const analytics = computePracticeAnalytics(enriched, MOCK_QUESTIONS);

  assert.equal(analytics.totalAttempts, 3);
  assert.equal(analytics.uniqueStudents, 2);
  assert.equal(analytics.passCount, 2);
  assert.equal(analytics.failCount, 1);
  assert.equal(analytics.passRatePercent, 67);
  assert.equal(analytics.maxScore, 911);
  assert.equal(analytics.minScore, 667);
  assert.equal(analytics.medianScore, 844);
  assert.equal(analytics.weakestTopic?.topic, '2. Kỹ thuật viết Prompt');
  assert.equal(analytics.weakestTopic?.accuracyPercent, 53);

  const hs1Row = analytics.leaderboard.find((r) => r.username === 'hs01');
  assert.ok(hs1Row);
  assert.equal(hs1Row.attemptCount, 2);
  assert.equal(hs1Row.improvementDelta, 844 - 667);
});

test('formatAnswerReadable formats mcq and ordering answers cleanly', () => {
  assert.equal(
    formatAnswerReadable('a', MOCK_QUESTIONS[0]),
    'A. Large Language Model'
  );
  assert.equal(
    formatAnswerReadable(['s1', 's2'], MOCK_QUESTIONS[1]),
    '1. Xác định mục tiêu → 2. Cung cấp ngữ cảnh'
  );
  assert.equal(formatAnswerReadable(null, MOCK_QUESTIONS[0]), 'Chưa trả lời');
});

test('buildPracticeResultsExcelBytes generates a valid 3-sheet workbook', async () => {
  const enriched = enrichPracticeAttempts(MOCK_ATTEMPTS, MOCK_USERS);
  const analytics = computePracticeAnalytics(enriched, MOCK_QUESTIONS);
  const bytes = await buildPracticeResultsExcelBytes(enriched, analytics);
  const wb = XLSX.read(bytes, { type: 'array' });

  assert.deepEqual(wb.SheetNames, [
    'Lich_Su_Luot_Thi',
    'Tong_Hop_Hoc_Sinh',
    'Phan_Tich_Chuyen_De',
  ]);
  const sheet1Rows = XLSX.utils.sheet_to_json(wb.Sheets['Lich_Su_Luot_Thi']);
  assert.equal(sheet1Rows.length, 3);
});
