import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractRequestAuthToken,
  signAuthToken,
  verifyAuthToken,
} from './authToken';

const TEST_SECRET = 'test_exam_auth_secret_key_for_unit_tests_2026';

test('signAuthToken và verifyAuthToken ký và xác thực hợp lệ payload giáo viên và học sinh', () => {
  const nowMs = new Date('2026-11-20T08:00:00.000Z').getTime();
  const teacherToken = signAuthToken(
    {
      sub: 'admin',
      username: 'admin',
      role: 'teacher',
      className: 'Quản trị',
    },
    { secret: TEST_SECRET, ttlSeconds: 3600, nowMs }
  );

  const verified = verifyAuthToken(teacherToken, {
    secret: TEST_SECRET,
    nowMs: nowMs + 1000,
  });
  assert.ok(verified);
  assert.equal(verified.sub, 'admin');
  assert.equal(verified.username, 'admin');
  assert.equal(verified.role, 'teacher');
  assert.equal(verified.className, 'Quản trị');
});

test('verifyAuthToken từ chối token bị giả mạo payload, sai chữ ký, sai bí mật hoặc hết hạn', () => {
  const nowMs = new Date('2026-11-20T08:00:00.000Z').getTime();
  const studentToken = signAuthToken(
    {
      sub: 'hs_a',
      username: 'hs_a',
      role: 'student',
      className: '12A1',
    },
    { secret: TEST_SECRET, ttlSeconds: 120, nowMs }
  );

  // 1. Giả mạo payload nâng quyền từ student -> teacher
  const [, originalSig] = studentToken.split('.');
  const forgedPayload = Buffer.from(
    JSON.stringify({
      sub: 'hs_a',
      username: 'hs_a',
      role: 'teacher',
      iat: Math.floor(nowMs / 1000),
      exp: Math.floor(nowMs / 1000) + 3600,
    })
  ).toString('base64url');
  assert.equal(
    verifyAuthToken(`${forgedPayload}.${originalSig}`, {
      secret: TEST_SECRET,
      nowMs,
    }),
    null
  );

  // 2. Sai khóa bí mật
  assert.equal(
    verifyAuthToken(studentToken, {
      secret: 'different_secret_key_that_must_fail_12345',
      nowMs,
    }),
    null
  );

  // 3. Token hết hạn
  assert.equal(
    verifyAuthToken(studentToken, {
      secret: TEST_SECRET,
      nowMs: nowMs + 121 * 1000,
    }),
    null
  );

  // 4. Token sai cấu trúc hoặc rỗng
  assert.equal(verifyAuthToken('', { secret: TEST_SECRET, nowMs }), null);
  assert.equal(verifyAuthToken('not-a-valid-token', { secret: TEST_SECRET, nowMs }), null);
});

test('extractRequestAuthToken đọc đúng Bearer header và fallback query authToken cho SSE', () => {
  const fromHeader = extractRequestAuthToken({
    header: (name) =>
      name.toLowerCase() === 'authorization' ? 'Bearer abc.def' : undefined,
    query: { authToken: 'ignored.token' },
  });
  assert.equal(fromHeader, 'abc.def');

  const fromQuery = extractRequestAuthToken({
    header: () => undefined,
    query: { authToken: 'sse.token' },
  });
  assert.equal(fromQuery, 'sse.token');

  const missing = extractRequestAuthToken({
    header: () => undefined,
    query: {},
  });
  assert.equal(missing, null);
});
