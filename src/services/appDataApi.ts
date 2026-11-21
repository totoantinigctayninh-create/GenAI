import { ActiveStatus, ExamAttempt, Question, UserAccount } from '../types/exam';
import { examSessionApi } from './examSessionApi';

export interface PublicBrandingResponse {
  ok: true;
  departmentLogoUrl?: string;
  isOfficialDefaultLogo: boolean;
  questionsCount: number;
  quotaExceeded: boolean;
}

export interface AppBootstrapResponse {
  ok: true;
  role: 'teacher' | 'student';
  currentUser: UserAccount;
  users: UserAccount[];
  questions: Question[];
  attempts: ExamAttempt[];
  departmentLogoUrl?: string;
  isOfficialDefaultLogo: boolean;
  questionsCount: number;
  quotaExceeded: boolean;
  hydrated: {
    users: boolean;
    questions: boolean;
    attempts: boolean;
  };
  serverTime: string;
}

export interface StudentMutationResponse {
  ok: true;
  user: UserAccount;
  attempt?: ExamAttempt;
}

export interface TeacherMutationResponse {
  ok: true;
  question?: Question;
  questions?: Question[];
  student?: UserAccount;
  students?: UserAccount[];
  deletedCount?: number;
  deletedIds?: string[];
  departmentLogoUrl?: string;
  isOfficialDefaultLogo?: boolean;
}

let appDataApiUnavailable = false;

function isNetworkOrStaticHostError(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const msg = error.message;
    return (
      msg.includes('Failed to fetch') ||
      msg.includes('NetworkError') ||
      msg.includes('not valid JSON')
    );
  }
  return false;
}

async function requestAppData<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    body?: unknown;
    requireAuth?: boolean;
  } = {}
): Promise<T | null> {
  if (typeof window === 'undefined' || appDataApiUnavailable) {
    return null;
  }

  const headers: Record<string, string> = {};
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const token = examSessionApi.getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (options.requireAuth) {
    return null;
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

    // Nếu máy chủ trả về trang HTML tĩnh / 404 plain-text -> môi trường tĩnh không có Express API
    if (!data || typeof data !== 'object') {
      if (response.status === 404 || response.status === 405 || response.ok) {
        appDataApiUnavailable = true;
      }
      return null;
    }

    if (!response.ok || data.ok === false) {
      const err = new Error(
        String(data.message || 'Không thể kết nối dữ liệu máy chủ.')
      ) as Error & { status?: number; errorCode?: string };
      err.status = response.status;
      err.errorCode = typeof data.errorCode === 'string' ? data.errorCode : undefined;
      throw err;
    }

    return data as unknown as T;
  } catch (error) {
    if (isNetworkOrStaticHostError(error)) {
      appDataApiUnavailable = true;
      return null;
    }
    throw error;
  }
}

export const appDataApi = {
  isUnavailable(): boolean {
    return appDataApiUnavailable;
  },

  resetAvailability(): void {
    appDataApiUnavailable = false;
  },

  async getPublicBranding(): Promise<PublicBrandingResponse | null> {
    return requestAppData<PublicBrandingResponse>('/api/public/branding', {
      method: 'GET',
      requireAuth: false,
    });
  },

  async bootstrap(options?: {
    mode?: 'live-exam';
  }): Promise<AppBootstrapResponse | null> {
    const qs = options?.mode === 'live-exam' ? '?mode=live-exam' : '';
    return requestAppData<AppBootstrapResponse>(`/api/app/bootstrap${qs}`, {
      method: 'GET',
      requireAuth: true,
    });
  },

  async logout(): Promise<{ ok: true } | null> {
    return requestAppData<{ ok: true }>('/api/auth/logout', {
      method: 'POST',
      body: {},
      requireAuth: true,
    });
  },

  async toggleBookmark(
    questionId: string
  ): Promise<StudentMutationResponse | null> {
    return requestAppData<StudentMutationResponse>('/api/student/bookmark', {
      method: 'POST',
      body: { questionId },
      requireAuth: true,
    });
  },

  async recordPracticeCheck(
    questionId: string,
    isCorrect: boolean,
    removeOnCorrect: boolean = false
  ): Promise<StudentMutationResponse | null> {
    return requestAppData<StudentMutationResponse>('/api/student/practice-check', {
      method: 'POST',
      body: { questionId, isCorrect, removeOnCorrect },
      requireAuth: true,
    });
  },

  async markMastered(
    questionId: string
  ): Promise<StudentMutationResponse | null> {
    return requestAppData<StudentMutationResponse>('/api/student/mastered', {
      method: 'POST',
      body: { questionId },
      requireAuth: true,
    });
  },

  async syncStudyTime(
    additionalSeconds: number,
    activeStatus: ActiveStatus = 'studying'
  ): Promise<StudentMutationResponse | null> {
    return requestAppData<StudentMutationResponse>('/api/student/study-time', {
      method: 'POST',
      body: { additionalSeconds, activeStatus },
      requireAuth: true,
    });
  },

  async saveAttempt(
    attempt: ExamAttempt,
    wrongQuestionIdsFromExam: string[]
  ): Promise<StudentMutationResponse | null> {
    return requestAppData<StudentMutationResponse>('/api/student/attempts', {
      method: 'POST',
      body: { attempt, wrongQuestionIdsFromExam },
      requireAuth: true,
    });
  },

  async saveQuestion(
    question: Question
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>('/api/teacher/questions', {
      method: 'POST',
      body: { question },
      requireAuth: true,
    });
  },

  async saveQuestionsBatch(
    questions: Question[],
    replaceAll: boolean = false
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>('/api/teacher/questions/batch', {
      method: 'POST',
      body: { questions, replaceAll },
      requireAuth: true,
    });
  },

  async deleteQuestion(
    questionId: string
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>(
      `/api/teacher/questions/${encodeURIComponent(questionId)}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
  },

  async saveStudent(
    student: UserAccount
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>('/api/teacher/students', {
      method: 'POST',
      body: { student },
      requireAuth: true,
    });
  },

  async saveStudentsBatch(
    students: UserAccount[]
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>('/api/teacher/students/batch', {
      method: 'POST',
      body: { students },
      requireAuth: true,
    });
  },

  async updateStudentPassword(
    userId: string,
    newPassword: string
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>(
      `/api/teacher/students/${encodeURIComponent(userId)}/password`,
      {
        method: 'PATCH',
        body: { newPassword },
        requireAuth: true,
      }
    );
  },

  async resetStudentProgress(
    userId: string
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>(
      `/api/teacher/students/${encodeURIComponent(userId)}/reset-progress`,
      {
        method: 'POST',
        body: {},
        requireAuth: true,
      }
    );
  },

  async deleteStudent(
    userId: string
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>(
      `/api/teacher/students/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
  },

  async batchDeleteStudents(
    userIds: string[]
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>(
      '/api/teacher/students/batch-delete',
      {
        method: 'POST',
        body: { userIds },
        requireAuth: true,
      }
    );
  },

  async updateDepartmentLogo(
    logoUrl: string,
    isOfficialDefault: boolean
  ): Promise<TeacherMutationResponse | null> {
    return requestAppData<TeacherMutationResponse>('/api/teacher/logo', {
      method: 'POST',
      body: { logoUrl, isOfficialDefault },
      requireAuth: true,
    });
  },
};
