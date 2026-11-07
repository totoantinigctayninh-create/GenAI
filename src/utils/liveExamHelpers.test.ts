import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLiveStudentMonitoringRows,
  computeServerClockOffsetMs,
  computeServerRemainingSeconds,
  detectBlockedKeyShortcut,
  doesViolationCountTowardLimit,
  evaluateViolationPolicy,
  formatSingleSummaryLine,
  getViolationSeverityLevel,
  hasCorrectAnswerLeakInPayload,
  isSuspiciousSplitScreenResize,
  mergeServerAndLocalAnswers,
  toClientRenderableQuestion,
  validateCreateExamSessionForm,
} from './liveExamHelpers';
import { isQuestionAnswered } from './scoring';

test('toClientRenderableQuestion maps SanitizedStudentQuestion cleanly for all question types without leaking answers', () => {
  const sanitizedMatching = {
    id: 'Q10',
    orderNumber: 1,
    type: 'matching' as const,
    topic: '1. Tổng quan & Mô hình GenAI',
    examSet: 'Đề 1',
    prompt: 'Nối khái niệm tương ứng',
    matchingLeftItems: [
      { id: 'p1', left: 'LLM' },
      { id: 'p2', left: 'RAG' },
    ],
    matchingRightChoices: ['Truy xuất tăng cường', 'Mô hình ngôn ngữ lớn'],
  };

  const clientQ = toClientRenderableQuestion(sanitizedMatching);
  assert.equal(clientQ.id, 'Q10');
  assert.equal(clientQ.correctAnswer, '');
  assert.equal(clientQ.explanation, '');
  assert.equal(clientQ.pairs?.length, 2);
  assert.equal(
    isQuestionAnswered(clientQ, {
      p1: 'Mô hình ngôn ngữ lớn',
      p2: 'Truy xuất tăng cường',
    }),
    true
  );
  assert.equal(isQuestionAnswered(clientQ, { p1: 'Mô hình ngôn ngữ lớn' }), false);
});

test('computeServerClockOffsetMs and computeServerRemainingSeconds handle server clock skew accurately', () => {
  const clientNow = new Date('2026-11-06T10:00:00.000Z').getTime();
  // Máy chủ nhanh hơn trình duyệt 10 giây
  const serverNowIso = '2026-11-06T10:00:10.000Z';
  const deadlineIso = '2026-11-06T10:05:10.000Z'; // Còn đúng 300 giây theo đồng hồ máy chủ

  const offsetMs = computeServerClockOffsetMs(serverNowIso, clientNow);
  assert.equal(offsetMs, 10_000);

  const remaining = computeServerRemainingSeconds(
    deadlineIso,
    offsetMs,
    clientNow
  );
  assert.equal(remaining, 300);

  // Sau 305 giây ở trình duyệt -> hết giờ (0 giây)
  const afterExpired = computeServerRemainingSeconds(
    deadlineIso,
    offsetMs,
    clientNow + 305_000
  );
  assert.equal(afterExpired, 0);
});

test('mergeServerAndLocalAnswers preserves unsynced offline answers and flags dirtyQuestionIds', () => {
  const serverSaved = {
    Q1: {
      selectedAnswer: 'A',
      flagged: false,
      timeSpentSeconds: 12,
      savedAt: '2026-11-06T10:01:00.000Z',
    },
    Q2: {
      selectedAnswer: 'B',
      flagged: true,
      timeSpentSeconds: 8,
      savedAt: '2026-11-06T10:01:30.000Z',
    },
  };

  const localBackup = {
    // Q1 được sửa khi mất mạng (dirty: true)
    Q1: {
      selectedAnswer: 'C',
      flagged: true,
      timeSpentSeconds: 20,
      dirty: true,
      updatedAtMs: new Date('2026-11-06T10:02:00.000Z').getTime(),
    },
    // Q3 mới làm trên máy khi mất mạng
    Q3: {
      selectedAnswer: ['A', 'D'],
      flagged: false,
      timeSpentSeconds: 15,
      dirty: true,
      updatedAtMs: new Date('2026-11-06T10:02:10.000Z').getTime(),
    },
  };

  const merged = mergeServerAndLocalAnswers(serverSaved, localBackup);
  assert.equal(merged.answersMap.Q1, 'C');
  assert.equal(merged.flaggedMap.Q1, true);
  assert.equal(merged.timeSpentMap.Q1, 20);

  assert.equal(merged.answersMap.Q2, 'B');
  assert.equal(merged.flaggedMap.Q2, true);
  assert.equal(merged.timeSpentMap.Q2, 8);

  assert.deepEqual(merged.answersMap.Q3, ['A', 'D']);
  assert.deepEqual(merged.dirtyQuestionIds.sort(), ['Q1', 'Q3']);
});

