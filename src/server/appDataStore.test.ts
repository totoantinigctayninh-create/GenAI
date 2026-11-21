import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import express from 'express';
import { createAppDataRouter } from './appDataRoutes.ts';
import {
  type AppDataPersistenceAdapter,
  FIRESTORE_QUOTA_ERROR_MESSAGE,
  ServerAppDataStore,
} from './appDataStore.ts';
import { ExamSessionEngine } from './examSessionEngine.ts';
import { createExamSessionRouter } from './examSessionRoutes.ts';
import type { ExamAttempt, Question, UserAccount } from '../types/exam.ts';

function createMockPersistence() {
  const savedUsers: UserAccount[] = [];
  const deletedUserIds: string[] = [];
  const savedQuestions: Question[] = [];
  const deletedQuestionIds: string[] = [];
  const savedAttempts: ExamAttempt[] = [];
  const deletedAttemptIds: string[] = [];
  const savedLogos: Array<{ logoUrl: string; isOfficialDefault: boolean }> = [];

  const adapter: AppDataPersistenceAdapter = {
    async saveUser(user) {
      savedUsers.push({ ...user });
    },
    async saveUsersBatch(users) {
      users.forEach((u) => savedUsers.push({ ...u }));
    },
    async deleteUser(userId) {
      deletedUserIds.push(userId);
    },
    async deleteUsersBatch(userIds) {
      deletedUserIds.push(...userIds);
    },
    async saveQuestion(question) {
      savedQuestions.push({ ...question });
    },
    async saveQuestionsBatch(questions) {
      questions.forEach((q) => savedQuestions.push({ ...q }));
    },
    async deleteQuestion(questionId) {
      deletedQuestionIds.push(questionId);
    },
    async saveAttempt(attempt) {
      savedAttempts.push({ ...attempt });
    },
    async deleteAttemptsBatch(attemptIds) {
      deletedAttemptIds.push(...attemptIds);
    },
    async saveDepartmentLogo(logoUrl, isOfficialDefault) {
      savedLogos.push({ logoUrl, isOfficialDefault });
    },
  };

  return {
    adapter,
    savedUsers,
    deletedUserIds,
    savedQuestions,
    deletedQuestionIds,
    savedAttempts,
    deletedAttemptIds,
    savedLogos,
  };
}

function makeSampleQuestion(id: string): Question {
  return {
    id,
    type: 'mcq_single',
    topic: '1. Nguyên tắc cơ bản về AI tạo sinh',
    prompt: `Câu hỏi mẫu ${id}`,
    options: [
      { id: 'A', text: 'Đáp án A' },
      { id: 'B', text: 'Đáp án B' },
    ],
    correctAnswer: 'A',
    explanation: 'Giải thích mẫu',
    examSet: 'Đề 1',
  };
}

