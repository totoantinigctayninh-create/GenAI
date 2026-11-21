import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';
import { ExamSessionEngine } from './examSessionEngine.ts';
import { createExamSessionRouter } from './examSessionRoutes.ts';
import {
  createThrottledSseDispatcher,
  isCriticalSessionRealtimeEvent,
} from './sseThrottle.ts';
import type { Question, UserAccount } from '../types/exam.ts';
import type { SessionRealtimeEvent } from '../types/examSession.ts';

function createFixtureQuestions(count = 10): Question[] {
  return Array.from({ length: count }, (_, idx) => ({
    id: `q_${idx + 1}`,
    orderNumber: idx + 1,
    type: 'mcq_single',
    topic: 'Prompt Engineering',
    examSet: 'Set 1',
    prompt: `Câu hỏi kiểm thử số ${idx + 1}: Chọn đáp án đúng cho mô hình AI?`,
    options: [
      { id: 'A', text: 'Phương án A rất dài để kiểm tra kích thước payload' },
      { id: 'B', text: 'Phương án B rất dài để kiểm tra kích thước payload' },
      { id: 'C', text: 'Phương án C rất dài để kiểm tra kích thước payload' },
      { id: 'D', text: 'Phương án D rất dài để kiểm tra kích thước payload' },
    ],
    correctAnswer: 'A',
    explanation: 'Giải thích đáp án không bao giờ được lọt ra phía học sinh.',
  }));
}

function createFixtureUsers(): UserAccount[] {
  return [
    {
      id: 'admin',
      username: 'admin',
      password: 'secret',
      fullName: 'Giáo viên Quản trị',
      role: 'teacher',
      className: 'Tổ Toán - Tin',
      lastLogin: new Date().toISOString(),
      status: 'online',
      totalStudyMinutes: 0,
      totalStudySeconds: 0,
    },
    {
      id: 'hs_01',
      username: 'hs01',
      password: 'secret',
      fullName: 'Nguyễn Văn A',
      role: 'student',
      className: '12A1',
      lastLogin: new Date().toISOString(),
      status: 'studying',
      totalStudyMinutes: 10,
      totalStudySeconds: 600,
    },
  ];
}

test('ExamSessionEngine.getAttemptStatus trả về payload gọn nhẹ không kèm câu hỏi và tự nộp khi quá hạn', () => {
  let fakeNow = Date.parse('2026-06-01T08:00:00.000Z');
  const engine = new ExamSessionEngine({
    nowFn: () => new Date(fakeNow),
  });
  engine.setUsers(createFixtureUsers());
  engine.setQuestions(createFixtureQuestions(12));

  const session = engine.createSession('admin', {
    title: 'Ca thi kiểm tra hiệu năng',
    targetClass: '12A1',
    questionCount: 10,
    durationMinutes: 15,
    selectionMode: 'proportional',
    maxViolations: 3,
    passScore: 700,
    resultVisibility: 'score_only',
  });
  engine.openSession('admin', session.id);

  const paper = engine.startOrResumeAttempt('hs_01', session.code, 'device_1');
  const status = engine.getAttemptStatus('hs_01', paper.attempt.id, paper.sessionToken);

  assert.equal(status.status, 'in_progress');
  assert.equal(status.sessionStatus, 'open');
  assert.equal(status.violationCount, 0);
  assert.equal(status.maxViolations, 3);
  assert.equal(status.deadlineAt, paper.attempt.deadlineAt);
  assert.equal(status.serverNow, '2026-06-01T08:00:00.000Z');
  assert.equal('questions' in (status as unknown as Record<string, unknown>), false);
  assert.equal('savedAnswers' in (status as unknown as Record<string, unknown>), false);
  assert.ok(
    JSON.stringify(status).length < 300,
    `Expected compact payload < 300 bytes, got ${JSON.stringify(status).length}`
  );

  // Từ chối khi sessionToken không khớp thiết bị đang hoạt động
  assert.throws(
    () => engine.getAttemptStatus('hs_01', paper.attempt.id, 'wrong-token'),
    /thiết bị khác/
  );

  // Khi quá hạn làm bài, getAttemptStatus tự động chốt bài sang submitted
  fakeNow += 16 * 60 * 1000;
  const expiredStatus = engine.getAttemptStatus(
    'hs_01',
    paper.attempt.id,
    paper.sessionToken
  );
  assert.equal(expiredStatus.status, 'submitted');
});