test('hasCorrectAnswerLeakInPayload detects any accidental correctAnswer or explanation fields', () => {
  const safePayload = {
    ok: true,
    questions: [
      { id: 'Q1', prompt: 'Hello', options: [{ id: 'A', text: 'Opt A' }] },
    ],
  };
  assert.equal(hasCorrectAnswerLeakInPayload(safePayload), false);

  const leakyPayload = {
    ok: true,
    questions: [{ id: 'Q1', prompt: 'Hello', correctAnswer: 'A' }],
  };
  assert.equal(hasCorrectAnswerLeakInPayload(leakyPayload), true);
});

test('detectBlockedKeyShortcut identifies Escape, F12, DevTools and Ctrl+C/V/P/S/U accurately', () => {
  assert.deepEqual(detectBlockedKeyShortcut({ key: 'Escape' }), {
    blocked: true,
    label: 'Escape',
    isEscape: true,
  });
  assert.deepEqual(detectBlockedKeyShortcut({ key: 'F12' }), {
    blocked: true,
    label: 'F12',
    isEscape: false,
  });
  assert.deepEqual(
    detectBlockedKeyShortcut({ key: 'i', ctrlKey: true, shiftKey: true }),
    {
      blocked: true,
      label: 'Ctrl+Shift+I',
      isEscape: false,
    }
  );
  for (const k of ['c', 'v', 'x', 'p', 's', 'u']) {
    assert.deepEqual(detectBlockedKeyShortcut({ key: k, ctrlKey: true }), {
      blocked: true,
      label: `Ctrl+${k.toUpperCase()}`,
      isEscape: false,
    });
  }
  assert.deepEqual(detectBlockedKeyShortcut({ key: 'ArrowRight' }), {
    blocked: false,
    label: '',
    isEscape: false,
  });
});

test('evaluateViolationPolicy and doesViolationCountTowardLimit distinguish blocked keys from screen-leaving violations', () => {
  assert.equal(doesViolationCountTowardLimit('phim_bi_chan'), false);
  assert.equal(doesViolationCountTowardLimit('blocked_key'), false);
  assert.equal(doesViolationCountTowardLimit('tab_switch'), true);
  assert.equal(doesViolationCountTowardLimit('window_blur'), true);
  assert.equal(doesViolationCountTowardLimit('fullscreen_exit'), true);

  // Phím bị chặn không làm tăng violationCount
  const blockedRes = evaluateViolationPolicy(1, 3, 'phim_bi_chan');
  assert.equal(blockedRes.countsTowardLimit, false);
  assert.equal(blockedRes.nextViolationCount, 1);
  assert.equal(blockedRes.shouldAutoSubmit, false);

  // Lần 2/3 -> cảnh báo đỏ lần cuối trước ngưỡng
  const secondRes = evaluateViolationPolicy(1, 3, 'tab_switch');
  assert.equal(secondRes.countsTowardLimit, true);
  assert.equal(secondRes.nextViolationCount, 2);
  assert.equal(secondRes.isLastWarningBeforeSubmit, true);
  assert.equal(secondRes.shouldAutoSubmit, false);

  // Lần 3/3 -> chạm ngưỡng -> tự động nộp bài
  const thirdRes = evaluateViolationPolicy(2, 3, 'fullscreen_exit');
  assert.equal(thirdRes.countsTowardLimit, true);
  assert.equal(thirdRes.nextViolationCount, 3);
  assert.equal(thirdRes.shouldAutoSubmit, true);
});

