import test from 'node:test';
import assert from 'node:assert/strict';
import { ExamSessionRecord } from '../types/examSession';
import { LiveStudentMonitoringRow } from './liveExamHelpers';
import {
  buildSessionShareMessage,
  computeExamSessionsOverviewStats,
  EXAM_SESSION_PRESETS,
  filterAndSortExamSessions,
  filterLiveMonitoringRowsByStatus,
} from './examSessionQuickHelpers';

const MOCK_SESSIONS: ExamSessionRecord[] = [
  {
    id: 's1',
    code: 'AB12CD',
    title: 'Kiểm tra 15 phút - Lớp 12A1',
    createdBy: 'admin',
    createdByName: 'Giáo viên Quản trị',
    targetClass: '12A1',
    questionCount: 15,
    durationMinutes: 15,
    selectionMode: 'proportional',
    shuffleQuestions: true,
    shuffleOptions: true,
    openAt: null,
    closeAt: null,
    maxViolations: 3,
    passScore: 700,
    resultVisibility: 'score_only',
    status: 'open',
    createdAt: '2026-05-01T08:00:00.000Z',
    updatedAt: '2026-05-01T08:00:00.000Z',
    enteredCount: 25,
    inProgressCount: 20,
    submittedCount: 5,
  },
  {
    id: 's2',
    code: 'XY98ZT',
    title: 'Thi thử Certiport - Toàn trường',
    createdBy: 'admin',
    createdByName: 'Giáo viên Quản trị',
    targetClass: 'ALL',
    questionCount: 45,
    durationMinutes: 50,
    selectionMode: 'proportional',
    shuffleQuestions: true,
    shuffleOptions: true,
    openAt: null,
    closeAt: null,
    maxViolations: 3,
    passScore: 700,
    resultVisibility: 'score_and_answers',
    status: 'ended',
    createdAt: '2026-05-03T08:00:00.000Z',
    updatedAt: '2026-05-03T09:00:00.000Z',
    enteredCount: 40,
    inProgressCount: 0,
    submittedCount: 40,
  },
];

test('EXAM_SESSION_PRESETS provides 4 valid Vietnamese presets', () => {
  assert.equal(EXAM_SESSION_PRESETS.length, 4);
  assert.equal(EXAM_SESSION_PRESETS[0].questionCount, 45);
  assert.equal(EXAM_SESSION_PRESETS[0].durationMinutes, 50);
});

test('computeExamSessionsOverviewStats aggregates counts cleanly', () => {
  const stats = computeExamSessionsOverviewStats(MOCK_SESSIONS);
  assert.equal(stats.totalSessions, 2);
  assert.equal(stats.openCount, 1);
  assert.equal(stats.endedCount, 1);
  assert.equal(stats.activeStudentsNow, 20);
  assert.equal(stats.totalEnteredStudents, 65);
  assert.equal(stats.totalSubmittedScripts, 45);
});

test('filterAndSortExamSessions filters by class and sorts by active_students', () => {
  const byActive = filterAndSortExamSessions(MOCK_SESSIONS, {
    statusFilter: 'ALL',
    classFilter: 'ALL',
    searchQuery: '',
    sortBy: 'active_students',
  });
  assert.deepEqual(
    byActive.map((s) => s.id),
    ['s1', 's2']
  );

  const byClass = filterAndSortExamSessions(MOCK_SESSIONS, {
    statusFilter: 'ALL',
    classFilter: '12A1',
    searchQuery: 'ab12',
    sortBy: 'newest',
  });
  assert.equal(byClass.length, 1);
  assert.equal(byClass[0].code, 'AB12CD');
});

test('buildSessionShareMessage includes session code, title, and structure', () => {
  const msg = buildSessionShareMessage(MOCK_SESSIONS[0]);
  assert.ok(msg.includes('AB12CD'));
  assert.ok(msg.includes('15 câu'));
  assert.ok(msg.includes('Lớp 12A1'));
});

test('filterLiveMonitoringRowsByStatus filters live rows accurately', () => {
  const rows: LiveStudentMonitoringRow[] = [
    {
      rowKey: '1',
      studentId: 'u1',
      username: 'hs01',
      fullName: 'An',
      className: '12A1',
      status: 'in_progress',
      answeredCount: 10,
      totalQuestions: 45,
      progressPercent: 22,
      remainingSeconds: 1000,
      violationCount: 2,
      violationSeverity: 'warning',
      recentViolations: [],
      reentryCount: 0,
    },
    {
      rowKey: '2',
      studentId: 'u2',
      username: 'hs02',
      fullName: 'Binh',
      className: '12A1',
      status: 'submitted',
      answeredCount: 45,
      totalQuestions: 45,
      progressPercent: 100,
      remainingSeconds: 0,
      violationCount: 0,
      violationSeverity: 'normal',
      recentViolations: [],
      reentryCount: 0,
    },
    {
      rowKey: '3',
      studentId: 'u3',
      username: 'hs03',
      fullName: 'Chi',
      className: '12A1',
      status: 'not_entered',
      answeredCount: 0,
      totalQuestions: 45,
      progressPercent: 0,
      remainingSeconds: null,
      violationCount: 0,
      violationSeverity: 'normal',
      recentViolations: [],
      reentryCount: 0,
    },
  ];

  assert.equal(filterLiveMonitoringRowsByStatus(rows, 'in_progress').length, 1);
  assert.equal(filterLiveMonitoringRowsByStatus(rows, 'submitted').length, 1);
  assert.equal(filterLiveMonitoringRowsByStatus(rows, 'not_entered').length, 1);
  assert.equal(filterLiveMonitoringRowsByStatus(rows, 'violations').length, 1);
  assert.equal(filterLiveMonitoringRowsByStatus(rows, 'all').length, 3);
});