test('HTTP GET /api/exam-attempts/:attemptId/status trả về JSON gọn nhẹ và xác thực đúng học sinh', async () => {
  const secret = 'test-hmac-secret-for-status-route';
  const engine = new ExamSessionEngine();
  engine.setUsers(createFixtureUsers());
  engine.setQuestions(createFixtureQuestions(10));
  const session = engine.createSession('admin', {
    title: 'Ca thi HTTP status',
    targetClass: '12A1',
    questionCount: 8,
    durationMinutes: 20,
    selectionMode: 'proportional',
    maxViolations: 3,
    passScore: 700,
    resultVisibility: 'score_only',
  });
  engine.openSession('admin', session.id);
  const paper = engine.startOrResumeAttempt('hs_01', session.code, 'dev_http');

  const app = express();
  app.use(express.json());
  app.use('/api', createExamSessionRouter(engine, { authSecret: secret }));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'hs01', password: 'secret' }),
    });
    assert.equal(loginRes.status, 200);
    const { token: studentAuthToken } = (await loginRes.json()) as {
      token: string;
    };

    const res = await fetch(
      `${baseUrl}/api/exam-attempts/${encodeURIComponent(paper.attempt.id)}/status`,
      {
        headers: {
          Authorization: `Bearer ${studentAuthToken}`,
          'x-exam-session-token': paper.sessionToken,
        },
      }
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.ok, true);
    assert.equal(body.status, 'in_progress');
    assert.equal(body.sessionStatus, 'open');
    assert.equal(body.violationCount, 0);
    assert.equal(body.maxViolations, 3);
    assert.equal(typeof body.serverNow, 'string');
    assert.equal(typeof body.deadlineAt, 'string');
    assert.equal('questions' in body, false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('createThrottledSseDispatcher gộp 150 sự kiện lưu đáp án thành 1 lần đẩy sau 1500ms', () => {
  const flushed: SessionRealtimeEvent[] = [];
  let scheduledCallback: (() => void) | null = null;
  let scheduledDelay: number | null = null;
  let clearedCount = 0;

  const dispatcher = createThrottledSseDispatcher({
    windowMs: 1500,
    isCritical: (ev) => isCriticalSessionRealtimeEvent(ev, 'open'),
    onFlush: (ev) => flushed.push(ev),
    setTimer: (cb, delayMs) => {
      scheduledCallback = cb;
      scheduledDelay = delayMs;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      clearedCount += 1;
      scheduledCallback = null;
    },
  });

  // Giả lập 150 học sinh lưu đáp án dồn dập trong 1 cửa sổ 1500ms
  for (let i = 1; i <= 150; i++) {
    dispatcher.enqueue({
      type: 'student:progress',
      sessionId: 'sess_1',
      emittedAt: new Date().toISOString(),
      studentId: `hs_${i}`,
    });
  }

  assert.equal(flushed.length, 0);
  assert.equal(scheduledDelay, 1500);
  assert.equal(dispatcher.hasPending(), true);

  // Hết cửa sổ 1500ms -> chỉ đẩy đúng 1 sự kiện tổng hợp (sự kiện mới nhất)
  assert.ok(scheduledCallback);
  (scheduledCallback as () => void)();

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].studentId, 'hs_150');
  assert.equal(dispatcher.hasPending(), false);

  // Khi đóng kết nối (dispose), hủy sạch bộ hẹn giờ đang chờ
  dispatcher.enqueue({
    type: 'student:progress',
    sessionId: 'sess_1',
    emittedAt: new Date().toISOString(),
    studentId: 'hs_151',
  });
  assert.equal(dispatcher.hasPending(), true);
  dispatcher.dispose();
  assert.equal(clearedCount, 1);
  assert.equal(dispatcher.hasPending(), false);
});