async function startTestServer(options: {
  hydrated?: boolean;
  quotaExceeded?: boolean;
  lookupUser?: (usernameOrId: string) => Promise<UserAccount | null>;
}) {
  const persistence = createMockPersistence();
  const engine = new ExamSessionEngine();
  const store = new ServerAppDataStore(engine, persistence.adapter);

  const adminUser: UserAccount = {
    id: 'admin',
    username: 'admin',
    password: 'admin_secret',
    fullName: 'Quản trị viên',
    role: 'teacher',
    className: '',
    lastLogin: '2026-10-20T00:00:00.000Z',
    status: 'offline',
    activeStatus: 'offline',
    totalStudyMinutes: 0,
    totalStudySeconds: 0,
  };

  const teacherUser: UserAccount = {
    id: 'gv_toan',
    username: 'gv_toan',
    password: 'gv123',
    fullName: 'Giáo viên Toán',
    role: 'teacher',
    className: '12A1',
    lastLogin: '2026-10-20T00:00:00.000Z',
    status: 'offline',
    activeStatus: 'offline',
    totalStudyMinutes: 0,
    totalStudySeconds: 0,
  };

  const studentA: UserAccount = {
    id: 'hs_a',
    username: 'hs_a',
    password: '123',
    fullName: 'Nguyễn Văn A',
    role: 'student',
    className: '12A1',
    lastLogin: '2026-10-20T00:00:00.000Z',
    status: 'offline',
    activeStatus: 'offline',
    totalStudyMinutes: 0,
    totalStudySeconds: 0,
    bookmarkedQuestions: [],
    wrongQuestions: [],
    masteredQuestions: [],
    practiceProgress: {},
  };

  const studentB: UserAccount = {
    id: 'hs_b',
    username: 'hs_b',
    password: '456',
    fullName: 'Trần Thị B',
    role: 'student',
    className: '12A2',
    lastLogin: '2026-10-20T00:00:00.000Z',
    status: 'offline',
    activeStatus: 'offline',
    totalStudyMinutes: 5,
    totalStudySeconds: 300,
  };

  if (options.hydrated !== false) {
    store.hydrateFromStartup({
      users: [adminUser, teacherUser, studentA, studentB],
      questions: [makeSampleQuestion('Q1'), makeSampleQuestion('Q2')],
      attempts: [
        {
          id: 'att_b_1',
          userId: 'hs_b',
          username: 'hs_b',
          fullName: 'Trần Thị B',
          mode: 'Thi thử',
          examSet: 'Đề 1',
          certiportScore: 800,
          correctCount: 16,
          totalQuestions: 20,
          durationSeconds: 600,
          completedAt: '2026-10-21T08:00:00.000Z',
        },
      ],
      departmentLogoUrl: 'data:image/png;base64,TESTLOGO',
      isOfficialDefaultLogo: false,
    });
  }

  if (options.quotaExceeded) {
    store.markFirestoreQuotaExceeded(true);
  }

  const app = express();
  app.use(express.json());
  app.use('/api', createAppDataRouter(store, { authSecret: 'test-secret' }));
  app.use(
    '/api',
    createExamSessionRouter(engine, {
      authSecret: 'test-secret',
      lookupUser: options.lookupUser,
      appDataStore: store,
    })
  );

  const server = await new Promise<http.Server>((resolve) => {
    const srv = app.listen(0, '127.0.0.1', () => resolve(srv));
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    baseUrl,
    store,
    engine,
    persistence,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function apiJson(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {}
) {
  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (options.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }
  const resp = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = (await resp.json()) as Record<string, unknown>;
  return { status: resp.status, data };
}

test('Login uses Express RAM cache with 0 Firestore lookupUser calls once hydrated', async () => {
  let lookupCalls = 0;
  const ctx = await startTestServer({
    hydrated: true,
    lookupUser: async () => {
      lookupCalls += 1;
      return null;
    },
  });

  try {
    const branding = await apiJson(ctx.baseUrl, '/api/public/branding');
    assert.equal(branding.status, 200);
    assert.equal(branding.data.questionsCount, 2);
    assert.equal(branding.data.departmentLogoUrl, 'data:image/png;base64,TESTLOGO');
    assert.equal(branding.data.isOfficialDefaultLogo, false);

    const loginRes = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'hs_a', password: '123' },
    });
    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.data.ok, true);
    assert.equal(lookupCalls, 0);
    const loggedUser = loginRes.data.user as UserAccount;
    assert.equal(loggedUser.id, 'hs_a');
    assert.equal(loggedUser.password, '');
    assert.equal(loggedUser.activeStatus, 'studying');
    // Đăng nhập chỉ cập nhật trạng thái trong RAM (0 lượt ghi Firestore)
    assert.equal(ctx.persistence.savedUsers.length, 0);

    // Non-existent user while hydrated (and not quota-exceeded) returns 401 without calling Firestore lookup
    const badLogin = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'does_not_exist', password: '123' },
    });
    assert.equal(badLogin.status, 401);
    assert.equal(lookupCalls, 0);
    assert.match(String(badLogin.data.message), /Không tìm thấy tài khoản/);
  } finally {
    await ctx.close();
  }
});

test('Quota-exceeded login returns HTTP 503 with exact Vietnamese quota error message instead of account-not-found', async () => {
  const ctx = await startTestServer({
    hydrated: false,
    quotaExceeded: true,
  });

  try {
    const loginRes = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'khanglp', password: '123' },
    });
    assert.equal(loginRes.status, 503);
    assert.equal(loginRes.data.ok, false);
    assert.equal(loginRes.data.errorCode, 'FIRESTORE_QUOTA_EXCEEDED');
    assert.equal(loginRes.data.message, FIRESTORE_QUOTA_ERROR_MESSAGE);
  } finally {
    await ctx.close();
  }
});

