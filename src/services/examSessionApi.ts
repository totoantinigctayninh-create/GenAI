import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import type {
  CreateExamSessionInput,
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
  SessionRealtimeEvent,
  StudentAttemptPaperPayload,
  StudentAttemptResultPayload,
  StudentAttemptStatusPayload,
  TeacherSessionDetailPayload,
  VerifyCodeResult,
  ViolationEventRecord,
  ViolationEventType,
} from '../types/examSession';

const AUTH_TOKEN_STORAGE_KEY = 'certiport_genai_auth_token_v1';
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

function loadStoredAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
    return token && token.trim() ? token.trim() : null;
  } catch {
    return null;
  }
}

function persistStoredAuthToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (token && token.trim()) {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token.trim());
    } else {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    }
  } catch {
    // Bỏ qua nếu bộ nhớ cục bộ bị chặn
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
let clientEngineLoadPromise: Promise<ExamSessionEngine> | null = null;
let clientEngineHydrationPromise: Promise<void> | null = null;
let activeProfileContext: UserAccount | null = null;
let pendingFallbackUsers: UserAccount[] = [];
let pendingFallbackQuestions: Question[] = [];
let currentAuthToken: string | null = loadStoredAuthToken();
let serverApiUnavailable = false;
let remoteSyncContextTimer: number | null = null;

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
  if (activeProfileContext) {
    engine.upsertUser(activeProfileContext);
  }
  if (pendingFallbackUsers.length > 0) {
    engine.setUsers(pendingFallbackUsers);
  }
  if (pendingFallbackQuestions.length > 0) {
    engine.setQuestions(pendingFallbackQuestions);
  }

  const localSnapshot = loadLocalEngineSnapshot();
  engine.hydrateState(localSnapshot);
}

async function getClientExamEngineAsync(): Promise<ExamSessionEngine> {
  if (clientEngineInstance) {
    return clientEngineInstance;
  }
  if (!clientEngineLoadPromise) {
    clientEngineLoadPromise = import('../server/examSessionEngine').then(
      ({ ExamSessionEngine: EngineClass }) => {
        const instance = new EngineClass({
          storageAdapter: createClientStorageAdapter(),
        });
        hydrateClientEngineFromLocalCache(instance);
        clientEngineInstance = instance;
        return instance;
      }
    );
  }
  return clientEngineLoadPromise;
}