test('createThrottledSseDispatcher đẩy ngay lập tức các sự kiện trọng yếu (nộp bài, tự nộp do vi phạm, khóa/kết thúc ca thi)', () => {
  const flushed: SessionRealtimeEvent[] = [];
  let sessionStatus: 'open' | 'locked' | 'ended' = 'open';
  let clearedCount = 0;

  const dispatcher = createThrottledSseDispatcher({
    windowMs: 1500,
    isCritical: (ev) => isCriticalSessionRealtimeEvent(ev, sessionStatus),
    onFlush: (ev) => flushed.push(ev),
    setTimer: () => 42 as unknown as ReturnType<typeof setTimeout>,
    clearTimer: () => {
      clearedCount += 1;
    },
  });

  // Sự kiện thường đang chờ trong cửa sổ 1500ms
  dispatcher.enqueue({
    type: 'student:progress',
    sessionId: 'sess_1',
    emittedAt: new Date().toISOString(),
    studentId: 'hs_1',
  });
  assert.equal(flushed.length, 0);

  // Học sinh nộp bài -> phải đẩy ngay lập tức & hủy timer đang chờ
  dispatcher.enqueue({
    type: 'student:submitted',
    sessionId: 'sess_1',
    emittedAt: new Date().toISOString(),
    studentId: 'hs_1',
    submitReason: 'voluntary',
  });
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].type, 'student:submitted');
  assert.equal(clearedCount, 1);

  // Vi phạm gây tự nộp bài -> đẩy ngay
  dispatcher.enqueue({
    type: 'student:violation',
    sessionId: 'sess_1',
    emittedAt: new Date().toISOString(),
    studentId: 'hs_2',
    autoSubmitted: true,
  });
  assert.equal(flushed.length, 2);
  assert.equal(flushed[1].autoSubmitted, true);

  // Giáo viên khóa ca thi -> đẩy ngay
  sessionStatus = 'locked';
  dispatcher.enqueue({
    type: 'session:updated',
    sessionId: 'sess_1',
    emittedAt: new Date().toISOString(),
  });
  assert.equal(flushed.length, 3);
  assert.equal(flushed[2].type, 'session:updated');
});

test('Thi trực tiếp gộp đáp án vào 1 tài liệu attempts/{id}: chỉ ghi khi Bắt đầu, Checkpoint 20 phút/Shutdown và Nộp bài (0 lượt ghi mỗi cú click)', async () => {
  const savedAttempts: Array<{
    id: string;
    status: string;
    answeredCount: number;
    bundledCount: number;
  }> = [];
  let savedAnswerHookCalls = 0;

  const engine = new ExamSessionEngine({
    storageAdapter: {
      onAttemptSaved: (attempt) => {
        savedAttempts.push({
          id: attempt.id,
          status: attempt.status,
          answeredCount: attempt.answeredCount ?? 0,
          bundledCount: Object.keys(attempt.savedAnswers ?? {}).length,
        });
      },
      onAnswerSaved: () => {
        savedAnswerHookCalls += 1;
      },
    },
  });

  engine.setUsers(createFixtureUsers());
  engine.setQuestions(createFixtureQuestions(10));

  const session = engine.createSession('admin', {
    title: 'Ca thi tối ưu lượt ghi',
    targetClass: '12A1',
    questionCount: 5,
    durationMinutes: 45,
    selectionMode: 'proportional',
    maxViolations: 3,
    passScore: 700,
    resultVisibility: 'score_only',
  });
  engine.openSession('admin', session.id);

  // 1. Bắt đầu thi -> đúng 1 lượt ghi attempts/{id}
  const paper = engine.startOrResumeAttempt('hs_01', session.code, 'device_opt_1');
  assert.equal(savedAttempts.length, 1);
  assert.equal(savedAttempts[0].status, 'in_progress');
  assert.equal(engine.getDirtyAttemptIds().length, 0);

  // 2. Học sinh chọn 5 đáp án liên tiếp -> 0 lượt ghi Firestore thêm, lưu tức thì trong RAM & đánh dấu dirty
  for (const q of paper.questions) {
    engine.saveAttemptAnswer('hs_01', paper.attempt.id, {
      sessionToken: paper.sessionToken,
      questionId: q.id,
      selectedAnswer: 'A',
    });
  }
  assert.equal(savedAttempts.length, 1);
  // onAnswerSaved vẫn được gọi cho local cache/backup, còn Firestore adapter là no-op (0 lượt ghi Firestore)
  assert.equal(savedAnswerHookCalls, 5);
  assert.deepEqual(engine.getDirtyAttemptIds(), [paper.attempt.id]);

  // 3. Học sinh F5 tải lại trang trên cùng thiết bị -> khôi phục đủ 5 đáp án từ RAM, 0 lượt ghi Firestore mới
  const resumed = engine.startOrResumeAttempt('hs_01', session.code, 'device_opt_1');
  assert.equal(Object.keys(resumed.savedAnswers).length, 5);
  assert.equal(savedAttempts.length, 1);

  // 4. Điểm lưu an toàn 20 phút (hoặc flush trước khi tắt server) -> ghi 1 lần duy nhất kèm đủ 5 đáp án gộp
  const flushedIds = await engine.flushDirtyAttempts();
  assert.deepEqual(flushedIds, [paper.attempt.id]);
  assert.equal(savedAttempts.length, 2);
  assert.equal(savedAttempts[1].status, 'in_progress');
  assert.equal(savedAttempts[1].bundledCount, 5);
  assert.equal(engine.getDirtyAttemptIds().length, 0);

  // Nếu không có thay đổi mới, lần checkpoint tiếp theo ghi 0 lượt
  const emptyFlush = await engine.flushDirtyAttempts();
  assert.deepEqual(emptyFlush, []);
  assert.equal(savedAttempts.length, 2);

  // 5. Nộp bài -> ghi 1 lần cuối cùng chứa điểm chính thức + toàn bộ savedAnswers gộp
  const finalResult = engine.submitAttempt(
    'hs_01',
    paper.attempt.id,
    resumed.sessionToken
  );
  assert.equal(finalResult.status, 'submitted');
  assert.equal(finalResult.score, 1000);
  assert.equal(savedAttempts.length, 3);
  assert.equal(savedAttempts[2].status, 'submitted');
  assert.equal(savedAttempts[2].bundledCount, 5);
  assert.equal(engine.getDirtyAttemptIds().length, 0);
});

