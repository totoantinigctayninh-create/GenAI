import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DEPARTMENT_LOGO_URL,
  isAdminAccount,
  resolveDepartmentLogoUrl,
} from './branding';

test('resolveDepartmentLogoUrl falls back to official department logo asset when empty', () => {
  assert.equal(resolveDepartmentLogoUrl(undefined), DEFAULT_DEPARTMENT_LOGO_URL);
  assert.equal(resolveDepartmentLogoUrl(null), DEFAULT_DEPARTMENT_LOGO_URL);
  assert.equal(resolveDepartmentLogoUrl('   '), DEFAULT_DEPARTMENT_LOGO_URL);
  assert.equal(
    resolveDepartmentLogoUrl('data:image/png;base64,abc'),
    'data:image/png;base64,abc'
  );
});

test('isAdminAccount grants logo edit permission strictly to the admin teacher account', () => {
  assert.equal(
    isAdminAccount({ id: 'admin', username: 'admin', role: 'teacher' }),
    true
  );
  assert.equal(
    isAdminAccount({ id: 'ADMIN', username: 'ADMIN', role: 'teacher' }),
    true
  );
  // Non-admin teachers must NOT have admin logo edit permission
  assert.equal(
    isAdminAccount({ id: 'khanglp', username: 'khanglp', role: 'teacher' }),
    false
  );
  assert.equal(
    isAdminAccount({ id: 'cuctt', username: 'cuctt', role: 'teacher' }),
    false
  );
  // Students and unauthenticated sessions must NEVER have admin permission
  assert.equal(
    isAdminAccount({ id: 'admin', username: 'admin', role: 'student' }),
    false
  );
  assert.equal(isAdminAccount(null), false);
  assert.equal(isAdminAccount(undefined), false);
});
