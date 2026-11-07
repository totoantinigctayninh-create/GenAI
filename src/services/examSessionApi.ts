import { UserAnswer } from '../types/exam';
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
import {
  CreateExamSessionInput,
  UpdateExamSessionInput,
} from '../server/examSessionEngine';

async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    userId: string;
    sessionToken?: string;
    deviceId?: string;
    body?: unknown;
  }
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': options.userId,
  };
  if (options.sessionToken) {
    headers['x-exam-session-token'] = options.sessionToken;
  }
  if (options.deviceId) {
    headers['x-device-id'] = options.deviceId;
  }

  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = await response.json();
  if (!response.ok && data?.ok === false) {
    throw new Error(data.message || 'Yêu cầu thất bại.');
  }
  return data as T;
}

export const examSessionApi = {
  // ---- API Giáo viên ----
  listSessions(teacherId: string) {
    return apiRequest<{ ok: true; sessions: ExamSessionRecord[] }>(
      '/api/exam-sessions',
      { userId: teacherId }
    );
  },

  createSession(teacherId: string, input: CreateExamSessionInput) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      '/api/exam-sessions',
      { method: 'POST', userId: teacherId, body: input }
    );
  },

  getSessionDetail(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true } & TeacherSessionDetailPayload>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}`,
      {
        userId: teacherId,
      }
    );
  },

  updateSession(
    teacherId: string,
    sessionId: string,
    patch: UpdateExamSessionInput
  ) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}`,
      { method: 'PATCH', userId: teacherId, body: patch }
    );
  },

  openSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/open`,
      { method: 'POST', userId: teacherId }
    );
  },

  lockSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/lock`,
      { method: 'POST', userId: teacherId }
    );
  },

  unlockSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/unlock`,
      { method: 'POST', userId: teacherId }
    );
  },

  endSession(teacherId: string, sessionId: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/end`,
      { method: 'POST', userId: teacherId }
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
    }>(`/api/exam-sessions/${encodeURIComponent(sessionId)}/extend`, {
      method: 'POST',
      userId: teacherId,
      body: { extraMinutes, attemptId },
    });
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
        body: { attemptId, ...(extraMinutes !== undefined ? { extraMinutes } : {}) },
      }
    );
  },

  forceSubmitAttempt(teacherId: string, sessionId: string, attemptId: string) {
    return apiRequest<{ ok: true; attempt: SessionAttemptRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/force-submit`,
      { method: 'POST', userId: teacherId, body: { attemptId } }
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
      { method: 'POST', userId: teacherId, body: options ?? {} }
    );
  },

  cloneSession(teacherId: string, sessionId: string, title?: string) {
    return apiRequest<{ ok: true; session: ExamSessionRecord }>(
      `/api/exam-sessions/${encodeURIComponent(sessionId)}/clone`,
      { method: 'POST', userId: teacherId, body: { title } }
    );
  },

  deleteSession(teacherId: string, sessionId: string) {
    return apiRequest<{
      ok: true;
      deletedId: string;
      code: string;
      title: string;
    }>(`/api/exam-sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      userId: teacherId,
    });
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
    return apiRequest<VerifyCodeResult>('/api/exam-sessions/verify-code', {
      method: 'POST',
      userId: studentId,
      body: { code, studentProfile },
    });
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
        deviceId,
        body: {
          code,
          deviceId,
          studentProfile: options?.studentProfile,
          keyboardLockSupported: options?.keyboardLockSupported,
          browserNote: options?.browserNote,
        },
      }
    );
  },

  getAttemptPaper(studentId: string, attemptId: string, sessionToken: string) {
    return apiRequest<{ ok: true } & StudentAttemptPaperPayload>(
      `/api/attempts/${encodeURIComponent(attemptId)}/paper`,
      {
        userId: studentId,
        sessionToken,
      }
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
        sessionToken,
        body: payload,
      }
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
    }>(`/api/attempts/${encodeURIComponent(attemptId)}/violations`, {
      method: 'POST',
      userId: studentId,
      sessionToken,
      body: payload,
    });
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
        sessionToken,
        body: options ?? {},
      }
    );
  },

  getResult(studentId: string, attemptId: string) {
    return apiRequest<{ ok: true; result: StudentAttemptResultPayload }>(
      `/api/attempts/${encodeURIComponent(attemptId)}/result`,
      { userId: studentId }
    );
  },

  async listStudentAttempts(
    studentId: string
  ): Promise<StudentAttemptResultPayload[]> {
    const res = await apiRequest<{
      ok: true;
      attempts: StudentAttemptResultPayload[];
    }>('/api/student/attempts', { userId: studentId });
    return Array.isArray(res.attempts) ? res.attempts : [];
  },
};
