import express, { type Request, type Response, Router } from 'express';
import {
  extractRequestAuthToken,
  verifyAuthToken,
  type AuthTokenPayload,
} from './authToken.ts';
import { ServerAppDataStore } from './appDataStore.ts';
import type { ActiveStatus, ExamAttempt, Question, UserAccount } from '../types/exam.ts';

export interface AppDataRouterOptions {
  authSecret?: string;
}

function sanitizeUserForStudentSelf(user: UserAccount): UserAccount {
  return {
    ...user,
    password: '',
  };
}

function isAdminToken(payload: AuthTokenPayload): boolean {
  return (
    payload.role === 'teacher' &&
    (payload.sub.toLowerCase() === 'admin' ||
      payload.username.toLowerCase() === 'admin')
  );
}

/**
 * Các tuyến API Write-Through Cache đọc từ RAM máy chủ Express (0 lượt đọc Firestore cho trình duyệt)
 * và ghi xuyên thấu xuống Firestore.
 */
export function createAppDataRouter(
  store: ServerAppDataStore,
  options: AppDataRouterOptions = {}
): Router {
  const router = express.Router();

  const requireAuth = (req: Request, res: Response): AuthTokenPayload | null => {
    const token = extractRequestAuthToken(req);
    const verified = verifyAuthToken(token, { secret: options.authSecret });
    if (!verified) {
      res.status(401).json({
        ok: false,
        errorCode: 'UNAUTHORIZED',
        message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
      });
      return null;
    }
    return verified;
  };

  const requireTeacher = (req: Request, res: Response): AuthTokenPayload | null => {
    const verified = requireAuth(req, res);
    if (!verified) return null;
    if (verified.role !== 'teacher') {
      res.status(403).json({
        ok: false,
        errorCode: 'FORBIDDEN_ROLE',
        message: 'Chức năng này chỉ dành cho tài khoản Giáo viên.',
      });
      return null;
    }
    return verified;
  };

  // 1. API công khai cho màn hình đăng nhập (Logo + số câu hỏi từ RAM, 0 lượt đọc Firestore)
  router.get('/public/branding', (_req: Request, res: Response) => {
    const branding = store.getPublicBranding();
    res.json({
      ok: true,
      ...branding,
    });
  });

  // 2. API khởi tải toàn bộ dữ liệu theo đúng phân quyền từ RAM máy chủ
  router.get('/app/bootstrap', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;

    const mode = String(req.query.mode || '').trim().toLowerCase();
    const branding = store.getPublicBranding();
    const self = store.getUser(actor.sub) ?? store.getUser(actor.username);

    const hydrated = {
      users: store.isUsersHydrated(),
      questions: store.isQuestionsHydrated(),
      attempts: store.isUsersHydrated(),
    };
    const serverTime = new Date().toISOString();

    if (actor.role === 'teacher') {
      const safeTeacher = self
        ? sanitizeUserForStudentSelf(self)
        : ({
            id: actor.sub,
            username: actor.username,
            password: '',
            fullName: actor.username,
            role: 'teacher',
            className: actor.className || '',
            lastLogin: serverTime,
            status: 'online',
            activeStatus: 'online',
            totalStudyMinutes: 0,
            totalStudySeconds: 0,
          } satisfies UserAccount);

      res.json({
        ok: true,
        role: 'teacher',
        user: safeTeacher,
        currentUser: safeTeacher,
        users: store.getUsers(),
        questions: store.getQuestions(),
        attempts: store.getAllAttempts(),
        departmentLogoUrl: branding.departmentLogoUrl,
        isOfficialDefaultLogo: branding.isOfficialDefaultLogo,
        questionsCount: branding.questionsCount,
        quotaExceeded: branding.quotaExceeded,
        hydrated,
        serverTime,
      });
      return;
    }

    // Học sinh: CHỈ trả về hồ sơ của chính mình (ẩn mật khẩu), lịch sử của chính mình,
    // và tuyệt đối không trả về ngân hàng câu hỏi khi đang ở chế độ "live-exam".
    const safeUser = self
      ? sanitizeUserForStudentSelf(self)
      : ({
          id: actor.sub,
          username: actor.username,
          password: '',
          fullName: actor.username,
          role: 'student',
          className: actor.className || '',
          lastLogin: serverTime,
          status: 'studying',
          activeStatus: 'studying',
          totalStudyMinutes: 0,
          totalStudySeconds: 0,
          bookmarkedQuestions: [],
          wrongQuestions: [],
          masteredQuestions: [],
          practiceProgress: {},
        } satisfies UserAccount);

    res.json({
      ok: true,
      role: 'student',
      user: safeUser,
      currentUser: safeUser,
      users: [safeUser],
      questions: mode === 'live-exam' ? [] : store.getQuestions(),
      attempts: store.getStudentAttempts(safeUser.id, safeUser.username),
      departmentLogoUrl: branding.departmentLogoUrl,
      isOfficialDefaultLogo: branding.isOfficialDefaultLogo,
      questionsCount: branding.questionsCount,
      quotaExceeded: branding.quotaExceeded,
      hydrated,
      serverTime,
    });
  });

  // 3. Đánh dấu trạng thái offline khi đăng xuất (cập nhật RAM + ghi Firestore)
  router.post('/auth/logout', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;
    store.recordUserLogoutActivity(actor.sub);
    res.json({ ok: true });
  });

  // ============================================================================
  // 4. API GHI XUYÊN THẤU TIẾN ĐỘ HỌC SINH (WRITE-THROUGH)
  // ============================================================================

  router.post('/student/bookmark', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;
    const questionId = String(req.body?.questionId || '').trim();
    if (!questionId) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu mã câu hỏi cần đánh dấu.',
      });
      return;
    }
    const updated = store.toggleStudentBookmark(actor.sub, questionId);
    res.json({
      ok: true,
      user: updated ? sanitizeUserForStudentSelf(updated) : null,
    });
  });

  router.post('/student/practice-check', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;
    const questionId = String(req.body?.questionId || '').trim();
    const isCorrect = Boolean(req.body?.isCorrect);
    const removeOnCorrect = Boolean(req.body?.removeOnCorrect);
    if (!questionId) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu mã câu hỏi luyện tập.',
      });
      return;
    }
    const updated = store.recordStudentPracticeCheck(
      actor.sub,
      questionId,
      isCorrect,
      removeOnCorrect
    );
    res.json({
      ok: true,
      user: updated ? sanitizeUserForStudentSelf(updated) : null,
    });
  });

  router.post('/student/mastered', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;
    const questionId = String(req.body?.questionId || '').trim();
    if (!questionId) {
      res.status(400).json({
        ok: false,
        message: 'Thiếu mã câu hỏi cần đánh dấu đã nắm vững.',
      });
      return;
    }
    const updated = store.markStudentQuestionMastered(actor.sub, questionId);
    res.json({
      ok: true,
      user: updated ? sanitizeUserForStudentSelf(updated) : null,
    });
  });

  router.post('/student/study-time', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;
    const additionalSeconds = Number(req.body?.additionalSeconds || 0);
    const rawStatus = String(req.body?.activeStatus || 'studying');
    const activeStatus: ActiveStatus =
      rawStatus === 'online' || rawStatus === 'offline' || rawStatus === 'studying'
        ? rawStatus
        : 'studying';

    const updated = store.addStudentStudyTime(
      actor.sub,
      additionalSeconds,
      activeStatus
    );
    res.json({
      ok: true,
      user: updated ? sanitizeUserForStudentSelf(updated) : null,
    });
  });

  router.post('/student/attempts', (req: Request, res: Response) => {
    const actor = requireAuth(req, res);
    if (!actor) return;

    const attempt = req.body?.attempt as ExamAttempt | undefined;
    const wrongQuestionIdsFromExam = Array.isArray(
      req.body?.wrongQuestionIdsFromExam
    )
      ? (req.body.wrongQuestionIdsFromExam as unknown[]).map((x) => String(x))
      : [];

    if (!attempt || typeof attempt !== 'object' || !attempt.id) {
      res.status(400).json({
        ok: false,
        message: 'Dữ liệu bài thi thử không hợp lệ.',
      });
      return;
    }

    const result = store.saveStudentAttempt(
      actor.sub,
      {
        ...attempt,
        userId: actor.sub,
      },
      wrongQuestionIdsFromExam
    );
    res.json({
      ok: true,
      attempt: result.attempt,
      user: result.user ? sanitizeUserForStudentSelf(result.user) : null,
    });
  });

  // ============================================================================
  // 5. API GHI XUYÊN THẤU QUẢN TRỊ GIÁO VIÊN (WRITE-THROUGH)
  // ============================================================================

  router.post('/teacher/questions', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const question = req.body?.question as Question | undefined;
    if (!question || !question.id || !question.prompt) {
      res.status(400).json({
        ok: false,
        message: 'Dữ liệu câu hỏi không hợp lệ.',
      });
      return;
    }
    const saved = store.saveQuestion(question);
    res.json({ ok: true, question: saved });
  });

  router.post('/teacher/questions/batch', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const incoming = req.body?.questions as Question[] | undefined;
    const replaceAll = Boolean(req.body?.replaceAll);
    if (!Array.isArray(incoming)) {
      res.status(400).json({
        ok: false,
        message: 'Danh sách câu hỏi nhập hàng loạt không hợp lệ.',
      });
      return;
    }
    const saved = store.saveQuestionsBatch(incoming, replaceAll);
    res.json({ ok: true, count: saved.length });
  });

  router.delete('/teacher/questions/:id', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const qid = String(req.params.id || '').trim();
    if (!qid) {
      res.status(400).json({ ok: false, message: 'Thiếu mã câu hỏi cần xóa.' });
      return;
    }
    store.deleteQuestion(qid);
    res.json({ ok: true });
  });

  router.post('/teacher/students', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const student = req.body?.student as UserAccount | undefined;
    if (!student || !student.username || !student.fullName) {
      res.status(400).json({
        ok: false,
        message: 'Thông tin tài khoản không hợp lệ.',
      });
      return;
    }
    try {
      const saved = store.saveStudentAccount(student);
      res.json({ ok: true, student: saved });
    } catch (error) {
      res.status(400).json({
        ok: false,
        message:
          error instanceof Error ? error.message : 'Không thể lưu tài khoản.',
      });
    }
  });

  router.post('/teacher/students/batch', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const incoming = req.body?.students as UserAccount[] | undefined;
    if (!Array.isArray(incoming)) {
      res.status(400).json({
        ok: false,
        message: 'Danh sách tài khoản nhập hàng loạt không hợp lệ.',
      });
      return;
    }
    const saved = store.saveStudentsBatch(incoming);
    res.json({ ok: true, count: saved.length });
  });

  router.patch('/teacher/students/:id/password', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const targetId = String(req.params.id || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();
    if (!targetId || !newPassword) {
      res.status(400).json({
        ok: false,
        message: 'Vui lòng cung cấp tài khoản và mật khẩu mới hợp lệ.',
      });
      return;
    }
    const updated = store.updateStudentPassword(targetId, newPassword);
    res.json({ ok: true, student: updated ?? null });
  });

  router.post(
    '/teacher/students/:id/reset-progress',
    (req: Request, res: Response) => {
      const actor = requireTeacher(req, res);
      if (!actor) return;

      const targetId = String(req.params.id || '').trim();
      if (!targetId) {
        res.status(400).json({ ok: false, message: 'Thiếu mã học sinh.' });
        return;
      }
      const result = store.resetStudentProgress(targetId);
      res.json({
        ok: true,
        student: result.user ?? null,
        deletedAttemptIds: result.deletedAttemptIds,
      });
    }
  );

  router.delete('/teacher/students/:id', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const targetId = String(req.params.id || '').trim();
    if (!targetId) {
      res.status(400).json({ ok: false, message: 'Thiếu mã tài khoản cần xóa.' });
      return;
    }
    const deleted = store.deleteStudentAccount(targetId, actor.sub);
    if (!deleted) {
      res.status(400).json({
        ok: false,
        message: 'Không thể xóa tài khoản quản trị gốc hoặc tài khoản đang đăng nhập.',
      });
      return;
    }
    res.json({ ok: true });
  });

  router.post('/teacher/students/batch-delete', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    const userIds = Array.isArray(req.body?.userIds)
      ? (req.body.userIds as unknown[]).map((x) => String(x))
      : [];
    const deletedIds = store.deleteStudentsBatch(userIds, actor.sub);
    res.json({ ok: true, deletedIds });
  });

  router.post('/teacher/logo', (req: Request, res: Response) => {
    const actor = requireTeacher(req, res);
    if (!actor) return;

    if (!isAdminToken(actor)) {
      res.status(403).json({
        ok: false,
        errorCode: 'FORBIDDEN_ADMIN_ONLY',
        message: 'Chỉ tài khoản quản trị (admin) mới có quyền chỉnh sửa logo.',
      });
      return;
    }
    const logoUrl = String(req.body?.logoUrl || '');
    const isOfficialDefault = Boolean(req.body?.isOfficialDefault);
    const result = store.updateDepartmentLogo(logoUrl, isOfficialDefault);
    res.json({ ok: true, ...result });
  });

  return router;
}
