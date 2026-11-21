import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { ThemeProvider } from './context/ThemeContext';

const StudentPortal = lazy(() =>
  import('./components/StudentPortal').then((m) => ({ default: m.StudentPortal }))
);
const TeacherPortal = lazy(() =>
  import('./components/TeacherPortal').then((m) => ({ default: m.TeacherPortal }))
);
import {
  authenticateWithUsernamePassword,
  deleteMultipleStudentAccounts,
  deleteQuestionFromFirestore,
  deleteStudentAccount,
  ensureSeedDataInitialized,
  fetchPublicQuestionsCount,
  fetchQuestionsOnce,
  isLegacyVirtualAttempt,
  isLegacyVirtualQuestion,
  isLegacyVirtualUser,
  markQuestionMasteredInFirestore,
  recordExamAttempt,
  recordQuestionPracticeResultInFirestore,
  resetSeedDataToDefault,
  resetStudentLearningDataInFirestore,
  saveMultipleQuestionsToFirestore,
  saveMultipleStudentAccountsToFirestore,
  saveQuestionToFirestore,
  saveStudentAccount,
  subscribeToAttempts,
  subscribeToDepartmentLogo,
  subscribeToQuestions,
  subscribeToSingleUser,
  subscribeToUserAttempts,
  subscribeToUsers,
  syncExamWrongQuestionsToFirestore,
  testFirestoreConnection,
  toggleQuestionBookmarkInFirestore,
  updateDepartmentLogoInFirestore,
  updateStudentPasswordInFirestore,
  updateUserActivityAndStudyTime,
} from './services/firebase';
import { ExamAttempt, Question, UserAccount } from './types/exam';
import {
  DEFAULT_DEPARTMENT_LOGO_URL,
  isAdminAccount,
  resolveDepartmentLogoUrl,
} from './utils/branding';
import {
  compressLogoFileToBase64,
  ensureCompactLogoDataUrl,
} from './utils/questionBankUtils';
import { computeUpdatedWrongQuestions } from './utils/scoring';
import { appDataApi } from './services/appDataApi';
import { examSessionApi } from './services/examSessionApi';

const SESSION_STORAGE_KEY = 'certiport_genai_active_user_id_v3';
const DEPARTMENT_LOGO_CACHE_KEY = 'igc_toantin_logo_url_v2';
const PUBLIC_QUESTIONS_COUNT_CACHE_KEY = 'certiport_genai_public_questions_count_v1';

// Dọn sạch các khóa bộ nhớ cục bộ cũ từng lưu danh sách tài khoản/mật khẩu hoặc ngân hàng câu hỏi/đáp án
try {
  localStorage.removeItem('certiport_genai_active_user_id');
  localStorage.removeItem('certiport_genai_users_cache_v1');
  localStorage.removeItem('certiport_genai_questions_cache_v1');
  localStorage.removeItem('certiport_genai_attempts_cache_v1');
  localStorage.removeItem('certiport_genai_users_cache_v3');
  localStorage.removeItem('certiport_genai_questions_cache_v3');
  localStorage.removeItem('certiport_genai_attempts_cache_v3');
  localStorage.removeItem('igc_toantin_logo_url_v1');
} catch {
  // Bỏ qua
}

