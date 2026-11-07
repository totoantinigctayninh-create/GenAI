import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { Question, UserAccount } from '../types/exam';
import {
  EXAM_CODE_ALPHABET,
  ExamEngineError,
  ExamSessionEngine,
  generateUniqueExamCode,
  isValidExamCodeFormat,
} from './examSessionEngine';
import { createExamSessionRouter } from './examSessionRoutes';

const SAMPLE_USERS: UserAccount[] = [
  {
    id: 'gv_toan',
    username: 'gv_toan',
    password: '123',
    fullName: 'Thầy Nguyễn Văn Toán',
    role: 'teacher',
    className: '12A1',
    lastLogin: '2026-11-06T08:00:00.000Z',
    status: 'online',
    totalStudyMinutes: 0,
  },
  {
    id: 'gv_tin',
    username: 'gv_tin',
    password: '123',
    fullName: 'Cô Trần Thị Tin',
    role: 'teacher',
    className: '12A2',
    lastLogin: '2026-11-06T08:00:00.000Z',
    status: 'online',
    totalStudyMinutes: 0,
  },
  {
    id: 'hs_a',
    username: 'hs_a',
    password: '123',
    fullName: 'Lê Minh Ngọc',
    role: 'student',
    className: '12A1',
    lastLogin: '2026-11-06T08:00:00.000Z',
    status: 'studying',
    totalStudyMinutes: 45,
  },
  {
    id: 'hs_b',
    username: 'hs_b',
    password: '123',
    fullName: 'Phạm Quốc Bảo',
    role: 'student',
    className: '12A1',
    lastLogin: '2026-11-06T08:00:00.000Z',
    status: 'studying',
    totalStudyMinutes: 30,
  },
  {
    id: 'hs_other_class',
    username: 'hs_other_class',
    password: '123',
    fullName: 'Hoàng Gia Huy',
    role: 'student',
    className: '12A2',
    lastLogin: '2026-11-06T08:00:00.000Z',
    status: 'studying',
    totalStudyMinutes: 10,
  },
];

const SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'Q1',
    type: 'mcq_single',
    topic: '1. Tổng quan & Mô hình GenAI',
    examSet: 'Đề 1',
    prompt: 'Mô hình nào sử dụng cơ chế Self-Attention?',
    options: [
      { id: 'A', text: 'Transformer' },
      { id: 'B', text: 'RNN cổ điển' },
      { id: 'C', text: 'K-Means' },
      { id: 'D', text: 'Decision Tree' },
    ],
    correctAnswer: 'A',
    explanation: 'Transformer sử dụng cơ chế Self-Attention giúp xử lý song song.',
  },
  {
    id: 'Q2',
    type: 'mcq_multiple',
    topic: '2. Kỹ thuật viết Prompt',
    examSet: 'Đề 1',
    prompt: 'Chọn 2 thành phần quan trọng của một Prompt hiệu quả:',
    maxSelect: 2,
    options: [
      { id: 'A', text: 'Ngữ cảnh (Context)' },
      { id: 'B', text: 'Định dạng đầu ra (Output Format)' },
      { id: 'C', text: 'Tốc độ xung nhịp CPU' },
      { id: 'D', text: 'Dung lượng RAM' },
    ],
    correctAnswer: ['A', 'B'],
    explanation: 'Ngữ cảnh và Định dạng đầu ra giúp định hướng câu trả lời chính xác.',
  },
  {
    id: 'Q3',
    type: 'matching',
    topic: '3. Đạo đức, Pháp lý & Bảo mật',
    examSet: 'Đề 1',
    prompt: 'Ghép khái niệm bảo mật AI với mô tả đúng:',
    pairs: [
      { id: 'p1', left: 'Hallucination', right: 'Sinh thông tin sai lệch như thật' },
      { id: 'p2', left: 'Prompt Injection', right: 'Chèn chỉ dẫn độc hại vượt rào cản' },
    ],
    correctAnswer: {
      p1: 'Sinh thông tin sai lệch như thật',
      p2: 'Chèn chỉ dẫn độc hại vượt rào cản',
    },
    explanation: 'Hallucination là ảo giác AI, còn Prompt Injection là tấn công chèn lệnh.',
  },
  {
    id: 'Q4',
    type: 'ordering',
    topic: '4. Ứng dụng & Công cụ thực tế',
    examSet: 'Đề 1',
    prompt: 'Sắp xếp quy trình tinh chỉnh Prompt:',
    steps: [
      { id: 's1', text: 'Xác định mục tiêu' },
      { id: 's2', text: 'Viết prompt nháp' },
      { id: 's3', text: 'Đánh giá và tinh chỉnh' },
    ],
    correctAnswer: ['s1', 's2', 's3'],
    explanation: 'Quy trình chuẩn đi từ xác định mục tiêu -> viết nháp -> đánh giá.',
  },
];

function createTestSetup(initialIso = '2026-11-06T09:00:00.000Z') {
  let currentMs = new Date(initialIso).getTime();
  const advanceSeconds = (seconds: number) => {
    currentMs += seconds * 1000;
  };

  const engine = new ExamSessionEngine({
    nowFn: () => new Date(currentMs),
  });
  engine.setUsers(SAMPLE_USERS);
  engine.setQuestions(SAMPLE_QUESTIONS);

  return { engine, advanceSeconds };
}

