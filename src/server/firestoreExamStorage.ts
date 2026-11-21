import fs from 'node:fs';
import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  collection,
  deleteDoc,
  doc,
  getCountFromServer,
  getDoc,
  getDocs,
  getFirestore,
  initializeFirestore,
  setDoc,
  setLogLevel,
  writeBatch,
} from 'firebase/firestore';
import {
  DEFAULT_ADMIN_ACCOUNT,
  LEGACY_SEED_ATTEMPT_IDS,
  LEGACY_SEED_CREATED_PREFIX,
  LEGACY_SEED_QUESTION_IDS,
  LEGACY_SEED_USER_IDS,
  SEED_USERS,
} from '../data/seedData.ts';
import type { ExamAttempt, Question, UserAccount } from '../types/exam.ts';
import type {
  AttemptAnswerRecord,
  ExamAuditLogRecord,
  ExamSessionRecord,
  SessionAttemptRecord,
  ViolationEventRecord,
} from '../types/examSession.ts';
import {
  type AppDataPersistenceAdapter,
  FirestoreQuotaExceededError,
  isFirestoreQuotaError,
  ServerAppDataStore,
} from './appDataStore.ts';
import { ExamSessionEngine, type ExamStorageAdapter } from './examSessionEngine.ts';

setLogLevel('silent');

const DEPARTMENT_BRANDING_DOC_ID = 'system_department_logo';

const firebaseConfigUrl = new URL('../../firebase-applet-config.json', import.meta.url);
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigUrl, 'utf-8')) as {
  projectId: string;
  appId: string;
  apiKey: string;
  authDomain: string;
  firestoreDatabaseId: string;
  storageBucket?: string;
  messagingSenderId?: string;
};

const firebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);

function getServerFirestore() {
  try {
    return initializeFirestore(
      firebaseApp,
      { experimentalAutoDetectLongPolling: true },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
  }
}

const db = getServerFirestore();

const OperationType = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LIST: 'list',
  GET: 'get',
  WRITE: 'write',
} as const;

type ServerOperationType = (typeof OperationType)[keyof typeof OperationType];

function isSystemBrandingUser(u: UserAccount): boolean {
  return (
    u.id === DEPARTMENT_BRANDING_DOC_ID ||
    u.username === DEPARTMENT_BRANDING_DOC_ID
  );
}

function isLegacyVirtualUser(u: UserAccount): boolean {
  if (isSystemBrandingUser(u)) return true;
  return (
    LEGACY_SEED_USER_IDS.includes(u.id) &&
    Boolean(!u.createdAt || u.createdAt.startsWith('2026-10-20T08:'))
  );
}

function isLegacyVirtualQuestion(q: Question): boolean {
  return (
    q.id === 'Q176' ||
    (LEGACY_SEED_QUESTION_IDS.includes(q.id) &&
      Boolean(!q.createdAt || q.createdAt.startsWith(LEGACY_SEED_CREATED_PREFIX)))
  );
}

function isLegacyVirtualAttempt(a: ExamAttempt): boolean {
  return (
    LEGACY_SEED_ATTEMPT_IDS.includes(a.id) ||
    Boolean(a.userId && LEGACY_SEED_USER_IDS.includes(a.userId)) ||
    a.userId === 'student-preview-temp' ||
    Boolean(
      a.completedAt &&
        (a.completedAt.startsWith('2026-10-31') ||
          a.completedAt.startsWith('2026-11-01'))
    )
  );
}

