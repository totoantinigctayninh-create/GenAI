import express, { type Request, type Response, Router } from 'express';
import {
  type CreateExamSessionInput,
  ExamEngineError,
  ExamSessionEngine,
  type UpdateExamSessionInput,
} from './examSessionEngine.ts';
import type { ViolationEventType } from '../types/examSession.ts';
import type { UserAnswer } from '../types/exam.ts';

function extractActorId(req: Request): string {
  const headerUser = req.header('x-user-id') || req.header('x-actor-id');
  if (headerUser) return headerUser.trim();

  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    return authHeader.slice(7).trim();
  }

  const bodyUser =
    (req.body && (req.body.userId || req.body.actorId || req.body.studentId || req.body.teacherId)) ||
    req.query.userId;
  return String(bodyUser || '').trim();
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

export function createExamSessionRouter(engine: ExamSessionEngine): Router {
  const router = express.Router();

  // ============================================================================
  // 1. API GIÁO VIÊN: QUẢN LÝ CA THI (`/api/exam-sessions`)
  // ============================================================================

  function resolveTeacherActor(req: Request): string {
    const actorId = extractActorId(req);
    if (!actorId) return '';
    const existing = engine.getUser(actorId);
    if (existing) {
      return existing.id;
    }
    // Hỗ trợ đồng bộ tài khoản giáo viên đang đăng nhập nếu chưa có trong bộ nhớ máy chủ
    const roleHeader = req.header('x-user-role');
    const classHeader = req.header('x-user-class');
    if (roleHeader === 'teacher' || actorId.toLowerCase().startsWith('gv_')) {
      const inferredClass =
        classHeader?.trim() ||
        (actorId.toLowerCase() === 'gv_toan'
          ? '12A1'
          : actorId.toLowerCase() === 'gv_tin'
            ? '12A2'
            : '');
      engine.upsertUser({
        id: actorId,
        username: actorId,
        password: '***',
        fullName: `Giáo viên (${actorId})`,
        role: 'teacher',
        className: inferredClass,
        lastLogin: new Date().toISOString(),
        status: 'online',
        totalStudyMinutes: 0,
      });
    }
    return actorId;
  }

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
    const actorId = extractActorId(req);
    if (!actorId) return '';
    const existing = engine.getUser(actorId);
    if (existing) {
      // Nếu client truyền className mới nhất của học sinh đang đăng nhập thì đồng bộ
      if (
        existing.role === 'student' &&
        req.body?.studentProfile &&
        typeof req.body.studentProfile.className === 'string' &&
        req.body.studentProfile.className.trim()
      ) {
        engine.upsertUser({
          ...existing,
          className: req.body.studentProfile.className.trim(),
        });
      }
      return existing.id;
    }

    // Tự động đăng ký tài khoản học sinh đang đăng nhập trên trình duyệt nếu chưa kịp đồng bộ
    const profile = req.body?.studentProfile;
    if (profile && typeof profile === 'object') {
      const id = String(profile.id || profile.username || actorId).trim();
      if (id) {
        engine.upsertUser({
          id,
          username: String(profile.username || id).trim(),
          password: '***',
          fullName: String(profile.fullName || id).trim(),
          role: 'student',
          className: String(profile.className || 'Lớp Certiport GenAI').trim(),
          lastLogin: new Date().toISOString(),
          status: 'studying',
          totalStudyMinutes: 0,
        });
        return id;
      }
    }

    return actorId;
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
      const actorId = extractActorId(req);
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

  // Lưu đáp án từng câu trong lúc làm bài
  router.post('/attempts/:attemptId/answers', (req: Request, res: Response) => {
    try {
      const actorId = extractActorId(req);
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
