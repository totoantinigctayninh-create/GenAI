import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LoginScreen } from './components/LoginScreen';
import { StudentPortal } from './components/StudentPortal';
import { TeacherPortal } from './components/TeacherPortal';
import { ThemeProvider } from './context/ThemeContext';
import { SEED_ATTEMPTS, SEED_QUESTIONS, SEED_USERS } from './data/seedData';
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
import { computeUpdatedWrongQuestions } from './utils/scoring';
import { examSessionApi } from './services/examSessionApi';

const SESSION_STORAGE_KEY = 'certiport_genai_active_user_id_v3';
const USERS_CACHE_KEY = 'certiport_genai_users_cache_v3';
const QUESTIONS_CACHE_KEY = 'certiport_genai_questions_cache_v3';
const ATTEMPTS_CACHE_KEY = 'certiport_genai_attempts_cache_v3';
const DEPARTMENT_LOGO_CACHE_KEY = 'igc_toantin_logo_url_v1';

// Dọn sạch bộ nhớ đệm cũ có chứa dữ liệu ảo (v1/v2)
try {
  localStorage.removeItem('certiport_genai_active_user_id');
  localStorage.removeItem('certiport_genai_users_cache_v1');
  localStorage.removeItem('certiport_genai_questions_cache_v1');
  localStorage.removeItem('certiport_genai_attempts_cache_v1');
} catch {
  // Bỏ qua
}