test('Role-scoped bootstrap & student write-through mutations immediately reflect in Teacher bootstrap', async () => {
  const ctx = await startTestServer({ hydrated: true });

  try {
    // Login as student A
    const studentLogin = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'hs_a', password: '123' },
    });
    const studentToken = String(studentLogin.data.token);

    // Student normal bootstrap: sees ONLY self (no student B), 2 questions, 0 attempts
    const studentBoot = await apiJson(ctx.baseUrl, '/api/app/bootstrap', {
      token: studentToken,
    });
    assert.equal(studentBoot.status, 200);
    assert.equal(studentBoot.data.role, 'student');
    assert.equal((studentBoot.data.users as UserAccount[]).length, 1);
    assert.equal((studentBoot.data.users as UserAccount[])[0].id, 'hs_a');
    assert.equal((studentBoot.data.users as UserAccount[])[0].password, '');
    assert.equal((studentBoot.data.questions as Question[]).length, 2);
    assert.equal((studentBoot.data.attempts as ExamAttempt[]).length, 0);

    // Student live-exam bootstrap: receives 0 questions (anti-cheat)
    const liveBoot = await apiJson(
      ctx.baseUrl,
      '/api/app/bootstrap?mode=live-exam',
      { token: studentToken }
    );
    assert.equal(liveBoot.status, 200);
    assert.equal((liveBoot.data.questions as Question[]).length, 0);

    // Student cannot access teacher endpoints
    const forbidden = await apiJson(ctx.baseUrl, '/api/teacher/students', {
      method: 'POST',
      token: studentToken,
      body: { student: { id: 'x', username: 'x', password: '1', fullName: 'X', role: 'student' } },
    });
    assert.equal(forbidden.status, 403);

    // Student mutations: bookmark, wrong check, mastered, study-time, exam attempt
    const bmRes = await apiJson(ctx.baseUrl, '/api/student/bookmark', {
      method: 'POST',
      token: studentToken,
      body: { questionId: 'Q1' },
    });
    assert.equal(bmRes.status, 200);
    assert.deepEqual((bmRes.data.user as UserAccount).bookmarkedQuestions, ['Q1']);

    const checkWrong = await apiJson(ctx.baseUrl, '/api/student/practice-check', {
      method: 'POST',
      token: studentToken,
      body: { questionId: 'Q1', isCorrect: false, removeOnCorrect: false },
    });
    assert.equal(checkWrong.status, 200);
    assert.deepEqual((checkWrong.data.user as UserAccount).wrongQuestions, ['Q1']);

    const masteredRes = await apiJson(ctx.baseUrl, '/api/student/mastered', {
      method: 'POST',
      token: studentToken,
      body: { questionId: 'Q1' },
    });
    assert.equal(masteredRes.status, 200);
    assert.deepEqual((masteredRes.data.user as UserAccount).wrongQuestions, []);
    assert.deepEqual((masteredRes.data.user as UserAccount).masteredQuestions, ['Q1']);

    const timeRes = await apiJson(ctx.baseUrl, '/api/student/study-time', {
      method: 'POST',
      token: studentToken,
      body: { additionalSeconds: 180, activeStatus: 'studying' },
    });
    assert.equal(timeRes.status, 200);
    assert.equal((timeRes.data.user as UserAccount).totalStudySeconds, 180);
    assert.equal((timeRes.data.user as UserAccount).totalStudyMinutes, 3);

    const attemptRes = await apiJson(ctx.baseUrl, '/api/student/attempts', {
      method: 'POST',
      token: studentToken,
      body: {
        attempt: {
          id: 'att_a_1',
          userId: 'hs_a',
          username: 'hs_a',
          fullName: 'Nguyễn Văn A',
          className: '12A1',
          mode: 'Thi thử',
          examSet: 'Đề 1',
          certiportScore: 900,
          correctCount: 18,
          totalQuestions: 20,
          durationSeconds: 120,
          completedAt: '2026-10-22T09:00:00.000Z',
          answers: {},
        },
        wrongQuestionIdsFromExam: ['Q2'],
      },
    });
    assert.equal(attemptRes.status, 200);
    assert.equal((attemptRes.data.user as UserAccount).totalStudySeconds, 300);
    assert.deepEqual((attemptRes.data.user as UserAccount).wrongQuestions, ['Q2']);

    // Login as teacher -> immediately sees all updated progress from RAM
    const teacherLogin = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin_secret' },
    });
    const teacherToken = String(teacherLogin.data.token);

    const teacherBoot = await apiJson(ctx.baseUrl, '/api/app/bootstrap', {
      token: teacherToken,
    });
    assert.equal(teacherBoot.status, 200);
    assert.equal(teacherBoot.data.role, 'teacher');
    const allUsers = teacherBoot.data.users as UserAccount[];
    const refreshedStudentA = allUsers.find((u) => u.id === 'hs_a');
    assert.ok(refreshedStudentA);
    assert.equal(refreshedStudentA.totalStudySeconds, 300);
    assert.deepEqual(refreshedStudentA.bookmarkedQuestions, ['Q1']);
    assert.deepEqual(refreshedStudentA.wrongQuestions, ['Q2']);
    assert.deepEqual(refreshedStudentA.masteredQuestions, ['Q1']);
    assert.equal((teacherBoot.data.attempts as ExamAttempt[]).length, 2);

    // Kiểm chứng ngân sách ghi Firestore:
    // - Đăng nhập, bookmark, kiểm tra đáp án, đã nắm vững, thời gian ôn tập = 0 lượt ghi vào users/{uid}
    // - Nộp bài thi thử = đúng 1 lượt ghi duy nhất vào attempts/{attempt.id} và 0 lượt ghi vào users/{uid}
    assert.equal(ctx.persistence.savedUsers.length, 0);
    assert.equal(ctx.persistence.savedAttempts.length, 1);
    assert.equal(ctx.persistence.savedAttempts[0].id, 'att_a_1');

    // Giáo viên bấm Reset tiến độ học sinh -> ghi ngay progressResetAt và xóa attempts của học sinh đó
    const resetRes = await apiJson(
      ctx.baseUrl,
      '/api/teacher/students/hs_a/reset-progress',
      {
        method: 'POST',
        token: teacherToken,
      }
    );
    assert.equal(resetRes.status, 200);
    assert.equal(ctx.persistence.savedUsers.length, 1);
    assert.equal(ctx.persistence.savedUsers[0].id, 'hs_a');
    assert.equal(typeof ctx.persistence.savedUsers[0].progressResetAt, 'string');
    assert.deepEqual(ctx.persistence.deletedAttemptIds, ['att_a_1']);
  } finally {
    await ctx.close();
  }
});

