import express, { type Request, type Response, Router } from 'express';
import {
  type CreateExamSessionInput,
  ExamEngineError,
  ExamSessionEngine,
  type UpdateExamSessionInput,
} from './examSessionEngine.ts';
import {
  extractRequestAuthToken,
  signAuthToken,
  verifyAuthToken,
} from './authToken.ts';
import type { ViolationEventType } from '../types/examSession.ts';
import type { UserAccount, UserAnswer } from '../types/exam.ts';
import {
  createThrottledSseDispatcher,
  DEFAULT_SSE_THROTTLE_WINDOW_MS,
  isCriticalSessionRealtimeEvent,
} from './sseThrottle.ts';

import {
  FirestoreQuotaExceededError,
  isFirestoreQuotaError,
  type ServerAppDataStore,
} from './appDataStore.ts';

export interface ExamSessionRouterOptions {
  authSecret?: string;
  lookupUser?: (usernameOrId: string) => Promise<UserAccount | null>;
  fetchQuestionCount?: () => Promise<number>;
  appDataStore?: ServerAppDataStore;
}

function sanitizeUserForClient(user: UserAccount): Omit<UserAccount, 'password'> & {
  password: string;
} {
  return {
    ...user,
    password: '',
  };
}

function extractClientIp(req: Request): string {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || '127.0.0.1';
}

function extractSessionToken(req: Request): string | undefined {
  const headerToken = req.header('x-exam-session-token');
  if (headerToken) return headerToken.trim();
  if (req.body && typeof req.body.sessionToken === 'string') {
    return req.body.sessionToken.trim();
  }
  if (typeof req.query.sessionToken === 'string') {
    return req.query.sessionToken.trim();
  }
  return undefined;
}

function handleRouteError(res: Response, error: unknown): void {
  if (error instanceof FirestoreQuotaExceededError || isFirestoreQuotaError(error)) {
    const quotaErr =
      error instanceof FirestoreQuotaExceededError
        ? error
        : new FirestoreQuotaExceededError();
    res.status(quotaErr.statusCode).json({
      ok: false,
      errorCode: quotaErr.errorCode,
      message: quotaErr.message,
    });
    return;
  }
  if (error instanceof ExamEngineError) {
    res.status(error.statusCode).json({
      ok: false,
      errorCode: error.errorCode,
      message: error.message,
    });
    return;
  }
  const message = error instanceof Error ? error.message : 'Lỗi máy chủ nội bộ.';
  res.status(500).json({
    ok: false,
    errorCode: 'INTERNAL_SERVER_ERROR',
    message,
  });
}

