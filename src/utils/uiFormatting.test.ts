import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractStudentGivenName,
  formatCompactStudyDuration,
  formatVerifyCodeErrorMessage,
  getAvatarInitial,
  getShortTopicName,
  sanitizeLiveExamCodeInput,
} from './uiFormatting';

test('getShortTopicName returns exact shortened names for all 4 Certiport topics', () => {
  assert.equal(getShortTopicName('1. Tổng quan & Mô hình GenAI'), 'Mô hình GenAI');
  assert.equal(getShortTopicName('2. Kỹ thuật viết Prompt'), 'Viết prompt');
  assert.equal(getShortTopicName('3. Đạo đức, Pháp lý & Bảo mật'), 'Đạo đức và bảo mật');
  assert.equal(getShortTopicName('4. Ứng dụng & Công cụ thực tế'), 'Ứng dụng thực tế');
});

test('extractStudentGivenName extracts and capitalizes Vietnamese given name', () => {
  assert.equal(extractStudentGivenName('lê minh ngọc'), 'Ngọc');
  assert.equal(extractStudentGivenName('Nguyễn Văn An'), 'An');
  assert.equal(extractStudentGivenName(''), 'bạn');
});

test('getAvatarInitial returns uppercase initial of given name', () => {
  assert.equal(getAvatarInitial('lê minh ngọc'), 'N');
  assert.equal(getAvatarInitial('Nguyễn Văn An'), 'A');
});

test('formatCompactStudyDuration formats study time concisely', () => {
  assert.equal(formatCompactStudyDuration(4620), '1 giờ 17 phút');
  assert.equal(formatCompactStudyDuration(900), '15 phút');
  assert.equal(formatCompactStudyDuration(0), '0 phút');
});

test('sanitizeLiveExamCodeInput strips whitespace, uppercases, and limits to 6 chars', () => {
  assert.equal(sanitizeLiveExamCodeInput('  k9 m2 p4 '), 'K9M2P4');
  assert.equal(sanitizeLiveExamCodeInput('a b c d e f g h'), 'ABCDEF');
});

test('formatVerifyCodeErrorMessage returns exact single-line error strings', () => {
  assert.equal(formatVerifyCodeErrorMessage('not_found'), 'Mã không tồn tại');
  assert.equal(formatVerifyCodeErrorMessage('not_open_yet'), 'Ca thi chưa mở');
  assert.equal(formatVerifyCodeErrorMessage('locked'), 'Ca thi đã khóa');
  assert.equal(formatVerifyCodeErrorMessage('ended'), 'Ca thi đã khóa');
  assert.equal(
    formatVerifyCodeErrorMessage('wrong_class'),
    'Bạn không thuộc lớp được phép thi'
  );
  assert.equal(
    formatVerifyCodeErrorMessage('already_submitted'),
    'Bạn đã nộp bài ca thi này'
  );
  assert.equal(
    formatVerifyCodeErrorMessage('rate_limited', 48),
    'Thử lại sau 48 giây'
  );
});
