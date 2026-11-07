import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import { SEED_USERS } from '../data/seedData';
import {
  CreateExamSessionInput,
  ExamEngineError,
  ExamSessionEngine,
  ExamStorageAdapter,
  UpdateExamSessionInput,
} from '../server/examSessionEngine';
import {
  db,
  handleFirestoreError,
  isLegacyVirtualQuestion,
  isLegacyVirtualUser,
  OperationType,
} from './firebase';
import { Question, UserAccount, UserAnswer } from '../types/exam';
import {
  AttemptAnswerRecord,
  ExamAuditLogRecord,
  ExamSessionRecord,
  SessionAttemptRecord,
  StudentAttemptPaperPayload,
  StudentAttemptResultPayload,
  TeacherSessionDetailPayload,
  VerifyCodeResult,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession';

const USERS_CACHE_KEY = 'certiport_genai_users_cache_v3';
const QUESTIONS_CACHE_KEY = 'certiport_genai_questions_cache_v3';
const LOCAL_EXAM_ENGINE_CACHE_KEY = 'certiport_exam_sessions_engine_cache_v1';

interface CachedEngineSnapshot {
  sessions: ExamSessionRecord[];
  attempts: SessionAttemptRecord[];
  attemptAnswers: AttemptAnswerRecord[];
  violations: ViolationEventRecord[];
  auditLogs: ExamAuditLogRecord[];
}

function stripUndefinedFields<T extends object>(obj: T): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean;
}

function loadLocalArray<T>(key: string): T[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function loadLocalEngineSnapshot(): CachedEngineSnapshot {
  if (typeof window === 'undefined') {
    return {
      sessions: [],
      attempts: [],
      attemptAnswers: [],
      violations: [],
      auditLogs: [],
    };
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_EXAM_ENGINE_CACHE_KEY);
    if (!raw) {
      return {
        sessions: [],
        attempts: [],
        attemptAnswers: [],
        violations: [],
        auditLogs: [],
      };
    }
    const parsed = JSON.parse(raw) as Partial<CachedEngineSnapshot>;
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      attempts: Array.isArray(parsed.attempts) ? parsed.attempts : [],
      attemptAnswers: Array.isArray(parsed.attemptAnswers)
        ? parsed.attemptAnswers
        : [],
      violations: Array.isArray(parsed.violations) ? parsed.violations : [],
      auditLogs: Array.isArray(parsed.auditLogs) ? parsed.auditLogs : [],
    };
  } catch {
    return {
      sessions: [],
      attempts: [],
      attemptAnswers: [],
      violations: [],
      auditLogs: [],
    };
  }
}

function saveLocalEngineSnapshot(snapshot: CachedEngineSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LOCAL_EXAM_ENGINE_CACHE_KEY,
      JSON.stringify(snapshot)
    );
  } catch {
    // Bỏ qua nếu bộ nhớ cục bộ đầy
  }
}

let clientEngineInstance: ExamSessionEngine | null = null;
let clientEngineHydrationPromise: Promise<void> | null = null;
let activeProfileContext: UserAccount | null = null;
let serverApiUnavailable = false;