export function createExamSessionRouter(
  engine: ExamSessionEngine,
  options: ExamSessionRouterOptions = {}
): Router {
  const router = express.Router();

  // ============================================================================
  // 0. API CÔNG KHAI & XÁC THỰC PHIÊN LÀM VIỆC BẰNG CHỮ KÝ HMAC-SHA256
  // ============================================================================

  router.get('/public/stats', async (_req: Request, res: Response) => {
    let questionsCount = engine.getQuestionCount();
    const shouldQueryRemote =
      questionsCount === 0 &&
      Boolean(options.fetchQuestionCount) &&
      !options.appDataStore?.isQuestionsHydrated() &&
      !options.appDataStore?.isFirestoreQuotaExceeded();

    if (shouldQueryRemote && options.fetchQuestionCount) {
      try {
        const remoteCount = await options.fetchQuestionCount();
        if (remoteCount > 0) {
          questionsCount = remoteCount;
        }
      } catch (err) {
        if (isFirestoreQuotaError(err)) {
          options.appDataStore?.markFirestoreQuotaExceeded(true);
        }
      }
    }
    res.json({
      ok: true,
      questionsCount,
    });
  });

  // Đăng nhập bằng tài khoản & mật khẩu -> ưu tiên đọc trực tiếp từ RAM máy chủ (0 lượt đọc Firestore)
  router.post('/auth/login', async (req: Request, res: Response) => {
    try {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '').trim();

      if (!username || !password) {
        throw new ExamEngineError(
          'Vui lòng nhập đầy đủ Mã định danh và Mật khẩu.',
          400,
          'INVALID_CREDENTIALS'
        );
      }

      let matched = engine.getUser(username);
      const usersHydrated = Boolean(options.appDataStore?.isUsersHydrated());
      const quotaExceeded = Boolean(options.appDataStore?.isFirestoreQuotaExceeded());

      // Chỉ gọi 1 lượt getDoc tới Firestore khi RAM máy chủ chưa kịp khởi tải xong lúc khởi động nguội
      if (!matched && !usersHydrated && !quotaExceeded && options.lookupUser) {
        try {
          const remoteUser = await options.lookupUser(username);
          if (remoteUser) {
            engine.upsertUser(remoteUser);
            matched = engine.getUser(remoteUser.id) ?? remoteUser;
          }
        } catch (lookupErr) {
          if (isFirestoreQuotaError(lookupErr)) {
            options.appDataStore?.markFirestoreQuotaExceeded(true);
            throw new FirestoreQuotaExceededError();
          }
          throw lookupErr;
        }
      } else if (
        matched &&
        matched.password !== password &&
        !usersHydrated &&
        !quotaExceeded &&
        options.lookupUser
      ) {
        try {
          const freshRemote = await options.lookupUser(username);
          if (freshRemote) {
            engine.upsertUser(freshRemote);
            matched = engine.getUser(freshRemote.id) ?? freshRemote;
          }
        } catch (lookupErr) {
          if (isFirestoreQuotaError(lookupErr)) {
            options.appDataStore?.markFirestoreQuotaExceeded(true);
          }
        }
      }

      if (!matched) {
        // Nếu Firestore đang chạm hạn mức và RAM chưa có đủ danh sách tài khoản, báo rõ lỗi hạn mức thay vì báo nhầm "Không tìm thấy tài khoản"
        if (options.appDataStore?.isFirestoreQuotaExceeded()) {
          throw new FirestoreQuotaExceededError();
        }
        throw new ExamEngineError(
          `Không tìm thấy tài khoản với mã định danh "${username}".`,
          401,
          'INVALID_CREDENTIALS'
        );
      }

      if (matched.password !== password) {
        throw new ExamEngineError(
          'Mật khẩu không chính xác. Vui lòng kiểm tra lại.',
          401,
          'INVALID_CREDENTIALS'
        );
      }

      const activeUser =
        options.appDataStore?.recordUserLoginActivity(matched.id) ?? matched;

      const token = signAuthToken(
        {
          sub: activeUser.id,
          username: activeUser.username,
          role: activeUser.role,
          className: activeUser.className,
        },
        { secret: options.authSecret }
      );

      res.json({
        ok: true,
        token,
        user: sanitizeUserForClient(activeUser),
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Kiểm tra mã phiên hiện tại (khi tải lại trang)
  router.get('/auth/me', async (req: Request, res: Response) => {
    try {
      const rawToken = extractRequestAuthToken(req);
      const verified = verifyAuthToken(rawToken, { secret: options.authSecret });
      if (!verified) {
        throw new ExamEngineError(
          'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
          401,
          'UNAUTHORIZED'
        );
      }

      let user = engine.getUser(verified.sub);
      const usersHydrated = Boolean(options.appDataStore?.isUsersHydrated());
      const quotaExceeded = Boolean(options.appDataStore?.isFirestoreQuotaExceeded());

      if (!user && !usersHydrated && !quotaExceeded && options.lookupUser) {
        try {
          const remote = await options.lookupUser(verified.sub);
          if (remote) {
            engine.upsertUser(remote);
            user = remote;
          }
        } catch (lookupErr) {
          if (isFirestoreQuotaError(lookupErr)) {
            options.appDataStore?.markFirestoreQuotaExceeded(true);
            throw new FirestoreQuotaExceededError();
          }
          throw lookupErr;
        }
      }

      if (!user) {
        if (options.appDataStore?.isFirestoreQuotaExceeded()) {
          throw new FirestoreQuotaExceededError();
        }
        throw new ExamEngineError(
          'Tài khoản không còn tồn tại trên hệ thống. Vui lòng đăng nhập lại.',
          401,
          'UNAUTHORIZED'
        );
      }

      res.json({
        ok: true,
        user: sanitizeUserForClient(user),
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // ============================================================================
  // 1. API GIÁO VIÊN: QUẢN LÝ CA THI (`/api/exam-sessions`)
  // ============================================================================

  function requireVerifiedAuth(req: Request) {
    const rawToken = extractRequestAuthToken(req);
    const verified = verifyAuthToken(rawToken, { secret: options.authSecret });
    if (!verified) {
      throw new ExamEngineError(
        'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập lại.',
        401,
        'UNAUTHORIZED'
      );
    }
    return verified;
  }

  function resolveTeacherActor(req: Request): string {
    const verified = requireVerifiedAuth(req);
    if (verified.role !== 'teacher') {
      throw new ExamEngineError(
        'Chỉ tài khoản giáo viên mới có quyền thực hiện thao tác quản lý ca thi.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    const existing = engine.getUser(verified.sub);
    if (!existing || existing.role !== 'teacher') {
      throw new ExamEngineError(
        'Tài khoản giáo viên chưa được xác thực trên hệ thống hoặc đã bị thu hồi quyền.',
        403,
        'FORBIDDEN_ROLE'
      );
    }
    return existing.id;
  }

  // Đồng bộ danh sách người dùng và câu hỏi từ giáo viên lên máy chủ (chỉ tài khoản giáo viên đã xác thực)
  router.post('/exam-sessions/sync-context', (req: Request, res: Response) => {
    try {
      resolveTeacherActor(req);
      const body = req.body ?? {};
      if (Array.isArray(body.users) && body.users.length > 0) {
        for (const u of body.users) {
          if (u && typeof u.id === 'string' && typeof u.role === 'string') {
            const existing = engine.getUser(u.id);
            const incomingPassword =
              typeof u.password === 'string' && u.password && u.password !== '***'
                ? u.password
                : existing?.password ?? '';
            engine.upsertUser({
              ...u,
              password: incomingPassword,
            });
          }
        }
      }
      if (body.currentUser && typeof body.currentUser.id === 'string') {
        const existing = engine.getUser(body.currentUser.id);
        if (existing) {
          const incomingPassword =
            typeof body.currentUser.password === 'string' &&
            body.currentUser.password &&
            body.currentUser.password !== '***'
              ? body.currentUser.password
              : existing.password;
          engine.upsertUser({
            ...existing,
            ...body.currentUser,
            role: existing.role,
            password: incomingPassword,
          });
        }
      }
      if (Array.isArray(body.questions) && body.questions.length > 0) {
        engine.setQuestions(body.questions);
      }
      res.json({ ok: true });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Lấy danh sách ca thi của giáo viên
  router.get('/exam-sessions', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const sessions = engine.listTeacherSessions(actorId);
      res.json({ ok: true, sessions });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Tạo mới ca thi
  router.post('/exam-sessions', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const input: CreateExamSessionInput = req.body ?? {};
      const session = engine.createSession(actorId, input);
      res.status(201).json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Luồng giám sát thời gian thực (Server-Sent Events) cho giáo viên theo dõi ca thi
  router.get('/exam-sessions/:sessionId/stream', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const sessionId = req.params.sessionId;
      const initialDetail = engine.getTeacherSessionDetail(actorId, sessionId);

      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();

      const writeSse = (eventName: string, data: unknown) => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      writeSse('snapshot', { ok: true, ...initialDetail });

      const throttledDispatcher = createThrottledSseDispatcher({
        windowMs: DEFAULT_SSE_THROTTLE_WINDOW_MS,
        isCritical: (event) => {
          const currentSessionStatus = engine.getSessionStatus(sessionId);
          return isCriticalSessionRealtimeEvent(event, currentSessionStatus);
        },
        onFlush: (latestEvent) => {
          try {
            const detail = engine.getTeacherSessionDetail(actorId, sessionId);
            writeSse('update', { event: latestEvent, detail });
          } catch {
            // Nếu ca thi đã bị xóa hoặc giáo viên mất quyền, đóng luồng nhẹ nhàng
            throttledDispatcher.dispose();
            if (!res.writableEnded) {
              res.end();
            }
          }
        },
      });

      const unsubscribe = engine.subscribeToSessionEvents(sessionId, (event) => {
        throttledDispatcher.enqueue(event);
      });

      const heartbeatTimer = setInterval(() => {
        if (res.writableEnded || res.destroyed) return;
        res.write(`: heartbeat ${Date.now()}\n\n`);
      }, 20000);

      req.on('close', () => {
        clearInterval(heartbeatTimer);
        throttledDispatcher.dispose();
        unsubscribe();
      });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Lấy chi tiết ca thi (kèm danh sách lượt thi, vi phạm, nhật ký tác vụ)
  router.get('/exam-sessions/:sessionId', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const detail = engine.getTeacherSessionDetail(actorId, req.params.sessionId);
      res.json({ ok: true, ...detail });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Sửa cấu hình ca thi
  router.patch('/exam-sessions/:sessionId', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const patch: UpdateExamSessionInput = req.body ?? {};
      const session = engine.updateSession(actorId, req.params.sessionId, patch);
      res.json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Mở ca thi
  router.post('/exam-sessions/:sessionId/open', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const session = engine.openSession(actorId, req.params.sessionId);
      res.json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Khóa ca thi
  router.post('/exam-sessions/:sessionId/lock', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const session = engine.lockSession(actorId, req.params.sessionId);
      res.json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Mở khóa ca thi
  router.post('/exam-sessions/:sessionId/unlock', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const session = engine.unlockSession(actorId, req.params.sessionId);
      res.json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Kết thúc ca thi (tự động thu các bài đang làm dở)
  router.post('/exam-sessions/:sessionId/end', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const session = engine.endSession(actorId, req.params.sessionId);
      res.json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Gia hạn thời gian cho ca thi hoặc cho một lượt thi cụ thể
  router.post('/exam-sessions/:sessionId/extend', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const extraMinutes = Number(req.body?.extraMinutes ?? 5);
      const targetAttemptId =
        typeof req.body?.attemptId === 'string' ? req.body.attemptId : undefined;
      const result = engine.extendTime(
        actorId,
        req.params.sessionId,
        extraMinutes,
        targetAttemptId
      );
      res.json({ ok: true, ...result });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Cho phép học sinh vào lại phòng thi (hỗ trợ cả tạo lượt thi mới giữ nguyên bài cũ khi đã bị tự nộp)
  router.post('/exam-sessions/:sessionId/allow-reentry', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const attemptId = String(req.body?.attemptId || '');
      const extraMinutes =
        req.body?.extraMinutes !== undefined
          ? Number(req.body.extraMinutes)
          : undefined;
      const attempt = engine.allowStudentReentry(
        actorId,
        req.params.sessionId,
        attemptId,
        extraMinutes
      );
      res.json({ ok: true, attempt });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Giáo viên nộp bài giúp / thu bài của một học sinh
  router.post('/exam-sessions/:sessionId/force-submit', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const attemptId = String(req.body?.attemptId || '');
      const attempt = engine.teacherForceSubmitAttempt(
        actorId,
        req.params.sessionId,
        attemptId
      );
      res.json({ ok: true, attempt });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Giả lập học sinh trong ca thi (mặc định 32 đang thi, 5 đã nộp, 3 chưa vào = 40 học sinh)
  router.post('/exam-sessions/:sessionId/simulate-students', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const detail = engine.simulateSessionStudents(
        actorId,
        req.params.sessionId,
        req.body ?? {}
      );
      res.json({ ok: true, ...detail });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Sao chép ca thi
  router.post('/exam-sessions/:sessionId/clone', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const newTitle =
        typeof req.body?.title === 'string' ? req.body.title : undefined;
      const session = engine.cloneSession(actorId, req.params.sessionId, newTitle);
      res.status(201).json({ ok: true, session });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Xóa ca thi (chỉ khi chưa có học sinh nào vào thi)
  router.delete('/exam-sessions/:sessionId', (req: Request, res: Response) => {
    try {
      const actorId = resolveTeacherActor(req);
      const deleted = engine.deleteSession(actorId, req.params.sessionId);
      res.json({ ok: true, ...deleted });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // ============================================================================
  // 2. API HỌC SINH: XÁC THỰC MÃ, BẮT ĐẦU THI, LẤY ĐỀ, LƯU ĐÁP ÁN, VI PHẠM, NỘP BÀI, KẾT QUẢ
  // ============================================================================

  function resolveStudentActor(req: Request): string {
    const verified = requireVerifiedAuth(req);
    const existing = engine.getUser(verified.sub);
    if (!existing) {
      throw new ExamEngineError(
        'Tài khoản học sinh chưa được xác thực trên hệ thống. Vui lòng đăng nhập lại.',
        401,
        'UNAUTHORIZED'
      );
    }
    return existing.id;
  }

  // Xác thực mã 6 ký tự (có giới hạn 5 lần sai -> khóa 60 giây theo tài khoản & IP)
  router.post('/exam-sessions/verify-code', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const ip = extractClientIp(req);
      const code = String(req.body?.code || '');
      const result = engine.verifySessionCode(actorId, code, ip);
      res.status(200).json(result);
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Bắt đầu thi hoặc vào lại bài thi
  router.post('/exam-sessions/start', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const ip = extractClientIp(req);
      const codeOrSessionId = String(req.body?.code || req.body?.sessionId || '');
      const deviceId = String(
        req.header('x-device-id') || req.body?.deviceId || 'default_device'
      );
      const browserInfo = {
        ...(typeof req.body?.keyboardLockSupported === 'boolean'
          ? { keyboardLockSupported: req.body.keyboardLockSupported }
          : {}),
        ...(typeof req.body?.browserNote === 'string' && req.body.browserNote.trim()
          ? { browserNote: req.body.browserNote.trim() }
          : {}),
      };
      const paper = engine.startOrResumeAttempt(
        actorId,
        codeOrSessionId,
        deviceId,
        ip,
        browserInfo
      );
      res.json({ ok: true, ...paper });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Lấy đề của lượt thi (TUYỆT ĐỐI KHÔNG kèm đáp án đúng hay giải thích)
  router.get('/attempts/:attemptId/paper', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const sessionToken = extractSessionToken(req);
      const paper = engine.getAttemptPaper(
        actorId,
        req.params.attemptId,
        sessionToken
      );
      res.json({ ok: true, ...paper });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Kiểm tra trạng thái gọn nhẹ (~200 byte) của lượt thi để đồng bộ đồng hồ & hạn nộp
  const handleGetAttemptStatus = (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const sessionToken = extractSessionToken(req);
      const statusPayload = engine.getAttemptStatus(
        actorId,
        req.params.attemptId,
        sessionToken
      );
      res.json({ ok: true, ...statusPayload });
    } catch (error) {
      handleRouteError(res, error);
    }
  };
  router.get('/exam-attempts/:attemptId/status', handleGetAttemptStatus);
  router.get('/attempts/:attemptId/status', handleGetAttemptStatus);

  // Lưu đáp án từng câu trong lúc làm bài
  router.post('/attempts/:attemptId/answers', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const sessionToken = extractSessionToken(req);
      const answerRecord = engine.saveAttemptAnswer(actorId, req.params.attemptId, {
        questionId: String(req.body?.questionId || ''),
        selectedAnswer: (req.body?.selectedAnswer ?? null) as UserAnswer | null,
        timeSpentSeconds: req.body?.timeSpentSeconds,
        flagged: req.body?.flagged,
        sessionToken,
      });
      res.json({ ok: true, answer: answerRecord });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Ghi nhận vi phạm trong lúc làm bài
  router.post('/attempts/:attemptId/violations', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const sessionToken = extractSessionToken(req);
      const violationResult = engine.recordViolation(actorId, req.params.attemptId, {
        type: (req.body?.type || 'other') as ViolationEventType,
        occurredAt:
          typeof req.body?.occurredAt === 'string'
            ? req.body.occurredAt
            : undefined,
        awaySeconds: req.body?.awaySeconds,
        currentQuestionOrder: req.body?.currentQuestionOrder,
        note: req.body?.note,
        sessionToken,
        finalAnswers: Array.isArray(req.body?.finalAnswers)
          ? req.body.finalAnswers
          : undefined,
      });
      res.json({ ok: true, ...violationResult });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Cập nhật chính xác thời lượng rời màn hình khi học sinh quay lại phòng thi
  router.patch(
    '/attempts/:attemptId/violations/:violationId',
    (req: Request, res: Response) => {
      try {
        const actorId = resolveStudentActor(req);
        const sessionToken = extractSessionToken(req);
        const awaySeconds = Number(req.body?.awaySeconds ?? 0);
        const violation = engine.updateViolationAwayDuration(
          actorId,
          req.params.attemptId,
          req.params.violationId,
          awaySeconds,
          sessionToken
        );
        res.json({ ok: true, violation });
      } catch (error) {
        handleRouteError(res, error);
      }
    }
  );

  // Học sinh nộp bài
  router.post('/attempts/:attemptId/submit', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const sessionToken = extractSessionToken(req);
      const reason =
        req.body?.reason === 'timeout'
          ? 'timeout'
          : req.body?.reason === 'violation'
            ? 'violation'
            : 'voluntary';
      const finalAnswers = Array.isArray(req.body?.finalAnswers)
        ? req.body.finalAnswers
        : undefined;
      const result = engine.submitAttempt(
        actorId,
        req.params.attemptId,
        sessionToken,
        { reason, finalAnswers }
      );
      res.json({ ok: true, result });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Học sinh xem kết quả lượt thi sau khi đã nộp
  router.get('/attempts/:attemptId/result', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const result = engine.getAttemptResult(actorId, req.params.attemptId);
      res.json({ ok: true, result });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  // Học sinh lấy danh sách các lượt thi "Thi ngay" đã nộp cho mục Lịch sử phòng thi
  router.get('/student/attempts', (req: Request, res: Response) => {
    try {
      const actorId = resolveStudentActor(req);
      const attempts = engine.listStudentSubmittedAttempts(actorId);
      res.json({ ok: true, attempts });
    } catch (error) {
      handleRouteError(res, error);
    }
  });

  return router;
}
