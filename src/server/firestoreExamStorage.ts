import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  setDoc,
} from 'firebase/firestore';
import {
  db,
  handleFirestoreError,
  isLegacyVirtualQuestion,
  isLegacyVirtualUser,
  OperationType,
} from '../services/firebase';
import { SEED_USERS } from '../data/seedData';
import { Question, UserAccount } from '../types/exam';
import {
  AttemptAnswerRecord,
  ExamAuditLogRecord,
  ExamSessionRecord,
  SessionAttemptRecord,
  ViolationEventRecord,
} from '../types/examSession';
import { ExamSessionEngine, ExamStorageAdapter } from './examSessionEngine';

function stripUndefinedFields<T extends object>(obj: T): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      clean[k] = v;
    }
  }
  return clean;
}

export function createFirestoreExamStorageAdapter(): ExamStorageAdapter {
  return {
    async onSessionSaved(session: ExamSessionRecord) {
      const path = `exam_sessions/${session.id}`;
      try {
        await setDoc(doc(db, 'exam_sessions', session.id), stripUndefinedFields(session));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onSessionDeleted(sessionId: string) {
      const path = `exam_sessions/${sessionId}`;
      try {
        await deleteDoc(doc(db, 'exam_sessions', sessionId));
      } catch (error) {
        handleFirestoreError(error, OperationType.DELETE, path);
      }
    },

    async onAttemptSaved(attempt: SessionAttemptRecord) {
      const path = `attempts/${attempt.id}`;
      try {
        // Bổ sung các trường tương thích với schema Attempt hiện có trên Firestore
        const payload = stripUndefinedFields({
          ...attempt,
          userId: attempt.studentId,
          examSet: attempt.sessionTitle,
          mode: `Ca thi: ${attempt.sessionTitle} (${attempt.sessionCode})`,
          certiportScore: attempt.score ?? 0,
          durationSeconds: attempt.submittedAt
            ? Math.max(
                0,
                Math.round(
                  (new Date(attempt.submittedAt).getTime() -
                    new Date(attempt.startedAt).getTime()) /
                    1000
                )
              )
            : 0,
          completedAt: attempt.submittedAt ?? attempt.startedAt,
        });
        await setDoc(doc(db, 'attempts', attempt.id), payload);
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onAnswerSaved(answer: AttemptAnswerRecord) {
      const path = `attempt_answers/${answer.id}`;
      try {
        await setDoc(doc(db, 'attempt_answers', answer.id), stripUndefinedFields(answer));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
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
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },

    async onAuditLogSaved(log: ExamAuditLogRecord) {
      const path = `exam_audit_log/${log.id}`;
      try {
        await setDoc(doc(db, 'exam_audit_log', log.id), stripUndefinedFields(log));
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, path);
      }
    },
  };
}

/**
 * Khởi tạo dữ liệu ban đầu và đồng bộ thời gian thực từ Firestore vào `ExamSessionEngine`
 */
export async function syncEngineWithFirestore(
  engine: ExamSessionEngine
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
        handleFirestoreError(e, OperationType.LIST, 'users');
        return null;
      }),
      getDocs(collection(db, 'questions')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'questions');
        return null;
      }),
      getDocs(collection(db, 'exam_sessions')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'exam_sessions');
        return null;
      }),
      getDocs(collection(db, 'attempts')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'attempts');
        return null;
      }),
      getDocs(collection(db, 'attempt_answers')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'attempt_answers');
        return null;
      }),
      getDocs(collection(db, 'violation_events')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'violation_events');
        return null;
      }),
      getDocs(collection(db, 'exam_audit_log')).catch((e) => {
        handleFirestoreError(e, OperationType.LIST, 'exam_audit_log');
        return null;
      }),
    ]);

    if (usersSnap) {
      const users = usersSnap.docs
        .map((d) => d.data() as UserAccount)
        .filter((u) => !isLegacyVirtualUser(u));
      if (users.length > 0) {
        engine.setUsers(users);
      }
    }

    if (questionsSnap) {
      const questions = questionsSnap.docs
        .map((d) => d.data() as Question)
        .filter((q) => !isLegacyVirtualQuestion(q));
      engine.setQuestions(questions);
    }

    engine.hydrateState({
      sessions: sessionsSnap?.docs.map((d) => d.data() as ExamSessionRecord) ?? [],
      attempts: attemptsSnap?.docs.map((d) => d.data() as SessionAttemptRecord) ?? [],
      attemptAnswers:
        answersSnap?.docs.map((d) => d.data() as AttemptAnswerRecord) ?? [],
      violations:
        violationsSnap?.docs.map((d) => d.data() as ViolationEventRecord) ?? [],
      auditLogs: auditSnap?.docs.map((d) => d.data() as ExamAuditLogRecord) ?? [],
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, 'exam_sessions_init');
  }

  // Lắng nghe thay đổi của `users` và `questions` trên Firestore để máy chủ luôn có dữ liệu mới nhất
  const unsubUsers = onSnapshot(
    collection(db, 'users'),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as UserAccount)
        .filter((u) => !isLegacyVirtualUser(u));
      if (list.length > 0) {
        engine.setUsers(list);
      }
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'users')
  );

  const unsubQuestions = onSnapshot(
    collection(db, 'questions'),
    (snap) => {
      const list = snap.docs
        .map((d) => d.data() as Question)
        .filter((q) => !isLegacyVirtualQuestion(q));
      engine.setQuestions(list);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'questions')
  );

  // Tác vụ nền quét định kỳ mỗi 5 giây để tự động thu bài hết giờ
  const sweepTimer = setInterval(() => {
    engine.sweepExpiredAttempts();
  }, 5000);

  return () => {
    unsubUsers();
    unsubQuestions();
    clearInterval(sweepTimer);
  };
}
