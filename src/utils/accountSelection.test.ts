import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getDeletableAccountIds,
  isAccountProtectedFromDelete,
  pruneMissingSelection,
  toggleAccountSelection,
  toggleSelectAllIds,
} from './accountSelection';

test('isAccountProtectedFromDelete bảo vệ tài khoản admin gốc và tài khoản đang đăng nhập', () => {
  assert.equal(
    isAccountProtectedFromDelete({ id: 'admin', username: 'admin' }, 'gv_1'),
    true
  );
  assert.equal(
    isAccountProtectedFromDelete({ id: 'ADMIN', username: 'Admin' }, 'gv_1'),
    true
  );
  assert.equal(
    isAccountProtectedFromDelete({ id: 'gv_1', username: 'gv_1' }, 'gv_1'),
    true
  );
  assert.equal(
    isAccountProtectedFromDelete({ id: 'gv_2', username: 'gv_2' }, 'gv_1'),
    false
  );
  assert.equal(
    isAccountProtectedFromDelete({ id: 'hs_101', username: 'hs_101' }, 'admin'),
    false
  );
});

test('getDeletableAccountIds loại bỏ admin, người dùng hiện tại và ID trùng lặp', () => {
  const accounts = [
    { id: 'admin', username: 'admin' },
    { id: 'gv_toan', username: 'gv_toan' },
    { id: 'gv_tin', username: 'gv_tin' },
    { id: 'hs_01', username: 'hs_01' },
    { id: 'hs_01', username: 'hs_01' },
    { id: 'hs_02', username: 'hs_02' },
  ];

  assert.deepEqual(getDeletableAccountIds(accounts, 'gv_toan'), [
    'gv_tin',
    'hs_01',
    'hs_02',
  ]);
});

test('toggleAccountSelection bật/tắt đúng và từ chối chọn tài khoản được bảo vệ', () => {
  const s0 = new Set<string>();
  const s1 = toggleAccountSelection(s0, 'hs_01', false);
  assert.deepEqual(Array.from(s1), ['hs_01']);

  const s2 = toggleAccountSelection(s1, 'admin', true);
  assert.deepEqual(Array.from(s2), ['hs_01']);

  const s3 = toggleAccountSelection(s2, 'hs_01', false);
  assert.deepEqual(Array.from(s3), []);
});

test('toggleSelectAllIds chọn đủ nhóm mục tiêu và bỏ chọn khi toàn bộ nhóm đã được chọn', () => {
  const s0 = new Set<string>(['hs_99']);
  const pageIds = ['hs_01', 'hs_02', 'hs_03'];

  const s1 = toggleSelectAllIds(s0, pageIds);
  assert.deepEqual(Array.from(s1).sort(), ['hs_01', 'hs_02', 'hs_03', 'hs_99']);

  // Bấm lại lần nữa chỉ bỏ chọn các ID thuộc trang hiện tại, giữ nguyên ID đã chọn ở trang khác
  const s2 = toggleSelectAllIds(s1, pageIds);
  assert.deepEqual(Array.from(s2), ['hs_99']);
});

test('pruneMissingSelection xóa các ID không còn tồn tại khỏi tập đã chọn', () => {
  const selected = new Set(['hs_01', 'hs_02', 'hs_deleted']);
  const existing = new Set(['hs_01', 'hs_03']);
  assert.deepEqual(Array.from(pruneMissingSelection(selected, existing)), ['hs_01']);
});