function createClientStorageAdapter(): ExamStorageAdapter {
  const localState = loadLocalEngineSnapshot();

  const persistSnapshot = () => {
    saveLocalEngineSnapshot(localState);
  };

  return {
    async onSessionSaved(session: ExamSessionRecord) {
      const idx = localState.sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) {
        localState.sessions[idx] = session;
      } else {
        localState.sessions.push(session);
      }
      persistSnapshot();

      const path = `exam_sessions/${session.id}`;
      try {
        await setDoc(
          doc(db, 'exam_sessions', session.id),
          stripUndefinedFields(session)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onSessionDeleted(sessionId: string) {
      localState.sessions = localState.sessions.filter((s) => s.id !== sessionId);
      persistSnapshot();

      const path = `exam_sessions/${sessionId}`;
      try {
        await deleteDoc(doc(db, 'exam_sessions', sessionId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    },

    async onAttemptSaved(attempt: SessionAttemptRecord) {
      const idx = localState.attempts.findIndex((a) => a.id === attempt.id);
      if (idx >= 0) {
        localState.attempts[idx] = attempt;
      } else {
        localState.attempts.push(attempt);
      }
      persistSnapshot();

      const path = `attempts/${attempt.id}`;
      try {
        const payload = stripUndefinedFields({
          ...attempt,
          userId: attempt.studentId,
          username: attempt.username || attempt.studentId,
          fullName: attempt.fullName || attempt.username || attempt.studentId,
          totalQuestions:
            attempt.totalQuestions ?? attempt.generatedQuestions?.length ?? 0,
          correctCount: attempt.correctCount ?? 0,
          examSet: attempt.sessionTitle,
          mode: `Ca thi: ${attempt.sessionTitle} (${attempt.sessionCode})`,
          certiportScore: attempt.score ?? 0,
          durationSeconds:
            attempt.durationSeconds ??
            (attempt.submittedAt
              ? Math.max(
                  0,
                  Math.round(
                    (new Date(attempt.submittedAt).getTime() -
                      new Date(attempt.startedAt).getTime()) /
                      1000
                  )
                )
              : 0),
          completedAt: attempt.submittedAt ?? attempt.startedAt,
        });
        await setDoc(doc(db, 'attempts', attempt.id), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onAnswerSaved(answer: AttemptAnswerRecord) {
      const idx = localState.attemptAnswers.findIndex((a) => a.id === answer.id);
      if (idx >= 0) {
        localState.attemptAnswers[idx] = answer;
      } else {
        localState.attemptAnswers.push(answer);
      }
      persistSnapshot();

      const path = `attempt_answers/${answer.id}`;
      try {
        await setDoc(
          doc(db, 'attempt_answers', answer.id),
          stripUndefinedFields(answer)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onViolationSaved(violation: ViolationEventRecord) {
      const idx = localState.violations.findIndex((v) => v.id === violation.id);
      if (idx >= 0) {
        localState.violations[idx] = violation;
      } else {
        localState.violations.push(violation);
      }
      persistSnapshot();

      const path = `violation_events/${violation.id}`;
      try {
        await setDoc(
          doc(db, 'violation_events', violation.id),
          stripUndefinedFields(violation)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onAuditLogSaved(log: ExamAuditLogRecord) {
      const idx = localState.auditLogs.findIndex((l) => l.id === log.id);
      if (idx >= 0) {
        localState.auditLogs[idx] = log;
      } else {
        localState.auditLogs.push(log);
      }
      persistSnapshot();

      const path = `exam_audit_log/${log.id}`;
      try {
        await setDoc(
          doc(db, 'exam_audit_log', log.id),
          stripUndefinedFields(log)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
  };
}

function hydrateClientEngineFromLocalCache(engine: ExamSessionEngine): void {
  const cachedUsers = loadLocalArray<UserAccount>(USERS_CACHE_KEY).filter(
    (u) => !isLegacyVirtualUser(u)
  );
  if (cachedUsers.length > 0) {
    engine.setUsers([...SEED_USERS, ...cachedUsers]);
  }
  if (activeProfileContext) {
    engine.upsertUser(activeProfileContext);
  }

  const cachedQuestions = loadLocalArray<Question>(QUESTIONS_CACHE_KEY).filter(
    (q) => !isLegacyVirtualQuestion(q)
  );
  if (cachedQuestions.length > 0) {
    engine.setQuestions(cachedQuestions);
  }

  const localSnapshot = loadLocalEngineSnapshot();
  engine.hydrateState(localSnapshot);
}

function getClientExamEngine(): ExamSessionEngine {
  if (!clientEngineInstance) {
    clientEngineInstance = new ExamSessionEngine({
      storageAdapter: createClientStorageAdapter(),
    });
    hydrateClientEngineFromLocalCache(clientEngineInstance);
  }
  return clientEngineInstance;
}

async function ensureClientEngineHydrated(): Promise<ExamSessionEngine> {
  const engine = getClientExamEngine();
  hydrateClientEngineFromLocalCache(engine);

  if (!clientEngineHydrationPromise && typeof window !== 'undefined') {
    clientEngineHydrationPromise = (async () => {
      try {
        const [
          usersSnap,
          questionsSnap,
          sessionsSnap,
          attemptsSnap,
          answersSnap,
          violationsSnap,
          auditSnap,
        ] = await Promise.all([
          getDocs(collection(db, 'users')).catch(() => null),
          getDocs(collection(db, 'questions')).catch(() => null),
          getDocs(collection(db, 'exam_sessions')).catch(() => null),
          getDocs(collection(db, 'attempts')).catch(() => null),
          getDocs(collection(db, 'attempt_answers')).catch(() => null),
          getDocs(collection(db, 'violation_events')).catch(() => null),
          getDocs(collection(db, 'exam_audit_log')).catch(() => null),
        ]);

        if (usersSnap && !usersSnap.empty) {
          const users = usersSnap.docs
            .map((d) => d.data() as UserAccount)
            .filter((u) => !isLegacyVirtualUser(u));
          if (users.length > 0) {
            engine.setUsers([...SEED_USERS, ...users]);
          }
        }
        if (activeProfileContext) {
          engine.upsertUser(activeProfileContext);
        }

        if (questionsSnap && !questionsSnap.empty) {
          const questions = questionsSnap.docs
            .map((d) => d.data() as Question)
            .filter((q) => !isLegacyVirtualQuestion(q));
          if (questions.length > 0) {
            engine.setQuestions(questions);
          }
        }

        const firestoreSessions =
          sessionsSnap?.docs.map((d) => d.data() as ExamSessionRecord) ?? [];
        const firestoreAttempts =
          attemptsSnap?.docs.map((d) => d.data() as SessionAttemptRecord) ?? [];
        const firestoreAnswers =
          answersSnap?.docs.map((d) => d.data() as AttemptAnswerRecord) ?? [];
        const firestoreViolations =
          violationsSnap?.docs.map((d) => d.data() as ViolationEventRecord) ?? [];
        const firestoreAuditLogs =
          auditSnap?.docs.map((d) => d.data() as ExamAuditLogRecord) ?? [];

        engine.hydrateState({
          sessions: firestoreSessions,
          attempts: firestoreAttempts,
          attemptAnswers: firestoreAnswers,
          violations: firestoreViolations,
          auditLogs: firestoreAuditLogs,
        });

        // Lắng nghe cập nhật thời gian thực từ Firestore
        onSnapshot(
          collection(db, 'exam_sessions'),
          (snap) => {
            const list = snap.docs.map((d) => d.data() as ExamSessionRecord);
            engine.hydrateState({ sessions: list });
          },
          () => {}
        );
        onSnapshot(
          collection(db, 'attempts'),
          (snap) => {
            const list = snap.docs.map((d) => d.data() as SessionAttemptRecord);
            engine.hydrateState({ attempts: list });
          },
          () => {}
        );
        onSnapshot(
          collection(db, 'attempt_answers'),
          (snap) => {
            const list = snap.docs.map((d) => d.data() as AttemptAnswerRecord);
            engine.hydrateState({ attemptAnswers: list });
          },
          () => {}
        );
        onSnapshot(
          collection(db, 'violation_events'),
          (snap) => {
            const list = snap.docs.map((d) => d.data() as ViolationEventRecord);
            engine.hydrateState({ violations: list });
          },
          () => {}
        );
      } catch {
        // Nếu đang ngoại tuyến, giữ nguyên dữ liệu từ localStorage
      }
    })();
  }

  if (clientEngineHydrationPromise) {
    await clientEngineHydrationPromise;
  }
  if (activeProfileContext) {
    engine.upsertUser(activeProfileContext);
  }
  return engine;
}

function ensureActorRegisteredInClientEngine(
  engine: ExamSessionEngine,
  actorId: string,
  expectedRole: 'teacher' | 'student'
): void {
  if (!actorId) return;
  if (activeProfileContext && (activeProfileContext.id === actorId || activeProfileContext.username === actorId)) {
    engine.upsertUser(activeProfileContext);
    return;
  }
  const existing = engine.getUser(actorId);
  if (existing) return;

  engine.upsertUser({
    id: actorId,
    username: actorId,
    password: '***',
    fullName:
      expectedRole === 'teacher'
        ? `Giáo viên (${actorId})`
        : `Học sinh (${actorId})`,
    role: expectedRole,
    className: expectedRole === 'student' ? '12A1' : '',
    lastLogin: new Date().toISOString(),
    status: 'online',
    totalStudyMinutes: 0,
  });
}

async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    userId: string;
    roleHint?: 'teacher' | 'student';
    sessionToken?: string;
    deviceId?: string;
    body?: unknown;
  },
  fallbackHandler: (engine: ExamSessionEngine) => T | Promise<T>
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': options.userId,
  };
  const role =
    options.roleHint ||
    (activeProfileContext &&
    (activeProfileContext.id === options.userId ||
      activeProfileContext.username === options.userId)
      ? activeProfileContext.role
      : undefined);

  if (role) {
    headers['x-user-role'] = role;
  }
  if (
    activeProfileContext &&
    (activeProfileContext.id === options.userId ||
      activeProfileContext.username === options.userId)
  ) {
    if (activeProfileContext.fullName) {
      headers['x-user-fullname'] = encodeURIComponent(
        activeProfileContext.fullName
      );
    }
    if (activeProfileContext.username) {
      headers['x-user-username'] = encodeURIComponent(
        activeProfileContext.username
      );
    }
    if (activeProfileContext.className) {
      headers['x-user-class'] = encodeURIComponent(
        activeProfileContext.className
      );
    }
  }
  if (options.sessionToken) {
    headers['x-exam-session-token'] = options.sessionToken;
  }
  if (options.deviceId) {
    headers['x-device-id'] = options.deviceId;
  }

  if (serverApiUnavailable) {
    const engine = await ensureClientEngineHydrated();
    if (role) {
      ensureActorRegisteredInClientEngine(engine, options.userId, role);
    }
    return await fallbackHandler(engine);
  }

  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });

    const rawText = await response.text();
    let data: Record<string, unknown> | null = null;
    try {
      data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
    } catch {
      data = null;
    }

    // Nếu máy chủ trả về trang tĩnh HTML hoặc lỗi 404 plain-text (ví dụ "The page could not be found" trên static host),
    // chuyển sang chạy trực tiếp trên ExamSessionEngine đồng bộ Firestore ở trình duyệt.
    if (!data || typeof data !== 'object') {
      serverApiUnavailable = true;
      const engine = await ensureClientEngineHydrated();
      if (role) {
        ensureActorRegisteredInClientEngine(engine, options.userId, role);
      }
      return await fallbackHandler(engine);
    }

    if (!response.ok && data.ok === false) {
      // Nếu máy chủ báo chưa có tài khoản hoặc chưa có ca thi do vừa khởi động lại, thử trên engine đồng bộ Firestore
      const errorCode = String(data.errorCode || '');
      if (
        errorCode === 'UNAUTHORIZED' ||
        errorCode === 'SESSION_NOT_FOUND' ||
        errorCode === 'ATTEMPT_NOT_FOUND'
      ) {
        try {
          const engine = await ensureClientEngineHydrated();
          if (role) {
            ensureActorRegisteredInClientEngine(engine, options.userId, role);
          }
          return await fallbackHandler(engine);
        } catch (fallbackErr) {
          if (fallbackErr instanceof ExamEngineError) {
            throw new Error(fallbackErr.message);
          }
          throw new Error(String(data.message || 'Yêu cầu thất bại.'));
        }
      }
      throw new Error(String(data.message || 'Yêu cầu thất bại.'));
    }

    // Đồng bộ kết quả từ máy chủ vào bộ nhớ clientEngine để giữ nhất quán
    const engine = getClientExamEngine();
    if (data.session && typeof data.session === 'object') {
      engine.hydrateState({ sessions: [data.session as ExamSessionRecord] });
    }
    if (Array.isArray(data.sessions)) {
      engine.hydrateState({ sessions: data.sessions as ExamSessionRecord[] });
    }
    return data as unknown as T;
  } catch (error) {
    // Nếu lỗi mạng hoặc lỗi cú pháp JSON từ proxy tĩnh, chạy trên engine đồng bộ Firestore
    if (
      error instanceof TypeError ||
      (error instanceof Error &&
        (error.message.includes('not valid JSON') ||
          error.message.includes('Failed to fetch') ||
          error.message.includes('NetworkError')))
    ) {
      serverApiUnavailable = true;
      const engine = await ensureClientEngineHydrated();
      if (role) {
        ensureActorRegisteredInClientEngine(engine, options.userId, role);
      }
      return await fallbackHandler(engine);
    }
    throw error;
  }
}

export const examSessionApi = {
  /**
   * Đồng bộ tài khoản đang đăng nhập, danh sách người dùng và ngân hàng câu hỏi
   * cho cả bộ xử lý Ca thi ở trình duyệt (Firestore) lẫn máy chủ Express.
   */
  syncContext(context: {
    currentUser?: UserAccount | null;
    users?: UserAccount[];
    questions?: Question[];
  }): void {
    const engine = getClientExamEngine();
    if (Array.isArray(context.users) && context.users.length > 0) {
      engine.setUsers([...SEED_USERS, ...context.users]);
    }
    if (context.currentUser) {
      activeProfileContext = context.currentUser;
      engine.upsertUser(context.currentUser);
    }
    if (Array.isArray(context.questions) && context.questions.length > 0) {
      engine.setQuestions(context.questions);
    }

    if (typeof window !== 'undefined' && !serverApiUnavailable) {
      void fetch('/api/exam-sessions/sync-context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentUser: context.currentUser ?? undefined,
          users: context.users,
          questions: context.questions,
        }),
      })
        .then((res) => {
          if (res.status === 404) {
            serverApiUnavailable = true;
          }
        })
        .catch(() => {
          serverApiUnavailable = true;
        });
    }
  },

  // ---- API Giáo viên ----
  listSessions(teacherId: string) {
    return apiRequest<{ ok: true; sessions: ExamSessionRecord[] }>(
      '/api/exam-sessions',
      { userId: teacherId, roleHint: 'teacher' },
      (engine) => ({
        ok: true,
        sessions: engine.listTeacherSessions(teacherId),
      })
    );
  },

  createSession(teacherId: string, input: CreateExamSessionInput) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      '/api/exam-sessions',
      { method: 'POST', userId: teacherId, roleHint: 'teacher', body: input },
      (engine) => ({
        ok: true,
        session: engine.createSession(teacherId, input),
      })
    );
  },

  getSessionDetail(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true } & TeacherSessionDetailPayload>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}`,
      { userId: teacherId, roleHint: 'teacher' },
      (engine) => ({
        ok: true,
        ...engine.getTeacherSessionDetail(teacherId, sessionId),
      })
    );
  },

  updateSession(
    teacherId: string,
    sessionId: string,
    patch: UpdateExamSessionInput
  ) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', userId: teacherId, roleHint: 'teacher', body: patch },
      (engine) => ({
        ok: true,
        session: engine.updateSession(teacherId, sessionId, patch),
      })
    );
  },

  openSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/open`,
      { method: 'POST', userId: teacherId, roleHint: 'teacher' },
      (engine) => ({
        ok: true,
        session: engine.openSession(teacherId, sessionId),
      })
    );
  },

  lockSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/lock`,
      { method: 'POST', userId: teacherId, roleHint: 'teacher' },
      (engine) => ({
        ok: true,
        session: engine.lockSession(teacherId, sessionId),
      })
    );
  },

  unlockSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/unlock`,
      { method: 'POST', userId: teacherId, roleHint: 'teacher' },
      (engine) => ({
        ok: true,
        session: engine.unlockSession(teacherId, sessionId),
      })
    );
  },

  endSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/end`,
      { method: 'POST', userId: teacherId, roleHint: 'teacher' },
      (engine) => ({
        ok: true,
        session: engine.endSession(teacherId, sessionId),
      })
    );
  },

  extendSession(
    teacherId: string,
    sessionId: string,
    extraMinutes: number,
    attemptId?: string
  ) {
    return apiRequest<{
      ok: true;
      session: ExamSessionRecord;
      updatedAttempts: SessionAttemptRecord[];
    }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/extend`,
      {
        method: 'POST',
        userId: teacherId,
        roleHint: 'teacher',
        body: { extraMinutes, attemptId },
      },
      (engine) => ({
        ok: true,
        ...engine.extendTime(teacherId, sessionId, extraMinutes, attemptId),
      })
    );
  },

  allowStudentReentry(
    teacherId: string,
    sessionId: string,
    attemptId: string,
    extraMinutes?: number
  ) {
    return apiRequest<{ ok: true; attempt: SessionAttemptRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/allow-reentry`,
      {
        method: 'POST',
        userId: teacherId,
        roleHint: 'teacher',
        body: {
          attemptId,
          ...(extraMinutes !== undefined ? { extraMinutes } : {}),
        },
      },
      (engine) => ({
        ok: true,
        attempt: engine.allowStudentReentry(
          teacherId,
          sessionId,
          attemptId,
          extraMinutes
        ),
      })
    );
  },

  forceSubmitAttempt(teacherId: string, sessionId: string, attemptId: string) {
    return apiRequest<{ ok: true; attempt: SessionAttemptRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/force-submit`,
      {
        method: 'POST',
        userId: teacherId,
        roleHint: 'teacher',
        body: { attemptId },
      },
      (engine) => ({
        ok: true,
        attempt: engine.teacherForceSubmitAttempt(
          teacherId,
          sessionId,
          attemptId
        ),
      })
    );
  },

  simulateStudents(
    teacherId: string,
    sessionId: string,
    options?: {
      inProgressCount?: number;
      submittedCount?: number;
      notEnteredCount?: number;
    }
  ) {
    return apiRequest<{ ok: true } & TeacherSessionDetailPayload>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/simulate-students`,
      {
        method: 'POST',
        userId: teacherId,
        roleHint: 'teacher',
        body: options ?? {},
      },
      (engine) => ({
        ok: true,
        ...engine.simulateSessionStudents(teacherId, sessionId, options),
      })
    );
  },

  cloneSession(teacherId: string, sessionId: string, title?: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/clone`,
      {
        method: 'POST',
        userId: teacherId,
        roleHint: 'teacher',
        body: { title },
      },
      (engine) => ({
        ok: true,
        session: engine.cloneSession(teacherId, sessionId, title),
      })
    );
  },

  deleteSession(teacherId: string, sessionId: string) {
    return apiRequest<{
      ok: true;
      deletedId: string;
      code: string;
      title: string;
    }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}`,
      {
        method: 'DELETE',
        userId: teacherId,
        roleHint: 'teacher',
      },
      (engine) => ({
        ok: true,
        ...engine.deleteSession(teacherId, sessionId),
      })
    );
  },

  // ---- API Học sinh ----
  verifyCode(
    studentId: string,
    code: string,
    studentProfile?: {
      id: string;
      username: string;
      fullName: string;
      className?: string;
    }
  ) {
    return apiRequest<VerifyCodeResult>(
      '/api/exam-sessions/verify-code',
      {
        method: 'POST',
        userId: studentId,
        roleHint: 'student',
        body: { code, studentProfile },
      },
      (engine) => {
        if (studentProfile) {
          engine.upsertUser({
            id: studentProfile.id || studentId,
            username: studentProfile.username || studentId,
            password: '***',
            fullName:
              studentProfile.fullName || studentProfile.username || studentId,
            role: 'student',
            className: studentProfile.className || '12A1',
            lastLogin: new Date().toISOString(),
            status: 'online',
            totalStudyMinutes: 0,
          });
        }
        return engine.verifySessionCode(studentId, code, 'client');
      }
    );
  },

  startExam(
    studentId: string,
    code: string,
    deviceId: string,
    options?: {
      studentProfile?: {
        id: string;
        username: string;
        fullName: string;
        className?: string;
      };
      keyboardLockSupported?: boolean;
      browserNote?: string;
    }
  ) {
    return apiRequest<{ ok: true } & StudentAttemptPaperPayload>(
      '/api/exam-sessions/start',
      {
        method: 'POST',
        userId: studentId,
        roleHint: 'student',
        deviceId,
        body: {
          code,
          deviceId,
          studentProfile: options?.studentProfile,
          keyboardLockSupported: options?.keyboardLockSupported,
          browserNote: options?.browserNote,
        },
      },
      (engine) => {
        if (options?.studentProfile) {
          engine.upsertUser({
            id: options.studentProfile.id || studentId,
            username: options.studentProfile.username || studentId,
            password: '***',
            fullName:
              options.studentProfile.fullName ||
              options.studentProfile.username ||
              studentId,
            role: 'student',
            className: options.studentProfile.className || '12A1',
            lastLogin: new Date().toISOString(),
            status: 'in_exam',
            totalStudyMinutes: 0,
          });
        }
        const paper = engine.startOrResumeAttempt(
          studentId,
          code,
          deviceId,
          'client',
          {
            keyboardLockSupported: options?.keyboardLockSupported,
            browserNote: options?.browserNote,
          }
        );
        return { ok: true, ...paper };
      }
    );
  },

  getAttemptPaper(studentId: string, attemptId: string, sessionToken: string) {
    return apiRequest<{ ok: true } & StudentAttemptPaperPayload>(
      `/api/attempts/${encodeURIComponent(attemptId)}/paper`,
      {
        userId: studentId,
        roleHint: 'student',
        sessionToken,
      },
      (engine) => ({
        ok: true,
        ...engine.getAttemptPaper(studentId, attemptId, sessionToken),
      })
    );
  },

  saveAnswer(
    studentId: string,
    attemptId: string,
    sessionToken: string,
    payload: {
      questionId: string;
      selectedAnswer: UserAnswer | null;
      timeSpentSeconds?: number;
      flagged?: boolean;
    }
  ) {
    return apiRequest<{ ok: true; answer: AttemptAnswerRecord }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/answers`,
      {
        method: 'POST',
        userId: studentId,
        roleHint: 'student',
        sessionToken,
        body: payload,
      },
      (engine) => ({
        ok: true,
        answer: engine.saveAttemptAnswer(studentId, attemptId, {
          questionId: payload.questionId,
          selectedAnswer: payload.selectedAnswer,
          timeSpentSeconds: payload.timeSpentSeconds,
          flagged: payload.flagged,
          sessionToken,
        }),
      })
    );
  },

  recordViolation(
    studentId: string,
    attemptId: string,
    sessionToken: string,
    payload: {
      type: ViolationEventType;
      occurredAt?: string;
      awaySeconds?: number;
      currentQuestionOrder?: number;
      note?: string;
      finalAnswers?: Array<{
        questionId: string;
        selectedAnswer: UserAnswer | null;
        timeSpentSeconds?: number;
        flagged?: boolean;
      }>;
    }
  ) {
    return apiRequest<{
      ok: true;
      violation: ViolationEventRecord;
      violationCount: number;
      maxViolations: number;
      countsTowardLimit: boolean;
      autoSubmitted: boolean;
      status: SessionAttemptRecord['status'];
      result?: StudentAttemptResultPayload;
    }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/violations`,
      {
        method: 'POST',
        userId: studentId,
        roleHint: 'student',
        sessionToken,
        body: payload,
      },
      (engine) => ({
        ok: true,
        ...engine.recordViolation(studentId, attemptId, {
          type: payload.type,
          occurredAt: payload.occurredAt,
          awaySeconds: payload.awaySeconds,
          currentQuestionOrder: payload.currentQuestionOrder,
          note: payload.note,
          sessionToken,
          finalAnswers: payload.finalAnswers,
        }),
      })
    );
  },

  submitAttempt(
    studentId: string,
    attemptId: string,
    sessionToken: string,
    options?: {
      reason?: 'voluntary' | 'timeout' | 'violation';
      finalAnswers?: Array<{
        questionId: string;
        selectedAnswer: UserAnswer | null;
        timeSpentSeconds?: number;
        flagged?: boolean;
      }>;
    }
  ) {
    return apiRequest<{ ok: true; result: StudentAttemptResultPayload }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/submit`,
      {
        method: 'POST',
        userId: studentId,
        roleHint: 'student',
        sessionToken,
        body: options ?? {},
      },
      (engine) => ({
        ok: true,
        result: engine.submitAttempt(studentId, attemptId, sessionToken, {
          reason: options?.reason ?? 'voluntary',
          finalAnswers: options?.finalAnswers,
        }),
      })
    );
  },

  getResult(studentId: string, attemptId: string) {
    return apiRequest<{ ok: true; result: StudentAttemptResultPayload }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/result`,
      { userId: studentId, roleHint: 'student' },
      (engine) => ({
        ok: true,
        result: engine.getAttemptResult(studentId, attemptId),
      })
    );
  },

  async listStudentAttempts(
    studentId: string
  ): Promise<StudentAttemptResultPayload[]> {
    const res = await apiRequest<{
      ok: true;
      attempts: StudentAttemptResultPayload[];
    }>(
      '/api/student/attempts',
      { userId: studentId, roleHint: 'student' },
      (engine) => ({
        ok: true,
        attempts: engine.listStudentSubmittedAttempts(studentId),
      })
    );
    return Array.isArray(res.attempts) ? res.attempts : [];
  },
};
