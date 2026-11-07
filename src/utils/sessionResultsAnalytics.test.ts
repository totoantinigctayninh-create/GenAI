import assert from 'node:assert/strict';
import test from 'node:test';
import { ExamSessionEngine } from '../server/examSessionEngine';
import {
  buildRawScoreTableRows,
  buildSessionQuestionAnalysis,
  buildSessionResultsExcelBytes,
  buildStudentDrawerDetail,
  compareTwoExamSessions,
  computeSessionClassAnalytics,
  filterAndSortStudentScoreRows,
  filterRawRowsByScoreBin,
  getScoreBinIndex,
  parseSessionResultsExcelBytes,
  verifyAnalyticsAgainstRawScoreTable,
} from './sessionResultsAnalytics';

function createTestEngine() {
  const engine = new ExamSessionEngine({
    nowFn: () => new Date('2026-05-15T09:00:00.000Z'),
  });
  engine.setUsers([
    {
      id: 'gv_1',
      username: 'gv_1',
      password: '123',
      fullName: 'Giáo viên Kiểm thử 1',
      role: 'teacher',
      className: '12A1',
      lastLogin: '2026-05-15T08:00:00.000Z',
      status: 'online',
      totalStudyMinutes: 0,
    },
    {
      id: 'gv_2',
      username: 'gv_2',
      password: '123',
      fullName: 'Giáo viên Lớp Khác',
      role: 'teacher',
      className: '12C9',
      lastLogin: '2026-05-15T08:00:00.000Z',
      status: 'online',
      totalStudyMinutes: 0,
    },
  ]);
  return engine;
}

test('Bước 7A/8: Kiểm thử với 0 học sinh, 1 học sinh và 40 học sinh giả lập kèm đối chiếu bảng điểm gốc', () => {
  const engine = createTestEngine();
  const session = engine.createSession('gv_1', {
    title: 'Ca thi Kiểm thử Thống kê 7A',
    code: 'R7A8B9',
    targetClass: '12A1',
    questionCount: 20,
    durationMinutes: 50,
    passScore: 700,
    status: 'open',
  });

  // 1. Trường hợp 0 học sinh
  const detail0 = engine.simulateSessionStudents('gv_1', session.id, {
    inProgressCount: 0,
    submittedCount: 0,
    notEnteredCount: 0,
  });
  const rows0 = buildRawScoreTableRows(detail0.attempts, detail0.session, detail0.serverNow);
  const analytics0 = computeSessionClassAnalytics(rows0, detail0.session);
  const report0 = verifyAnalyticsAgainstRawScoreTable(
    analytics0,
    rows0,
    detail0.session.passScore
  );

  assert.equal(rows0.length, 0);
  assert.equal(analytics0.kpis.participantCount, 0);
  assert.equal(analytics0.kpis.averageScore, 0);
  assert.equal(analytics0.kpis.medianScore, 0);
  assert.equal(analytics0.kpis.highestScore, 0);
  assert.equal(analytics0.kpis.lowestScore, 0);
  assert.equal(analytics0.kpis.passRatePercent, 0);
  assert.equal(analytics0.isProvisional, true);
  assert.equal(report0.matches, true);

  // 2. Trường hợp 1 học sinh
  const detail1 = engine.simulateSessionStudents('gv_1', session.id, {
    inProgressCount: 0,
    submittedCount: 1,
    notEnteredCount: 0,
  });
  const rows1 = buildRawScoreTableRows(detail1.attempts, detail1.session, detail1.serverNow);
  const analytics1 = computeSessionClassAnalytics(rows1, detail1.session);
  const report1 = verifyAnalyticsAgainstRawScoreTable(
    analytics1,
    rows1,
    detail1.session.passScore
  );

  assert.equal(rows1.length, 1);
  assert.equal(analytics1.kpis.participantCount, 1);
  assert.equal(analytics1.kpis.averageScore, rows1[0].score);
  assert.equal(analytics1.kpis.medianScore, rows1[0].score);
  assert.equal(analytics1.kpis.highestScore, rows1[0].score);
  assert.equal(analytics1.kpis.lowestScore, rows1[0].score);
  assert.equal(report1.matches, true);

  // 3. Trường hợp 40 học sinh giả lập (32 đang thi, 5 đã nộp, 3 chưa vào -> 37 thí sinh đã vào làm bài)
  const detail40 = engine.simulateSessionStudents('gv_1', session.id, {
    inProgressCount: 32,
    submittedCount: 5,
    notEnteredCount: 3,
  });
  const rows40 = buildRawScoreTableRows(
    detail40.attempts,
    detail40.session,
    detail40.serverNow
  );
  const analytics40 = computeSessionClassAnalytics(rows40, detail40.session);
  const report40 = verifyAnalyticsAgainstRawScoreTable(
    analytics40,
    rows40,
    detail40.session.passScore
  );

  assert.equal(rows40.length, 37);
  assert.equal(report40.matches, true);
  assert.deepEqual(report40.discrepancies, []);
  assert.equal(analytics40.isProvisional, true);
  assert.equal(analytics40.histogram.bins.length, 10);

  // Kiểm tra lọc bảng học sinh khi bấm một cột trên Phổ điểm
  const populatedBin = analytics40.histogram.bins.find((b) => b.count > 0)!;
  const filteredRows = filterRawRowsByScoreBin(rows40, populatedBin.binIndex);
  assert.equal(filteredRows.length, populatedBin.count);
  assert.equal(
    filteredRows.every(
      (r) => getScoreBinIndex(r.score) === populatedBin.binIndex
    ),
    true
  );

  // Kiểm tra 4 thanh ngang theo chuyên đề và dòng nhận xét tự động chuyên đề yếu nhất
  assert.equal(analytics40.topics.bars.length, 4);
  assert.ok(analytics40.topics.weakestTopic);
  assert.equal(
    analytics40.topics.weakestTopic?.shortLabel,
    'Đạo đức và bảo mật'
  );
  assert.equal(
    analytics40.topics.weakestSummaryLine.startsWith(
      'Yếu nhất: Đạo đức và bảo mật, đúng '
    ),
    true
  );

  // Kiểm tra biểu đồ phân tán nhận diện nhóm làm quá nhanh điểm thấp và nhóm làm hết giờ
  assert.equal(analytics40.scatter.points.length, 37);
  assert.equal(analytics40.scatter.fastLowScoreCount >= 1, true);
  assert.equal(analytics40.scatter.nearTimeoutCount >= 1, true);

  // Khi kết thúc ca thi -> tất cả học sinh đang thi được thu bài, trạng thái tạm thời tắt
  engine.endSession('gv_1', session.id);
  const detailEnded = engine.getTeacherSessionDetail('gv_1', session.id);
  const rowsEnded = buildRawScoreTableRows(
    detailEnded.attempts,
    detailEnded.session,
    detailEnded.serverNow
  );
  const analyticsEnded = computeSessionClassAnalytics(
    rowsEnded,
    detailEnded.session
  );
  const reportEnded = verifyAnalyticsAgainstRawScoreTable(
    analyticsEnded,
    rowsEnded,
    detailEnded.session.passScore
  );

  assert.equal(analyticsEnded.isProvisional, false);
  assert.equal(reportEnded.matches, true);
});