test('Teacher CRUD write-through protects admin/self on batch delete and restricts logo to admin', async () => {
  const ctx = await startTestServer({ hydrated: true });

  try {
    const gvLogin = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'gv_toan', password: 'gv123' },
    });
    const gvToken = String(gvLogin.data.token);

    // Non-admin teacher cannot change department logo
    const logoForbidden = await apiJson(ctx.baseUrl, '/api/teacher/logo', {
      method: 'POST',
      token: gvToken,
      body: { logoUrl: 'data:image/png;base64,NEW', isOfficialDefault: false },
    });
    assert.equal(logoForbidden.status, 403);

    // Batch delete protects admin and gv_toan (actor), deletes hs_a & hs_b
    const batchDel = await apiJson(ctx.baseUrl, '/api/teacher/students/batch-delete', {
      method: 'POST',
      token: gvToken,
      body: { userIds: ['admin', 'gv_toan', 'hs_a', 'hs_b'] },
    });
    assert.equal(batchDel.status, 200);
    assert.deepEqual(batchDel.data.deletedIds, ['hs_a', 'hs_b']);
    assert.ok(ctx.engine.getUser('admin'));
    assert.ok(ctx.engine.getUser('gv_toan'));
    assert.equal(ctx.engine.getUser('hs_a'), undefined);

    // Admin can update logo & CRUD questions
    const adminLogin = await apiJson(ctx.baseUrl, '/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin_secret' },
    });
    const adminToken = String(adminLogin.data.token);

    const logoOk = await apiJson(ctx.baseUrl, '/api/teacher/logo', {
      method: 'POST',
      token: adminToken,
      body: { logoUrl: 'data:image/png;base64,ADMINLOGO', isOfficialDefault: false },
    });
    assert.equal(logoOk.status, 200);
    assert.equal(ctx.persistence.savedLogos.length, 1);

    const saveQ = await apiJson(ctx.baseUrl, '/api/teacher/questions', {
      method: 'POST',
      token: adminToken,
      body: { question: makeSampleQuestion('Q99') },
    });
    assert.equal(saveQ.status, 200);
    assert.equal(ctx.engine.getQuestionCount(), 3);

    const delQ = await apiJson(ctx.baseUrl, '/api/teacher/questions/Q99', {
      method: 'DELETE',
      token: adminToken,
    });
    assert.equal(delQ.status, 200);
    assert.equal(ctx.engine.getQuestionCount(), 2);
  } finally {
    await ctx.close();
  }
});