function loadCachedList<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export default function App() {
  const [users, setUsers] = useState<UserAccount[]>(() =>
    loadCachedList<UserAccount>(USERS_CACHE_KEY, SEED_USERS).filter(
      (u) => !isLegacyVirtualUser(u)
    )
  );
  const [questions, setQuestions] = useState<Question[]>(() =>
    loadCachedList<Question>(QUESTIONS_CACHE_KEY, SEED_QUESTIONS).filter(
      (q) => !isLegacyVirtualQuestion(q)
    )
  );
  const [attempts, setAttempts] = useState<ExamAttempt[]>(() =>
    loadCachedList<ExamAttempt>(ATTEMPTS_CACHE_KEY, SEED_ATTEMPTS).filter(
      (a) => !isLegacyVirtualAttempt(a)
    )
  );
  const [activeUserId, setActiveUserId] = useState<string | null>(() => {
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
    return localStorage.getItem(SESSION_STORAGE_KEY);
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

  // Lưu bộ đệm cục bộ mỗi khi state thay đổi để đảm bảo phản hồi tức thì cả khi mạng chậm
  useEffect(() => {
    try {
      localStorage.setItem(USERS_CACHE_KEY, JSON.stringify(users));
    } catch {
      // Bỏ qua nếu bộ nhớ đầy
    }
  }, [users]);

  useEffect(() => {
    try {
      localStorage.setItem(QUESTIONS_CACHE_KEY, JSON.stringify(questions));
    } catch {
      // Bỏ qua
    }
  }, [questions]);

  useEffect(() => {
    try {
      localStorage.setItem(ATTEMPTS_CACHE_KEY, JSON.stringify(attempts));
    } catch {
      // Bỏ qua
    }
  }, [attempts]);

  const [isLiveExamMode, setIsLiveExamMode] = useState<boolean>(() => {
    const params = new URLSearchParams(window.location.search);
    const tabParam = params.get('tab');
    return tabParam === 'live-exam' || tabParam === 'thingay';
  });

  // Khởi tạo kết nối Firestore cho tài khoản người dùng
  useEffect(() => {
    let unsubUsers: (() => void) | null = null;

    async function bootstrapUsers() {
      const isOnline = await testFirestoreConnection();
      if (isOnline && activeUserId === 'admin') {
        await ensureSeedDataInitialized();
      }

      unsubUsers = subscribeToUsers((liveUsers) => {
        const mergedMap = new Map<string, UserAccount>();
        for (const su of SEED_USERS) mergedMap.set(su.id, su);
        for (const lu of liveUsers) {
          if (isLegacyVirtualUser(lu)) continue;
          const seedMatch = SEED_USERS.find((s) => s.id === lu.id);
          mergedMap.set(lu.id, {
            ...seedMatch,
            ...lu,
            bookmarkedQuestions: lu.bookmarkedQuestions ?? [],
            wrongQuestions: lu.wrongQuestions ?? [],
            masteredQuestions: lu.masteredQuestions ?? [],
            practiceProgress: lu.practiceProgress ?? {},
          });
        }
        const mergedList = Array.from(mergedMap.values());
        setUsers(mergedList);
        const adminDoc = mergedList.find((u) => u.id === 'admin');
        if (adminDoc && typeof adminDoc.logoUrl === 'string') {
          setDepartmentLogoUrl(adminDoc.logoUrl || undefined);
          try {
            if (adminDoc.logoUrl) {
              localStorage.setItem(DEPARTMENT_LOGO_CACHE_KEY, adminDoc.logoUrl);
            } else {
              localStorage.removeItem(DEPARTMENT_LOGO_CACHE_KEY);
            }
          } catch {
            // Bỏ qua
          }
        }
      });
    }

    bootstrapUsers();

    return () => {
      if (unsubUsers) unsubUsers();
    };
  }, [activeUserId]);

  // Chỉ lắng nghe bộ câu hỏi và lịch sử tự luyện khi học sinh KHÔNG ở chế độ "Thi ngay" (tránh rò rỉ đáp án qua gói tin mạng Firestore khi đang thi)
  useEffect(() => {
    if (isLiveExamMode && activeUserId !== 'admin') {
      return;
    }
    const unsubQuestions = subscribeToQuestions((liveQuestions) => {
      setQuestions(liveQuestions);
    });
    const unsubAttempts = subscribeToAttempts((liveAttempts) => {
      setAttempts(liveAttempts);
    });
    return () => {
      unsubQuestions();
      unsubAttempts();
    };
  }, [isLiveExamMode, activeUserId]);

  const currentUser = useMemo(() => {
    if (!activeUserId) return null;
    const found =
      users.find((u) => u.id.toLowerCase() === activeUserId.toLowerCase()) ??
      SEED_USERS.find((u) => u.id.toLowerCase() === activeUserId.toLowerCase()) ??
      null;
    if (found) return found;

    // Hỗ trợ chế độ xem giao diện học sinh/giáo viên qua tham số URL ổn định xuyên suốt phiên
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

    return null;
  }, [activeUserId, users]);

  useEffect(() => {
    examSessionApi.syncContext({
      currentUser,
      users,
      questions,
    });
  }, [currentUser, users, questions]);

  const handleLogin = useCallback(
    async (username: string, password: string) => {
      setLoginError(null);
      setIsAuthenticating(true);
      try {
        const authenticated = await authenticateWithUsernamePassword(
          username,
          password,
          users
        );
        setUsers((prev) =>
          prev.map((u) => (u.id === authenticated.id ? authenticated : u))
        );
        setActiveUserId(authenticated.id);
        localStorage.setItem(SESSION_STORAGE_KEY, authenticated.id);
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
    setActiveUserId(null);
    localStorage.removeItem(SESSION_STORAGE_KEY);
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

  const handleUpdateDepartmentLogo = useCallback(async (logoUrl: string) => {
    const cleaned = logoUrl.trim();
    setDepartmentLogoUrl(cleaned || undefined);
    try {
      if (cleaned) {
        localStorage.setItem(DEPARTMENT_LOGO_CACHE_KEY, cleaned);
      } else {
        localStorage.removeItem(DEPARTMENT_LOGO_CACHE_KEY);
      }
    } catch {
      // Bỏ qua
    }
    setUsers((prev) =>
      prev.map((u) => (u.id === 'admin' ? { ...u, logoUrl: cleaned } : u))
    );
    await updateDepartmentLogoInFirestore(cleaned);
  }, []);

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

  return (
    <ThemeProvider>
      {!currentUser ? (
        <LoginScreen
          onLogin={handleLogin}
          isLoading={isAuthenticating}
          errorMessage={loginError}
          seededUsers={users}
          questionsCount={questions.length}
          departmentLogoUrl={departmentLogoUrl}
          onUpdateDepartmentLogo={handleUpdateDepartmentLogo}
        />
      ) : currentUser.role === 'teacher' ? (
        <TeacherPortal
          currentUser={currentUser}
          users={users}
          questions={questions}
          attempts={attempts}
          departmentLogoUrl={departmentLogoUrl}
          onUpdateDepartmentLogo={handleUpdateDepartmentLogo}
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
      ) : (
        <StudentPortal
          currentUser={currentUser}
          questions={questions}
          attempts={attempts}
          departmentLogoUrl={departmentLogoUrl}
          onLogout={handleLogout}
          onSaveAttempt={handleSaveAttempt}
          onSyncStudyTime={handleSyncStudyTime}
          onToggleBookmark={handleToggleBookmark}
          onRecordPracticeCheck={handleRecordPracticeCheck}
          onMarkQuestionMastered={handleMarkQuestionMastered}
          onActiveTabChange={(tab) => setIsLiveExamMode(tab === 'live-exam')}
        />
      )}
    </ThemeProvider>
  );
}