test('Mã ca thi 6 ký tự loại bỏ 0/O/1/I/L, không phân biệt hoa thường và duy nhất trong các ca đang hoạt động', () => {
  const { engine } = createTestSetup();
  const activeSet = new Set<string>();

  for (let i = 0; i < 50; i++) {
    const code = generateUniqueExamCode(activeSet);
    assert.equal(code.length, 6);
    assert.equal(isValidExamCodeFormat(code), true);
    assert.equal(/[0O1IL]/.test(code), false);
    for (const ch of code) {
      assert.equal(EXAM_CODE_ALPHABET.includes(ch), true);
    }
    activeSet.add(code);
  }

  // Từ chối mã chứa ký tự dễ nhầm 0, O, 1, I, L
  assert.equal(isValidExamCodeFormat('AB0DEF'), false);
  assert.equal(isValidExamCodeFormat('AB1DEF'), false);
  assert.equal(isValidExamCodeFormat('ABO234'), false);
  assert.equal(isValidExamCodeFormat('ABI234'), false);
  assert.equal(isValidExamCodeFormat('ABL234'), false);

  // Tạo ca thi với mã hợp lệ và kiểm tra trùng mã khi ca đang hoạt động
  const s1 = engine.createSession('gv_toan', {
    title: 'Ca thi K12 - Đợt 1',
    code: 'k9m2p4', // truyền chữ thường -> tự chuẩn hóa thành K9M2P4
    status: 'open',
  });
  assert.equal(s1.code, 'K9M2P4');

  assert.throws(
    () =>
      engine.createSession('gv_toan', {
        title: 'Ca thi trùng mã',
        code: 'K9M2P4',
      }),
    (err: unknown) =>
      err instanceof ExamEngineError && err.errorCode === 'DUPLICATE_ACTIVE_CODE'
  );
});

test('Mã sai, lý do từ chối cụ thể và giới hạn nhập sai 5 lần khóa 60 giây theo tài khoản và IP', () => {
  const { engine, advanceSeconds } = createTestSetup();

  // Tạo ca thi nháp của lớp 12A1
  const session = engine.createSession('gv_toan', {
    title: 'Kiểm tra 15 phút GenAI',
    code: 'M7N8P9',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 15,
    status: 'draft',
  });

  // 1. Ca thi đang ở trạng thái nháp -> reason: 'not_open_yet'
  const draftCheck = engine.verifySessionCode('hs_a', 'm7n8p9', '10.0.0.1');
  assert.equal(draftCheck.valid, false);
  assert.equal(draftCheck.reason, 'not_open_yet');

  // Mở ca thi
  engine.openSession('gv_toan', session.id);

  // 2. Học sinh khác lớp (12A2) nhập mã -> reason: 'wrong_class'
  const wrongClassCheck = engine.verifySessionCode(
    'hs_other_class',
    'M7N8P9',
    '10.0.0.2'
  );
  assert.equal(wrongClassCheck.valid, false);
  assert.equal(wrongClassCheck.reason, 'wrong_class');

  // 3. Nhập mã sai 5 lần liên tiếp từ IP 10.0.0.99 -> lần thứ 5 bị khóa 60 giây
  for (let i = 1; i <= 4; i++) {
    const res = engine.verifySessionCode('hs_a', 'ZZZZZZ', '10.0.0.99');
    assert.equal(res.valid, false);
    assert.equal(res.reason, 'not_found');
  }
  const fifthFail = engine.verifySessionCode('hs_a', 'ZZZZZZ', '10.0.0.99');
  assert.equal(fifthFail.valid, false);
  assert.equal(fifthFail.reason, 'rate_limited');
  assert.equal(fifthFail.retryAfterSeconds, 60);

  // Ngay cả khi nhập mã ĐÚNG ngay sau đó trên cùng tài khoản hoặc cùng IP cũng bị chặn trong 60 giây
  const blockedCorrect = engine.verifySessionCode('hs_a', 'M7N8P9', '10.0.0.50');
  assert.equal(blockedCorrect.valid, false);
  assert.equal(blockedCorrect.reason, 'rate_limited');

  const blockedSameIpOtherUser = engine.verifySessionCode(
    'hs_b',
    'M7N8P9',
    '10.0.0.99'
  );
  assert.equal(blockedSameIpOtherUser.valid, false);
  assert.equal(blockedSameIpOtherUser.reason, 'rate_limited');

  // Sau 61 giây -> hết thời gian khóa, xác thực mã thành công
  advanceSeconds(61);
  const okAfterWait = engine.verifySessionCode('hs_a', 'm7n8p9', '10.0.0.99');
  assert.equal(okAfterWait.valid, true);
  assert.equal(okAfterWait.session?.code, 'M7N8P9');
});

