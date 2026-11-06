import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  setDoc,
  setLogLevel,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import {
  DEFAULT_ADMIN_ACCOUNT,
  LEGACY_SEED_ATTEMPT_IDS,
  LEGACY_SEED_CREATED_PREFIX,
  LEGACY_SEED_QUESTION_IDS,
  LEGACY_SEED_USER_IDS,
  SEED_USERS,
} from '../data/seedData';
import {
  ActiveStatus,
  ExamAttempt,
  PracticeQuestionStat,
  Question,
  UserAccount,
} from '../types/exam';
import { computeUpdatedWrongQuestions } from '../utils/scoring';

export function isLegacyVirtualUser(u: UserAccount): boolean {
  return (
    LEGACY_SEED_USER_IDS.includes(u.id) &&
    Boolean(!u.createdAt || u.createdAt.startsWith('2026-10-20T08:'))
  );
}

export function isLegacyVirtualQuestion(q: Question): boolean {
  return (
    q.id === 'Q176' ||
    (LEGACY_SEED_QUESTION_IDS.includes(q.id) &&
      Boolean(!q.createdAt || q.createdAt.startsWith(LEGACY_SEED_CREATED_PREFIX)))
  );
}

export function isLegacyVirtualAttempt(a: ExamAttempt): boolean {
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

// Tắt log lỗi nội bộ của SDK khi mạng người dùng chập chờn hoặc chặn WebChannel
setLogLevel('silent');

const app = initializeApp(firebaseConfig);

function createFirestoreInstance() {
  try {
    return initializeFirestore(
      app,
      {
        experimentalAutoDetectLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

function isTransientOfflineError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore backend') ||
    msg.includes('unavailable') ||
    msg.includes('network error') ||
    msg.includes('failed to get document')
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): void {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid ?? null,
      email: auth.currentUser?.email ?? null,
      emailVerified: auth.currentUser?.emailVerified ?? null,
      isAnonymous: auth.currentUser?.isAnonymous ?? null,
      tenantId: auth.currentUser?.tenantId ?? null,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };

  // Nếu là lỗi mất mạng/timeout tạm thời phía client, chỉ ghi warn để ứng dụng tự động dùng dữ liệu đệm (offline fallback)
  if (isTransientOfflineError(error)) {
    console.warn('Firestore offline/timeout fallback active:', errInfo.path);
    return;
  }

  console.warn('Firestore operation notice:', JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<boolean> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    return true;
  } catch (error) {
    if (isTransientOfflineError(error)) {
      return false;
    }
    return true;
  }
}

/**
 * Đảm bảo tài khoản Quản trị viên (`admin`) tồn tại và tự động xóa toàn bộ dữ liệu ảo (Seed Data cũ) khỏi Firestore
 */
export async function ensureSeedDataInitialized(): Promise<{
  usersCount: number;
  questionsCount: number;
}> {
  let usersCount = 1;
  let questionsCount = 0;

  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    const existingDocsMap = new Map(
      usersSnap.docs.map((d) => [d.id, d.data() as UserAccount])
    );

    if (!existingDocsMap.has(DEFAULT_ADMIN_ACCOUNT.id)) {
      await setDoc(doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id), DEFAULT_ADMIN_ACCOUNT);
    }

    // Xóa các học sinh ảo cũ (HS001, HS002 từ seed data)
    for (const d of usersSnap.docs) {
      const u = d.data() as UserAccount;
      if (isLegacyVirtualUser(u)) {
        await deleteDoc(doc(db, 'users', d.id));
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'users');
  }

  try {
    const questionsSnap = await getDocs(collection(db, 'questions'));
    let realCount = 0;
    for (const d of questionsSnap.docs) {
      const q = d.data() as Question;
      if (isLegacyVirtualQuestion(q)) {
        await deleteDoc(doc(db, 'questions', d.id));
      } else {
        realCount += 1;
      }
    }
    questionsCount = realCount;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'questions');
  }

  try {
    const attemptsSnap = await getDocs(collection(db, 'attempts'));
    for (const d of attemptsSnap.docs) {
      const att = d.data() as ExamAttempt;
      if (isLegacyVirtualAttempt(att)) {
        await deleteDoc(doc(db, 'attempts', d.id));
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'attempts');
  }

  return { usersCount, questionsCount };
}

/**
 * Xóa toàn bộ dữ liệu ảo / làm sạch Ngân hàng câu hỏi khi giáo viên yêu cầu
 */
export async function resetSeedDataToDefault(): Promise<void> {
  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    for (const d of usersSnap.docs) {
      const u = d.data() as UserAccount;
      if (u.role === 'student' && isLegacyVirtualUser(u)) {
        await deleteDoc(doc(db, 'users', d.id));
      }
    }
    await setDoc(doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id), DEFAULT_ADMIN_ACCOUNT);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'users');
  }

  try {
    const questionsSnap = await getDocs(collection(db, 'questions'));
    for (const d of questionsSnap.docs) {
      const q = d.data() as Question;
      if (isLegacyVirtualQuestion(q)) {
        await deleteDoc(doc(db, 'questions', d.id));
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'questions');
  }

  try {
    const attemptsSnap = await getDocs(collection(db, 'attempts'));
    for (const d of attemptsSnap.docs) {
      const att = d.data() as ExamAttempt;
      if (isLegacyVirtualAttempt(att)) {
        await deleteDoc(doc(db, 'attempts', d.id));
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, 'attempts');
  }
}

/**
 * Xác thực người dùng bằng Mã định danh (Username/Student ID) và Mật khẩu qua collection `users`
 * Có hỗ trợ fallback sang danh sách `knownUsers` / `SEED_USERS` khi mạng chậm hoặc ngoại tuyến
 */
export async function authenticateWithUsernamePassword(
  usernameInput: string,
  passwordInput: string,
  knownUsers: UserAccount[] = SEED_USERS
): Promise<UserAccount> {
  const cleanId = usernameInput.trim();
  const cleanPass = passwordInput.trim();

  if (!cleanId || !cleanPass) {
    throw new Error('Vui lòng nhập đầy đủ Mã định danh và Mật khẩu.');
  }

  let matchedUser: UserAccount | null = null;

  try {
    const directDoc = await getDoc(doc(db, 'users', cleanId));
    if (directDoc.exists()) {
      matchedUser = directDoc.data() as UserAccount;
    } else {
      const allUsersSnap = await getDocs(collection(db, 'users'));
      for (const d of allUsersSnap.docs) {
        const data = d.data() as UserAccount;
        if (data.username.toLowerCase() === cleanId.toLowerCase()) {
          matchedUser = data;
          break;
        }
      }
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, `users/${cleanId}`);
  }

  if (!matchedUser) {
    const localFallback =
      knownUsers.find((u) => u.username.toLowerCase() === cleanId.toLowerCase()) ??
      SEED_USERS.find((u) => u.username.toLowerCase() === cleanId.toLowerCase());
    if (localFallback) {
      matchedUser = localFallback;
    }
  }

  if (!matchedUser) {
    throw new Error(`Không tìm thấy tài khoản với mã định danh "${cleanId}".`);
  }

  if (matchedUser.password !== cleanPass) {
    throw new Error('Mật khẩu không chính xác. Vui lòng kiểm tra lại.');
  }

  const nowIso = new Date().toISOString();
  const updatedUser: UserAccount = {
    ...matchedUser,
    id: matchedUser.id || matchedUser.username,
    lastLogin: nowIso,
    status: matchedUser.role === 'student' ? 'studying' : 'online',
    activeStatus: matchedUser.role === 'student' ? 'studying' : 'online',
  };

  try {
    await setDoc(doc(db, 'users', updatedUser.id), updatedUser, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, `users/${updatedUser.id}`);
  }

  return updatedUser;
}

/**
 * Cập nhật trạng thái hoạt động và cộng dồn thời gian ôn tập của học sinh lên Firestore
 */
export async function updateUserActivityAndStudyTime(
  userId: string,
  activeStatus: ActiveStatus,
  additionalStudySeconds: number = 0
): Promise<void> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return;
    const current = snap.data() as UserAccount;
    const nextSeconds = Math.max(0, (current.totalStudySeconds || 0) + additionalStudySeconds);
    const nextMinutes = Math.round(nextSeconds / 60);
    await setDoc(
      doc(db, 'users', userId),
      {
        ...current,
        id: current.id || userId,
        activeStatus,
        status: activeStatus,
        totalStudySeconds: nextSeconds,
        totalStudyMinutes: nextMinutes,
        lastLogin: new Date().toISOString(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Đồng bộ câu hỏi Đánh dấu (Bookmark) của học sinh lên Firestore
 */
export async function toggleQuestionBookmarkInFirestore(
  userId: string,
  questionId: string
): Promise<string[]> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    const seedDefault = SEED_USERS.find((u) => u.id === userId);
    const current: UserAccount = snap.exists()
      ? (snap.data() as UserAccount)
      : (seedDefault ?? {
          id: userId,
          username: userId,
          password: '123456',
          fullName: userId,
          role: 'student',
          lastLogin: new Date().toISOString(),
          status: 'studying',
          totalStudyMinutes: 0,
        });

    const existingBookmarks = Array.isArray(current.bookmarkedQuestions)
      ? current.bookmarkedQuestions
      : [];
    const nextBookmarks = existingBookmarks.includes(questionId)
      ? existingBookmarks.filter((id) => id !== questionId)
      : [...existingBookmarks, questionId];

    await setDoc(
      doc(db, 'users', userId),
      {
        ...current,
        id: current.id || userId,
        bookmarkedQuestions: nextBookmarks,
      },
      { merge: true }
    );
    return nextBookmarks;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
    return [];
  }
}

/**
 * Ghi nhận kết quả kiểm tra 1 câu hỏi trong Chế độ Luyện tập hoặc Kho câu sai
 */
export async function recordQuestionPracticeResultInFirestore(
  userId: string,
  questionId: string,
  isCorrect: boolean,
  removeOnCorrect: boolean = false
): Promise<void> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    const seedDefault = SEED_USERS.find((u) => u.id === userId);
    const current: UserAccount = snap.exists()
      ? (snap.data() as UserAccount)
      : (seedDefault ?? {
          id: userId,
          username: userId,
          password: '123456',
          fullName: userId,
          role: 'student',
          lastLogin: new Date().toISOString(),
          status: 'studying',
          totalStudyMinutes: 0,
        });

    const currentWrong = Array.isArray(current.wrongQuestions) ? current.wrongQuestions : [];
    const currentMastered = Array.isArray(current.masteredQuestions)
      ? current.masteredQuestions
      : [];
    const currentProgress: Record<string, PracticeQuestionStat> =
      current.practiceProgress && typeof current.practiceProgress === 'object'
        ? { ...current.practiceProgress }
        : {};

    const prevStat = currentProgress[questionId];
    currentProgress[questionId] = {
      answeredAt: new Date().toISOString(),
      isCorrect,
      attemptsCount: (prevStat?.attemptsCount ?? 0) + 1,
    };

    const { wrongQuestions, masteredQuestions } = computeUpdatedWrongQuestions(
      currentWrong,
      currentMastered,
      questionId,
      isCorrect,
      removeOnCorrect
    );

    await setDoc(
      doc(db, 'users', userId),
      {
        ...current,
        id: current.id || userId,
        wrongQuestions,
        masteredQuestions,
        practiceProgress: currentProgress,
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Đánh dấu "Đã nắm vững (Xóa khỏi kho câu sai)" cho một câu hỏi cụ thể trên Firestore
 */
export async function markQuestionMasteredInFirestore(
  userId: string,
  questionId: string
): Promise<void> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return;
    const current = snap.data() as UserAccount;
    const currentWrong = Array.isArray(current.wrongQuestions) ? current.wrongQuestions : [];
    const currentMastered = Array.isArray(current.masteredQuestions)
      ? current.masteredQuestions
      : [];

    const { wrongQuestions, masteredQuestions } = computeUpdatedWrongQuestions(
      currentWrong,
      currentMastered,
      questionId,
      true,
      true
    );

    await setDoc(
      doc(db, 'users', userId),
      {
        ...current,
        id: current.id || userId,
        wrongQuestions,
        masteredQuestions,
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Tự động thêm danh sách các câu trả lời sai sau khi nộp bài Thi thử vào `wrongQuestions` trên Firestore
 */
export async function syncExamWrongQuestionsToFirestore(
  userId: string,
  wrongQuestionIdsFromExam: string[]
): Promise<void> {
  if (wrongQuestionIdsFromExam.length === 0) return;
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return;
    const current = snap.data() as UserAccount;
    const wrongSet = new Set(Array.isArray(current.wrongQuestions) ? current.wrongQuestions : []);
    const masteredSet = new Set(
      Array.isArray(current.masteredQuestions) ? current.masteredQuestions : []
    );

    for (const qId of wrongQuestionIdsFromExam) {
      wrongSet.add(qId);
      masteredSet.delete(qId);
    }

    const wrongQuestions = Array.from(wrongSet);
    const masteredQuestions = Array.from(masteredSet);

    await setDoc(
      doc(db, 'users', userId),
      {
        ...current,
        id: current.id || userId,
        wrongQuestions,
        masteredQuestions,
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Tạo mới hoặc cập nhật tài khoản (Học sinh hoặc Giáo viên Quản trị)
 */
export async function saveStudentAccount(account: UserAccount): Promise<void> {
  const sanitizedId = account.username.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitizedId) {
    throw new Error('Mã tài khoản chỉ được chứa chữ cái, chữ số, dấu gạch ngang hoặc gạch dưới.');
  }
  const totalSec = Math.max(0, Number(account.totalStudySeconds) || 0);
  const defaultGroup =
    account.role === 'teacher'
      ? 'Tổ Toán - Tin · Trường IGC Tây Ninh'
      : 'Lớp Certiport GenAI';
  const payload: UserAccount = {
    id: sanitizedId,
    username: sanitizedId,
    password: account.password.trim().slice(0, 128),
    fullName: account.fullName.trim().slice(0, 120),
    role: account.role === 'teacher' ? 'teacher' : 'student',
    className: (account.className || defaultGroup).trim().slice(0, 64),
    lastLogin: account.lastLogin || new Date().toISOString(),
    status: account.activeStatus || account.status || 'offline',
    activeStatus: account.activeStatus || account.status || 'offline',
    totalStudyMinutes: Math.round(totalSec / 60),
    totalStudySeconds: totalSec,
    bookmarkedQuestions: account.bookmarkedQuestions ?? [],
    wrongQuestions: account.wrongQuestions ?? [],
    masteredQuestions: account.masteredQuestions ?? [],
    practiceProgress: account.practiceProgress ?? {},
    ...(account.logoUrl !== undefined ? { logoUrl: account.logoUrl } : {}),
    createdAt: account.createdAt || new Date().toISOString(),
  };

  try {
    await setDoc(doc(db, 'users', sanitizedId), payload, { merge: true });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `users/${sanitizedId}`);
  }
}

/**
 * Lưu hoặc cập nhật Logo Tổ Toán - Tin · Trường IGC Tây Ninh vào tài khoản quản trị gốc (`users/admin`) trên Firestore
 */
export async function updateDepartmentLogoInFirestore(logoUrl: string): Promise<void> {
  const path = `users/${DEFAULT_ADMIN_ACCOUNT.id}`;
  try {
    const snap = await getDoc(doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id));
    const current: UserAccount = snap.exists()
      ? (snap.data() as UserAccount)
      : DEFAULT_ADMIN_ACCOUNT;
    await setDoc(
      doc(db, 'users', DEFAULT_ADMIN_ACCOUNT.id),
      {
        ...current,
        id: DEFAULT_ADMIN_ACCOUNT.id,
        username: current.username || DEFAULT_ADMIN_ACCOUNT.username,
        password: current.password || DEFAULT_ADMIN_ACCOUNT.password,
        fullName: current.fullName || DEFAULT_ADMIN_ACCOUNT.fullName,
        role: 'teacher',
        logoUrl: logoUrl.trim(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteStudentAccount(userId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'users', userId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `users/${userId}`);
  }
}

/**
 * Lưu hàng loạt tài khoản học sinh từ file Excel lên Firestore
 */
export async function saveMultipleStudentAccountsToFirestore(
  students: UserAccount[]
): Promise<void> {
  for (const st of students) {
    await saveStudentAccount(st);
  }
}

/**
 * Đổi mật khẩu cho một tài khoản học sinh trên Firestore
 */
export async function updateStudentPasswordInFirestore(
  userId: string,
  newPassword: string
): Promise<void> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (!snap.exists()) return;
    const current = snap.data() as UserAccount;
    await setDoc(
      doc(db, 'users', userId),
      {
        ...current,
        id: current.id || userId,
        password: newPassword.trim().slice(0, 128),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

/**
 * Reset toàn bộ dữ liệu làm bài (luyện tập, kho câu sai, thời gian ôn tập & lịch sử thi thử) của một học sinh
 */
export async function resetStudentLearningDataInFirestore(
  userId: string,
  attemptIdsToDelete: string[] = []
): Promise<void> {
  const path = `users/${userId}`;
  try {
    const snap = await getDoc(doc(db, 'users', userId));
    if (snap.exists()) {
      const current = snap.data() as UserAccount;
      await setDoc(
        doc(db, 'users', userId),
        {
          ...current,
          id: current.id || userId,
          totalStudySeconds: 0,
          totalStudyMinutes: 0,
          bookmarkedQuestions: [],
          wrongQuestions: [],
          masteredQuestions: [],
          practiceProgress: {},
        },
        { merge: true }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }

  for (const attId of attemptIdsToDelete) {
    try {
      await deleteDoc(doc(db, 'attempts', attId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `attempts/${attId}`);
    }
  }
}

/**
 * Lưu câu hỏi mới hoặc cập nhật câu hỏi vào collection `questions`
 */
export async function saveQuestionToFirestore(question: Question): Promise<void> {
  const sanitizedId = question.id.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  const rawPayload: Record<string, unknown> = {
    ...question,
    id: sanitizedId,
    prompt: question.prompt.trim().slice(0, 2000),
    explanation: question.explanation.trim().slice(0, 2000),
  };

  // Loại bỏ các trường undefined để Firestore không báo lỗi
  const cleanPayload: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(rawPayload)) {
    if (v !== undefined) {
      cleanPayload[k] = v;
    }
  }

  try {
    await setDoc(doc(db, 'questions', sanitizedId), cleanPayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, `questions/${sanitizedId}`);
  }
}

/**
 * Xóa câu hỏi khỏi collection `questions` trên Firestore
 */
export async function deleteQuestionFromFirestore(questionId: string): Promise<void> {
  const sanitizedId = questionId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
  if (!sanitizedId) return;
  try {
    await deleteDoc(doc(db, 'questions', sanitizedId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, `questions/${sanitizedId}`);
  }
}

/**
 * Lưu hàng loạt câu hỏi lên Firestore (dùng khi Nhập JSON, Nhập Excel hoặc Phân bổ tự động Đề nhỏ)
 */
export async function saveMultipleQuestionsToFirestore(
  questionsList: Question[]
): Promise<void> {
  for (const q of questionsList) {
    await saveQuestionToFirestore(q);
  }
}

/**
 * Lưu kết quả làm bài thi vào collection `attempts`
 */
export async function recordExamAttempt(attempt: ExamAttempt): Promise<void> {
  try {
    await setDoc(doc(db, 'attempts', attempt.id), attempt);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, `attempts/${attempt.id}`);
  }
}

/**
 * Lắng nghe danh sách `users` thời gian thực từ Firestore (tự động loại bỏ dữ liệu học sinh ảo cũ)
 */
export function subscribeToUsers(onData: (users: UserAccount[]) => void): () => void {
  return onSnapshot(
    collection(db, 'users'),
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as UserAccount)
        .filter((u) => !isLegacyVirtualUser(u));
      list.sort((a, b) => a.username.localeCompare(b.username));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'users');
    }
  );
}

/**
 * Lắng nghe danh sách `questions` thời gian thực từ Firestore (tự động loại bỏ câu hỏi ảo cũ)
 */
export function subscribeToQuestions(onData: (questions: Question[]) => void): () => void {
  return onSnapshot(
    collection(db, 'questions'),
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as Question)
        .filter((q) => !isLegacyVirtualQuestion(q));
      list.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'questions');
    }
  );
}

/**
 * Lắng nghe danh sách `attempts` thời gian thực từ Firestore (tự động loại bỏ lượt thi ảo cũ)
 */
export function subscribeToAttempts(onData: (attempts: ExamAttempt[]) => void): () => void {
  return onSnapshot(
    collection(db, 'attempts'),
    (snapshot) => {
      const list = snapshot.docs
        .map((d) => d.data() as ExamAttempt)
        .filter((a) => !isLegacyVirtualAttempt(a));
      list.sort((a, b) => b.completedAt.localeCompare(a.completedAt));
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, 'attempts');
    }
  );
}
