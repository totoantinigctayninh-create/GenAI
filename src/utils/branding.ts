import type { UserAccount } from '../types/exam';

/**
 * Logo chính thức của Tổ Toán - Tin · Trường TH-THCS-THPT IGC Tây Ninh
 * Được đóng gói trực tiếp trong ứng dụng để hiển thị tức thì trên mọi trình duyệt/thiết bị.
 */
export const DEFAULT_DEPARTMENT_LOGO_URL = '/assets/aistudio/logo_d68b723c.png';

/**
 * Trả về đường dẫn logo hiện tại: ưu tiên logo tùy chỉnh do tài khoản quản trị tải lên,
 * nếu không có thì luôn dùng logo chính thức mặc định của Tổ Toán - Tin.
 */
export function resolveDepartmentLogoUrl(customLogoUrl?: string | null): string {
  const trimmed = typeof customLogoUrl === 'string' ? customLogoUrl.trim() : '';
  return trimmed || DEFAULT_DEPARTMENT_LOGO_URL;
}

/**
 * Kiểm tra tài khoản hiện tại có phải tài khoản Quản trị hệ thống (admin) hay không.
 * Chỉ tài khoản quản trị mới được phép chỉnh sửa / thay đổi / khôi phục Logo tổ chuyên môn.
 */
export function isAdminAccount(
  user: Pick<UserAccount, 'id' | 'username' | 'role'> | null | undefined
): boolean {
  if (!user || user.role !== 'teacher') {
    return false;
  }
  const normalizedId = String(user.id || '').trim().toLowerCase();
  const normalizedUsername = String(user.username || '').trim().toLowerCase();
  return normalizedId === 'admin' || normalizedUsername === 'admin';
}