test('Ca thi bị khóa (locked): học sinh mới không vào được bằng mã, nhưng học sinh đang làm bài vẫn thi tiếp và nộp bài bình thường', () => {
  const { engine } = createTestSetup();
  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Khóa/Mở khóa',
    code: 'K2M3N4',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 20,
    status: 'open',
  });

  // Học sinh A bắt đầu làm bài khi ca đang mở
  const started = engine.startOrResumeAttempt('hs_a', 'K2M3N4', 'dev_1');
  const attemptId = started.attempt.id;
  const token = started.sessionToken;

  // Giáo viên khóa ca thi
  engine.lockSession('gv_toan', session.id);

  // Học sinh B (học sinh mới chưa vào phòng thi) xác thực mã khi ca đang khóa -> bị từ chối với reason: 'locked'
  const verifyLocked = engine.verifySessionCode('hs_b', 'K2M3N4');
  assert.equal(verifyLocked.valid, false);
  assert.equal(verifyLocked.reason, 'locked');
  assert.equal(verifyLocked.message, 'Ca thi đã khóa');

  assert.throws(
    () => engine.startOrResumeAttempt('hs_b', 'K2M3N4', 'dev_b'),
    (err: unknown) =>
      err instanceof ExamEngineError && err.errorCode === 'LOCKED'
  );

  // Học sinh A đang thi trong phòng thi KHÔNG bị đá ra, vẫn lưu đáp án và đồng bộ đề bình thường
  const savedWhileLocked = engine.saveAttemptAnswer('hs_a', attemptId, {
    questionId: 'Q1',
    selectedAnswer: 'A',
    timeSpentSeconds: 12,
    flagged: true,
    sessionToken: token,
  });
  assert.equal(savedWhileLocked.selectedAnswer, 'A');
  assert.equal(savedWhileLocked.flagged, true);

  const paperWhileLocked = engine.getAttemptPaper('hs_a', attemptId, token);
  assert.equal(paperWhileLocked.attempt.id, attemptId);

  // Giáo viên mở khóa ca thi -> Học sinh B vào thi được bình thường
  engine.unlockSession('gv_toan', session.id);
  const verifyUnlockedB = engine.verifySessionCode('hs_b', 'K2M3N4');
  assert.equal(verifyUnlockedB.valid, true);
});

test('Đáp án đúng (correctAnswer) và giải thích (explanation) TUYỆT ĐỐI không lọt xuống phía học sinh khi đang thi', () => {
  const { engine } = createTestSetup();
  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Bảo mật Đáp án',
    code: 'S8T9V2',
    targetClass: 'ALL',
    questionCount: 4,
    durationMinutes: 30,
    resultVisibility: 'score_only',
    status: 'open',
  });

  const paper = engine.startOrResumeAttempt('hs_a', session.code, 'device_hs_a');
  assert.equal(paper.questions.length, 4);

  // Kiểm tra từng câu hỏi trả về cho học sinh không có trường correctAnswer hay explanation
  for (const q of paper.questions) {
    const rawObj = q as unknown as Record<string, unknown>;
    assert.equal('correctAnswer' in rawObj, false);
    assert.equal('explanation' in rawObj, false);
    // Đối với câu matching, chỉ có matchingLeftItems và matchingRightChoices, không có pairs chứa cặp đúng
    if (q.type === 'matching') {
      assert.equal('pairs' in rawObj, false);
      assert.equal(Array.isArray(q.matchingLeftItems), true);
      assert.equal(Array.isArray(q.matchingRightChoices), true);
    }
  }

  // Kể cả khi gọi getAttemptPaper lần nữa cũng không có đáp án đúng
  const fetchedPaper = engine.getAttemptPaper(
    'hs_a',
    paper.attempt.id,
    paper.sessionToken
  );
  const serializedPaper = JSON.stringify(fetchedPaper);
  assert.equal(serializedPaper.includes('correctAnswer'), false);
  assert.equal(serializedPaper.includes('explanation'), false);

  // Khi nộp bài ở chế độ 'score_only', kết quả trả về có điểm nhưng KHÔNG có đáp án đúng/giải thích
  const resultScoreOnly = engine.submitAttempt(
    'hs_a',
    paper.attempt.id,
    paper.sessionToken
  );
  assert.equal(typeof resultScoreOnly.score, 'number');
  assert.equal(resultScoreOnly.questionsWithAnswers, undefined);
  assert.equal(JSON.stringify(resultScoreOnly).includes('correctAnswer'), false);
});

test('Đề mỗi học sinh sinh một lần, vào lại ra đúng đề đó; đăng nhập thiết bị khác đóng phiên cũ và ghi nhận vi phạm', () => {
  const { engine } = createTestSetup();
  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Kiểm tra Phiên thiết bị',
    code: 'D4F5G6',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 45,
    maxViolations: 2,
    status: 'open',
  });

  // Lần 1: Học sinh A vào thi trên Thiết bị 1
  const firstStart = engine.startOrResumeAttempt('hs_a', 'D4F5G6', 'device_laptop');
  const firstQuestionIds = firstStart.questions.map((q) => q.id);
  const firstQ1Options = firstStart.questions[0].options?.map((o) => o.id);
  const tokenDevice1 = firstStart.sessionToken;

  engine.saveAttemptAnswer('hs_a', firstStart.attempt.id, {
    questionId: firstQuestionIds[0],
    selectedAnswer: 'A',
    sessionToken: tokenDevice1,
  });

  // Lần 2: Học sinh A đăng nhập từ Thiết bị 2 ('device_phone')
  const secondStart = engine.startOrResumeAttempt('hs_a', 'D4F5G6', 'device_phone');
  const secondQuestionIds = secondStart.questions.map((q) => q.id);
  const secondQ1Options = secondStart.questions[0].options?.map((o) => o.id);

  // Đề và thứ tự đáp án phải giữ nguyên 100%
  assert.deepEqual(secondQuestionIds, firstQuestionIds);
  assert.deepEqual(secondQ1Options, firstQ1Options);
  assert.equal(secondStart.attempt.reentryCount, 1);
  // Ghi nhận 1 vi phạm 'multi_device'
  assert.equal(secondStart.attempt.violationCount, 1);
  // Đáp án đã lưu trước đó vẫn còn nguyên
  assert.equal(
    secondStart.savedAnswers[firstQuestionIds[0]]?.selectedAnswer,
    'A'
  );

  // Thiết bị 1 cũ cố tình gửi request bằng token cũ -> bị từ chối vì phiên đã bị đóng
  assert.throws(
    () =>
      engine.saveAttemptAnswer('hs_a', firstStart.attempt.id, {
        questionId: firstQuestionIds[0],
        selectedAnswer: 'B',
        sessionToken: tokenDevice1,
      }),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.errorCode === 'SESSION_REPLACED_BY_ANOTHER_DEVICE'
  );

  // Vi phạm lần thứ 2 (chạm ngưỡng maxViolations = 2) -> tự động thu bài với lý do 'violation'
  const violRes = engine.recordViolation('hs_a', firstStart.attempt.id, {
    type: 'tab_switch',
    awaySeconds: 5,
    currentQuestionOrder: 2,
    sessionToken: secondStart.sessionToken,
  });
  assert.equal(violRes.autoSubmitted, true);
  assert.equal(violRes.status, 'submitted');

  const finalResult = engine.getAttemptResult('hs_a', firstStart.attempt.id);
  assert.equal(finalResult.submitReason, 'violation');
});