test('Bước 7B/8: Phân tích câu hỏi, Bảng học sinh, Drawer chi tiết, Xuất Excel 3 sheet khớp 100%, Cô lập giáo viên & So sánh 2 ca thi', () => {
  const engine = createTestEngine();
  const sessionA = engine.createSession('gv_1', {
    title: 'Ca thi Chi tiết 7B - Đợt 1',
    code: 'B7B8C9',
    targetClass: '12A1',
    questionCount: 20,
    durationMinutes: 50,
    passScore: 700,
    status: 'open',
  });

  // Kiểm tra cô lập quyền giáo viên: gv_2 (lớp 12C9) không xem được ca thi của gv_1 (lớp 12A1)
  assert.throws(
    () => engine.getTeacherSessionDetail('gv_2', sessionA.id),
    (err: unknown) =>
      err instanceof Error &&
      err.message.includes('chỉ được quyền truy cập ca thi do mình tạo')
  );

  const detail = engine.simulateSessionStudents('gv_1', sessionA.id, {
    inProgressCount: 32,
    submittedCount: 5,
    notEnteredCount: 3,
  });

  const rawRows = buildRawScoreTableRows(
    detail.attempts,
    detail.session,
    detail.serverNow
  );
  const analytics = computeSessionClassAnalytics(rawRows, detail.session);

  // 1) Phân tích từng câu hỏi: sắp theo tỉ lệ đúng từ thấp đến cao
  const questionAnalysis = buildSessionQuestionAnalysis(rawRows);
  assert.equal(questionAnalysis.length, 20);
  for (let i = 1; i < questionAnalysis.length; i++) {
    assert.equal(
      questionAnalysis[i].accuracyPercent >=
        questionAnalysis[i - 1].accuracyPercent,
      true
    );
  }

  // Kiểm tra phân loại độ khó (Khó <40%, Vừa 40-80%, Dễ >80%) và danh sách học sinh làm sai
  const hardestQ = questionAnalysis[0];
  assert.equal(hardestQ.wrongStudents.length, hardestQ.wrongCount);
  assert.equal(
    hardestQ.correctCount + hardestQ.wrongCount,
    hardestQ.totalStudents
  );
  assert.equal(hardestQ.optionDistribution.length >= 2, true);

  // 2) Bảng học sinh: lọc theo trạng thái (đạt, chưa đạt, tự nộp do vi phạm) và khoảng điểm
  const passedRows = filterAndSortStudentScoreRows({
    rows: rawRows,
    selectedBinIndex: null,
    statusFilter: 'passed',
    searchQuery: '',
    sortField: 'rank',
    sortDirection: 'asc',
  });
  const failedRows = filterAndSortStudentScoreRows({
    rows: rawRows,
    selectedBinIndex: null,
    statusFilter: 'failed',
    searchQuery: '',
    sortField: 'rank',
    sortDirection: 'asc',
  });
  const violationSubmittedRows = filterAndSortStudentScoreRows({
    rows: rawRows,
    selectedBinIndex: null,
    statusFilter: 'violation_submitted',
    searchQuery: '',
    sortField: 'rank',
    sortDirection: 'asc',
  });
  assert.equal(passedRows.length + failedRows.length, rawRows.length);
  assert.equal(violationSubmittedRows.length >= 1, true);
  assert.equal(
    violationSubmittedRows.every((r) => r.submitReason === 'violation'),
    true
  );

  // 3) Drawer chi tiết học sinh: khớp điểm, chuyên đề so với trung bình lớp, toàn bộ câu hỏi kèm thời gian, và dòng thời gian vi phạm
  const targetStudent = violationSubmittedRows[0];
  const drawerDetail = buildStudentDrawerDetail(
    targetStudent,
    analytics,
    detail.violations
  );
  assert.equal(drawerDetail.student.score, targetStudent.score);
  assert.equal(
    drawerDetail.scoreDeltaVsClass,
    targetStudent.score - analytics.kpis.averageScore
  );
  assert.equal(drawerDetail.topicComparisons.length, 4);
  assert.equal(
    drawerDetail.questions.length,
    targetStudent.totalQuestions
  );
  assert.equal(
    drawerDetail.questions.filter((q) => q.isCorrect).length,
    targetStudent.correctCount
  );
  assert.equal(
    drawerDetail.questions.every((q) => q.timeSpentSeconds >= 0),
    true
  );
  assert.equal(
    drawerDetail.violationTimeline.length,
    targetStudent.violationCount
  );

  // 4) Xuất file Excel (.xlsx) gồm 3 sheet và mở file kiểm tra số liệu khớp 100% với bảng & drawer
  const excelBytes = buildSessionResultsExcelBytes({
    session: detail.session,
    rawRows,
    questionAnalysis,
    violations: detail.violations,
  });
  const parsedExcel = parseSessionResultsExcelBytes(excelBytes);
  assert.deepEqual(parsedExcel.sheetNames, [
    'Bảng điểm',
    'Phân tích câu hỏi',
    'Nhật ký vi phạm',
  ]);
  assert.equal(parsedExcel.scoreSheet.length, rawRows.length);
  assert.equal(parsedExcel.questionSheet.length, questionAnalysis.length);
  assert.equal(parsedExcel.violationSheet.length, detail.violations.length);

  // Kiểm tra dòng đầu tiên của Sheet "Bảng điểm" khớp với hạng 1 trên bảng học sinh
  assert.equal(parsedExcel.scoreSheet[0]['Họ và tên'], rawRows[0].fullName);
  assert.equal(parsedExcel.scoreSheet[0]['Điểm (/1000)'], rawRows[0].score);
  assert.equal(
    parsedExcel.scoreSheet[0]['Số câu đúng'],
    rawRows[0].correctCount
  );

  // Kiểm tra dòng câu hỏi khó nhất trong Sheet "Phân tích câu hỏi" khớp với drawer câu hỏi
  assert.equal(
    parsedExcel.questionSheet[0]['Mã câu hỏi'],
    hardestQ.questionId
  );
  assert.equal(
    parsedExcel.questionSheet[0]['Tỉ lệ đúng (%)'],
    hardestQ.accuracyPercent
  );
  assert.equal(
    parsedExcel.questionSheet[0]['Số HS sai'],
    hardestQ.wrongCount
  );

  // 5) So sánh 2 ca thi
  const sessionB = engine.createSession('gv_1', {
    title: 'Ca thi Chi tiết 7B - Đợt 2',
    code: 'D7E8F9',
    targetClass: '12A1',
    questionCount: 20,
    durationMinutes: 50,
    passScore: 700,
    status: 'ended',
  });
  const detailB = engine.simulateSessionStudents('gv_1', sessionB.id, {
    inProgressCount: 0,
    submittedCount: 15,
    notEnteredCount: 0,
  });
  const rowsB = buildRawScoreTableRows(
    detailB.attempts,
    detailB.session,
    detailB.serverNow
  );
  const analyticsB = computeSessionClassAnalytics(rowsB, detailB.session);

  const comparison = compareTwoExamSessions({
    currentSession: detail.session,
    currentAnalytics: analytics,
    targetSession: detailB.session,
    targetAnalytics: analyticsB,
  });
  assert.equal(
    comparison.averageScoreDelta,
    analytics.kpis.averageScore - analyticsB.kpis.averageScore
  );
});
