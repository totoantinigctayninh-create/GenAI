import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
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
  deleteQuestionFromFirestore,
  deleteStudentAccount,
  ensureSeedDataInitialized,
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
import { examSessionApi } from './services/examSessionApi';

const SESSION_STORAGE_KEY = 'certiport_genai_active_user_id_v3';
const DEPARTMENT_LOGO_CACHE_KEY = 'igc_toantin_logo_url_v2';

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
  const [publicQuestionsCount, setPublicQuestionsCount] = useState<number>(0);
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

  // Tải số lượng câu hỏi công khai cho màn hình đăng nhập (không tải nội dung/đáp án)
  useEffect(() => {
    let cancelled = false;
    examSessionApi.getPublicStats().then((stats) => {
      if (!cancelled && stats && typeof stats.questionsCount === 'number') {
        setPublicQuestionsCount(stats.questionsCount);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
        setAuthenticatedUserSnapshot(res.user);
      } else if (res.status === 'invalid') {
        setAuthenticatedUserSnapshot(null);
        setActiveUserId(null);
        try {
          localStorage.removeItem(SESSION_STORAGE_KEY);
        } catch {
          // Bỏ qua
        }
        setLoginError(res.message);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeUserId]);

  // Đồng bộ thời gian thực Logo Tổ Toán - Tin từ Firestore (nếu Quản trị viên có cập nhật logo tùy chỉnh).
  // Khi không có bản ghi đè trên Firestore, toàn bộ hệ thống hiển thị logo chính thức mặc định đã đóng gói sẵn.
  useEffect(() => {
    const unsubLogo = subscribeToDepartmentLogo((remoteLogo, isOfficialDefault) => {
      const cleanedRemote = typeof remoteLogo === 'string' ? remoteLogo.trim() : '';
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
    });

    return () => {
      unsubLogo();
    };
  }, []);

  // Khởi tạo kết nối Firestore cho tài khoản người dùng khi đã đăng nhập
  useEffect(() => {
    if (!activeUserId) {
      setUsers([]);
      return;
    }

    let isMounted = true;
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
  }, [activeUserId]);

  const currentUser = useMemo(() => {
    if (!activeUserId) return null;
    const found =
      users.find((u) => u.id.toLowerCase() === activeUserId.toLowerCase()) ??
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
  }, [activeUserId, users, authenticatedUserSnapshot]);

  const isTeacherRole = currentUser?.role === 'teacher';

  // Chỉ lắng nghe bộ câu hỏi và lịch sử tự luyện khi đã đăng nhập VÀ học sinh KHÔNG ở chế độ "Thi ngay"
  // Khi học sinh bước vào tab "Thi ngay", lập tức xóa bộ câu hỏi (chứa correctAnswer) khỏi bộ nhớ React và ngắt lắng nghe Firestore
  useEffect(() => {
    if (!activeUserId) {
      setQuestions([]);
      setAttempts([]);
      return;
    }

    if (isLiveExamMode && !isTeacherRole) {
      setQuestions([]);
      return;
    }

    const unsubQuestions = subscribeToQuestions((liveQuestions) => {
      setQuestions(liveQuestions);
      if (liveQuestions.length > 0) {
        setPublicQuestionsCount(liveQuestions.length);
      }
    });
    const unsubAttempts = subscribeToAttempts((liveAttempts) => {
      setAttempts(liveAttempts);
    });
    return () => {
      unsubQuestions();
      unsubAttempts();
    };
  }, [isLiveExamMode, activeUserId, isTeacherRole]);

  useEffect(() => {
    examSessionApi.syncContext({
      currentUser,
      users: isTeacherRole ? users : undefined,
      questions: isTeacherRole ? questions : isLiveExamMode ? [] : undefined,
    });
  }, [currentUser, users, questions, isTeacherRole, isLiveExamMode]);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setLoginError(null);
      setIsAuthenticating(true);
      try {
        // Ưu tiên xác thực qua máy chủ Express để nhận mã phiên HMAC-SHA256 hợp lệ
        const serverAuth = await examSessionApi.login(username, password);
        let authenticated: UserAccount;

        if (serverAuth) {
          authenticated = serverAuth.user;
          void updateUserActivityAndStudyTime(
            authenticated.id,
            authenticated.role === 'student' ? 'studying' : 'online',
            0
          );
        } else {
          // Dự phòng khi chạy trên môi trường tĩnh không có backend Express
          authenticated = await authenticateWithUsernamePassword(
            username,
            password,
            users
          );
        }

        setAuthenticatedUserSnapshot(authenticated);
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
    examSessionApi.clearAuthToken();
    setAuthenticatedUserSnapshot(null);
    setActiveUserId(null);
    setIsLiveExamMode(false);
    setQuestions([]);
    setUsers([]);
    setAttempts([]);
    try {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    } catch {
      // Bỏ qua
    }
    if (uid) {
      await updateUserActivityAndStudyTime(uid, 'offline', 0);
    }
  }, [activeUserId]);

  const handleSyncStudyTime = useCallback(
    async (additionalSeconds: number) => {
      if (
        !activeUserId ||
        activeUserId.toLowerCase() === 'admin' ||
        currentUser?.role === 'teacher'
      ) {
        return;
      }
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id.toLowerCase() !== activeUserId.toLowerCase()) return u;
          const nextSec = (u.totalStudySeconds || 0) + additionalSeconds;
          return {
            ...u,
            totalStudySeconds: nextSec,
            totalStudyMinutes: Math.round(nextSec / 60),
            lastLogin: new Date().toISOString(),
          };
        })
      );
      await updateUserActivityAndStudyTime(
        activeUserId,
        'studying',
        additionalSeconds
      );
    },
    [activeUserId, currentUser]
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

      // Khi khôi phục logo mặc định, đồng bộ lại bản nén của logo chính thức lên Firestore
      // để mọi máy tính/trình duyệt (kể cả bản đã xuất bản trước đó) luôn hiển thị đúng logo tổ.
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

      setDepartmentLogoUrl(compact || undefined);
      setIsOfficialDefaultLogo(resettingToOfficialDefault);
      try {
        if (compact) {
          localStorage.setItem(DEPARTMENT_LOGO_CACHE_KEY, compact);
        } else {
          localStorage.removeItem(DEPARTMENT_LOGO_CACHE_KEY);
        }
      } catch {
        // Bỏ qua
      }
      setUsers((prev) =>
        prev.map((u) => (u.id === 'admin' ? { ...u, logoUrl: compact } : u))
      );
      await updateDepartmentLogoInFirestore(compact, {
        isOfficialDefault: resettingToOfficialDefault,
      });
    },
    [currentUser]
  );

  // Optimistic + Firestore sync cho Bookmark
  const handleToggleBookmark = useCallback(
    async (questionId: string) => {
      if (!currentUser) return;
      const uid = currentUser.id;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== uid) return u;
          const cur = u.bookmarkedQuestions ?? [];
          const next = cur.includes(questionId)
            ? cur.filter((id) => id !== questionId)
            : [...cur, questionId];
          return { ...u, bookmarkedQuestions: next };
        })
      );
      await toggleQuestionBookmarkInFirestore(uid, questionId);
    },
    [currentUser]
  );

  // Optimistic + Firestore sync khi học sinh bấm "Kiểm tra đáp án"
  const handleRecordPracticeCheck = useCallback(
    async (
      questionId: string,
      isCorrect: boolean,
      removeOnCorrect: boolean = false
    ) => {
      if (!currentUser) return;
      const uid = currentUser.id;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== uid) return u;
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
        })
      );
      await recordQuestionPracticeResultInFirestore(
        uid,
        questionId,
        isCorrect,
        removeOnCorrect
      );
    },
    [currentUser]
  );

  // Optimistic + Firestore sync khi học sinh bấm "Đã nắm vững (Xóa khỏi kho câu sai)"
  const handleMarkQuestionMastered = useCallback(
    async (questionId: string) => {
      if (!currentUser) return;
      const uid = currentUser.id;
      setUsers((prev) =>
        prev.map((u) => {
          if (u.id !== uid) return u;
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
        })
      );
      await markQuestionMasteredInFirestore(uid, questionId);
    },
    [currentUser]
  );

  const handleSaveAttempt = useCallback(
    async (attempt: ExamAttempt, wrongQuestionIdsFromExam: string[]) => {
      setAttempts((prev) => [attempt, ...prev]);
      await recordExamAttempt(attempt);
      if (currentUser && currentUser.role === 'student') {
        if (wrongQuestionIdsFromExam.length > 0) {
          setUsers((prev) =>
            prev.map((u) => {
              if (u.id !== currentUser.id) return u;
              const wrongSet = new Set([
                ...(u.wrongQuestions ?? []),
                ...wrongQuestionIdsFromExam,
              ]);
              return {
                ...u,
                wrongQuestions: Array.from(wrongSet),
              };
            })
          );
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
    [currentUser]
  );

  const handleSaveStudent = useCallback(async (student: UserAccount) => {
    setUsers((prev) => {
      const exists = prev.some((u) => u.id === student.id);
      return exists
        ? prev.map((u) => (u.id === student.id ? student : u))
        : [...prev, student];
    });
    await saveStudentAccount(student);
  }, []);

  const handleBatchSaveStudents = useCallback(
    async (incomingStudents: UserAccount[]) => {
      setUsers((prev) => {
        const map = new Map<string, UserAccount>(prev.map((u) => [u.id, u]));
        for (const st of incomingStudents) {
          map.set(st.id, st);
        }
        return Array.from(map.values());
      });
      await saveMultipleStudentAccountsToFirestore(incomingStudents);
    },
    []
  );

  const handleUpdateStudentPassword = useCallback(
    async (userId: string, newPassword: string) => {
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, password: newPassword.trim() } : u
        )
      );
      await updateStudentPasswordInFirestore(userId, newPassword);
    },
    []
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
      await resetStudentLearningDataInFirestore(userId, attemptIdsToDelete);
    },
    [attempts]
  );

  const handleDeleteStudent = useCallback(async (userId: string) => {
    setUsers((prev) => prev.filter((u) => u.id !== userId));
    await deleteStudentAccount(userId);
  }, []);

  const handleSaveQuestion = useCallback(async (question: Question) => {
    setQuestions((prev) => {
      const exists = prev.some((q) => q.id === question.id);
      return exists
        ? prev.map((q) => (q.id === question.id ? question : q))
        : [...prev, question];
    });
    await saveQuestionToFirestore(question);
  }, []);

  const handleDeleteQuestion = useCallback(async (questionId: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== questionId));
    await deleteQuestionFromFirestore(questionId);
  }, []);

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
      await saveMultipleQuestionsToFirestore(incomingQuestions);
    },
    []
  );

  const handleResetSeedData = useCallback(async () => {
    setUsers((prev) => prev.filter((u) => !isLegacyVirtualUser(u)));
    setQuestions((prev) => prev.filter((q) => !isLegacyVirtualQuestion(q)));
    setAttempts((prev) => prev.filter((a) => !isLegacyVirtualAttempt(a)));
    await resetSeedDataToDefault();
  }, []);

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
          seededUsers={users}
          questionsCount={questions.length || publicQuestionsCount}
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
            onLogout={handleLogout}
            onSaveStudent={handleSaveStudent}
            onBatchSaveStudents={handleBatchSaveStudents}
            onUpdateStudentPassword={handleUpdateStudentPassword}
            onResetStudentProgress={handleResetStudentProgress}
            onDeleteStudent={handleDeleteStudent}
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