test('isSuspiciousSplitScreenResize detects split-screen window shrinking on desktop', () => {
  assert.equal(isSuspiciousSplitScreenResize(1920, 1080, 1920, 1080), false);
  assert.equal(isSuspiciousSplitScreenResize(960, 1080, 1920, 1080), true);
  // Trên màn hình điện thoại nhỏ (<768px) không coi bàn phím ảo là chia đôi màn hình
  assert.equal(isSuspiciousSplitScreenResize(390, 400, 390, 844), false);
});

test('validateCreateExamSessionForm validates required and advanced fields with specific Vietnamese error messages', () => {
  // 1. Dữ liệu hợp lệ mặc định
  const validRes = validateCreateExamSessionForm(
    {
      title: 'Kiểm tra học kỳ 1 - Khối 12',
      targetClass: 'ALL',
      questionCount: 45,
      durationMinutes: 50,
      selectionMode: 'proportional',
      maxViolations: 3,
      passScore: 700,
    },
    100
  );
  assert.equal(validRes.valid, true);
  assert.deepEqual(validRes.errors, {});

  // 2. Dữ liệu sai ở các ô bắt buộc và nâng cao
  const invalidRes = validateCreateExamSessionForm(
    {
      title: ' ',
      targetClass: '',
      questionCount: 0,
      durationMinutes: 400,
      selectionMode: 'proportional',
      openAt: '2026-11-10T10:00',
      closeAt: '2026-11-10T09:00',
      maxViolations: 0,
      passScore: 1200,
    },
    90
  );
  assert.equal(invalidRes.valid, false);
  assert.equal(Boolean(invalidRes.errors.title), true);
  assert.equal(Boolean(invalidRes.errors.targetClass), true);
  assert.equal(Boolean(invalidRes.errors.questionCount), true);
  assert.equal(Boolean(invalidRes.errors.durationMinutes), true);
  assert.equal(Boolean(invalidRes.errors.closeAt), true);
  assert.equal(Boolean(invalidRes.errors.maxViolations), true);
  assert.equal(Boolean(invalidRes.errors.passScore), true);

  // 3. Chế độ chọn thủ công nhưng chưa tích chọn câu hỏi nào
  const manualInvalid = validateCreateExamSessionForm(
    {
      title: 'Ca thi chọn thủ công',
      targetClass: '12A1',
      questionCount: 10,
      durationMinutes: 30,
      selectionMode: 'manual',
      manualQuestionIds: [],
      maxViolations: 3,
      passScore: 700,
    },
    90
  );
  assert.equal(manualInvalid.valid, false);
  assert.equal(Boolean(manualInvalid.errors.manualQuestionIds), true);
});

