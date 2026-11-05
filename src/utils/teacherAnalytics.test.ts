import test from 'node:test';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import {
  TEST_FIXTURE_ATTEMPTS,
  TEST_FIXTURE_QUESTIONS,
  TEST_FIXTURE_USERS,
} from '../data/seedData';
import {
  buildClassReportWorkbookBytes,
  buildSampleStudentImportExcelBytes,
  computeClassAnalytics,
  computeStudentProgressRows,
  computeTopTrapQuestions,
  parseStudentsFromExcelBytes,
} from './teacherAnalytics';

test('computeStudentProgressRows calculates practiced count, wrong pool, attempts, highest and average score', () => {
  const rows = computeStudentProgressRows(TEST_FIXTURE_USERS, TEST_FIXTURE_ATTEMPTS);
  assert.equal(rows.length, 2); // HS001 and HS002

  const hs001 = rows.find((r) => r.student.id === 'HS001');
  assert.ok(hs001);
  assert.ok(hs001.practicedCount >= 2);
  assert.equal(hs001.wrongPoolCount, hs001.student.wrongQuestions?.length ?? 0);
  assert.ok(hs001.attemptCount >= 1);
  assert.ok(hs001.highestScore1000 >= 700);
  assert.ok(hs001.averageScore1000 >= 700);
});

test('computeTopTrapQuestions ranks questions by highest wrong count and wrong rate', () => {
  const traps = computeTopTrapQuestions(
    TEST_FIXTURE_QUESTIONS,
    TEST_FIXTURE_USERS,
    TEST_FIXTURE_ATTEMPTS
  );
  assert.equal(traps.length, TEST_FIXTURE_QUESTIONS.length);
  for (let i = 1; i < traps.length; i++) {
    assert.ok(traps[i - 1].wrongCount >= traps[i].wrongCount);
  }
  assert.ok(traps[0].wrongCount > 0);
  assert.ok(traps[0].wrongRatePercent > 0);
});

test('computeClassAnalytics computes topicCompetency (4 topics) and typeCompetency (5 types)', () => {
  const analytics = computeClassAnalytics(
    TEST_FIXTURE_QUESTIONS,
    TEST_FIXTURE_USERS,
    TEST_FIXTURE_ATTEMPTS
  );
  assert.equal(analytics.topicCompetency.length, 4);
  assert.equal(analytics.typeCompetency.length, 5);
  for (const t of analytics.topicCompetency) {
    assert.ok(t.accuracyPercent >= 0 && t.accuracyPercent <= 100);
  }
});

test('buildSampleStudentImportExcelBytes and parseStudentsFromExcelBytes round-trip bulk student list', () => {
  const bytes = buildSampleStudentImportExcelBytes();
  const students = parseStudentsFromExcelBytes(bytes);
  assert.equal(students.length, 3);
  assert.equal(students[0].username, 'HS003');
  assert.equal(students[0].role, 'student');
});

test('buildClassReportWorkbookBytes creates a 3-sheet .xlsx workbook with TongHopKetQuaHocSinh, ChiTietLichSuThiThu, and ThongKeCauHoiHaySai', () => {
  const bytes = buildClassReportWorkbookBytes(
    TEST_FIXTURE_QUESTIONS,
    TEST_FIXTURE_USERS,
    TEST_FIXTURE_ATTEMPTS
  );
  assert.ok(bytes.byteLength > 1500);

  const wb = XLSX.read(bytes, { type: 'array' });
  assert.deepEqual(wb.SheetNames, [
    'TongHopKetQuaHocSinh',
    'ChiTietLichSuThiThu',
    'ThongKeCauHoiHaySai',
  ]);

  const sheet1 = XLSX.utils.sheet_to_json(wb.Sheets['TongHopKetQuaHocSinh']);
  const sheet2 = XLSX.utils.sheet_to_json(wb.Sheets['ChiTietLichSuThiThu']);
  const sheet3 = XLSX.utils.sheet_to_json(wb.Sheets['ThongKeCauHoiHaySai']);

  assert.equal(sheet1.length, 2);
  assert.equal(sheet2.length, TEST_FIXTURE_ATTEMPTS.length);
  assert.equal(sheet3.length, TEST_FIXTURE_QUESTIONS.length);
});