function handleFirestoreError(
  error: unknown,
  operationType: ServerOperationType,
  path: string | null,
  appDataStore?: ServerAppDataStore
): void {
  if (isFirestoreQuotaError(error)) {
    appDataStore?.markFirestoreQuotaExceeded(true);
    console.warn('Firestore daily quota exceeded on:', path);
    return;
  }
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  if (
    lower.includes('client is offline') ||
    lower.includes('could not reach cloud firestore backend') ||
    lower.includes('unavailable') ||
    lower.includes('network error') ||
    lower.includes('failed to get document')
  ) {
    console.warn('Firestore offline/timeout fallback active:', path);
    return;
  }
  console.warn(
    'Firestore operation notice:',
    JSON.stringify({ error: msg, operationType, path })
  );
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

export function createFirestoreExamStorageAdapter(
  appDataStoreOrGetter?:
    | ServerAppDataStore
    | (() => ServerAppDataStore | undefined)
): ExamStorageAdapter {
  const resolveStore = (): ServerAppDataStore | undefined =>
    typeof appDataStoreOrGetter === 'function'
      ? appDataStoreOrGetter()
      : appDataStoreOrGetter;

  return {
    async onSessionSaved(session: ExamSessionRecord) {
      const path = `exam_sessions/${session.id}`;
      try {
        await setDoc(doc(db, 'exam_sessions', session.id), stripUndefinedFields(session));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path, resolveStore());
      }
    },

    async onSessionDeleted(sessionId: string) {
      const path = `exam_sessions/${sessionId}`;
      try {
        await deleteDoc(doc(db, 'exam_sessions', sessionId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path, resolveStore());
      }
    },

    async onAttemptSaved(attempt: SessionAttemptRecord) {
      const path = `attempts/${attempt.id}`;
      const durationSeconds =
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
          : 0);

      const enriched = {
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
        durationSeconds,
        completedAt: attempt.submittedAt ?? attempt.startedAt,
      };

      // Đồng bộ ngay vào RAM cache để Giáo viên xem kết quả không cần đọc lại Firestore
      if (attempt.submittedAt) {
        resolveStore()?.recordLiveSessionAttemptIfPresent(
          enriched as unknown as ExamAttempt
        );
      }

      try {
        await setDoc(doc(db, 'attempts', attempt.id), stripUndefinedFields(enriched));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path, resolveStore());
      }
    },

    async onAnswerSaved(answer: AttemptAnswerRecord) {
      const path = `attempt_answers/${answer.id}`;
      try {
        await setDoc(doc(db, 'attempt_answers', answer.id), stripUndefinedFields(answer));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path, resolveStore());
      }
    },

    async onViolationSaved(violation: ViolationEventRecord) {
      const path = `violation_events/${violation.id}`;
      try {
        await setDoc(
          doc(db, 'violation_events', violation.id),
          stripUndefinedFields(violation)
        );
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path, resolveStore());
      }
    },

    async onAuditLogSaved(log: ExamAuditLogRecord) {
      const path = `exam_audit_log/${log.id}`;
      try {
        await setDoc(doc(db, 'exam_audit_log', log.id), stripUndefinedFields(log));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path, resolveStore());
      }
    },
  };
}

/**
 * Bộ chuyển đổi ghi xuyên thấu (Write-Through) từ RAM máy chủ Express xuống Firestore
 * mà không cần đọc lại tài liệu trước khi ghi (0 lượt đọc thêm).
 */
