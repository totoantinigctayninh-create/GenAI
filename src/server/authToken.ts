import crypto from 'node:crypto';

export interface AuthTokenPayload {
  sub: string;
  username: string;
  role: 'teacher' | 'student';
  className?: string;
  iat: number;
  exp: number;
}

export interface SignAuthTokenInput {
  sub: string;
  username: string;
  role: 'teacher' | 'student';
  className?: string;
}

export interface AuthTokenOptions {
  secret?: string;
  ttlSeconds?: number;
  nowMs?: number;
}

const DEFAULT_TTL_SECONDS = 12 * 60 * 60; // 12 giờ
const RUNTIME_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

export function resolveAuthSecret(explicitSecret?: string): string {
  const candidates = [
    explicitSecret,
    process.env.EXAM_AUTH_SECRET,
    process.env.AUTH_TOKEN_SECRET,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length >= 16) {
      return candidate.trim();
    }
  }
  return RUNTIME_FALLBACK_SECRET;
}

function toBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function computeSignature(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');
}

/**
 * Ký mã phiên làm việc bằng thuật toán HMAC-SHA256.
 * Định dạng: `<base64url(payload)>.<base64url(signature)>`
 */
export function signAuthToken(
  input: SignAuthTokenInput,
  options: AuthTokenOptions = {}
): string {
  const secret = resolveAuthSecret(options.secret);
  const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttl = Math.max(60, Math.floor(options.ttlSeconds ?? DEFAULT_TTL_SECONDS));

  const payload: AuthTokenPayload = {
    sub: String(input.sub).trim(),
    username: String(input.username || input.sub).trim(),
    role: input.role,
    ...(input.className ? { className: String(input.className).trim() } : {}),
    iat: nowSec,
    exp: nowSec + ttl,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = computeSignature(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

/**
 * Xác thực chữ ký HMAC-SHA256 (constant-time) và hạn sử dụng của mã phiên làm việc.
 */
export function verifyAuthToken(
  token: string | undefined | null,
  options: Pick<AuthTokenOptions, 'secret' | 'nowMs'> = {}
): AuthTokenPayload | null {
  if (!token || typeof token !== 'string') return null;
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 2) return null;

  const [encodedPayload, providedSignature] = parts;
  if (!encodedPayload || !providedSignature) return null;

  const secret = resolveAuthSecret(options.secret);
  const expectedSignature = computeSignature(encodedPayload, secret);

  const providedBuf = Buffer.from(providedSignature, 'utf8');
  const expectedBuf = Buffer.from(expectedSignature, 'utf8');
  if (
    providedBuf.length !== expectedBuf.length ||
    !crypto.timingSafeEqual(providedBuf, expectedBuf)
  ) {
    return null;
  }

  try {
    const rawJson = fromBase64Url(encodedPayload);
    const parsed = JSON.parse(rawJson) as Partial<AuthTokenPayload>;
    if (
      !parsed ||
      typeof parsed.sub !== 'string' ||
      !parsed.sub.trim() ||
      (parsed.role !== 'teacher' && parsed.role !== 'student') ||
      typeof parsed.iat !== 'number' ||
      typeof parsed.exp !== 'number'
    ) {
      return null;
    }

    const nowSec = Math.floor((options.nowMs ?? Date.now()) / 1000);
    if (parsed.exp <= nowSec) {
      return null;
    }

    return {
      sub: parsed.sub.trim(),
      username:
        typeof parsed.username === 'string' && parsed.username.trim()
          ? parsed.username.trim()
          : parsed.sub.trim(),
      role: parsed.role,
      ...(typeof parsed.className === 'string'
        ? { className: parsed.className.trim() }
        : {}),
      iat: parsed.iat,
      exp: parsed.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Trích xuất mã phiên làm việc từ header `Authorization: Bearer <token>`
 * hoặc từ tham số truy vấn `?authToken=<token>` (dùng cho kết nối SSE EventSource).
 */
export function extractRequestAuthToken(req: {
  header: (name: string) => string | undefined;
  query?: Record<string, unknown>;
}): string | null {
  const authHeader = req.header('authorization');
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const queryToken = req.query?.authToken;
  if (typeof queryToken === 'string' && queryToken.trim()) {
    return queryToken.trim();
  }

  return null;
}
