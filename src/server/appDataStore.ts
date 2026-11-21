import {
  ActiveStatus,
  ExamAttempt,
  Question,
  UserAccount,
} from '../types/exam.ts';
import { computeUpdatedWrongQuestions } from '../utils/scoring.ts';
import { ExamSessionEngine } from './examSessionEngine.ts';

export const FIRESTORE_QUOTA_ERROR_MESSAGE =
  'Hệ thống tạm thời chạm giới hạn kết nối cơ sở dữ liệu trong ngày. Vui lòng thử lại sau hoặc báo giáo viên.';

export class FirestoreQuotaExceededError extends Error {
  public readonly statusCode = 503;
  public readonly errorCode = 'FIRESTORE_QUOTA_EXCEEDED';

  constructor(message: string = FIRESTORE_QUOTA_ERROR_MESSAGE) {
    super(message);
    this.name = 'FirestoreQuotaExceededError';
  }
}

export function isFirestoreQuotaError(error: unknown): boolean {
  if (!error) return false;
  if (error instanceof FirestoreQuotaExceededError) return true;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '').toLowerCase()
      : '';
  const msg =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();
  return (
    code === 'resource-exhausted' ||
    msg.includes('resource-exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('quota limit exceeded') ||
    msg.includes('free daily read units')
  );
}

export interface AppDataPersistenceAdapter {
  saveUser(user: UserAccount): Promise<void>;
  saveUsersBatch(users: UserAccount[]): Promise<void>;
  deleteUser(userId: string): Promise<void>;
  deleteUsersBatch(userIds: string[]): Promise<void>;
  saveQuestion(question: Question): Promise<void>;
  saveQuestionsBatch(questions: Question[]): Promise<void>;
  deleteQuestion(questionId: string): Promise<void>;
  saveAttempt(attempt: ExamAttempt): Promise<void>;
  deleteAttemptsBatch(attemptIds: string[]): Promise<void>;
  saveDepartmentLogo(
    logoUrl: string,
    isOfficialDefault: boolean
  ): Promise<void>;
}

const noopPersistenceAdapter: AppDataPersistenceAdapter = {
  async saveUser() {},
  async saveUsersBatch() {},
  async deleteUser() {},
  async deleteUsersBatch() {},
  async saveQuestion() {},
  async saveQuestionsBatch() {},
  async deleteQuestion() {},
  async saveAttempt() {},
  async deleteAttemptsBatch() {},
  async saveDepartmentLogo() {},
};

function normalizeUserDefaults(u: UserAccount): UserAccount {
  const id = (u.id || u.username || '').trim();
  return {
    ...u,
    id,
    username: (u.username || id).trim(),
    bookmarkedQuestions: Array.isArray(u.bookmarkedQuestions)
      ? u.bookmarkedQuestions
      : [],
    wrongQuestions: Array.isArray(u.wrongQuestions) ? u.wrongQuestions : [],
    masteredQuestions: Array.isArray(u.masteredQuestions)
      ? u.masteredQuestions
      : [],
    practiceProgress:
      u.practiceProgress && typeof u.practiceProgress === 'object'
        ? u.practiceProgress
        : {},
  };
}

function sanitizeQuestion(question: Question): Question {
  const sanitizedId = question.id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  return {
    ...question,
    id: sanitizedId || question.id.trim(),
    prompt: question.prompt.replace(/\r\n?/g, '\n').trim().slice(0, 2000),
    explanation: question.explanation
      .replace(/\r\n?/g, '\n')
      .trim()
      .slice(0, 2000),
  };
}

function sortQuestionsNaturally(list: Question[]): Question[] {
  return [...list].sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true })
  );
}

function sortAttemptsDesc(list: ExamAttempt[]): ExamAttempt[] {
  return [...list].sort((a, b) =>
    String(b.completedAt || '').localeCompare(String(a.completedAt || ''))
  );
}

/**
 * Kho bộ nhớ đệm Write-Through trên máy chủ Express:
 * - Đọc Firestore duy nhất 1 lần lúc khởi động máy chủ.
 * - Mọi yêu cầu đọc từ trình duyệt đều đọc thẳng từ RAM máy chủ (0 lượt đọc Firestore).
 * - Mọi yêu cầu ghi đều cập nhật RAM ngay lập tức (giáo viên/học sinh thấy tức thì) rồi ghi bền vững xuống Firestore.
 */
