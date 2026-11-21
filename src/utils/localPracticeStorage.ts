import { PracticeQuestionStat, UserAccount } from '../types/exam.ts';
import { computeUpdatedWrongQuestions } from './scoring.ts';

export const LOCAL_PRACTICE_STORAGE_PREFIX = 'certiport_local_practice_v1_';

export interface LocalStudentPracticeState {
  bookmarkedQuestions: string[];
  wrongQuestions: string[];
  masteredQuestions: string[];
  practiceProgress: Record<string, PracticeQuestionStat>;
  totalStudySeconds: number;
  totalStudyMinutes: number;
  /** Lưu lại mốc reset tiến độ từ phía giáo viên để tự động làm sạch bộ nhớ cục bộ khi giáo viên đặt lại */
  syncedResetAt?: string;
  updatedAt: string;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getLocalPracticeStorageKey(userId: string): string {
  return `${LOCAL_PRACTICE_STORAGE_PREFIX}${userId.trim().toLowerCase()}`;
}

export function createEmptyLocalPracticeState(
  syncedResetAt?: string
): LocalStudentPracticeState {
  return {
    bookmarkedQuestions: [],
    wrongQuestions: [],
    masteredQuestions: [],
    practiceProgress: {},
    totalStudySeconds: 0,
    totalStudyMinutes: 0,
    ...(syncedResetAt ? { syncedResetAt } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function extractLocalPracticeFromUser(
  user: UserAccount
): LocalStudentPracticeState {
  const totalSec =
    typeof user.totalStudySeconds === 'number'
      ? Math.max(0, Math.round(user.totalStudySeconds))
      : Math.max(0, Math.round((user.totalStudyMinutes || 0) * 60));

  return {
    bookmarkedQuestions: Array.isArray(user.bookmarkedQuestions)
      ? [...user.bookmarkedQuestions]
      : [],
    wrongQuestions: Array.isArray(user.wrongQuestions)
      ? [...user.wrongQuestions]
      : [],
    masteredQuestions: Array.isArray(user.masteredQuestions)
      ? [...user.masteredQuestions]
      : [],
    practiceProgress:
      user.practiceProgress && typeof user.practiceProgress === 'object'
        ? { ...user.practiceProgress }
        : {},
    totalStudySeconds: totalSec,
    totalStudyMinutes: Math.round(totalSec / 60),
    ...(user.progressResetAt ? { syncedResetAt: user.progressResetAt } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function loadLocalPracticeState(
  userId: string,
  storage?: StorageLike | null
): LocalStudentPracticeState | null {
  const cleanId = userId.trim();
  const store = getBrowserStorage(storage);
  if (!cleanId || !store) return null;

  try {
    const raw = store.getItem(getLocalPracticeStorageKey(cleanId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalStudentPracticeState>;
    if (!parsed || typeof parsed !== 'object') return null;

    const totalSec = Math.max(0, Math.round(Number(parsed.totalStudySeconds) || 0));
    return {
      bookmarkedQuestions: Array.isArray(parsed.bookmarkedQuestions)
        ? parsed.bookmarkedQuestions.filter((x): x is string => typeof x === 'string')
        : [],
      wrongQuestions: Array.isArray(parsed.wrongQuestions)
        ? parsed.wrongQuestions.filter((x): x is string => typeof x === 'string')
        : [],
      masteredQuestions: Array.isArray(parsed.masteredQuestions)
        ? parsed.masteredQuestions.filter((x): x is string => typeof x === 'string')
        : [],
      practiceProgress:
        parsed.practiceProgress && typeof parsed.practiceProgress === 'object'
          ? (parsed.practiceProgress as Record<string, PracticeQuestionStat>)
          : {},
      totalStudySeconds: totalSec,
      totalStudyMinutes: Math.round(totalSec / 60),
      ...(typeof parsed.syncedResetAt === 'string' && parsed.syncedResetAt
        ? { syncedResetAt: parsed.syncedResetAt }
        : {}),
      updatedAt:
        typeof parsed.updatedAt === 'string' && parsed.updatedAt
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveLocalPracticeState(
  userId: string,
  state: LocalStudentPracticeState,
  storage?: StorageLike | null
): void {
  const cleanId = userId.trim();
  const store = getBrowserStorage(storage);
  if (!cleanId || !store) return;

  try {
    store.setItem(getLocalPracticeStorageKey(cleanId), JSON.stringify(state));
  } catch {
    // Bỏ qua nếu bộ nhớ cục bộ bị đầy hoặc bị chặn ở chế độ ẩn danh
  }
}

export function clearLocalPracticeState(
  userId: string,
  storage?: StorageLike | null
): void {
  const cleanId = userId.trim();
  const store = getBrowserStorage(storage);
  if (!cleanId || !store) return;

  try {
    store.removeItem(getLocalPracticeStorageKey(cleanId));
  } catch {
    // Bỏ qua
  }
}

/**
 * Gộp hồ sơ tài khoản từ máy chủ với trạng thái ôn luyện cục bộ trong trình duyệt.
 * - Chỉ áp dụng cho học sinh (`role === 'student'`).
 * - Nếu giáo viên đã bấm "Reset tiến độ học sinh" (mốc `progressResetAt` mới hơn `syncedResetAt`),
 *   tự động xóa trạng thái ôn luyện cũ trên máy học sinh để đồng bộ sạch sẽ.
 */
export function mergeUserWithLocalPractice(
  user: UserAccount,
  storage?: StorageLike | null
): UserAccount {
  if (user.role !== 'student') {
    return user;
  }

  const local = loadLocalPracticeState(user.id, storage);
  const serverResetAt = user.progressResetAt;

  if (serverResetAt) {
    const localResetAt = local?.syncedResetAt || '';
    if (!local || !localResetAt || localResetAt < serverResetAt) {
      const fresh = createEmptyLocalPracticeState(serverResetAt);
      saveLocalPracticeState(user.id, fresh, storage);
      return {
        ...user,
        bookmarkedQuestions: [],
        wrongQuestions: [],
        masteredQuestions: [],
        practiceProgress: {},
        totalStudySeconds: 0,
        totalStudyMinutes: 0,
      };
    }
  }

  if (!local) {
    return {
      ...user,
      bookmarkedQuestions: user.bookmarkedQuestions ?? [],
      wrongQuestions: user.wrongQuestions ?? [],
      masteredQuestions: user.masteredQuestions ?? [],
      practiceProgress: user.practiceProgress ?? {},
    };
  }

  return {
    ...user,
    bookmarkedQuestions: local.bookmarkedQuestions,
    wrongQuestions: local.wrongQuestions,
    masteredQuestions: local.masteredQuestions,
    practiceProgress: local.practiceProgress,
    totalStudySeconds: local.totalStudySeconds,
    totalStudyMinutes: local.totalStudyMinutes,
  };
}

export function applyLocalPracticeStateToUser(
  user: UserAccount,
  local: LocalStudentPracticeState
): UserAccount {
  return {
    ...user,
    bookmarkedQuestions: local.bookmarkedQuestions,
    wrongQuestions: local.wrongQuestions,
    masteredQuestions: local.masteredQuestions,
    practiceProgress: local.practiceProgress,
    totalStudySeconds: local.totalStudySeconds,
    totalStudyMinutes: local.totalStudyMinutes,
  };
}

export function applyLocalBookmarkToggle(
  baseUser: UserAccount,
  questionId: string,
  storage?: StorageLike | null
): LocalStudentPracticeState {
  const base =
    loadLocalPracticeState(baseUser.id, storage) ??
    extractLocalPracticeFromUser(baseUser);
  const cleanQid = questionId.trim();
  const nextBookmarks = base.bookmarkedQuestions.includes(cleanQid)
    ? base.bookmarkedQuestions.filter((id) => id !== cleanQid)
    : [...base.bookmarkedQuestions, cleanQid];

  const next: LocalStudentPracticeState = {
    ...base,
    bookmarkedQuestions: nextBookmarks,
    updatedAt: new Date().toISOString(),
  };
  saveLocalPracticeState(baseUser.id, next, storage);
  return next;
}

export function applyLocalPracticeCheck(
  baseUser: UserAccount,
  questionId: string,
  isCorrect: boolean,
  removeOnCorrect: boolean = false,
  storage?: StorageLike | null
): LocalStudentPracticeState {
  const base =
    loadLocalPracticeState(baseUser.id, storage) ??
    extractLocalPracticeFromUser(baseUser);
  const cleanQid = questionId.trim();
  const { wrongQuestions, masteredQuestions } = computeUpdatedWrongQuestions(
    base.wrongQuestions,
    base.masteredQuestions,
    cleanQid,
    isCorrect,
    removeOnCorrect
  );
  const prevItem = base.practiceProgress[cleanQid];
  const nowIso = new Date().toISOString();

  const next: LocalStudentPracticeState = {
    ...base,
    wrongQuestions,
    masteredQuestions,
    practiceProgress: {
      ...base.practiceProgress,
      [cleanQid]: {
        answeredAt: nowIso,
        isCorrect,
        attemptsCount: (prevItem?.attemptsCount ?? 0) + 1,
      },
    },
    updatedAt: nowIso,
  };
  saveLocalPracticeState(baseUser.id, next, storage);
  return next;
}

export function applyLocalMarkMastered(
  baseUser: UserAccount,
  questionId: string,
  storage?: StorageLike | null
): LocalStudentPracticeState {
  const base =
    loadLocalPracticeState(baseUser.id, storage) ??
    extractLocalPracticeFromUser(baseUser);
  const cleanQid = questionId.trim();
  const { wrongQuestions, masteredQuestions } = computeUpdatedWrongQuestions(
    base.wrongQuestions,
    base.masteredQuestions,
    cleanQid,
    true,
    true
  );

  const next: LocalStudentPracticeState = {
    ...base,
    wrongQuestions,
    masteredQuestions,
    updatedAt: new Date().toISOString(),
  };
  saveLocalPracticeState(baseUser.id, next, storage);
  return next;
}

export function applyLocalStudyTimeDelta(
  baseUser: UserAccount,
  additionalSeconds: number,
  storage?: StorageLike | null
): LocalStudentPracticeState {
  const base =
    loadLocalPracticeState(baseUser.id, storage) ??
    extractLocalPracticeFromUser(baseUser);
  const safeDelta = Math.max(0, Math.round(Number(additionalSeconds) || 0));
  const nextSec = base.totalStudySeconds + safeDelta;

  const next: LocalStudentPracticeState = {
    ...base,
    totalStudySeconds: nextSec,
    totalStudyMinutes: Math.round(nextSec / 60),
    updatedAt: new Date().toISOString(),
  };
  saveLocalPracticeState(baseUser.id, next, storage);
  return next;
}

export function applyLocalExamWrongQuestions(
  baseUser: UserAccount,
  wrongQuestionIds: string[],
  durationSeconds: number = 0,
  storage?: StorageLike | null
): LocalStudentPracticeState {
  const base =
    loadLocalPracticeState(baseUser.id, storage) ??
    extractLocalPracticeFromUser(baseUser);

  const wrongSet = new Set(base.wrongQuestions);
  const masteredSet = new Set(base.masteredQuestions);
  for (const qid of wrongQuestionIds) {
    if (qid && typeof qid === 'string') {
      wrongSet.add(qid);
      masteredSet.delete(qid);
    }
  }

  const safeAdded = Math.max(0, Math.round(Number(durationSeconds) || 0));
  const nextSec = base.totalStudySeconds + safeAdded;

  const next: LocalStudentPracticeState = {
    ...base,
    wrongQuestions: Array.from(wrongSet),
    masteredQuestions: Array.from(masteredSet),
    totalStudySeconds: nextSec,
    totalStudyMinutes: Math.round(nextSec / 60),
    updatedAt: new Date().toISOString(),
  };
  saveLocalPracticeState(baseUser.id, next, storage);
  return next;
}