export default function App() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [publicQuestionsCount, setPublicQuestionsCount] = useState<number | null>(() => {
    try {
      const cached = Number(localStorage.getItem(PUBLIC_QUESTIONS_COUNT_CACHE_KEY));
      return Number.isFinite(cached) && cached > 0 ? cached : null;
    } catch {
      return null;
    }
  });
  const [authenticatedUserSnapshot, setAuthenticatedUserSnapshot] =
    useState<UserAccount | null>(null);

  const [activeUserId, setActiveUserId] = useState<string | null>(() => {
    // Chỉ cho phép tham số xem trước nhanh trên URL trong môi trường phát triển (DEV)
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      const customUser = params.get('user')?.trim();
      if (customUser) {
        return customUser;
      }
      if (params.get('role') === 'teacher' || params.get('autostart') === '1') {
        return 'admin';
      }
      if (params.get('role') === 'student') {
        return 'student_preview';
      }
    }
    try {
      return localStorage.getItem(SESSION_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [departmentLogoUrl, setDepartmentLogoUrl] = useState<string | undefined>(() => {
    try {
      return localStorage.getItem(DEPARTMENT_LOGO_CACHE_KEY) || undefined;
    } catch {
      return undefined;
    }
  });
  const [isOfficialDefaultLogo, setIsOfficialDefaultLogo] = useState<boolean>(true);

  const [isLiveExamMode, setIsLiveExamMode] = useState<boolean>(() => {
    if (!import.meta.env.DEV) return false;
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    return tabParam === 'live-exam' || tabParam === 'thingay';
  });

  // Trạng thái kết nối với máy chủ Express Write-Through Cache:
  // - 'checking': đang kiểm tra /api/public/branding (KHÔNG mở listener Firestore)
  // - 'express': toàn bộ đọc/ghi đi qua RAM máy chủ Express (0 lượt đọc Firestore phía trình duyệt)
  // - 'fallback': chỉ kích hoạt trên môi trường static host không có backend Express
  const [expressApiMode, setExpressApiMode] = useState<
    'checking' | 'express' | 'fallback'
  >('checking');
  const [isRefreshingData, setIsRefreshingData] = useState(false);

  const applyDepartmentLogoState = useCallback(
    (remoteLogo: string | undefined, isOfficialDefault: boolean) => {
      const cleanedRemote =
        typeof remoteLogo === 'string' ? remoteLogo.trim() : '';
      if (cleanedRemote) {
        setDepartmentLogoUrl(cleanedRemote);
        setIsOfficialDefaultLogo(Boolean(isOfficialDefault));
        try {
          localStorage.setItem(DEPARTMENT_LOGO_CACHE_KEY, cleanedRemote);
        } catch {
          // Bỏ qua
        }
      } else {
        setDepartmentLogoUrl(undefined);
        setIsOfficialDefaultLogo(true);
        try {
          localStorage.removeItem(DEPARTMENT_LOGO_CACHE_KEY);
        } catch {
          // Bỏ qua
        }
      }
    },
    []
  );

  const persistPublicQuestionsCount = useCallback((count: number) => {
    setPublicQuestionsCount(count);
    if (count > 0) {
      try {
        localStorage.setItem(PUBLIC_QUESTIONS_COUNT_CACHE_KEY, String(count));
      } catch {
        // Bỏ qua
      }
    }
  }, []);

  // Tải logo & tổng số câu hỏi công khai từ RAM máy chủ Express (/api/public/branding — 0 lượt đọc Firestore).
  // Chỉ dùng Firestore trực tiếp khi môi trường không có backend Express (static host fallback).
  useEffect(() => {
    let cancelled = false;
    let unsubFallbackLogo: (() => void) | null = null;

    const loadPublicBranding = async () => {
      const branding = await appDataApi.getPublicBranding();
      if (cancelled) return;

      if (branding) {
        setExpressApiMode('express');
        applyDepartmentLogoState(
          branding.departmentLogoUrl,
          branding.isOfficialDefaultLogo
        );
        if (branding.questionsCount > 0) {
          persistPublicQuestionsCount(branding.questionsCount);
        } else {
          setPublicQuestionsCount((prev) =>
            prev !== null && prev > 0 ? prev : branding.questionsCount
          );
        }
        return;
      }

      // Môi trường tĩnh không có Express API -> dự phòng qua Firestore
      setExpressApiMode('fallback');
      unsubFallbackLogo = subscribeToDepartmentLogo(
        (remoteLogo, isOfficialDefault) => {
          if (cancelled) return;
          applyDepartmentLogoState(remoteLogo, Boolean(isOfficialDefault));
        }
      );

      const firestoreCount = await fetchPublicQuestionsCount();
      if (cancelled) return;
      if (typeof firestoreCount === 'number' && firestoreCount > 0) {
        persistPublicQuestionsCount(firestoreCount);
      }
    };

    void loadPublicBranding();
    return () => {
      cancelled = true;
      if (unsubFallbackLogo) {
        unsubFallbackLogo();
      }
    };
  }, [applyDepartmentLogoState, persistPublicQuestionsCount]);

  // Xác thực lại mã phiên HMAC-SHA256 khi tải lại trang nếu có phiên đang lưu
  useEffect(() => {
    if (!activeUserId) return;

    // Bỏ qua kiểm tra token bắt buộc đối với các tham số xem trước chỉ dùng trong DEV
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      if (
        params.get('user') ||
        params.get('role') ||
        params.get('autostart') === '1'
      ) {
        return;
      }
    }

    let cancelled = false;
    examSessionApi.verifySession().then((res) => {
      if (cancelled) return;
      if (res.status === 'valid') {
        setExpressApiMode('express');
        setAuthenticatedUserSnapshot(res.user);
      } else if (res.status === 'quota_exceeded') {
        setExpressApiMode('express');
        setAuthenticatedUserSnapshot(null);
        setActiveUserId(null);
        setLoginError(res.message);
      } else if (res.status === 'invalid') {
        examSessionApi.clearAuthToken();
        setAuthenticatedUserSnapshot(null);
        setActiveUserId(null);
        setLoginError(null);
        try {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {
          // Bỏ qua
        }
      } else if (res.status === 'offline') {
        setExpressApiMode('fallback');
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeUserId]);

  // Lưu hồ sơ đơn lẻ cho học sinh (hoặc kiểm tra vai trò giáo viên phụ khi tải lại trang)
  const [singleUserDoc, setSingleUserDoc] = useState<UserAccount | null>(null);
  const studentQuestionsCacheRef = useRef<Question[] | null>(null);
  const lastRemoteTeacherSyncFingerprintRef = useRef<string>('');

  // Xác định sớm tài khoản hiện tại có chắc chắn là Giáo viên hay không
  // Lưu ý: Học sinh KHÔNG BAO GIỜ mở listener toàn bộ collection `users`
  const isConfirmedTeacher = useMemo(() => {
    if (!activeUserId) return false;
    const normalizedId = activeUserId.toLowerCase();
    if (
      authenticatedUserSnapshot &&
      authenticatedUserSnapshot.id.toLowerCase() === normalizedId
    ) {
      return authenticatedUserSnapshot.role === 'teacher';
    }
    if (
      singleUserDoc &&
      singleUserDoc.id.toLowerCase() === normalizedId &&
      singleUserDoc.role === 'teacher'
    ) {
      return true;
    }
    if (normalizedId === 'admin') {
      return true;
    }
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      if (params.get('role') === 'teacher' || normalizedId.startsWith('gv_')) {
        return true;
      }
    }
    return false;
  }, [activeUserId, authenticatedUserSnapshot, singleUserDoc]);

  // Nạp dữ liệu theo đúng vai trò từ RAM máy chủ Express (/api/app/bootstrap — 0 lượt đọc Firestore)
  const loadAppDataFromExpress = useCallback(
    async (options?: { mode?: 'live-exam'; silent?: boolean }) => {
      if (!activeUserId) return false;
      const token = examSessionApi.getAuthToken();
      if (!token) return false;

      if (!options?.silent) {
        setIsRefreshingData(true);
      }
      try {
        const payload = await appDataApi.bootstrap(
          options?.mode ? { mode: options.mode } : undefined
        );
        if (!payload) {
          if (appDataApi.isUnavailable()) {
            setExpressApiMode('fallback');
          }
          return false;
        }

        setExpressApiMode('express');
        setAuthenticatedUserSnapshot(payload.currentUser);
        setSingleUserDoc(payload.currentUser);
        setUsers(payload.users);
        setAttempts(payload.attempts);

        if (options?.mode === 'live-exam') {
          studentQuestionsCacheRef.current = null;
          setQuestions([]);
        } else {
          setQuestions(payload.questions);
          if (payload.role === 'student') {
            studentQuestionsCacheRef.current = payload.questions;
          }
          if (payload.questionsCount > 0) {
            persistPublicQuestionsCount(payload.questionsCount);
          }
        }

        applyDepartmentLogoState(
          payload.departmentLogoUrl,
          payload.isOfficialDefaultLogo
        );
        return true;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (status === 401) {
          examSessionApi.clearAuthToken();
          setAuthenticatedUserSnapshot(null);
          setActiveUserId(null);
          try {
            localStorage.removeItem(SESSION_STORAGE_KEY);
          } catch {
            // Bỏ qua
          }
        }
        return false;
      } finally {
        if (!options?.silent) {
          setIsRefreshingData(false);
        }
      }
    },
    [activeUserId, applyDepartmentLogoState, persistPublicQuestionsCount]
  );

  // Dọn dữ liệu khi đăng xuất; chỉ mở listener Firestore khi đang chạy ở chế độ fallback (static host)
  useEffect(() => {
    if (!activeUserId) {
      setUsers([]);
      setSingleUserDoc(null);
      setQuestions([]);
      setAttempts([]);
      studentQuestionsCacheRef.current = null;
      lastRemoteTeacherSyncFingerprintRef.current = '';
      examSessionApi.cancelPendingRemoteContextSync();
      return;
    }

    if (expressApiMode !== 'fallback') {
      return;
    }

    let isMounted = true;

    if (!isConfirmedTeacher) {
      const unsubSingleUser = subscribeToSingleUser(activeUserId, (liveUser) => {
        if (!isMounted) return;
        setSingleUserDoc(liveUser);
        setUsers(liveUser ? [liveUser] : []);
      });

      return () => {
        isMounted = false;
        unsubSingleUser();
      };
    }

    const unsubUsers = subscribeToUsers((liveUsers) => {
      if (!isMounted) return;
      const cleanedList = liveUsers
        .filter((lu) => !isLegacyVirtualUser(lu))
        .map((lu) => ({
          ...lu,
          bookmarkedQuestions: lu.bookmarkedQuestions ?? [],
          wrongQuestions: lu.wrongQuestions ?? [],
          masteredQuestions: lu.masteredQuestions ?? [],
          practiceProgress: lu.practiceProgress ?? {},
        }));
      setUsers(cleanedList);
      const adminDoc = cleanedList.find((u) => u.id === 'admin');
      if (adminDoc && typeof adminDoc.logoUrl === 'string' && adminDoc.logoUrl.trim()) {
        const cleanedLogo = adminDoc.logoUrl.trim();
        setDepartmentLogoUrl(cleanedLogo);
        try {
          localStorage.setItem(DEPARTMENT_LOGO_CACHE_KEY, cleanedLogo);
        } catch {
          // Bỏ qua
        }
      }
    });

    async function bootstrapUsers() {
      const isOnline = await testFirestoreConnection();
      if (isMounted && isOnline && activeUserId === 'admin') {
        await ensureSeedDataInitialized();
      }
    }

    void bootstrapUsers();

    return () => {
      isMounted = false;
      unsubUsers();
    };
  }, [activeUserId, isConfirmedTeacher, expressApiMode]);

  const currentUser = useMemo(() => {
    if (!activeUserId) return null;
    const found =
      users.find((u) => u.id.toLowerCase() === activeUserId.toLowerCase()) ??
      (singleUserDoc &&
      singleUserDoc.id.toLowerCase() === activeUserId.toLowerCase()
        ? singleUserDoc
        : null) ??
      (authenticatedUserSnapshot &&
      authenticatedUserSnapshot.id.toLowerCase() === activeUserId.toLowerCase()
        ? authenticatedUserSnapshot
        : null);
    if (found) return found;

    // Chỉ cho phép tạo hồ sơ xem trước từ tham số URL trong môi trường phát triển (DEV)
    if (import.meta.env.DEV) {
      const params = new URLSearchParams(window.location.search);
      const roleParam = params.get('role');
      const classParam = params.get('class')?.trim();

      if (
        roleParam === 'teacher' ||
        activeUserId.toLowerCase().startsWith('gv_')
      ) {
        const resolvedClass =
          classParam ||
          (activeUserId.toLowerCase() === 'gv_toan'
            ? '12A1'
            : activeUserId.toLowerCase() === 'gv_tin'
              ? '12A2'
              : '12A1');
        return {
          id: activeUserId,
          username: activeUserId,
          password: '',
          fullName: `Giáo viên (${activeUserId})`,
          role: 'teacher' as const,
          className: resolvedClass,
          lastLogin: new Date().toISOString(),
          status: 'online' as const,
          activeStatus: 'online' as const,
          totalStudyMinutes: 0,
          totalStudySeconds: 0,
        };
      }

      if (activeUserId === 'student_preview' || roleParam === 'student') {
        return {
          id: activeUserId,
          username: activeUserId === 'student_preview' ? 'HocSinh' : activeUserId,
          password: '',
          fullName:
            activeUserId === 'student_preview'
              ? 'Chế độ Xem Giao diện Học sinh'
              : `Học sinh (${activeUserId})`,
          role: 'student' as const,
          className: classParam || 'Phòng thi Certiport GenAI',
          lastLogin: new Date().toISOString(),
          status: 'online' as const,
          activeStatus: 'online' as const,
          totalStudyMinutes: 0,
          totalStudySeconds: 0,
          bookmarkedQuestions: [],
          wrongQuestions: [],
          masteredQuestions: [],
          practiceProgress: {},
        };
      }
    }

    return null;
  }, [activeUserId, users, singleUserDoc, authenticatedUserSnapshot]);

  const isTeacherRole = currentUser?.role === 'teacher';
  const currentStudentUsername = !isTeacherRole ? currentUser?.username : undefined;

  // Khi Express Write-Through Cache đang hoạt động:
  // - Tải toàn bộ dữ liệu theo đúng vai trò qua GET /api/app/bootstrap (0 lượt đọc Firestore)
  // - Khi học sinh vào tab "Thi ngay", lập tức xóa câu hỏi khỏi bộ nhớ React mà không gọi Firestore
  useEffect(() => {
    if (!activeUserId || expressApiMode !== 'express') {
      return;
    }

    if (!isTeacherRole && isLiveExamMode) {
      studentQuestionsCacheRef.current = null;
      setQuestions([]);
      return;
    }

    void loadAppDataFromExpress({
      mode: !isTeacherRole && isLiveExamMode ? 'live-exam' : undefined,
      silent: true,
    });
  }, [activeUserId, expressApiMode, isTeacherRole, isLiveExamMode, loadAppDataFromExpress]);

  // Làm mới nhẹ mỗi 30 giây từ RAM máy chủ Express cho Giáo viên (0 lượt đọc Firestore, chỉ chạy khi tab đang mở)
  useEffect(() => {
    if (!activeUserId || expressApiMode !== 'express' || !isTeacherRole) {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadAppDataFromExpress({ silent: true });
      }
    }, 30_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeUserId, expressApiMode, isTeacherRole, loadAppDataFromExpress]);

  // Chỉ dùng Firestore trực tiếp cho questions/attempts khi đang ở chế độ static host fallback
  useEffect(() => {
    if (!activeUserId || expressApiMode !== 'fallback') {
      return;
    }

    if (isTeacherRole) {
      const unsubQuestions = subscribeToQuestions((liveQuestions) => {
        setQuestions(liveQuestions);
        if (liveQuestions.length > 0) {
          persistPublicQuestionsCount(liveQuestions.length);
        }
      });
      const unsubAttempts = subscribeToAttempts((liveAttempts) => {
        setAttempts(liveAttempts);
      });
      return () => {
        unsubQuestions();
        unsubAttempts();
      };
    }

    if (isLiveExamMode) {
      studentQuestionsCacheRef.current = null;
      setQuestions([]);
      return;
    }

    let isCancelled = false;

    if (studentQuestionsCacheRef.current && studentQuestionsCacheRef.current.length > 0) {
      setQuestions(studentQuestionsCacheRef.current);
      setPublicQuestionsCount(studentQuestionsCacheRef.current.length);
    } else {
      void fetchQuestionsOnce().then((fetchedQuestions) => {
        if (isCancelled) return;
        studentQuestionsCacheRef.current = fetchedQuestions;
        setQuestions(fetchedQuestions);
        if (fetchedQuestions.length > 0) {
          persistPublicQuestionsCount(fetchedQuestions.length);
        }
      });
    }

    const unsubStudentAttempts = subscribeToUserAttempts(
      activeUserId,
      currentStudentUsername,
      (studentAttempts) => {
        if (isCancelled) return;
        setAttempts(studentAttempts);
      }
    );

    return () => {
      isCancelled = true;
      unsubStudentAttempts();
    };
  }, [
    expressApiMode,
    isLiveExamMode,
    activeUserId,
    isTeacherRole,
    currentStudentUsername,
    persistPublicQuestionsCount,
  ]);

  // Cập nhật bộ nhớ đệm cục bộ trong examSessionApi mà KHÔNG bắn POST /sync-context tràn lan
  useEffect(() => {
    examSessionApi.syncContext(
      {
        currentUser,
        users: isTeacherRole ? users : undefined,
        questions: isTeacherRole ? questions : isLiveExamMode ? [] : undefined,
      },
      { syncRemote: false }
    );
  }, [currentUser, users, questions, isTeacherRole, isLiveExamMode]);

  // Dấu vân tay cấu trúc dành RIÊNG cho chế độ fallback khi không dùng Express write-through cache
  const teacherStructuralFingerprint = useMemo(() => {
    if (!isTeacherRole || expressApiMode === 'express') return '';
    const usersSignature = users
      .map(
        (u) =>
          `${u.id}|${u.username}|${u.password || ''}|${u.fullName}|${u.role}|${u.className || ''}`
      )
      .join(';');
    const questionsSignature = questions
      .map(
        (q) =>
          `${q.id}|${q.type}|${q.topic}|${q.prompt}|${JSON.stringify(q.correctAnswer)}|${q.options?.length ?? 0}|${q.subItems?.length ?? 0}|${q.pairs?.length ?? 0}|${q.steps?.length ?? 0}|${q.imageUrl ? q.imageUrl.length : 0}`
      )
      .join(';');
    return `u:${users.length}:${usersSignature}::q:${questions.length}:${questionsSignature}`;
  }, [isTeacherRole, expressApiMode, users, questions]);

  // Chỉ gửi POST /api/exam-sessions/sync-context khi đang ở chế độ fallback (trong Express mode, mọi ghi đã đi thẳng qua /api/teacher/*)
  useEffect(() => {
    if (!isTeacherRole || expressApiMode === 'express' || !teacherStructuralFingerprint) {
      return;
    }
    if (lastRemoteTeacherSyncFingerprintRef.current === teacherStructuralFingerprint) {
      return;
    }
    lastRemoteTeacherSyncFingerprintRef.current = teacherStructuralFingerprint;
    examSessionApi.syncContext(
      {
        currentUser,
        users,
        questions,
      },
      { syncRemote: true, debounceMs: 5000 }
    );
  }, [isTeacherRole, expressApiMode, teacherStructuralFingerprint, currentUser, users, questions]);

  // Hàm tiện ích cập nhật đồng bộ state tài khoản hiện tại ở client (users + singleUserDoc + authenticatedUserSnapshot)
  const applyLocalUserUpdate = useCallback(
    (uid: string, updater: (user: UserAccount) => UserAccount) => {
      const targetLower = uid.toLowerCase();
      setUsers((prev) =>
        prev.map((u) => (u.id.toLowerCase() === targetLower ? updater(u) : u))
      );
      setSingleUserDoc((prev) =>
        prev && prev.id.toLowerCase() === targetLower ? updater(prev) : prev
      );
      setAuthenticatedUserSnapshot((prev) =>
        prev && prev.id.toLowerCase() === targetLower ? updater(prev) : prev
      );
    },
    []
  );

  const syncUserFromServerSnapshot = useCallback((updatedUser?: UserAccount) => {
    if (!updatedUser) return;
    const targetLower = updatedUser.id.toLowerCase();
    setUsers((prev) => {
      const exists = prev.some((u) => u.id.toLowerCase() === targetLower);
      return exists
        ? prev.map((u) =>
            u.id.toLowerCase() === targetLower ? updatedUser : u
          )
        : [updatedUser];
    });
    setSingleUserDoc((prev) =>
      prev && prev.id.toLowerCase() === targetLower ? updatedUser : prev
    );
    setAuthenticatedUserSnapshot((prev) =>
      prev && prev.id.toLowerCase() === targetLower ? updatedUser : prev
    );
  }, []);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setLoginError(null);
      setIsAuthenticating(true);
      try {
        // Ưu tiên xác thực qua RAM máy chủ Express (0 lượt đọc Firestore) để nhận mã phiên HMAC-SHA256 hợp lệ
        const serverAuth = await examSessionApi.login(username, password);
        let authenticated: UserAccount;

        if (serverAuth) {
          setExpressApiMode('express');
          authenticated = serverAuth.user;
          // Express /api/auth/login đã cập nhật trạng thái online/studying vào RAM + Firestore -> không gọi Firestore phía trình duyệt
        } else {
          // Dự phòng khi chạy trên môi trường tĩnh không có backend Express
          setExpressApiMode('fallback');
          authenticated = await authenticateWithUsernamePassword(
            username,
            password,
            users
          );
        }

        setAuthenticatedUserSnapshot(authenticated);
        setSingleUserDoc(authenticated);
        setActiveUserId(authenticated.id);
        setIsLiveExamMode(false);
        try {
          localStorage.setItem(SESSION_STORAGE_KEY, authenticated.id);
        } catch {
          // Bỏ qua
        }
      } catch (err) {
        setLoginError(
          err instanceof Error
            ? err.message
            : 'Không thể đăng nhập. Vui lòng kiểm tra lại thông tin.'
        );
      } finally {
        setIsAuthenticating(false);
      }
    },
    [users]
  );

  const handleLogout = useCallback(async () => {
    const uid = activeUserId;
    const usedExpress = expressApiMode !== 'fallback' && Boolean(examSessionApi.getAuthToken());

    if (usedExpress) {
      try {
        await appDataApi.logout();
      } catch {
        // Bỏ qua lỗi mạng khi đăng xuất
      }
    }

    examSessionApi.clearAuthToken();
    setAuthenticatedUserSnapshot(null);
    setActiveUserId(null);
    setLoginError(null);
    setIsLiveExamMode(false);
    setQuestions([]);
    setUsers([]);
    setSingleUserDoc(null);
    setAttempts([]);
    studentQuestionsCacheRef.current = null;
    lastRemoteTeacherSyncFingerprintRef.current = '';
    examSessionApi.cancelPendingRemoteContextSync();
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Bỏ qua
    }
    if (uid && !usedExpress) {
      await updateUserActivityAndStudyTime(uid, 'offline', 0);
    }
  }, [activeUserId, expressApiMode]);

  const handleSyncStudyTime = useCallback(
    async (additionalSeconds: number) => {
      if (
        !activeUserId ||
        additionalSeconds <= 0 ||
        activeUserId.toLowerCase() === 'admin' ||
        currentUser?.role === 'teacher'
      ) {
        return;
      }
      const nowIso = new Date().toISOString();
      applyLocalUserUpdate(activeUserId, (u) => {
        const nextSec = (u.totalStudySeconds || 0) + additionalSeconds;
        return {
          ...u,
          totalStudySeconds: nextSec,
          totalStudyMinutes: Math.round(nextSec / 60),
          lastLogin: nowIso,
        };
      });

      if (expressApiMode !== 'fallback') {
        try {
          const res = await appDataApi.syncStudyTime(additionalSeconds, 'studying');
          if (res) {
            syncUserFromServerSnapshot(res.user);
            return;
          }
        } catch (err) {
          console.warn('Study-time sync notice:', err);
          return;
        }
      }

      await updateUserActivityAndStudyTime(
        activeUserId,
        'studying',
        additionalSeconds
      );
    },
    [
      activeUserId,
      currentUser,
      expressApiMode,
      applyLocalUserUpdate,
      syncUserFromServerSnapshot,
    ]
  );

  const canManageDepartmentLogo = useMemo(
    () => isAdminAccount(currentUser),
    [currentUser]
  );

  const effectiveDepartmentLogoUrl = useMemo(
    () => resolveDepartmentLogoUrl(departmentLogoUrl),
    [departmentLogoUrl]
  );

  const handleUpdateDepartmentLogo = useCallback(
    async (logoUrl: string) => {
      if (!isAdminAccount(currentUser)) {
        throw new Error('Chỉ tài khoản quản trị (admin) mới có quyền chỉnh sửa logo.');
      }
      const cleaned = logoUrl.trim();
      const resettingToOfficialDefault = !cleaned;
      let compact = cleaned ? await ensureCompactLogoDataUrl(cleaned) : '';

      // Khi khôi phục logo mặc định, đồng bộ lại bản nén của logo chính thức
      if (resettingToOfficialDefault) {
        try {
          const resp = await fetch(DEFAULT_DEPARTMENT_LOGO_URL);
          if (resp.ok) {
            const blob = await resp.blob();
            compact = await compressLogoFileToBase64(blob);
          }
        } catch {
          compact = '';
        }
      }

      applyDepartmentLogoState(compact || undefined, resettingToOfficialDefault);
      setUsers((prev) =>
        prev.map((u) => (u.id === 'admin' ? { ...u, logoUrl: compact } : u))
      );

      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.updateDepartmentLogo(
          compact,
          resettingToOfficialDefault
        );
        if (res) return;
      }

      await updateDepartmentLogoInFirestore(compact, {
        isOfficialDefault: resettingToOfficialDefault,
      });
    },
    [currentUser, expressApiMode, applyDepartmentLogoState]
  );

  // Optimistic + Write-Through sync cho Bookmark
  const handleToggleBookmark = useCallback(
    async (questionId: string) => {
      if (!currentUser) return;
      const uid = currentUser.id;
      applyLocalUserUpdate(uid, (u) => {
        const cur = u.bookmarkedQuestions ?? [];
        const next = cur.includes(questionId)
          ? cur.filter((id) => id !== questionId)
          : [...cur, questionId];
        return { ...u, bookmarkedQuestions: next };
      });

      if (expressApiMode !== 'fallback') {
        try {
          const res = await appDataApi.toggleBookmark(questionId);
          if (res) {
            syncUserFromServerSnapshot(res.user);
            return;
          }
        } catch (err) {
          console.warn('Bookmark sync notice:', err);
          return;
        }
      }

      await toggleQuestionBookmarkInFirestore(uid, questionId);
    },
    [currentUser, expressApiMode, applyLocalUserUpdate, syncUserFromServerSnapshot]
  );

  // Optimistic + Write-Through sync khi học sinh bấm "Kiểm tra đáp án"
  const handleRecordPracticeCheck = useCallback(
    async (
      questionId: string,
      isCorrect: boolean,
      removeOnCorrect: boolean = false
    ) => {
      if (!currentUser) return;
      const uid = currentUser.id;
      applyLocalUserUpdate(uid, (u) => {
        const { wrongQuestions, masteredQuestions } =
          computeUpdatedWrongQuestions(
            u.wrongQuestions ?? [],
            u.masteredQuestions ?? [],
            questionId,
            isCorrect,
            removeOnCorrect
          );
        const prevProg = u.practiceProgress ?? {};
        const prevItem = prevProg[questionId];
        return {
          ...u,
          wrongQuestions,
          masteredQuestions,
          practiceProgress: {
            ...prevProg,
            [questionId]: {
              answeredAt: new Date().toISOString(),
              isCorrect,
              attemptsCount: (prevItem?.attemptsCount ?? 0) + 1,
            },
          },
        };
      });

      if (expressApiMode !== 'fallback') {
        try {
          const res = await appDataApi.recordPracticeCheck(
            questionId,
            isCorrect,
            removeOnCorrect
          );
          if (res) {
            syncUserFromServerSnapshot(res.user);
            return;
          }
        } catch (err) {
          console.warn('Practice check sync notice:', err);
          return;
        }
      }

      await recordQuestionPracticeResultInFirestore(
        uid,
        questionId,
        isCorrect,
        removeOnCorrect
      );
    },
    [currentUser, expressApiMode, applyLocalUserUpdate, syncUserFromServerSnapshot]
  );

  // Optimistic + Write-Through sync khi học sinh bấm "Đã nắm vững (Xóa khỏi kho câu sai)"
  const handleMarkQuestionMastered = useCallback(
    async (questionId: string) => {
      if (!currentUser) return;
      const uid = currentUser.id;
      applyLocalUserUpdate(uid, (u) => {
        const { wrongQuestions, masteredQuestions } =
          computeUpdatedWrongQuestions(
            u.wrongQuestions ?? [],
            u.masteredQuestions ?? [],
            questionId,
            true,
            true
          );
        return {
          ...u,
          wrongQuestions,
          masteredQuestions,
        };
      });

      if (expressApiMode !== 'fallback') {
        try {
          const res = await appDataApi.markMastered(questionId);
          if (res) {
            syncUserFromServerSnapshot(res.user);
            return;
          }
        } catch (err) {
          console.warn('Mark mastered sync notice:', err);
          return;
        }
      }

      await markQuestionMasteredInFirestore(uid, questionId);
    },
    [currentUser, expressApiMode, applyLocalUserUpdate, syncUserFromServerSnapshot]
  );

  const handleSaveAttempt = useCallback(
    async (attempt: ExamAttempt, wrongQuestionIdsFromExam: string[]) => {
      setAttempts((prev) => [attempt, ...prev]);

      if (currentUser && currentUser.role === 'student') {
        applyLocalUserUpdate(currentUser.id, (u) => {
          const wrongSet = new Set([
            ...(u.wrongQuestions ?? []),
            ...wrongQuestionIdsFromExam,
          ]);
          const nextSec =
            (u.totalStudySeconds || 0) + Math.max(0, attempt.durationSeconds || 0);
          return {
            ...u,
            wrongQuestions: Array.from(wrongSet),
            totalStudySeconds: nextSec,
            totalStudyMinutes: Math.round(nextSec / 60),
          };
        });
      }

      if (expressApiMode !== 'fallback') {
        try {
          const res = await appDataApi.saveAttempt(
            attempt,
            wrongQuestionIdsFromExam
          );
          if (res) {
            syncUserFromServerSnapshot(res.user);
            return;
          }
        } catch (err) {
          console.warn('Attempt save notice:', err);
          return;
        }
      }

      await recordExamAttempt(attempt);
      if (currentUser && currentUser.role === 'student') {
        if (wrongQuestionIdsFromExam.length > 0) {
          await syncExamWrongQuestionsToFirestore(
            currentUser.id,
            wrongQuestionIdsFromExam
          );
        }
        await updateUserActivityAndStudyTime(
          currentUser.id,
          'studying',
          attempt.durationSeconds
        );
      }
    },
    [currentUser, expressApiMode, applyLocalUserUpdate, syncUserFromServerSnapshot]
  );

  const handleSaveStudent = useCallback(
    async (student: UserAccount) => {
      setUsers((prev) => {
        const exists = prev.some((u) => u.id === student.id);
        return exists
          ? prev.map((u) => (u.id === student.id ? student : u))
          : [...prev, student];
      });
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.saveStudent(student);
        if (res) return;
      }
      await saveStudentAccount(student);
    },
    [expressApiMode]
  );

  const handleBatchSaveStudents = useCallback(
    async (incomingStudents: UserAccount[]) => {
      setUsers((prev) => {
        const map = new Map<string, UserAccount>(prev.map((u) => [u.id, u]));
        for (const st of incomingStudents) {
          map.set(st.id, st);
        }
        return Array.from(map.values());
      });
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.saveStudentsBatch(incomingStudents);
        if (res) return;
      }
      await saveMultipleStudentAccountsToFirestore(incomingStudents);
    },
    [expressApiMode]
  );

  const handleUpdateStudentPassword = useCallback(
    async (userId: string, newPassword: string) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, password: newPassword.trim() } : u
        )
      );
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.updateStudentPassword(userId, newPassword);
        if (res) return;
      }
      await updateStudentPasswordInFirestore(userId, newPassword);
    },
    [expressApiMode]
  );

  const handleResetStudentProgress = useCallback(
    async (userId: string) => {
      const attemptIdsToDelete = attempts
        .filter(
          (a) =>
            a.userId === userId ||
            a.username.toLowerCase() === userId.toLowerCase()
        )
        .map((a) => a.id);

      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                totalStudySeconds: 0,
                totalStudyMinutes: 0,
                bookmarkedQuestions: [],
                wrongQuestions: [],
                masteredQuestions: [],
                practiceProgress: {},
              }
            : u
        )
      );
      setAttempts((prev) =>
        prev.filter(
          (a) =>
            a.userId !== userId &&
            a.username.toLowerCase() !== userId.toLowerCase()
        )
      );
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.resetStudentProgress(userId);
        if (res) return;
      }
      await resetStudentLearningDataInFirestore(userId, attemptIdsToDelete);
    },
    [attempts, expressApiMode]
  );

  const handleDeleteStudent = useCallback(
    async (userId: string) => {
      if (userId.toLowerCase() === 'admin') return;
      setUsers((prev) => prev.filter((u) => u.id !== userId));
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.deleteStudent(userId);
        if (res) return;
      }
      await deleteStudentAccount(userId);
    },
    [expressApiMode]
  );

  const handleBatchDeleteStudents = useCallback(
    async (userIds: string[]) => {
      const currentIdLower = currentUser?.id?.toLowerCase() || '';
      const safeIds = Array.from(
        new Set(
          userIds
            .map((id) => id.trim())
            .filter(
              (id) =>
                id.length > 0 &&
                id.toLowerCase() !== 'admin' &&
                id.toLowerCase() !== currentIdLower
            )
        )
      );
      if (safeIds.length === 0) return;
      const deleteSet = new Set(safeIds);
      setUsers((prev) => prev.filter((u) => !deleteSet.has(u.id)));
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.batchDeleteStudents(safeIds);
        if (res) return;
      }
      await deleteMultipleStudentAccounts(safeIds);
    },
    [currentUser, expressApiMode]
  );

  const handleSaveQuestion = useCallback(
    async (question: Question) => {
      setQuestions((prev) => {
        const exists = prev.some((q) => q.id === question.id);
        return exists
          ? prev.map((q) => (q.id === question.id ? question : q))
          : [...prev, question];
      });
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.saveQuestion(question);
        if (res) return;
      }
      await saveQuestionToFirestore(question);
    },
    [expressApiMode]
  );

  const handleDeleteQuestion = useCallback(
    async (questionId: string) => {
      setQuestions((prev) => prev.filter((q) => q.id !== questionId));
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.deleteQuestion(questionId);
        if (res) return;
      }
      await deleteQuestionFromFirestore(questionId);
    },
    [expressApiMode]
  );

  const handleBatchSaveQuestions = useCallback(
    async (incomingQuestions: Question[], replaceAll: boolean = false) => {
      setQuestions((prev) => {
        if (replaceAll) {
          return incomingQuestions;
        }
        const map = new Map<string, Question>(prev.map((q) => [q.id, q]));
        for (const iq of incomingQuestions) {
          map.set(iq.id, iq);
        }
        return Array.from(map.values());
      });
      if (expressApiMode !== 'fallback') {
        const res = await appDataApi.saveQuestionsBatch(
          incomingQuestions,
          replaceAll
        );
        if (res) return;
      }
      await saveMultipleQuestionsToFirestore(incomingQuestions);
    },
    [expressApiMode]
  );

  const handleResetSeedData = useCallback(async () => {
    setUsers((prev) => prev.filter((u) => !isLegacyVirtualUser(u)));
    setQuestions((prev) => prev.filter((q) => !isLegacyVirtualQuestion(q)));
    setAttempts((prev) => prev.filter((a) => !isLegacyVirtualAttempt(a)));
    await resetSeedDataToDefault();
  }, []);

  const handleRefreshTeacherData = useCallback(async () => {
    await loadAppDataFromExpress({ silent: false });
  }, [loadAppDataFromExpress]);

  const portalLoadingFallback = (
    <div
      data-testid="portal-lazy-loading"
      className="min-h-screen bg-[var(--color-bg-canvas)] flex flex-col items-center justify-center gap-3 p-6 text-center"
    >
      <div
        className="w-9 h-9 rounded-full border-3 border-teal-200 border-t-teal-700 animate-spin"
        aria-hidden="true"
      />
      <p className="text-sm font-semibold text-[var(--color-text-secondary)]">
        Đang tải giao diện...
      </p>
    </div>
  );

  return (
    <ThemeProvider>
      {!currentUser ? (
        <LoginScreen
          onLogin={handleLogin}
          isLoading={isAuthenticating}
          errorMessage={loginError}
          onClearError={() => setLoginError(null)}
          seededUsers={users}
          questionsCount={questions.length > 0 ? questions.length : publicQuestionsCount}
          departmentLogoUrl={effectiveDepartmentLogoUrl}
        />
      ) : currentUser.role === 'teacher' ? (
        <Suspense fallback={portalLoadingFallback}>
          <TeacherPortal
            currentUser={currentUser}
            users={users}
            questions={questions}
            attempts={attempts}
            departmentLogoUrl={effectiveDepartmentLogoUrl}
            hasCustomDepartmentLogo={Boolean(departmentLogoUrl && !isOfficialDefaultLogo)}
            onUpdateDepartmentLogo={
              canManageDepartmentLogo ? handleUpdateDepartmentLogo : undefined
            }
            onRefreshData={
              expressApiMode === 'express' ? handleRefreshTeacherData : undefined
            }
            isRefreshingData={isRefreshingData}
            onLogout={handleLogout}
            onSaveStudent={handleSaveStudent}
            onBatchSaveStudents={handleBatchSaveStudents}
            onUpdateStudentPassword={handleUpdateStudentPassword}
            onResetStudentProgress={handleResetStudentProgress}
            onDeleteStudent={handleDeleteStudent}
            onBatchDeleteStudents={handleBatchDeleteStudents}
            onSaveQuestion={handleSaveQuestion}
            onDeleteQuestion={handleDeleteQuestion}
            onBatchSaveQuestions={handleBatchSaveQuestions}
            onResetSeedData={handleResetSeedData}
          />
        </Suspense>
      ) : (
        <Suspense fallback={portalLoadingFallback}>
          <StudentPortal
            currentUser={currentUser}
            questions={questions}
            attempts={attempts}
            departmentLogoUrl={effectiveDepartmentLogoUrl}
            onLogout={handleLogout}
            onSaveAttempt={handleSaveAttempt}
            onSyncStudyTime={handleSyncStudyTime}
            onToggleBookmark={handleToggleBookmark}
            onRecordPracticeCheck={handleRecordPracticeCheck}
            onMarkQuestionMastered={handleMarkQuestionMastered}
            onActiveTabChange={(tab) => setIsLiveExamMode(tab === 'live-exam')}
          />
        </Suspense>
      )}
    </ThemeProvider>
  );
}
