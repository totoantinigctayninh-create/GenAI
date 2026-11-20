import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SessionAttemptRecord,
  ViolationEventRecord,
} from '../types/examSession';
import {
  buildLiveViolationTimeline,
  filterLiveViolationTimeline,
  formatAwayDurationVietnamese,
  formatExactViolationTimestamp,
  formatLatestViolationInlineSummary,
} from './liveProctoringUtils';

const MOCK_ATTEMPTS: SessionAttemptRecord[] = [
  {
    id: 'att_1',
    sessionId: 'sess_1',
    sessionCode: 'ABC123',
    sessionTitle: 'Kiểm tra GenAI',
    studentId: 'hs_1',
    username: 'hs01',
    fullName: 'Nguyễn Minh Khôi',
    className: '12A1',
    generatedQuestions: [],
    startedAt: '2026-11-19T08:00:00.000Z',
    deadlineAt: '2026-11-19T08:50:00.000Z',
    submittedAt: null,
    submitReason: null,
    score: null,
    correctCount: null,
    totalQuestions: 45,
    percentage: null,
    passed: null,
    reentryCount: 0,
    reentryAllowed: false,
    violationCount: 2,
    activeSessionToken: 'tok1',
    activeDeviceId: 'dev1',
    status: 'in_progress',
  },
  {
    id: 'att_2',
    sessionId: 'sess_1',
    sessionCode: 'ABC123',
    sessionTitle: 'Kiểm tra GenAI',
    studentId: 'hs_2',
    username: 'hs02',
    fullName: 'Trần Thảo Vy',
    className: '12A1',
    generatedQuestions: [],
    startedAt: '2026-11-19T08:00:00.000Z',
    deadlineAt: '2026-11-19T08:50:00.000Z',
    submittedAt: '2026-11-19T08:12:00.000Z',
    submitReason: 'violation',
    score: 400,
    correctCount: 18,
    totalQuestions: 45,
    percentage: 40,
    passed: false,
    reentryCount: 0,
    reentryAllowed: false,
    violationCount: 3,
    activeSessionToken: null,
    activeDeviceId: 'dev2',
    status: 'submitted',
  },
];

const MOCK_VIOLATIONS: ViolationEventRecord[] = [
  {
    id: 'v_1',
    attemptId: 'att_1',
    sessionId: 'sess_1',
    studentId: 'hs_1',
    type: 'phim_bi_chan',
    occurredAt: '2026-11-19T08:05:10.000Z',
    awaySeconds: 0,
    currentQuestionOrder: 3,
    note: 'F12',
  },
  {
    id: 'v_2',
    attemptId: 'att_1',
    sessionId: 'sess_1',
    studentId: 'hs_1',
    type: 'tab_switch',
    occurredAt: '2026-11-19T08:08:25.000Z',
    awaySeconds: 14,
    currentQuestionOrder: 7,
    note: 'Chuyển tab hoặc ẩn trình duyệt',
  },
  {
    id: 'v_3',
    attemptId: 'att_2',
    sessionId: 'sess_1',
    studentId: 'hs_2',
    type: 'window_blur',
    occurredAt: '2026-11-19T08:11:59.000Z',
    awaySeconds: 65,
    currentQuestionOrder: 12,
    note: 'Alt+Tab',
  },
];

test('formatExactViolationTimestamp formats HH:mm:ss and dd/MM/yyyy reliably', () => {
  const res = formatExactViolationTimestamp('2026-11-19T08:08:25.000Z');
  assert.match(res.time, /^\d{2}:\d{2}:\d{2}$/);
  assert.match(res.date, /^\d{2}\/\d{2}\/\d{4}$/);
  assert.ok(res.full.includes(res.time));
  assert.equal(formatExactViolationTimestamp('invalid').time, '--:--:--');
});

test('formatAwayDurationVietnamese formats seconds and minutes cleanly', () => {
  assert.equal(formatAwayDurationVietnamese(0), '');
  assert.equal(formatAwayDurationVietnamese(14), '14 giây');
  assert.equal(formatAwayDurationVietnamese(65), '1p 5s');
  assert.equal(formatAwayDurationVietnamese(120), '2 phút');
});

test('buildLiveViolationTimeline sorts newest first and classifies severity accurately', () => {
  const timeline = buildLiveViolationTimeline(MOCK_VIOLATIONS, MOCK_ATTEMPTS, 3);
  assert.equal(timeline.length, 3);
  assert.deepEqual(
    timeline.map((t) => t.id),
    ['v_3', 'v_2', 'v_1']
  );

  // v_3 caused auto-submit at 3/3 -> critical
  assert.equal(timeline[0].severity, 'critical');
  assert.equal(timeline[0].isAutoSubmitTrigger, true);
  assert.equal(timeline[0].studentName, 'Trần Thảo Vy');

  // v_2 is tab_switch at 2/3 -> warning
  assert.equal(timeline[1].severity, 'warning');
  assert.equal(timeline[1].countsTowardLimit, true);
  assert.equal(timeline[1].awaySeconds, 14);

  // v_1 is blocked key -> info (does not count toward auto-submit limit)
  assert.equal(timeline[2].severity, 'info');
  assert.equal(timeline[2].countsTowardLimit, false);
});

test('filterLiveViolationTimeline filters by category and search query', () => {
  const timeline = buildLiveViolationTimeline(MOCK_VIOLATIONS, MOCK_ATTEMPTS, 3);
  assert.equal(
    filterLiveViolationTimeline(timeline, { category: 'screen_leave' }).length,
    2
  );
  assert.equal(
    filterLiveViolationTimeline(timeline, { category: 'blocked_action' }).length,
    1
  );
  assert.equal(
    filterLiveViolationTimeline(timeline, {
      category: 'all',
      searchQuery: 'f12',
    }).length,
    1
  );
  assert.equal(
    filterLiveViolationTimeline(timeline, {
      category: 'all',
      studentUsername: 'hs02',
    }).length,
    1
  );
});

test('formatLatestViolationInlineSummary includes exact time, label, and away duration', () => {
  const summary = formatLatestViolationInlineSummary(MOCK_VIOLATIONS[1]);
  assert.ok(summary !== null);
  assert.ok(summary.includes('Chuyển tab / Ẩn trình duyệt'));
  assert.ok(summary.includes('14 giây'));
  assert.equal(formatLatestViolationInlineSummary(undefined), null);
});