test('hydrateState tương thích ngược 100%: khôi phục đồng thời cả savedAnswers gộp mới và bảng attempt_answers cũ', () => {
  let persistedAttemptRecord: import('../types/examSession.ts').SessionAttemptRecord | null = null;
  const engine = new ExamSessionEngine({
    storageAdapter: {
      onAttemptSaved: (attempt) => {
        persistedAttemptRecord = { ...attempt };
      },
    },
  });
  engine.setUsers(createFixtureUsers());
  engine.setQuestions(createFixtureQuestions(6));

  const draftSession = engine.createSession('admin', {
    title: 'Ca thi tương thích ngược',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 45,
    selectionMode: 'proportional',
    maxViolations: 3,
    passScore: 700,
    resultVisibility: 'score_only',
  });
  const openSession = engine.openSession('admin', draftSession.id);
  const startedPaper = engine.startOrResumeAttempt('hs_01', openSession.code, 'dev_compat');
  assert.ok(persistedAttemptRecord);
  const [q1, q2, q3] = startedPaper.questions;

  // Khôi phục một bài thi có đáp án q1 trong trường gộp savedAnswers và q2, q3 trong collection cũ attempt_answers
  const freshEngine = new ExamSessionEngine();
  freshEngine.setUsers(createFixtureUsers());
  freshEngine.setQuestions(createFixtureQuestions(6));
  freshEngine.hydrateState({
    sessions: [openSession],
    attempts: [
      {
        ...(persistedAttemptRecord as import('../types/examSession.ts').SessionAttemptRecord),
        savedAnswers: {
          [q1.id]: {
            questionId: q1.id,
            selectedAnswer: 'A',
            savedAt: '2026-06-01T08:02:00.000Z',
            timeSpentSeconds: 10,
            flagged: false,
          },
          [q2.id]: {
            questionId: q2.id,
            selectedAnswer: 'B',
            savedAt: '2026-06-01T08:01:00.000Z',
            timeSpentSeconds: 8,
            flagged: false,
          },
        },
      },
    ],
    attemptAnswers: [
      {
        id: `${startedPaper.attempt.id}_${q2.id}`,
        attemptId: startedPaper.attempt.id,
        sessionId: openSession.id,
        studentId: 'hs_01',
        questionId: q2.id,
        selectedAnswer: 'A', // mới hơn bản trong savedAnswers -> phải ưu tiên bản mới hơn
        savedAt: '2026-06-01T08:03:00.000Z',
        timeSpentSeconds: 15,
        flagged: false,
      },
      {
        id: `${startedPaper.attempt.id}_${q3.id}`,
        attemptId: startedPaper.attempt.id,
        sessionId: openSession.id,
        studentId: 'hs_01',
        questionId: q3.id,
        selectedAnswer: 'C',
        savedAt: '2026-06-01T08:04:00.000Z',
        timeSpentSeconds: 12,
        flagged: true,
      },
    ],
  });

  const resumed = freshEngine.startOrResumeAttempt('hs_01', openSession.code, 'dev_compat');
  assert.equal(resumed.savedAnswers[q1.id].selectedAnswer, 'A');
  assert.equal(resumed.savedAnswers[q2.id].selectedAnswer, 'A');
  assert.equal(resumed.savedAnswers[q3.id].selectedAnswer, 'C');
});