async function ensureClientEngineHydrated(): Promise<ExamSessionEngine> {
  const engine = await getClientExamEngineAsync();
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
            engine.setUsers(users);
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
  };
  const authToken = currentAuthToken || loadStoredAuthToken();
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  const role =
    options.roleHint ||
    (activeProfileContext &&
    (activeProfileContext.id === options.userId ||
      activeProfileContext.username === options.userId)
      ? activeProfileContext.role
      : undefined);

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

    // Nếu máy chủ trả về trang tĩnh HTML hoặc lỗi 404 plain-text (ví dụ static host không có backend),
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
      const errorCode = String(data.errorCode || '');
      // Tuyệt đối không bỏ qua lỗi phân quyền / xác thực (401/403) bằng fallback cục bộ
      if (
        response.status === 401 ||
        response.status === 403 ||
        errorCode === 'UNAUTHORIZED' ||
        errorCode === 'FORBIDDEN_ROLE' ||
        errorCode === 'FORBIDDEN_SESSION_ACCESS' ||
        errorCode === 'FORBIDDEN_ATTEMPT_OWNERSHIP'
      ) {
        throw new Error(
          String(
            data.message ||
              'Phiên đăng nhập không hợp lệ hoặc bạn không có quyền thực hiện thao tác này.'
          )
        );
      }

      if (
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
          if (
            fallbackErr instanceof Error &&
            (fallbackErr.name === 'ExamEngineError' ||
              typeof (fallbackErr as { status?: number }).status === 'number')
          ) {
            throw new Error(fallbackErr.message);
          }
          throw new Error(String(data.message || 'Yêu cầu thất bại.'));
        }
      }
      throw new Error(String(data.message || 'Yêu cầu thất bại.'));
    }

    // Đồng bộ kết quả từ máy chủ vào bộ nhớ clientEngine nếu đã khởi tạo fallback
    if (clientEngineInstance) {
      if (data.session && typeof data.session === 'object') {
        clientEngineInstance.hydrateState({
          sessions: [data.session as ExamSessionRecord],
        });
      }
      if (Array.isArray(data.sessions)) {
        clientEngineInstance.hydrateState({
          sessions: data.sessions as ExamSessionRecord[],
        });
      }
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
  getAuthToken(): string | null {
    if (!currentAuthToken) {
      currentAuthToken = loadStoredAuthToken();
    }
    return currentAuthToken;
  },

  setAuthToken(token: string | null): void {
    currentAuthToken = token && token.trim() ? token.trim() : null;
    persistStoredAuthToken(currentAuthToken);
  },

  clearAuthToken(): void {
    currentAuthToken = null;
    activeProfileContext = null;
    if (remoteSyncContextTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(remoteSyncContextTimer);
      remoteSyncContextTimer = null;
    }
    persistStoredAuthToken(null);
  },

  /**
   * Lấy tổng số câu hỏi chuẩn hóa cho màn hình đăng nhập mà không tải về đáp án.
   */
  async getPublicStats(): Promise<{ questionsCount: number } | null> {
    if (typeof window === 'undefined' || serverApiUnavailable) return null;
    try {
      const response = await fetch('/api/public/stats');
      if (!response.ok) return null;
      const data = (await response.json()) as {
        ok?: boolean;
        questionsCount?: number;
      };
      if (data && data.ok && typeof data.questionsCount === 'number') {
        return { questionsCount: data.questionsCount };
      }
      return null;
    } catch {
      return null;
    }
  },

  /**
   * Đăng nhập qua máy chủ Express để nhận mã phiên HMAC-SHA256 hợp lệ.
   * Trả về `null` chỉ khi máy chủ API không khả dụng (ví dụ chạy static host không có backend).
   */
  async login(
    username: string,
    password: string
  ): Promise<{ token: string; user: UserAccount } | null> {
    if (typeof window === 'undefined' || serverApiUnavailable) {
      return null;
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }

      if (!data || typeof data !== 'object') {
        serverApiUnavailable = true;
        return null;
      }

      if (!response.ok || data.ok === false) {
        throw new Error(
          String(
            data.message || 'Tên đăng nhập hoặc mật khẩu không chính xác.'
          )
        );
      }

      const token = typeof data.token === 'string' ? data.token : '';
      const user = data.user as UserAccount | undefined;
      if (!token || !user) {
        throw new Error('Máy chủ không cấp được mã phiên hợp lệ.');
      }

      this.setAuthToken(token);
      activeProfileContext = user;
      return { token, user };
    } catch (error) {
      if (
        error instanceof TypeError ||
        (error instanceof Error &&
          (error.message.includes('Failed to fetch') ||
            error.message.includes('NetworkError')))
      ) {
        serverApiUnavailable = true;
        return null;
      }
      throw error;
    }
  },

  /**
   * Xác thực lại mã phiên HMAC-SHA256 hiện tại với máy chủ khi tải lại trang.
   */
  async verifySession(): Promise<
    | { status: 'valid'; user: UserAccount }
    | { status: 'invalid'; message: string }
    | { status: 'quota_exceeded'; message: string }
    | { status: 'offline' }
  > {
    if (typeof window === 'undefined' || serverApiUnavailable) {
      return { status: 'offline' };
    }
    const token = this.getAuthToken();
    if (!token) {
      return {
        status: 'invalid',
        message: 'Phiên đăng nhập đã hết hạn hoặc cần xác thực lại. Vui lòng đăng nhập để tiếp tục.',
      };
    }

    try {
      const response = await fetch('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const rawText = await response.text();
      let data: Record<string, unknown> | null = null;
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
      } catch {
        data = null;
      }

      if (!data || typeof data !== 'object') {
        serverApiUnavailable = true;
        return { status: 'offline' };
      }

      if (
        response.status === 503 ||
        data.errorCode === 'FIRESTORE_QUOTA_EXCEEDED'
      ) {
        return {
          status: 'quota_exceeded',
          message: String(
            data.message ||
              'Hệ thống tạm thời chạm giới hạn kết nối cơ sở dữ liệu trong ngày. Vui lòng thử lại sau hoặc báo giáo viên.'
          ),
        };
      }

      if (!response.ok || data.ok === false) {
        this.clearAuthToken();
        return {
          status: 'invalid',
          message: String(
            data.message ||
              'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.'
          ),
        };
      }

      const user = data.user as UserAccount;
      activeProfileContext = user;
      return { status: 'valid', user };
    } catch {
      return { status: 'offline' };
    }
  },

  /**
   * Hủy tác vụ gửi đồng bộ ngữ cảnh đang chờ (khi đăng xuất hoặc ngắt phiên).
   */
  cancelPendingRemoteContextSync(): void {
    if (remoteSyncContextTimer !== null) {
      window.clearTimeout(remoteSyncContextTimer);
      remoteSyncContextTimer = null;
    }
  },

  /**
   * Đồng bộ tài khoản đang đăng nhập, danh sách người dùng và ngân hàng câu hỏi.
   * - Luôn cập nhật bộ nhớ đệm nội bộ cục bộ (không gửi yêu cầu mạng).
   * - Chỉ gửi `POST /api/exam-sessions/sync-context` (debounce tối thiểu 5000ms)
   *   khi tài khoản là giáo viên có mã phiên HMAC hợp lệ VÀ `options.syncRemote === true`
   *   (tức khi câu hỏi hoặc thông tin định danh tài khoản thực sự thay đổi).
   */
  syncContext(
    context: {
      currentUser?: UserAccount | null;
      users?: UserAccount[];
      questions?: Question[];
    },
    options?: {
      syncRemote?: boolean;
      debounceMs?: number;
    }
  ): void {
    if (context.currentUser) {
      activeProfileContext = context.currentUser;
      clientEngineInstance?.upsertUser(context.currentUser);
    } else {
      activeProfileContext = null;
    }

    const isTeacher = context.currentUser?.role === 'teacher';
    if (isTeacher && Array.isArray(context.users) && context.users.length > 0) {
      pendingFallbackUsers = context.users;
      clientEngineInstance?.setUsers(context.users);
    }
    if (Array.isArray(context.questions)) {
      if (isTeacher || context.questions.length === 0) {
        pendingFallbackQuestions = context.questions;
        clientEngineInstance?.setQuestions(context.questions);
      }
    }

    if (!options?.syncRemote) {
      return;
    }

    const token = this.getAuthToken();
    if (
      typeof window !== 'undefined' &&
      !serverApiUnavailable &&
      isTeacher &&
      token
    ) {
      const payloadToSend = {
        currentUser: context.currentUser ?? undefined,
        users: context.users,
        questions: context.questions,
      };
      const delayMs = Math.max(5000, options.debounceMs ?? 5000);
      if (remoteSyncContextTimer !== null) {
        window.clearTimeout(remoteSyncContextTimer);
      }
      remoteSyncContextTimer = window.setTimeout(() => {
        remoteSyncContextTimer = null;
        const latestToken = this.getAuthToken();
        if (!latestToken || serverApiUnavailable) return;
        void fetch('/api/exam-sessions/sync-context', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${latestToken}`,
          },
          body: JSON.stringify(payloadToSend),
        })
          .then((res) => {
            if (res.status === 404) {
              serverApiUnavailable = true;
            }
          })
          .catch(() => {
            serverApiUnavailable = true;
          });
      }, delayMs);
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

  getAttemptStatus(studentId: string, attemptId: string, sessionToken: string) {
    return apiRequest<{ ok: true } & StudentAttemptStatusPayload>(
      `/api/exam-attempts/${encodeURIComponent(attemptId)}/status`,
      {
        userId: studentId,
        roleHint: 'student',
        sessionToken,
      },
      (engine) => ({
        ok: true,
        ...engine.getAttemptStatus(studentId, attemptId, sessionToken),
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

  updateViolationAwayDuration(
    studentId: string,
    attemptId: string,
    violationId: string,
    sessionToken: string,
    awaySeconds: number
  ) {
    return apiRequest<{ ok: true; violation: ViolationEventRecord }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/violations/${encodeURIComponent(violationId)}`,
      {
        method: 'PATCH',
        userId: studentId,
        roleHint: 'student',
        sessionToken,
        body: { awaySeconds },
      },
      (engine) => ({
        ok: true,
        violation: engine.updateViolationAwayDuration(
          studentId,
          attemptId,
          violationId,
          awaySeconds,
          sessionToken
        ),
      })
    );
  },

  /**
   * Mở luồng giám sát thời gian thực (SSE) cho giáo viên theo dõi một ca thi.
   * Tự động nhận bản chụp trạng thái ban đầu và mọi sự kiện học sinh vào phòng, làm bài, vi phạm gian lận tức thời.
   */
  subscribeToSessionStream(
    teacherId: string,
    sessionId: string,
    handlers: {
      onSnapshot: (detail: TeacherSessionDetailPayload) => void;
      onUpdate: (
        event: SessionRealtimeEvent,
        detail: TeacherSessionDetailPayload
      ) => void;
      onStatusChange?: (status: 'connected' | 'reconnecting' | 'offline') => void;
    }
  ): () => void {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') {
      handlers.onStatusChange?.('offline');
      return () => {};
    }

    const authToken = this.getAuthToken();
    if (!authToken) {
      handlers.onStatusChange?.('offline');
      return () => {};
    }

    const params = new URLSearchParams({
      authToken,
    });
    const url = `/api/exam-sessions/${encodeURIComponent(sessionId)}/stream?${params.toString()}`;
    let closed = false;
    const es = new EventSource(url);

    es.onopen = () => {
      if (closed) return;
      handlers.onStatusChange?.('connected');
    };

    es.addEventListener('snapshot', (ev: MessageEvent) => {
      if (closed) return;
      try {
        const parsed = JSON.parse(ev.data) as TeacherSessionDetailPayload & {
          ok?: boolean;
        };
        handlers.onStatusChange?.('connected');
        handlers.onSnapshot(parsed);
      } catch {
        // Bỏ qua payload lỗi định dạng
      }
    });

    es.addEventListener('update', (ev: MessageEvent) => {
      if (closed) return;
      try {
        const parsed = JSON.parse(ev.data) as {
          event: SessionRealtimeEvent;
          detail: TeacherSessionDetailPayload;
        };
        if (parsed?.detail && parsed?.event) {
          handlers.onStatusChange?.('connected');
          handlers.onUpdate(parsed.event, parsed.detail);
        }
      } catch {
        // Bỏ qua payload lỗi định dạng
      }
    });

    es.onerror = () => {
      if (closed) return;
      handlers.onStatusChange?.(
        es.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting'
      );
    };

    return () => {
      closed = true;
      es.close();
    };
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
