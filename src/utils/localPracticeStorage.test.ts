import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLocalBookmarkToggle,
  applyLocalExamWrongQuestions,
  applyLocalMarkMastered,
  applyLocalPracticeCheck,
  applyLocalStudyTimeDelta,
  clearLocalPracticeState,
  getLocalPracticeStorageKey,
  loadLocalPracticeState,
  mergeUserWithLocalPractice,
  type StorageLike,
} from './localPracticeStorage.ts';
import type { UserAccount } from '../types/exam.ts';

function createMemoryStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

function makeStudent(id: string, overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    id,
    username: id,
    password: '',
    fullName: `Học sinh ${id}`,
    role: 'student',
    className: '12A1',
    lastLogin: '2026-10-20T08:00:00.000Z',
    status: 'studying',
    activeStatus: 'studying',
    totalStudyMinutes: 0,
    totalStudySeconds: 0,
    bookmarkedQuestions: [],
    wrongQuestions: [],
    masteredQuestions: [],
    practiceProgress: {},
    ...overrides,
  };
}

test('Lưu tiến độ luyện tập cục bộ tách biệt theo từng mã học sinh và không ảnh hưởng tài khoản khác', () => {
  const storage = createMemoryStorage();
  const studentA = makeStudent('HS_A');
  const studentB = makeStudent('HS_B');

  assert.equal(
    getLocalPracticeStorageKey('HS_A'),
    'certiport_local_practice_v1_hs_a'
  );

  // Học sinh A đánh dấu câu hỏi, trả lời sai Q1, trả lời đúng Q2, học thêm 125 giây
  const s1 = applyLocalBookmarkToggle(studentA, 'Q1', storage);
  assert.deepEqual(s1.bookmarkedQuestions, ['Q1']);

  const s2 = applyLocalPracticeCheck(studentA, 'Q1', false, false, storage);
  assert.deepEqual(s2.wrongQuestions, ['Q1']);
  assert.equal(s2.practiceProgress['Q1'].isCorrect, false);
  assert.equal(s2.practiceProgress['Q1'].attemptsCount, 1);

  const s3 = applyLocalPracticeCheck(studentA, 'Q2', true, false, storage);
  assert.deepEqual(s3.wrongQuestions, ['Q1']);
  assert.equal(s3.practiceProgress['Q2'].isCorrect, true);

  const s4 = applyLocalMarkMastered(studentA, 'Q1', storage);
  assert.deepEqual(s4.wrongQuestions, []);
  assert.deepEqual(s4.masteredQuestions, ['Q1']);

  const s5 = applyLocalStudyTimeDelta(studentA, 125, storage);
  assert.equal(s5.totalStudySeconds, 125);
  assert.equal(s5.totalStudyMinutes, 2);

  // Nộp bài thi thử: gộp câu sai Q3, Q4 và thêm 300 giây vào localStorage
  const s6 = applyLocalExamWrongQuestions(studentA, ['Q3', 'Q4'], 300, storage);
  assert.deepEqual(s6.wrongQuestions, ['Q3', 'Q4']);
  assert.equal(s6.totalStudySeconds, 425);
  assert.equal(s6.totalStudyMinutes, 7);

  // Học sinh A tải lại trang -> mergeUserWithLocalPractice khôi phục đầy đủ dữ liệu cục bộ
  const mergedA = mergeUserWithLocalPractice(makeStudent('HS_A'), storage);
  assert.deepEqual(mergedA.bookmarkedQuestions, ['Q1']);
  assert.deepEqual(mergedA.wrongQuestions, ['Q3', 'Q4']);
  assert.deepEqual(mergedA.masteredQuestions, ['Q1']);
  assert.equal(mergedA.totalStudySeconds, 425);
  assert.equal(mergedA.practiceProgress?.['Q2']?.isCorrect, true);

  // Học sinh B hoàn toàn sạch sẽ, không bị lẫn dữ liệu của học sinh A
  const mergedB = mergeUserWithLocalPractice(studentB, storage);
  assert.deepEqual(mergedB.bookmarkedQuestions, []);
  assert.deepEqual(mergedB.wrongQuestions, []);
  assert.equal(mergedB.totalStudySeconds, 0);
  assert.equal(loadLocalPracticeState('HS_B', storage), null);
});

test('Tự động dọn sạch dữ liệu luyện tập cục bộ khi giáo viên bấm Reset tiến độ học sinh (progressResetAt mới hơn)', () => {
  const storage = createMemoryStorage();
  const studentA = makeStudent('hs_reset_1');

  applyLocalBookmarkToggle(studentA, 'Q10', storage);
  applyLocalPracticeCheck(studentA, 'Q10', false, false, storage);
  applyLocalStudyTimeDelta(studentA, 600, storage);

  const beforeReset = mergeUserWithLocalPractice(studentA, storage);
  assert.deepEqual(beforeReset.bookmarkedQuestions, ['Q10']);
  assert.deepEqual(beforeReset.wrongQuestions, ['Q10']);
  assert.equal(beforeReset.totalStudySeconds, 600);

  // Giáo viên bấm Reset trên máy chủ -> server trả về progressResetAt mới
  const resetTimestamp = '2026-10-25T10:00:00.000Z';
  const afterTeacherReset = mergeUserWithLocalPractice(
    makeStudent('hs_reset_1', { progressResetAt: resetTimestamp }),
    storage
  );
  assert.deepEqual(afterTeacherReset.bookmarkedQuestions, []);
  assert.deepEqual(afterTeacherReset.wrongQuestions, []);
  assert.deepEqual(afterTeacherReset.masteredQuestions, []);
  assert.deepEqual(afterTeacherReset.practiceProgress, {});
  assert.equal(afterTeacherReset.totalStudySeconds, 0);

  // Sau khi reset, học sinh luyện tập lại từ đầu -> dữ liệu MỚI được giữ nguyên khi tải lại cùng mốc reset
  applyLocalBookmarkToggle(afterTeacherReset, 'Q20', storage);
  const reloadedAfterNewWork = mergeUserWithLocalPractice(
    makeStudent('hs_reset_1', { progressResetAt: resetTimestamp }),
    storage
  );
  assert.deepEqual(reloadedAfterNewWork.bookmarkedQuestions, ['Q20']);

  // Xóa trực tiếp qua clearLocalPracticeState
  clearLocalPracticeState('hs_reset_1', storage);
  assert.equal(loadLocalPracticeState('hs_reset_1', storage), null);
});