export class ServerAppDataStore {
  private readonly engine: ExamSessionEngine;
  private readonly persistence: AppDataPersistenceAdapter;
  private readonly attempts = new Map<string, ExamAttempt>();
  private departmentLogoUrl: string = '';
  private isOfficialDefaultLogo: boolean = true;
  private hydratedUsers: boolean = false;
  private hydratedQuestions: boolean = false;
  private hydratedAttempts: boolean = false;
  private firestoreQuotaExceeded: boolean = false;
  private lastHydratedAt: string | null = null;

  constructor(
    engine: ExamSessionEngine,
    persistence: AppDataPersistenceAdapter = noopPersistenceAdapter
  ) {
    this.engine = engine;
    this.persistence = persistence;
  }

  public markFirestoreQuotaExceeded(exceeded: boolean): void {
    this.firestoreQuotaExceeded = exceeded;
  }

  public isFirestoreQuotaExceeded(): boolean {
    return this.firestoreQuotaExceeded;
  }

  public isUsersHydrated(): boolean {
    return this.hydratedUsers;
  }

  public isQuestionsHydrated(): boolean {
    return this.hydratedQuestions;
  }

  public getLastHydratedAt(): string | null {
    return this.lastHydratedAt;
  }

  public hydrateFromStartup(payload: {
    users?: UserAccount[];
    questions?: Question[];
    attempts?: ExamAttempt[];
    departmentLogoUrl?: string;
    isOfficialDefaultLogo?: boolean;
  }): void {
    if (Array.isArray(payload.users)) {
      const normalized = payload.users.map(normalizeUserDefaults);
      if (normalized.length > 0) {
        this.engine.replaceUsers(normalized);
      }
      this.hydratedUsers = true;
    }

    if (Array.isArray(payload.questions)) {
      this.engine.setQuestions(sortQuestionsNaturally(payload.questions));
      this.hydratedQuestions = true;
    }

    if (Array.isArray(payload.attempts)) {
      this.attempts.clear();
      for (const att of payload.attempts) {
        if (att && att.id) {
          this.attempts.set(att.id, att);
        }
      }
      this.hydratedAttempts = true;
    }

    if (typeof payload.departmentLogoUrl === 'string') {
      this.departmentLogoUrl = payload.departmentLogoUrl.trim();
    }
    if (typeof payload.isOfficialDefaultLogo === 'boolean') {
      this.isOfficialDefaultLogo = payload.isOfficialDefaultLogo;
    }

    this.lastHydratedAt = new Date().toISOString();
  }

  // ============================================================================
  // 1. ĐỌC TỪ BỘ NHỚ RAM (0 LƯỢT ĐỌC FIRESTORE)
  // ============================================================================

  public getPublicBranding(): {
    departmentLogoUrl: string;
    isOfficialDefaultLogo: boolean;
    questionsCount: number;
    quotaExceeded: boolean;
  } {
    return {
      departmentLogoUrl: this.departmentLogoUrl,
      isOfficialDefaultLogo: this.isOfficialDefaultLogo,
      questionsCount: this.engine.getQuestionCount(),
      quotaExceeded: this.firestoreQuotaExceeded,
    };
  }

  public getQuestionCount(): number {
    return this.engine.getQuestionCount();
  }

  public getUsers(): UserAccount[] {
    return this.engine.getAllUsers().map(normalizeUserDefaults);
  }

  public getUser(userIdOrUsername: string): UserAccount | undefined {
    const found = this.engine.getUser(userIdOrUsername);
    return found ? normalizeUserDefaults(found) : undefined;
  }

  public getQuestions(): Question[] {
    return sortQuestionsNaturally(this.engine.getRawQuestions());
  }

  public getAllAttempts(): ExamAttempt[] {
    return sortAttemptsDesc(Array.from(this.attempts.values()));
  }

  public getStudentAttempts(userId: string, username?: string): ExamAttempt[] {
    const safeId = userId.trim().toLowerCase();
    const safeUsername = (username || '').trim().toLowerCase();
    const filtered = Array.from(this.attempts.values()).filter((att) => {
      const attUid = String(att.userId || '').trim().toLowerCase();
      const attUname = String(att.username || '').trim().toLowerCase();
      return (
        (safeId && attUid === safeId) ||
        (safeUsername && attUname === safeUsername) ||
        (safeId && attUname === safeId)
      );
    });
    return sortAttemptsDesc(filtered);
  }