test('Hết giờ tự động chốt bài ở máy chủ (khi học sinh gọi API hoặc qua tác vụ nền quét định kỳ)', () => {
  const { engine, advanceSeconds } = createTestSetup();
  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Đếm ngược Máy chủ',
    code: 'T2M3R4',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 10, // 10 phút = 600 giây
    resultVisibility: 'score_and_answers',
    status: 'open',
  });

  // Học sinh A và Học sinh B bắt đầu làm bài
  const paperA = engine.startOrResumeAttempt('hs_a', session.code, 'dev_a');
  const paperB = engine.startOrResumeAttempt('hs_b', session.code, 'dev_b');

  // Học sinh A trả lời đúng câu Q1 ('A') và Q2 (['A', 'B']) ở phút thứ 3
  advanceSeconds(180);
  engine.saveAttemptAnswer('hs_a', paperA.attempt.id, {
    questionId: 'Q1',
    selectedAnswer: 'A',
    timeSpentSeconds: 30,
    sessionToken: paperA.sessionToken,
  });
  engine.saveAttemptAnswer('hs_a', paperA.attempt.id, {
    questionId: 'Q2',
    selectedAnswer: ['A', 'B'],
    timeSpentSeconds: 45,
    sessionToken: paperA.sessionToken,
  });

  // Thời gian trôi qua thêm 8 phút (tổng 11 phút > 10 phút hạn nộp)
  advanceSeconds(480);

  // Học sinh A cố tình gửi thêm đáp án sau khi đã quá hạn -> Máy chủ tự chốt bài 'timeout' và từ chối lưu muộn
  assert.throws(
    () =>
      engine.saveAttemptAnswer('hs_a', paperA.attempt.id, {
        questionId: 'Q3',
        selectedAnswer: {
          p1: 'Sinh thông tin sai lệch như thật',
          p2: 'Chèn chỉ dẫn độc hại vượt rào cản',
        },
        sessionToken: paperA.sessionToken,
      }),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.errorCode === 'ATTEMPT_TIMEOUT_SUBMITTED'
  );

  // Kiểm tra kết quả của Học sinh A đã được máy chủ chấm tự động với 2/4 câu đúng = 500/1000 điểm, submitReason = 'timeout'
  const resultA = engine.getAttemptResult('hs_a', paperA.attempt.id);
  assert.equal(resultA.status, 'submitted');
  assert.equal(resultA.submitReason, 'timeout');
  assert.equal(resultA.correctCount, 2);
  assert.equal(resultA.score, 500);
  assert.equal(resultA.passed, false);

  // Học sinh B không gọi API nào, nhưng tác vụ nền sweepExpiredAttempts() quét qua -> tự động chốt bài của B
  const swept = engine.sweepExpiredAttempts();
  assert.equal(swept.some((a) => a.id === paperB.attempt.id), true);
  const resultB = engine.getAttemptResult('hs_b', paperB.attempt.id);
  assert.equal(resultB.status, 'submitted');
  assert.equal(resultB.submitReason, 'timeout');
  assert.equal(resultB.score, 0);
});