export function createFirestoreAppDataPersistenceAdapter(
  onQuotaExceeded?: () => void
): AppDataPersistenceAdapter {
  const handleWriteError = (
    error: unknown,
    operationType: ServerOperationType,
    path: string
  ) => {
    if (isFirestoreQuotaError(error)) {
      onQuotaExceeded?.();
    }
    handleFirestoreError(error, operationType, path);
  };

  return {
    async saveUser(user: UserAccount) {
      const path = `users/${user.id}`;
      try {
        await setDoc(doc(db, 'users', user.id), stripUndefinedFields(user), {
          merge: true,
        });
      } catch (error) {
        handleWriteError(error, OperationType.WRITE, path);
      }
    },

    async saveUsersBatch(users: UserAccount[]) {
      const CHUNK_SIZE = 450;
      for (let i = 0; i < users.length; i += CHUNK_SIZE) {
        const chunk = users.slice(i, i + CHUNK_SIZE);
        try {
          const batch = writeBatch(db);
          for (const u of chunk) {
            batch.set(doc(db, 'users', u.id), stripUndefinedFields(u), {
              merge: true,
            });
          }
          await batch.commit();
        } catch (error) {
          handleWriteError(error, OperationType.WRITE, 'users/batch');
        }
      }
    },

    async deleteUser(userId: string) {
      if (userId.toLowerCase() === 'admin') return;
      const path = `users/${userId}`;
      try {
        await deleteDoc(doc(db, 'users', userId));
      } catch (error) {
        handleWriteError(error, OperationType.DELETE, path);
      }
    },

    async deleteUsersBatch(userIds: string[]) {
      const safeIds = userIds.filter((id) => id.toLowerCase() !== 'admin');
      const CHUNK_SIZE = 450;
      for (let i = 0; i < safeIds.length; i += CHUNK_SIZE) {
        const chunk = safeIds.slice(i, i + CHUNK_SIZE);
        try {
          const batch = writeBatch(db);
          for (const uid of chunk) {
            batch.delete(doc(db, 'users', uid));
          }
          await batch.commit();
        } catch (error) {
          handleWriteError(error, OperationType.DELETE, 'users/batch');
        }
      }
    },

    async saveQuestion(question: Question) {
      const path = `questions/${question.id}`;
      try {
        await setDoc(
          doc(db, 'questions', question.id),
          stripUndefinedFields(question)
        );
      } catch (error) {
        handleWriteError(error, OperationType.WRITE, path);
      }
    },

    async saveQuestionsBatch(questions: Question[]) {
      const CHUNK_SIZE = 450;
      for (let i = 0; i < questions.length; i += CHUNK_SIZE) {
        const chunk = questions.slice(i, i + CHUNK_SIZE);
        try {
          const batch = writeBatch(db);
          for (const q of chunk) {
            batch.set(doc(db, 'questions', q.id), stripUndefinedFields(q));
          }
          await batch.commit();
        } catch (error) {
          handleWriteError(error, OperationType.WRITE, 'questions/batch');
        }
      }
    },

    async deleteQuestion(questionId: string) {
      const path = `questions/${questionId}`;
      try {
        await deleteDoc(doc(db, 'questions', questionId));
      } catch (error) {
        handleWriteError(error, OperationType.DELETE, path);
      }
    },

    async saveAttempt(attempt: ExamAttempt) {
      const path = `attempts/${attempt.id}`;
      try {
        await setDoc(
          doc(db, 'attempts', attempt.id),
          stripUndefinedFields(attempt)
        );
      } catch (error) {
        handleWriteError(error, OperationType.WRITE, path);
      }
    },

    async deleteAttemptsBatch(attemptIds: string[]) {
      const CHUNK_SIZE = 450;
      for (let i = 0; i < attemptIds.length; i += CHUNK_SIZE) {
        const chunk = attemptIds.slice(i, i + CHUNK_SIZE);
        try {
          const batch = writeBatch(db);
          for (const aid of chunk) {
            batch.delete(doc(db, 'attempts', aid));
          }
          await batch.commit();
        } catch (error) {
          handleWriteError(error, OperationType.DELETE, 'attempts/batch');
        }
      }
    },

    async saveDepartmentLogo(logoUrl: string, isOfficialDefault: boolean) {
      const cleaned = logoUrl.trim();
      try {
        await setDoc(
          doc(db, 'users', DEPARTMENT_BRANDING_DOC_ID),
          {
            id: DEPARTMENT_BRANDING_DOC_ID,
            username: DEPARTMENT_BRANDING_DOC_ID,
            password: 'system_branding_locked',
            fullName: 'Cấu hình Logo Tổ Toán - Tin',
            role: 'teacher',
            className: 'Tổ Toán - Tin · Trường IGC Tây Ninh',
            lastLogin: new Date().toISOString(),
            status: 'offline',
            activeStatus: 'offline',
            totalStudyMinutes: 0,
            totalStudySeconds: 0,
            logoUrl: cleaned,
            isOfficialDefaultLogo: isOfficialDefault,
          },
          { merge: true }
        );
      } catch (error) {
        handleWriteError(
          error,
          OperationType.UPDATE,
          `users/${DEPARTMENT_BRANDING_DOC_ID}`
        );
      }

      try {
        await setDoc(
          doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id),
          {
            ...DEFAULT_ADMIN_ACCOUNT,
            logoUrl: cleaned,
          },
          { merge: true }
        );
      } catch (error) {
        handleWriteError(
          error,
          OperationType.UPDATE,
          `users/${DEFAULT_ADMIN_ACCOUNT.id}`
        );
      }
    },
  };
}

/**
 * Tra cứu đơn lẻ 1 tài liệu người dùng trên Firestore (chỉ gọi khi RAM máy chủ chưa khởi tải xong).
 * Nếu Firestore báo vượt hạn mức (resource-exhausted), ném rõ FirestoreQuotaExceededError thay vì trả về null.
 */
export async function lookupUserFromFirestore(
  usernameOrId: string
): Promise<UserAccount | null> {
  const clean = String(usernameOrId || '').trim();
  if (!clean) return null;

  try {
    const directSnap = await getDoc(doc(db, 'users', clean));
    if (directSnap.exists()) {
      const data = directSnap.data() as UserAccount;
      if (!isLegacyVirtualUser(data)) {
        return { ...data, id: data.id || directSnap.id };
      }
    }
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      throw new FirestoreQuotaExceededError();
    }
    handleFirestoreError(error, OperationType.GET, `users/${clean}`);
  }

  return null;
}

/**
 * Đếm nhanh số câu hỏi hiện có trên Firestore bằng truy vấn tổng hợp (chỉ dùng khi RAM chưa kịp khởi tải).
 */
export async function fetchQuestionCountFromFirestore(): Promise<number> {
  try {
    const snap = await getCountFromServer(collection(db, 'questions'));
    return Number(snap.data().count) || 0;
  } catch (error) {
    if (isFirestoreQuotaError(error)) {
      throw new FirestoreQuotaExceededError();
    }
    handleFirestoreError(error, OperationType.LIST, 'questions');
    return 0;
  }
}