  public recordLiveSessionAttemptIfPresent(attempt: ExamAttempt): void {
    if (!attempt || !attempt.id) return;
    this.attempts.set(attempt.id, attempt);
  }

  // ============================================================================
  // 2. GHI XUYÊN THẤU (WRITE-THROUGH) CHO HỌC SINH & PHIÊN ĐĂNG NHẬP
  // ============================================================================

  private fireAndForgetPersist(task: Promise<void>): void {
    task.catch((err) => {
      if (isFirestoreQuotaError(err)) {
        this.firestoreQuotaExceeded = true;
      }
      console.warn(
        'AppDataStore write-through persistence notice:',
        err instanceof Error ? err.message : String(err)
      );
    });
  }

  public recordUserLoginActivity(userId: string): UserAccount | undefined {
    const current = this.getUser(userId);
    if (!current) return undefined;
    const nowIso = new Date().toISOString();
    const nextStatus: ActiveStatus =
      current.role === 'student' ? 'studying' : 'online';
    const updated: UserAccount = {
      ...current,
      lastLogin: nowIso,
      status: nextStatus,
      activeStatus: nextStatus,
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return updated;
  }

  public recordUserLogoutActivity(userId: string): void {
    const current = this.getUser(userId);
    if (!current) return;
    const updated: UserAccount = {
      ...current,
      status: 'offline',
      activeStatus: 'offline',
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
  }

  public toggleStudentBookmark(
    userId: string,
    questionId: string
  ): UserAccount | undefined {
    const current = this.getUser(userId);
    const cleanQid = questionId.trim();
    if (!current || !cleanQid) return current;

    const existing = current.bookmarkedQuestions ?? [];
    const nextBookmarks = existing.includes(cleanQid)
      ? existing.filter((id) => id !== cleanQid)
      : [...existing, cleanQid];

    const updated: UserAccount = {
      ...current,
      bookmarkedQuestions: nextBookmarks,
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return updated;
  }

  public recordStudentPracticeCheck(
    userId: string,
    questionId: string,
    isCorrect: boolean,
    removeOnCorrect: boolean = false
  ): UserAccount | undefined {
    const current = this.getUser(userId);
    const cleanQid = questionId.trim();
    if (!current || !cleanQid) return current;

    const { wrongQuestions, masteredQuestions } = computeUpdatedWrongQuestions(
      current.wrongQuestions ?? [],
      current.masteredQuestions ?? [],
      cleanQid,
      isCorrect,
      removeOnCorrect
    );

    const prevProgress = current.practiceProgress ?? {};
    const prevItem = prevProgress[cleanQid];
    const nowIso = new Date().toISOString();

    const updated: UserAccount = {
      ...current,
      wrongQuestions,
      masteredQuestions,
      lastLogin: nowIso,
      status: current.role === 'student' ? 'studying' : 'online',
      activeStatus: current.role === 'student' ? 'studying' : 'online',
      practiceProgress: {
        ...prevProgress,
        [cleanQid]: {
          answeredAt: nowIso,
          isCorrect,
          attemptsCount: (prevItem?.attemptsCount ?? 0) + 1,
        },
      },
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return updated;
  }

  public markStudentQuestionMastered(
    userId: string,
    questionId: string
  ): UserAccount | undefined {
    const current = this.getUser(userId);
    const cleanQid = questionId.trim();
    if (!current || !cleanQid) return current;

    const { wrongQuestions, masteredQuestions } = computeUpdatedWrongQuestions(
      current.wrongQuestions ?? [],
      current.masteredQuestions ?? [],
      cleanQid,
      true,
      true
    );

    const updated: UserAccount = {
      ...current,
      wrongQuestions,
      masteredQuestions,
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return updated;
  }

  public addStudentStudyTime(
    userId: string,
    additionalSeconds: number,
    activeStatus: ActiveStatus = 'studying'
  ): UserAccount | undefined {
    const current = this.getUser(userId);
    if (!current) return undefined;

    const safeDelta = Math.max(0, Math.round(Number(additionalSeconds) || 0));
    const currentSec =
      typeof current.totalStudySeconds === 'number'
        ? current.totalStudySeconds
        : (current.totalStudyMinutes || 0) * 60;
    const nextSec = currentSec + safeDelta;
    const nowIso = new Date().toISOString();

    const updated: UserAccount = {
      ...current,
      status: activeStatus,
      activeStatus,
      lastLogin: nowIso,
      totalStudySeconds: nextSec,
      totalStudyMinutes: Math.round(nextSec / 60),
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return updated;
  }

  public saveStudentAttempt(
    userId: string,
    attempt: ExamAttempt,
    wrongQuestionIdsFromExam: string[] = []
  ): { attempt: ExamAttempt; user?: UserAccount } {
    const cleanAttempt: ExamAttempt = {
      ...attempt,
      id: attempt.id || `att_${Date.now()}`,
      userId: attempt.userId || userId,
    };
    this.attempts.set(cleanAttempt.id, cleanAttempt);
    this.fireAndForgetPersist(this.persistence.saveAttempt(cleanAttempt));

    const current = this.getUser(userId);
    if (!current || current.role !== 'student') {
      return { attempt: cleanAttempt, user: current };
    }

    const wrongSet = new Set(current.wrongQuestions ?? []);
    const masteredSet = new Set(current.masteredQuestions ?? []);
    for (const qid of wrongQuestionIdsFromExam) {
      if (qid && typeof qid === 'string') {
        wrongSet.add(qid);
        masteredSet.delete(qid);
      }
    }

    const currentSec =
      typeof current.totalStudySeconds === 'number'
        ? current.totalStudySeconds
        : (current.totalStudyMinutes || 0) * 60;
    const addedSec = Math.max(
      0,
      Math.round(Number(cleanAttempt.durationSeconds) || 0)
    );
    const nextSec = currentSec + addedSec;
    const nowIso = new Date().toISOString();

    const updatedUser: UserAccount = {
      ...current,
      wrongQuestions: Array.from(wrongSet),
      masteredQuestions: Array.from(masteredSet),
      status: 'studying',
      activeStatus: 'studying',
      lastLogin: nowIso,
      totalStudySeconds: nextSec,
      totalStudyMinutes: Math.round(nextSec / 60),
    };
    this.engine.upsertUser(updatedUser);
    this.fireAndForgetPersist(this.persistence.saveUser(updatedUser));
    return { attempt: cleanAttempt, user: updatedUser };
  }

  // ============================================================================
  // 3. GHI XUYÊN THẤU (WRITE-THROUGH) CHO QUẢN TRỊ VIÊN / GIÁO VIÊN
  // ============================================================================

  public saveQuestion(question: Question): Question {
    const clean = sanitizeQuestion(question);
    this.engine.upsertQuestion(clean);
    this.hydratedQuestions = true;
    this.fireAndForgetPersist(this.persistence.saveQuestion(clean));
    return clean;
  }

  public saveQuestionsBatch(
    incomingQuestions: Question[],
    replaceAll: boolean = false
  ): Question[] {
    const cleaned = incomingQuestions.map(sanitizeQuestion);
    if (replaceAll) {
      this.engine.setQuestions(sortQuestionsNaturally(cleaned));
    } else {
      for (const q of cleaned) {
        this.engine.upsertQuestion(q);
      }
    }
    this.hydratedQuestions = true;
    this.fireAndForgetPersist(this.persistence.saveQuestionsBatch(cleaned));
    return cleaned;
  }

  public deleteQuestion(questionId: string): void {
    const cleanId = questionId.trim();
    if (!cleanId) return;
    this.engine.deleteQuestion(cleanId);
    this.fireAndForgetPersist(this.persistence.deleteQuestion(cleanId));
  }

  public saveStudentAccount(account: UserAccount): UserAccount {
    const sanitizedId = account.username
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '');
    if (!sanitizedId) {
      throw new Error(
        'Mã tài khoản chỉ được chứa chữ cái, chữ số, dấu gạch ngang hoặc gạch dưới.'
      );
    }
    const existing = this.getUser(sanitizedId);
    const merged = normalizeUserDefaults({
      ...existing,
      ...account,
      id: sanitizedId,
      username: sanitizedId,
      password: account.password.trim().slice(0, 128),
      fullName: account.fullName.trim().slice(0, 120),
    });
    this.engine.upsertUser(merged);
    this.hydratedUsers = true;
    this.fireAndForgetPersist(this.persistence.saveUser(merged));
    return merged;
  }

  public saveStudentsBatch(accounts: UserAccount[]): UserAccount[] {
    const saved: UserAccount[] = [];
    for (const acc of accounts) {
      const sanitizedId = acc.username.trim().replace(/[^a-zA-Z0-9_-]/g, '');
      if (!sanitizedId) continue;
      const existing = this.getUser(sanitizedId);
      const merged = normalizeUserDefaults({
        ...existing,
        ...acc,
        id: sanitizedId,
        username: sanitizedId,
        password: acc.password.trim().slice(0, 128),
        fullName: acc.fullName.trim().slice(0, 120),
      });
      this.engine.upsertUser(merged);
      saved.push(merged);
    }
    if (saved.length > 0) {
      this.hydratedUsers = true;
      this.fireAndForgetPersist(this.persistence.saveUsersBatch(saved));
    }
    return saved;
  }

  public updateStudentPassword(
    userId: string,
    newPassword: string
  ): UserAccount | undefined {
    const current = this.getUser(userId);
    const cleanPass = newPassword.trim().slice(0, 128);
    if (!current || !cleanPass) return current;
    const updated: UserAccount = {
      ...current,
      password: cleanPass,
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return updated;
  }

  public resetStudentProgress(userId: string): {
    user?: UserAccount;
    deletedAttemptIds: string[];
  } {
    const current = this.getUser(userId);
    const targetLower = userId.trim().toLowerCase();
    const deletedAttemptIds: string[] = [];

    for (const [attId, att] of this.attempts.entries()) {
      if (
        String(att.userId || '').toLowerCase() === targetLower ||
        String(att.username || '').toLowerCase() === targetLower
      ) {
        this.attempts.delete(attId);
        deletedAttemptIds.push(attId);
      }
    }

    if (deletedAttemptIds.length > 0) {
      this.fireAndForgetPersist(
        this.persistence.deleteAttemptsBatch(deletedAttemptIds)
      );
    }

    if (!current) {
      return { deletedAttemptIds };
    }

    const updated: UserAccount = {
      ...current,
      totalStudySeconds: 0,
      totalStudyMinutes: 0,
      bookmarkedQuestions: [],
      wrongQuestions: [],
      masteredQuestions: [],
      practiceProgress: {},
    };
    this.engine.upsertUser(updated);
    this.fireAndForgetPersist(this.persistence.saveUser(updated));
    return { user: updated, deletedAttemptIds };
  }

  public deleteStudentAccount(
    userId: string,
    actorUserId?: string
  ): boolean {
    const cleanId = userId.trim();
    if (!cleanId) return false;
    if (
      cleanId.toLowerCase() === 'admin' ||
      (actorUserId && cleanId.toLowerCase() === actorUserId.toLowerCase())
    ) {
      return false;
    }
    this.engine.deleteUser(cleanId);
    this.fireAndForgetPersist(this.persistence.deleteUser(cleanId));
    return true;
  }

  public deleteStudentsBatch(
    userIds: string[],
    actorUserId?: string
  ): string[] {
    const actorLower = (actorUserId || '').trim().toLowerCase();
    const safeIds = Array.from(
      new Set(
        userIds
          .map((id) => id.trim())
          .filter(
            (id) =>
              id.length > 0 &&
              id.toLowerCase() !== 'admin' &&
              id.toLowerCase() !== actorLower
          )
      )
    );
    if (safeIds.length === 0) return [];
    for (const uid of safeIds) {
      this.engine.deleteUser(uid);
    }
    this.fireAndForgetPersist(this.persistence.deleteUsersBatch(safeIds));
    return safeIds;
  }

  public updateDepartmentLogo(
    logoUrl: string,
    isOfficialDefault: boolean = false
  ): { departmentLogoUrl: string; isOfficialDefaultLogo: boolean } {
    const cleaned = logoUrl.trim();
    this.departmentLogoUrl = cleaned;
    this.isOfficialDefaultLogo = isOfficialDefault || !cleaned;

    const adminUser = this.getUser('admin');
    if (adminUser) {
      this.engine.upsertUser({
        ...adminUser,
        logoUrl: cleaned,
      });
    }

    this.fireAndForgetPersist(
      this.persistence.saveDepartmentLogo(cleaned, this.isOfficialDefaultLogo)
    );

    return {
      departmentLogoUrl: this.departmentLogoUrl,
      isOfficialDefaultLogo: this.isOfficialDefaultLogo,
    };
  }
}
