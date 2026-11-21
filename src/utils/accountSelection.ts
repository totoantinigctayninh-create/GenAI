import { UserAccount } from '../types/exam';

type AccountIdentity = Pick<UserAccount, 'id' | 'username'>;

/**
 * Kiểm tra tài khoản có được bảo vệ khỏi thao tác xóa hàng loạt hay không
 * (tài khoản quản trị gốc `admin` và tài khoản đang đăng nhập hiện tại).
 */
export function isAccountProtectedFromDelete(
  account: AccountIdentity,
  currentUserId?: string | null
): boolean {
  const idLower = (account.id || '').trim().toLowerCase();
  const usernameLower = (account.username || '').trim().toLowerCase();
  const currentLower = (currentUserId || '').trim().toLowerCase();

  if (idLower === 'admin' || usernameLower === 'admin') {
    return true;
  }
  if (currentLower && (idLower === currentLower || usernameLower === currentLower)) {
    return true;
  }
  return false;
}

/**
 * Lọc danh sách ID tài khoản hợp lệ có thể xóa (loại bỏ tài khoản được bảo vệ và trùng lặp).
 */
export function getDeletableAccountIds(
  accounts: readonly AccountIdentity[],
  currentUserId?: string | null
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const acc of accounts) {
    if (!acc.id || isAccountProtectedFromDelete(acc, currentUserId)) {
      continue;
    }
    if (!seen.has(acc.id)) {
      seen.add(acc.id);
      result.push(acc.id);
    }
  }
  return result;
}

/**
 * Bật/tắt chọn một tài khoản trong tập chọn xóa nhiều.
 */
export function toggleAccountSelection(
  selectedIds: ReadonlySet<string>,
  accountId: string,
  isProtected: boolean
): Set<string> {
  const next = new Set(selectedIds);
  if (!accountId || isProtected) {
    next.delete(accountId);
    return next;
  }
  if (next.has(accountId)) {
    next.delete(accountId);
  } else {
    next.add(accountId);
  }
  return next;
}

/**
 * Chọn tất cả hoặc bỏ chọn tất cả một nhóm ID mục tiêu (ví dụ: trang hiện tại hoặc toàn bộ danh sách đang lọc).
 */
export function toggleSelectAllIds(
  selectedIds: ReadonlySet<string>,
  targetIds: readonly string[]
): Set<string> {
  const next = new Set(selectedIds);
  if (targetIds.length === 0) {
    return next;
  }
  const allAlreadySelected = targetIds.every((id) => next.has(id));
  if (allAlreadySelected) {
    for (const id of targetIds) {
      next.delete(id);
    }
  } else {
    for (const id of targetIds) {
      next.add(id);
    }
  }
  return next;
}

/**
 * Loại bỏ các ID không còn tồn tại trong danh sách người dùng hiện tại (sau khi xóa hoặc đồng bộ lại).
 */
export function pruneMissingSelection(
  selectedIds: ReadonlySet<string>,
  existingDeletableIds: ReadonlySet<string>
): Set<string> {
  const next = new Set<string>();
  for (const id of selectedIds) {
    if (existingDeletableIds.has(id)) {
      next.add(id);
    }
  }
  return next;
}