test('Phân quyền cô lập: Học sinh A KHÔNG đọc/sửa/nộp được lượt thi của Học sinh B; Giáo viên khác lớp không sửa được ca thi', async () => {
  const { engine } = createTestSetup();
  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Riêng lớp 12A1',
    code: 'P7Q8R9',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 30,
    status: 'open',
  });

  const paperB = engine.startOrResumeAttempt('hs_b', session.code, 'dev_b');

  // 1. Học sinh A cố tình đọc đề của Học sinh B -> 403 FORBIDDEN_ATTEMPT_OWNERSHIP
  assert.throws(
    () => engine.getAttemptPaper('hs_a', paperB.attempt.id, paperB.sessionToken),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_ATTEMPT_OWNERSHIP'
  );

  // 2. Học sinh A cố tình lưu đáp án vào lượt thi của Học sinh B -> 403
  assert.throws(
    () =>
      engine.saveAttemptAnswer('hs_a', paperB.attempt.id, {
        questionId: 'Q1',
        selectedAnswer: 'A',
        sessionToken: paperB.sessionToken,
      }),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_ATTEMPT_OWNERSHIP'
  );

  // 3. Học sinh A cố tình nộp bài hộ Học sinh B -> 403
  assert.throws(
    () => engine.submitAttempt('hs_a', paperB.attempt.id, paperB.sessionToken),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_ATTEMPT_OWNERSHIP'
  );

  // 4. Học sinh B nộp bài của mình -> Học sinh A cố tình xem kết quả của Học sinh B -> 403
  engine.submitAttempt('hs_b', paperB.attempt.id, paperB.sessionToken);
  assert.throws(
    () => engine.getAttemptResult('hs_a', paperB.attempt.id),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_ATTEMPT_OWNERSHIP'
  );

  // 5. Giáo viên phụ trách lớp 12A2 ('gv_tin') không được phép khóa hoặc xem chi tiết ca thi lớp 12A1 của 'gv_toan'
  assert.throws(
    () => engine.lockSession('gv_tin', session.id),
    (err: unknown) =>
      err instanceof ExamEngineError &&
      err.statusCode === 403 &&
      err.errorCode === 'FORBIDDEN_SESSION_ACCESS'
  );

  // 6. Kiểm tra qua HTTP Express Router thực tế
  const app = express();
  app.use(express.json());
  app.use('/api', createExamSessionRouter(engine));

  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}/api`;

    // Học sinh A gọi GET /api/attempts/:attemptId/result của Học sinh B -> HTTP 403
    const forbiddenRes = await fetch(
      `${baseUrl}/attempts/${paperB.attempt.id}/result`,
      {
        headers: { 'x-user-id': 'hs_a' },
      }
    );
    assert.equal(forbiddenRes.status, 403);
    const forbiddenJson = (await forbiddenRes.json()) as { errorCode: string };
    assert.equal(forbiddenJson.errorCode, 'FORBIDDEN_ATTEMPT_OWNERSHIP');

    // Giáo viên gv_toan gia hạn, sao chép, kết thúc ca thi và kiểm tra exam_audit_log
    const cloneRes = await fetch(
      `${baseUrl}/exam-sessions/${session.id}/clone`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': 'gv_toan',
        },
        body: JSON.stringify({ title: 'Bản sao Ca thi 12A1' }),
      }
    );
    assert.equal(cloneRes.status, 201);

    const detailRes = await fetch(`${baseUrl}/exam-sessions/${session.id}`, {
      headers: { 'x-user-id': 'gv_toan' },
    });
    assert.equal(detailRes.status, 200);
    const detailJson = (await detailRes.json()) as {
      auditLogs: Array<{ action: string }>;
    };
    assert.equal(detailJson.auditLogs.length >= 1, true);
  } finally {
    server.close();
  }
});

test('Bước 3/8: Nộp bài kèm finalAnswers, 3 chế độ hiển thị kết quả (none / score_only / score_and_answers) và danh sách lịch sử ca thi của học sinh', () => {
  const { engine } = createTestSetup();

  const sessionNone = engine.createSession('gv_toan', {
    title: 'Ca thi Ẩn điểm',
    code: 'N2N3N4',
    targetClass: 'ALL',
    questionCount: 4,
    durationMinutes: 20,
    shuffleOptions: false,
    resultVisibility: 'none',
    status: 'open',
  });
  const sessionScoreOnly = engine.createSession('gv_toan', {
    title: 'Ca thi Chỉ hiện điểm',
    code: 'S2S3S4',
    targetClass: 'ALL',
    questionCount: 4,
    durationMinutes: 20,
    shuffleOptions: false,
    resultVisibility: 'score_only',
    status: 'open',
  });
  const sessionFull = engine.createSession('gv_toan', {
    title: 'Ca thi Hiện điểm và đáp án',
    code: 'F2F3F4',
    targetClass: 'ALL',
    questionCount: 4,
    durationMinutes: 20,
    shuffleOptions: false,
    resultVisibility: 'score_and_answers',
    status: 'open',
  });

  // 1. Ca thi 'none': nộp kèm finalAnswers
  const pNone = engine.startOrResumeAttempt('hs_a', sessionNone.code, 'dev_a');
  const resNone = engine.submitAttempt('hs_a', pNone.attempt.id, pNone.sessionToken, {
    reason: 'voluntary',
    finalAnswers: SAMPLE_QUESTIONS.map((q) => ({
      questionId: q.id,
      selectedAnswer: q.correctAnswer,
      timeSpentSeconds: 12,
      flagged: false,
    })),
  });
  assert.equal(resNone.resultVisibility, 'none');
  assert.equal(resNone.score, undefined);
  assert.equal(resNone.questionsWithAnswers, undefined);

  // 2. Ca thi 'score_only': nộp do hết giờ (timeout)
  const pScore = engine.startOrResumeAttempt('hs_a', sessionScoreOnly.code, 'dev_a');
  const resScore = engine.submitAttempt('hs_a', pScore.attempt.id, pScore.sessionToken, {
    reason: 'timeout',
    finalAnswers: SAMPLE_QUESTIONS.map((q) => ({
      questionId: q.id,
      selectedAnswer: q.correctAnswer,
      timeSpentSeconds: 8,
      flagged: true,
    })),
  });
  assert.equal(resScore.resultVisibility, 'score_only');
  assert.equal(resScore.submitReason, 'timeout');
  assert.equal(resScore.score, 1000);
  assert.equal(resScore.passed, true);
  assert.equal(resScore.questionsWithAnswers, undefined);

  // 3. Ca thi 'score_and_answers'
  const pFull = engine.startOrResumeAttempt('hs_a', sessionFull.code, 'dev_a');
  const resFull = engine.submitAttempt('hs_a', pFull.attempt.id, pFull.sessionToken, {
    reason: 'voluntary',
    finalAnswers: SAMPLE_QUESTIONS.map((q) => ({
      questionId: q.id,
      selectedAnswer: q.correctAnswer,
      timeSpentSeconds: 10,
      flagged: false,
    })),
  });
  assert.equal(resFull.resultVisibility, 'score_and_answers');
  assert.equal(resFull.score, 1000);
  assert.equal(Array.isArray(resFull.questionsWithAnswers), true);
  assert.equal(resFull.questionsWithAnswers?.length, 4);

  // 4. Lịch sử ca thi của học sinh trả về đủ 3 lượt thi đã nộp kèm mã ca thi
  const history = engine.listStudentSubmittedAttempts('hs_a');
  assert.equal(history.length, 3);
  assert.equal(history.some((h) => h.sessionCode === 'N2N3N4' && h.score === undefined), true);
  assert.equal(history.some((h) => h.sessionCode === 'S2S3S4' && h.score === 1000 && !h.questionsWithAnswers), true);
  assert.equal(history.some((h) => h.sessionCode === 'F2F3F4' && h.questionsWithAnswers?.length === 4), true);
});

test('Bước 4/8: Ghi nhận phím bị chặn (phim_bi_chan) không tính vào ngưỡng tự nộp; đủ 3 lần rời bài thi tự động nộp với lý do violation', () => {
  const { engine } = createTestSetup();
  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Chống gian lận Bước 4',
    code: 'V4V5V6',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 25,
    maxViolations: 3,
    resultVisibility: 'score_only',
    status: 'open',
  });

  const paper = engine.startOrResumeAttempt('hs_a', session.code, 'dev_step4');
  const attemptId = paper.attempt.id;
  const token = paper.sessionToken;

  // 1. Học sinh bấm F12, Ctrl+C, chuột phải -> ghi nhận loại 'phim_bi_chan' nhưng KHÔNG tăng violationCount
  for (let i = 0; i < 4; i++) {
    const blockedRes = engine.recordViolation('hs_a', attemptId, {
      type: 'phim_bi_chan',
      awaySeconds: 0,
      currentQuestionOrder: 1,
      note: 'F12 / Ctrl+C',
      sessionToken: token,
    });
    assert.equal(blockedRes.countsTowardLimit, false);
    assert.equal(blockedRes.violationCount, 0);
    assert.equal(blockedRes.autoSubmitted, false);
    assert.equal(blockedRes.status, 'in_progress');
  }

  // 2. Lần rời bài thi 1/3 (tab_switch)
  const v1 = engine.recordViolation('hs_a', attemptId, {
    type: 'tab_switch',
    awaySeconds: 4,
    currentQuestionOrder: 1,
    sessionToken: token,
  });
  assert.equal(v1.countsTowardLimit, true);
  assert.equal(v1.violationCount, 1);
  assert.equal(v1.maxViolations, 3);
  assert.equal(v1.autoSubmitted, false);

  // 3. Lần rời bài thi 2/3 (fullscreen_exit - cảnh báo cuối trước khi thu bài)
  const v2 = engine.recordViolation('hs_a', attemptId, {
    type: 'fullscreen_exit',
    awaySeconds: 2,
    currentQuestionOrder: 2,
    sessionToken: token,
  });
  assert.equal(v2.countsTowardLimit, true);
  assert.equal(v2.violationCount, 2);
  assert.equal(v2.autoSubmitted, false);

  // 4. Lần rời bài thi 3/3 (window_blur) kèm finalAnswers -> máy chủ tự động nộp bài với submitReason = 'violation'
  const v3 = engine.recordViolation('hs_a', attemptId, {
    type: 'window_blur',
    awaySeconds: 6,
    currentQuestionOrder: 3,
    sessionToken: token,
    finalAnswers: [
      {
        questionId: 'Q1',
        selectedAnswer: 'A',
        timeSpentSeconds: 15,
        flagged: false,
      },
    ],
  });
  assert.equal(v3.countsTowardLimit, true);
  assert.equal(v3.violationCount, 3);
  assert.equal(v3.autoSubmitted, true);
  assert.equal(v3.status, 'submitted');
  assert.equal(v3.result?.submitReason, 'violation');

  // Kiểm tra chi tiết ca thi phía giáo viên lưu đầy đủ cả 4 sự kiện 'phim_bi_chan' và 3 sự kiện rời màn hình (tổng 7 sự kiện)
  const detail = engine.getTeacherSessionDetail('gv_toan', session.id);
  const attemptViolations = detail.violations.filter((v) => v.attemptId === attemptId);
  assert.equal(attemptViolations.length, 7);
  assert.equal(
    attemptViolations.filter((v) => v.type === 'phim_bi_chan').length,
    4
  );
});

test('Bước 5/8: Danh sách ca thi giáo viên (số HS đã vào/tổng), xóa ca thi khi chưa có ai thi, và cô lập giữa các giáo viên', () => {
  const { engine } = createTestSetup();

  // gv_toan tạo 2 ca thi: 1 ca cho lớp 12A1 (có 2 học sinh trong SAMPLE_USERS: hs_a, hs_b), 1 ca nháp chưa có ai thi
  const activeSession = engine.createSession('gv_toan', {
    title: 'Ca thi Giữa kỳ 12A1',
    code: 'G5H6J7',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 45,
    status: 'open',
  });

  const draftSession = engine.createSession('gv_toan', {
    title: 'Ca thi Nháp cần xóa',
    code: 'X2Y3Z4',
    targetClass: 'ALL',
    questionCount: 4,
    durationMinutes: 30,
    status: 'draft',
  });

  // Giáo viên khác (gv_tin phụ trách 12A2) không thấy ca thi của lớp 12A1 hay ca thi do gv_toan tạo
  const tinSessions = engine.listTeacherSessions('gv_tin');
  assert.equal(tinSessions.length, 0);

  // Học sinh hs_a vào thi ca activeSession
  engine.startOrResumeAttempt('hs_a', activeSession.code, 'dev_a');

  const toanSessions = engine.listTeacherSessions('gv_toan');
  assert.equal(toanSessions.length, 2);

  const enrichedActive = toanSessions.find((s) => s.id === activeSession.id)!;
  assert.equal(enrichedActive.enteredCount, 1);
  assert.equal(enrichedActive.inProgressCount, 1);
  assert.equal(enrichedActive.totalTargetStudents, 2); // hs_a và hs_b thuộc 12A1

  // Không cho phép xóa ca thi đã có học sinh vào thi (activeSession)
  assert.throws(
    () => engine.deleteSession('gv_toan', activeSession.id),
    (err: unknown) =>
      err instanceof ExamEngineError && err.errorCode === 'SESSION_HAS_ATTEMPTS'
  );

  // Cho phép xóa ca thi chưa có học sinh nào thi (draftSession)
  const deleted = engine.deleteSession('gv_toan', draftSession.id);
  assert.equal(deleted.deletedId, draftSession.id);
  assert.equal(engine.listTeacherSessions('gv_toan').length, 1);
});

test('Bước 6/8: Theo dõi trực tiếp (32 đang thi, 5 đã nộp, 3 chưa vào), Gia hạn, Nộp bài giúp, Cho vào lại (tạo lượt thi mới giữ nguyên bài cũ) và ghi exam_audit_log', () => {
  const { engine } = createTestSetup();

  const session = engine.createSession('gv_toan', {
    title: 'Ca thi Theo dõi trực tiếp Bước 6',
    code: 'K6M7N8',
    targetClass: '12A1',
    questionCount: 4,
    durationMinutes: 30,
    maxViolations: 3,
    status: 'open',
  });

  // 1. Học sinh hs_a vào thi, làm 2 câu rồi bị tự nộp do vi phạm đủ 3 lần
  const paperA = engine.startOrResumeAttempt('hs_a', session.code, 'dev_a');
  engine.saveAttemptAnswer('hs_a', paperA.attempt.id, {
    questionId: 'Q1',
    selectedAnswer: 'A',
    timeSpentSeconds: 15,
    sessionToken: paperA.sessionToken,
  });
  engine.saveAttemptAnswer('hs_a', paperA.attempt.id, {
    questionId: 'Q2',
    selectedAnswer: ['A', 'B'],
    timeSpentSeconds: 20,
    sessionToken: paperA.sessionToken,
  });

  for (let i = 1; i <= 3; i++) {
    engine.recordViolation('hs_a', paperA.attempt.id, {
      type: 'tab_switch',
      awaySeconds: 5,
      currentQuestionOrder: 2,
      sessionToken: paperA.sessionToken,
    });
  }

  // Lúc này hs_a đã bị tự nộp (violation), hs_b chưa vào thi -> 0 đang thi, 1 đã nộp, 1 chưa vào
  const detailBefore = engine.getTeacherSessionDetail('gv_toan', session.id);
  assert.equal(detailBefore.summary.inProgressCount, 0);
  assert.equal(detailBefore.summary.submittedCount, 1);
  assert.equal(detailBefore.summary.notEnteredCount, 1);

  // 2. Giáo viên bấm "Cho vào lại" cho hs_a (vừa bị tự nộp do sự cố):
  // - Tạo lượt thi mới (status = 'in_progress')
  // - Giữ nguyên bài cũ (oldAttempt.status === 'submitted', supersededByAttemptId = newAttempt.id)
  // - Sao chép nguyên vẹn 2 đáp án đã làm sang lượt thi mới
  // - Ghi rõ trong exam_audit_log
  const newAttempt = engine.allowStudentReentry(
    'gv_toan',
    session.id,
    paperA.attempt.id,
    20
  );
  assert.notEqual(newAttempt.id, paperA.attempt.id);
  assert.equal(newAttempt.status, 'in_progress');
  assert.equal(newAttempt.previousAttemptId, paperA.attempt.id);
  assert.equal(newAttempt.answeredCount, 2);

  const detailAfterReentry = engine.getTeacherSessionDetail('gv_toan', session.id);
  // Lượt thi cũ vẫn được bảo toàn nguyên vẹn trong danh sách attempts của ca thi
  const preservedOldAttempt = detailAfterReentry.attempts.find(
    (a) => a.id === paperA.attempt.id
  );
  assert.equal(Boolean(preservedOldAttempt), true);
  assert.equal(preservedOldAttempt?.status, 'submitted');
  assert.equal(preservedOldAttempt?.supersededByAttemptId, newAttempt.id);

  // Dòng tóm tắt cập nhật đúng: hs_a chuyển sang Đang thi (1 đang thi, 0 đã nộp, 1 chưa vào)
  assert.equal(detailAfterReentry.summary.inProgressCount, 1);
  assert.equal(detailAfterReentry.summary.submittedCount, 0);
  assert.equal(detailAfterReentry.summary.notEnteredCount, 1);

  // Học sinh hs_a nhập lại mã ca thi -> vào thẳng lượt thi mới và thấy đủ 2 câu đã làm trước đó
  const verifyA = engine.verifySessionCode('hs_a', session.code);
  assert.equal(verifyA.valid, true);
  assert.equal(verifyA.session?.canResumeAttemptId, newAttempt.id);
  const resumedPaperA = engine.startOrResumeAttempt('hs_a', session.code, 'dev_a2');
  assert.equal(resumedPaperA.attempt.id, newAttempt.id);
  assert.equal(resumedPaperA.savedAnswers['Q1']?.selectedAnswer, 'A');
  assert.deepEqual(resumedPaperA.savedAnswers['Q2']?.selectedAnswer, ['A', 'B']);

  // 3. Giáo viên "Gia hạn" thêm 10 phút cho riêng hs_a và "Gia hạn cho cả ca" thêm 5 phút
  const beforeExtendDeadline = new Date(resumedPaperA.attempt.deadlineAt).getTime();
  engine.extendTime('gv_toan', session.id, 10, newAttempt.id);
  engine.extendTime('gv_toan', session.id, 5);
  const detailAfterExtend = engine.getTeacherSessionDetail('gv_toan', session.id);
  const updatedAttemptA = detailAfterExtend.attempts.find(
    (a) => a.id === newAttempt.id
  )!;
  const afterExtendDeadline = new Date(updatedAttemptA.deadlineAt).getTime();
  assert.equal(
    afterExtendDeadline - beforeExtendDeadline,
    (10 + 5) * 60 * 1000
  );

  // 4. Giáo viên "Nộp bài giúp" (teacherForceSubmitAttempt) cho hs_a
  const forceSubmitted = engine.teacherForceSubmitAttempt(
    'gv_toan',
    session.id,
    newAttempt.id
  );
  assert.equal(forceSubmitted.status, 'submitted');
  assert.equal(forceSubmitted.submitReason, 'teacher_forced');
  assert.equal(forceSubmitted.score, 500); // 2/4 câu đúng

  // Kiểm tra nhật ký exam_audit_log ghi đầy đủ allow_reentry, extend, force_submit
  const detailLogs = engine.getTeacherSessionDetail('gv_toan', session.id).auditLogs;
  assert.equal(
    detailLogs.some(
      (l) =>
        l.action === 'allow_reentry' &&
        Boolean(l.note?.includes(paperA.attempt.id)) &&
        Boolean(l.note?.includes(newAttempt.id))
    ),
    true
  );
  assert.equal(detailLogs.some((l) => l.action === 'extend'), true);
  assert.equal(detailLogs.some((l) => l.action === 'force_submit'), true);

  // 5. Kiểm tra giả lập 40 học sinh (32 đang thi, 5 đã nộp, 3 chưa vào) trên một ca thi mới
  const simSession = engine.createSession('gv_toan', {
    title: 'Ca thi 40 Học sinh Giả lập',
    code: 'S4M5T6',
    targetClass: '12B1',
    questionCount: 4,
    durationMinutes: 45,
    status: 'open',
  });
  const simDetail = engine.simulateSessionStudents('gv_toan', simSession.id, {
    inProgressCount: 32,
    submittedCount: 5,
    notEnteredCount: 3,
  });
  assert.equal(simDetail.summary.inProgressCount, 32);
  assert.equal(simDetail.summary.submittedCount, 5);
  assert.equal(simDetail.summary.notEnteredCount, 3);
  assert.equal(simDetail.attempts[0].violationCount >= simDetail.attempts[1].violationCount, true);
});

test('Giáo viên tùy chỉnh (ví dụ khanglp) đồng bộ qua header hoặc sync-context tạo và tải danh sách ca thi thành công', async () => {
  const { engine } = createTestSetup();
  const app = express();
  app.use(express.json());
  app.use('/api', createExamSessionRouter(engine));

  const server = app.listen(0);
  try {
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    const baseUrl = `http://127.0.0.1:${port}/api`;

    // 1. Gọi GET /api/exam-sessions bằng tài khoản giáo viên mới 'khanglp' kèm header x-user-role: teacher
    const listRes = await fetch(`${baseUrl}/exam-sessions`, {
      headers: {
        'x-user-id': 'khanglp',
        'x-user-role': 'teacher',
        'x-user-fullname': encodeURIComponent('Lê Phúc Khang'),
      },
    });
    assert.equal(listRes.status, 200);
    const listJson = (await listRes.json()) as {
      ok: boolean;
      sessions: Array<{ id: string }>;
    };
    assert.equal(listJson.ok, true);

    // 2. Tạo ca thi mới bởi 'khanglp'
    const createRes = await fetch(`${baseUrl}/exam-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': 'khanglp',
        'x-user-role': 'teacher',
        'x-user-fullname': encodeURIComponent('Lê Phúc Khang'),
      },
      body: JSON.stringify({
        title: 'Kiểm tra GenAI Khối 12',
        targetClass: 'ALL',
        questionCount: 4,
        durationMinutes: 50,
        status: 'open',
      }),
    });
    assert.equal(createRes.status, 201);
    const createJson = (await createRes.json()) as {
      ok: boolean;
      session: { id: string; code: string; title: string; createdBy: string };
    };
    assert.equal(createJson.ok, true);
    assert.equal(createJson.session.createdBy, 'khanglp');
    assert.equal(createJson.session.code.length, 6);
  } finally {
    server.close();
  }
});