test('Bước 6/8: getViolationSeverityLevel, formatSingleSummaryLine và buildLiveStudentMonitoringRows sắp xếp học sinh vi phạm nhiều lên đầu', () => {
  assert.equal(getViolationSeverityLevel(0, 3), 'normal');
  assert.equal(getViolationSeverityLevel(1, 3), 'normal');
  assert.equal(getViolationSeverityLevel(2, 3), 'warning');
  assert.equal(getViolationSeverityLevel(3, 3), 'exceeded');
  assert.equal(getViolationSeverityLevel(4, 3), 'exceeded');

  assert.equal(
    formatSingleSummaryLine({
      inProgressCount: 32,
      submittedCount: 5,
      notEnteredCount: 3,
    }),
    '32 đang thi, 5 đã nộp, 3 chưa vào'
  );

  const nowMs = new Date('2026-11-07T08:15:00.000Z').getTime();
  const rows = buildLiveStudentMonitoringRows({
    attempts: [
      {
        id: 'att_normal',
        sessionId: 's1',
        sessionCode: 'ABC234',
        sessionTitle: 'Test',
        studentId: 'hs_1',
        username: 'hs_1',
        fullName: 'An Nguyễn',
        className: '12A1',
        generatedQuestions: [],
        startedAt: '2026-11-07T08:00:00.000Z',
        deadlineAt: '2026-11-07T08:30:00.000Z',
        submittedAt: null,
        submitReason: null,
        score: null,
        correctCount: null,
        totalQuestions: 45,
        answeredCount: 15,
        percentage: null,
        passed: null,
        reentryCount: 0,
        reentryAllowed: false,
        violationCount: 0,
        activeSessionToken: 'tok1',
        activeDeviceId: 'dev1',
        status: 'in_progress',
      },
      {
        id: 'att_viol3',
        sessionId: 's1',
        sessionCode: 'ABC234',
        sessionTitle: 'Test',
        studentId: 'hs_2',
        username: 'hs_2',
        fullName: 'Bình Trần',
        className: '12A1',
        generatedQuestions: [],
        startedAt: '2026-11-07T08:00:00.000Z',
        deadlineAt: '2026-11-07T08:30:00.000Z',
        submittedAt: '2026-11-07T08:10:00.000Z',
        submitReason: 'violation',
        score: 400,
        correctCount: 18,
        totalQuestions: 45,
        answeredCount: 18,
        percentage: 40,
        passed: false,
        reentryCount: 0,
        reentryAllowed: false,
        violationCount: 3,
        activeSessionToken: null,
        activeDeviceId: null,
        status: 'submitted',
      },
      {
        id: 'att_viol2',
        sessionId: 's1',
        sessionCode: 'ABC234',
        sessionTitle: 'Test',
        studentId: 'hs_3',
        username: 'hs_3',
        fullName: 'Chi Lê',
        className: '12A1',
        generatedQuestions: [],
        startedAt: '2026-11-07T08:00:00.000Z',
        deadlineAt: '2026-11-07T08:30:00.000Z',
        submittedAt: null,
        submitReason: null,
        score: null,
        correctCount: null,
        totalQuestions: 45,
        answeredCount: 30,
        percentage: null,
        passed: null,
        reentryCount: 0,
        reentryAllowed: false,
        violationCount: 2,
        activeSessionToken: 'tok3',
        activeDeviceId: 'dev3',
        status: 'in_progress',
      },
    ],
    notEnteredStudents: [
      {
        studentId: 'hs_4',
        username: 'hs_4',
        fullName: 'Dũng Phạm',
        className: '12A1',
      },
    ],
    violations: [],
    maxViolations: 3,
    sessionQuestionCount: 45,
    clientNowMs: nowMs,
  });

  // Thứ tự: Bình Trần (3 vi phạm) -> Chi Lê (2 vi phạm) -> An Nguyễn (0 vi phạm, đang thi) -> Dũng Phạm (chưa vào)
  assert.deepEqual(
    rows.map((r) => r.studentId),
    ['hs_2', 'hs_3', 'hs_1', 'hs_4']
  );
  assert.equal(rows[0].violationSeverity, 'exceeded');
  assert.equal(rows[1].violationSeverity, 'warning');
  assert.equal(rows[2].violationSeverity, 'normal');

  // Bộ lọc "Chỉ hiện học sinh có vi phạm"
  const onlyViolRows = buildLiveStudentMonitoringRows({
    attempts: rows
      .filter((r) => r.status !== 'not_entered')
      .map((r) => ({
        id: r.attemptId!,
        sessionId: 's1',
        sessionCode: 'ABC234',
        sessionTitle: 'Test',
        studentId: r.studentId,
        username: r.username,
        fullName: r.fullName,
        className: r.className,
        generatedQuestions: [],
        startedAt: '2026-11-07T08:00:00.000Z',
        deadlineAt: '2026-11-07T08:30:00.000Z',
        submittedAt: null,
        submitReason: null,
        score: null,
        correctCount: null,
        totalQuestions: 45,
        answeredCount: r.answeredCount,
        percentage: null,
        passed: null,
        reentryCount: 0,
        reentryAllowed: false,
        violationCount: r.violationCount,
        activeSessionToken: null,
        activeDeviceId: null,
        status: r.status as 'in_progress' | 'submitted',
      })),
    notEnteredStudents: [
      {
        studentId: 'hs_4',
        username: 'hs_4',
        fullName: 'Dũng Phạm',
        className: '12A1',
      },
    ],
    violations: [],
    maxViolations: 3,
    sessionQuestionCount: 45,
    onlyWithViolations: true,
    clientNowMs: nowMs,
  });
  assert.deepEqual(
    onlyViolRows.map((r) => r.studentId),
    ['hs_2', 'hs_3']
  );
});