/**
 * Khởi tải dữ liệu MỘT LẦN DUY NHẤT từ Firestore vào RAM máy chủ (`ExamSessionEngine` + `ServerAppDataStore`).
 * Không mở `onSnapshot` trùng lặp trên máy chủ để loại bỏ hoàn toàn lượt đọc dư thừa.
 */
export async function syncEngineWithFirestore(
  engine: ExamSessionEngine,
  appDataStore?: ServerAppDataStore
): Promise<() => void> {
  engine.setUsers(SEED_USERS);

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
      getDocs(collection(db, 'users')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'users', appDataStore);
        return null;
      }),
      getDocs(collection(db, 'questions')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'questions', appDataStore);
        return null;
      }),
      getDocs(collection(db, 'exam_sessions')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'exam_sessions', appDataStore);
        return null;
      }),
      getDocs(collection(db, 'attempts')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'attempts', appDataStore);
        return null;
      }),
      getDocs(collection(db, 'attempt_answers')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'attempt_answers', appDataStore);
        return null;
      }),
      getDocs(collection(db, 'violation_events')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'violation_events', appDataStore);
        return null;
      }),
      getDocs(collection(db, 'exam_audit_log')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'exam_audit_log', appDataStore);
        return null;
      }),
    ]);

    let hydratedUsers: UserAccount[] | undefined;
    let departmentLogoUrl = '';
    let isOfficialDefaultLogo = true;

    if (usersSnap) {
      let brandingLogo = '';
      let brandingIsDefault = true;
      let adminLogo = '';

      const realUsers: UserAccount[] = [];
      for (const d of usersSnap.docs) {
        const raw = d.data() as UserAccount & { isOfficialDefaultLogo?: boolean };
        const data: UserAccount = { ...raw, id: raw.id || d.id };
        if (d.id === DEPARTMENT_BRANDING_DOC_ID || isSystemBrandingUser(data)) {
          if (typeof raw.logoUrl === 'string' && raw.logoUrl.trim()) {
            brandingLogo = raw.logoUrl.trim();
            brandingIsDefault = Boolean(raw.isOfficialDefaultLogo);
          }
          continue;
        }
        if (d.id === DEFAULT_ADMIN_ACCOUNT.id && typeof raw.logoUrl === 'string' && raw.logoUrl.trim()) {
          adminLogo = raw.logoUrl.trim();
        }
        if (!isLegacyVirtualUser(data)) {
          realUsers.push(data);
        }
      }

      if (brandingLogo) {
        departmentLogoUrl = brandingLogo;
        isOfficialDefaultLogo = brandingIsDefault;
      } else if (adminLogo) {
        departmentLogoUrl = adminLogo;
        isOfficialDefaultLogo = false;
      }

      if (realUsers.length > 0) {
        hydratedUsers = realUsers;
        engine.replaceUsers(realUsers);
      }
    }

    let hydratedQuestions: Question[] | undefined;
    if (questionsSnap) {
      const questions = questionsSnap.docs
        .map((d) => d.data() as Question)
        .filter((q) => !isLegacyVirtualQuestion(q));
      hydratedQuestions = questions;
      engine.setQuestions(questions);
    }

    const rawAttemptDocs = attemptsSnap?.docs.map((d) => d.data()) ?? [];
    const sessionAttempts = rawAttemptDocs.filter(
      (a): a is SessionAttemptRecord =>
        Boolean(a && typeof a === 'object' && 'sessionId' in a && a.sessionId)
    );
    const practiceAndAllAttempts = rawAttemptDocs
      .map((a) => a as ExamAttempt)
      .filter((a) => a && a.id && !isLegacyVirtualAttempt(a));

    engine.hydrateState({
      sessions: sessionsSnap?.docs.map((d) => d.data() as ExamSessionRecord) ?? [],
      attempts: sessionAttempts,
      attemptAnswers:
        answersSnap?.docs.map((d) => d.data() as AttemptAnswerRecord) ?? [],
      violations:
        violationsSnap?.docs.map((d) => d.data() as ViolationEventRecord) ?? [],
      auditLogs: auditSnap?.docs.map((d) => d.data() as ExamAuditLogRecord) ?? [],
    });

    appDataStore?.hydrateFromStartup({
      users: hydratedUsers,
      questions: hydratedQuestions,
      attempts: attemptsSnap ? practiceAndAllAttempts : undefined,
      departmentLogoUrl,
      isOfficialDefaultLogo,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'exam_sessions_init', appDataStore);
  }

  // Tác vụ nền quét định kỳ mỗi 5 giây trên RAM để tự động thu bài hết giờ (0 lượt đọc Firestore)
  const sweepTimer = setInterval(() => {
    engine.sweepExpiredAttempts();
  }, 5000);

  return () => {
    clearInterval(sweepTimer);
  };
}
