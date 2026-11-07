import { CodeVerifyRejectionReason } from '../types/examSession';

export const SHORT_TOPIC_NAMES: Record<string, string> = {
  '1. Tổng quan & Mô hình GenAI': 'Mô hình GenAI',
  '2. Kỹ thuật viết Prompt': 'Viết prompt',
  '3. Đạo đức, Pháp lý & Bảo mật': 'Đạo đức và bảo mật',
  '4. Ứng dụng & Công cụ thực tế': 'Ứng dụng thực tế',
};

export function getShortTopicName(topic: string): string {
  if (SHORT_TOPIC_NAMES[topic]) {
    return SHORT_TOPIC_NAMES[topic];
  }
  const normalized = topic.toLowerCase();
  if (normalized.includes('mô hình') || normalized.includes('tổng quan')) {
    return 'Mô hình GenAI';
  }
  if (normalized.includes('prompt')) {
    return 'Viết prompt';
  }
  if (normalized.includes('đạo đức') || normalized.includes('bảo mật')) {
    return 'Đạo đức và bảo mật';
  }
  if (normalized.includes('ứng dụng') || normalized.includes('công cụ')) {
    return 'Ứng dụng thực tế';
  }
  return topic.replace(/^\d+\.\s*/, '').trim();
}

export function extractStudentGivenName(fullName: string): string {
  const cleaned = (fullName || '').trim();
  if (!cleaned) return 'bạn';
  const parts = cleaned.split(/\s+/);
  const lastWord = parts[parts.length - 1];
  if (!lastWord) return 'bạn';
  return lastWord.charAt(0).toUpperCase() + lastWord.slice(1).toLowerCase();
}

export function getAvatarInitial(fullName: string): string {
  const given = extractStudentGivenName(fullName);
  return given.charAt(0).toUpperCase() || 'H';
}

export function formatCompactStudyDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return `${hours} giờ ${minutes} phút`;
  }
  if (minutes > 0) {
    return `${minutes} phút`;
  }
  if (safe > 0) {
    return '1 phút';
  }
  return '0 phút';
}

/**
 * Chuẩn hóa chuỗi nhập mã ca thi của học sinh:
 * - Tự động bỏ mọi khoảng trắng (kể cả khi dán)
 * - Tự động chuyển thành chữ IN HOA
 * - Giới hạn tối đa 6 ký tự
 */
export function sanitizeLiveExamCodeInput(raw: string): string {
  return String(raw || '')
    .replace(/\s+/g, '')
    .toUpperCase()
    .slice(0, 6);
}

/**
 * Trả về thông báo lỗi một dòng chuẩn xác dưới ô nhập mã "Thi ngay"
 */
export function formatVerifyCodeErrorMessage(
  reason?: CodeVerifyRejectionReason | string,
  retryAfterSeconds?: number
): string {
  switch (reason) {
    case 'not_found':
      return 'Mã không tồn tại';
    case 'not_open_yet':
      return 'Ca thi chưa mở';
    case 'locked':
    case 'ended':
      return 'Ca thi đã khóa';
    case 'wrong_class':
      return 'Bạn không thuộc lớp được phép thi';
    case 'already_submitted':
      return 'Bạn đã nộp bài ca thi này';
    case 'rate_limited': {
      const secs = Math.max(1, Math.ceil(Number(retryAfterSeconds) || 60));
      return `Thử lại sau ${secs} giây`;
    }
    default:
      return 'Mã không tồn tại';
  }
}
