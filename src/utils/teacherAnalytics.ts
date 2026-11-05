import * as XLSX from 'xlsx';
import {
  CERTIPORT_TOPICS,
  ExamAttempt,
  QUESTION_TYPE_LABELS,
  Question,
  QuestionType,
  UserAccount,
} from '../types/exam';

export interface StudentProgressSummary {
  student: UserAccount;
  practicedCount: number;
  wrongPoolCount: number;
  masteredCount: number;
  attemptCount: number;
  highestScore1000: number;
  averageScore1000: number;
  averagePercentage: number;
  passCount: number;
  studentAttempts: ExamAttempt[];
}

export interface TrapQuestionStat {
  question: Question;
  wrongCount: number;
  correctCount: number;
  totalChecks: number;
  wrongRatePercent: number;
  studentsCurrentlyStruggling: number;
}

export interface ClassCompetencyBar {
  key: string;
  label: string;
  questionCountInBank: number;
  totalChecks: number;
  correctChecks: number;
  wrongChecks: number;
  accuracyPercent: number;
}

export interface ClassAnalyticsSummary {
  studentRows: StudentProgressSummary[];
  trapQuestions: TrapQuestionStat[];
  topicCompetency: ClassCompetencyBar[];
  typeCompetency: ClassCompetencyBar[];
  classAverageScore1000: number;
  classPassRatePercent: number;
  totalActiveStudents: number;
}

function getAttemptCertiportScore(att: ExamAttempt): number {
  if (typeof att.certiportScore === 'number') return att.certiportScore;
  const correct = att.score ?? att.correctCount ?? 0;
  const total = Math.max(1, att.totalQuestions || 1);
  return Math.round((correct / total) * 1000);
}

/**
 * Tính toán bảng theo dõi chi tiết từng học sinh:
 * - Số câu đã luyện tập, Số câu còn trong Kho câu sai, Số lần đã thi thử, Điểm cao nhất & Điểm trung bình
 */
export function computeStudentProgressRows(
  users: UserAccount[],
  attempts: ExamAttempt[]
): StudentProgressSummary[] {
  const students = users.filter((u) => u.role === 'student');

  return students.map((student) => {
    const studentAttempts = attempts
      .filter(
        (a) =>
          a.userId === student.id ||
          a.username.toLowerCase() === student.username.toLowerCase()
      )
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));

    const progressKeys = student.practiceProgress
      ? Object.keys(student.practiceProgress)
      : [];
    const wrongPool = Array.isArray(student.wrongQuestions)
      ? student.wrongQuestions
      : [];
    const masteredPool = Array.isArray(student.masteredQuestions)
      ? student.masteredQuestions
      : [];

    // Tập hợp tất cả câu hỏi học sinh đã từng tương tác qua luyện tập hoặc kho câu sai
    const practicedSet = new Set<string>([
      ...progressKeys,
      ...wrongPool,
      ...masteredPool,
    ]);
    for (const att of studentAttempts) {
      if (Array.isArray(att.questionOrderIds)) {
        att.questionOrderIds.forEach((id) => practicedSet.add(id));
      } else if (Array.isArray(att.questionResults)) {
        att.questionResults.forEach((qr) => practicedSet.add(qr.questionId));
      }
    }

    const scores1000 = studentAttempts.map(getAttemptCertiportScore);
    const highestScore1000 =
      scores1000.length > 0 ? Math.max(...scores1000) : 0;
    const averageScore1000 =
      scores1000.length > 0
        ? Math.round(
            scores1000.reduce((acc, s) => acc + s, 0) / scores1000.length
          )
        : 0;
    const averagePercentage = Math.round(averageScore1000 / 10);
    const passCount = scores1000.filter((s) => s >= 700).length;

    return {
      student,
      practicedCount: practicedSet.size,
      wrongPoolCount: wrongPool.length,
      masteredCount: masteredPool.length,
      attemptCount: studentAttempts.length,
      highestScore1000,
      averageScore1000,
      averagePercentage,
      passCount,
      studentAttempts,
    };
  });
}

/**
 * Thống kê "Top Câu Hỏi Bẫy (Học sinh sai nhiều nhất)" trong toàn lớp
 */
export function computeTopTrapQuestions(
  questions: Question[],
  users: UserAccount[],
  attempts: ExamAttempt[]
): TrapQuestionStat[] {
  const students = users.filter((u) => u.role === 'student');

  const statsMap = new Map<
    string,
    {
      wrongCount: number;
      correctCount: number;
      strugglingStudents: Set<string>;
    }
  >();

  for (const q of questions) {
    statsMap.set(q.id, {
      wrongCount: 0,
      correctCount: 0,
      strugglingStudents: new Set<string>(),
    });
  }

  // 1. Tổng hợp từ tiến độ luyện tập & kho câu sai của từng học sinh
  for (const st of students) {
    const wrongList = Array.isArray(st.wrongQuestions) ? st.wrongQuestions : [];
    for (const wId of wrongList) {
      const entry = statsMap.get(wId);
      if (entry) {
        entry.strugglingStudents.add(st.id);
      }
    }

    const prog = st.practiceProgress ?? {};
    for (const [qId, stat] of Object.entries(prog)) {
      const entry = statsMap.get(qId);
      if (!entry) continue;
      const runs = Math.max(1, stat.attemptsCount || 1);
      if (stat.isCorrect) {
        entry.correctCount += 1;
        if (runs > 1) {
          entry.wrongCount += runs - 1;
        }
      } else {
        entry.wrongCount += runs;
      }
    }

    // Nếu câu nằm trong wrongQuestions nhưng chưa có trong practiceProgress
    for (const wId of wrongList) {
      const entry = statsMap.get(wId);
      if (entry && !prog[wId]) {
        entry.wrongCount += 1;
      }
    }
  }

  // 2. Tổng hợp từ các lượt Thi thử (Mock Exam Attempts)
  for (const att of attempts) {
    if (Array.isArray(att.questionResults) && att.questionResults.length > 0) {
      for (const qr of att.questionResults) {
        const entry = statsMap.get(qr.questionId);
        if (!entry) continue;
        if (qr.isCorrect) {
          entry.correctCount += 1;
        } else {
          entry.wrongCount += 1;
          if (att.userId || att.username) {
            entry.strugglingStudents.add(att.userId || att.username);
          }
        }
      }
    } else if (Array.isArray(att.wrongQuestionIds)) {
      for (const wId of att.wrongQuestionIds) {
        const entry = statsMap.get(wId);
        if (entry) {
          entry.wrongCount += 1;
          if (att.userId || att.username) {
            entry.strugglingStudents.add(att.userId || att.username);
          }
        }
      }
    }
  }

  const result: TrapQuestionStat[] = questions.map((question) => {
    const item = statsMap.get(question.id) ?? {
      wrongCount: 0,
      correctCount: 0,
      strugglingStudents: new Set<string>(),
    };
    const totalChecks = item.wrongCount + item.correctCount;
    const wrongRatePercent =
      totalChecks > 0 ? Math.round((item.wrongCount / totalChecks) * 100) : 0;

    return {
      question,
      wrongCount: item.wrongCount,
      correctCount: item.correctCount,
      totalChecks,
      wrongRatePercent,
      studentsCurrentlyStruggling: item.strugglingStudents.size,
    };
  });

  // Sắp xếp ưu tiên: Số lượt làm sai giảm dần -> Tỷ lệ % sai giảm dần
  return result.sort((a, b) => {
    if (b.wrongCount !== a.wrongCount) return b.wrongCount - a.wrongCount;
    if (b.wrongRatePercent !== a.wrongRatePercent) {
      return b.wrongRatePercent - a.wrongRatePercent;
    }
    return a.question.id.localeCompare(b.question.id, undefined, {
      numeric: true,
    });
  });
}

/**
 * Tính toán toàn bộ dữ liệu Phân tích Năng lực Lớp học theo Chuyên đề & Dạng câu hỏi
 */
export function computeClassAnalytics(
  questions: Question[],
  users: UserAccount[],
  attempts: ExamAttempt[]
): ClassAnalyticsSummary {
  const studentRows = computeStudentProgressRows(users, attempts);
  const trapQuestions = computeTopTrapQuestions(questions, users, attempts);

  const trapByQuestionId = new Map<string, TrapQuestionStat>(
    trapQuestions.map((t) => [t.question.id, t])
  );

  // 1. Năng lực trung bình theo 4 Chuyên đề Certiport
  const topicCompetency: ClassCompetencyBar[] = CERTIPORT_TOPICS.map(
    (topic) => {
      const qs = questions.filter((q) => q.topic === topic);
      let totalChecks = 0;
      let correctChecks = 0;
      let wrongChecks = 0;

      for (const q of qs) {
        const st = trapByQuestionId.get(q.id);
        if (st) {
          totalChecks += st.totalChecks;
          correctChecks += st.correctCount;
          wrongChecks += st.wrongCount;
        }
      }

      const accuracyPercent =
        totalChecks > 0 ? Math.round((correctChecks / totalChecks) * 100) : 0;

      return {
        key: topic,
        label: topic,
        questionCountInBank: qs.length,
        totalChecks,
        correctChecks,
        wrongChecks,
        accuracyPercent,
      };
    }
  );

  // 2. Năng lực trung bình theo 5 Dạng câu hỏi
  const questionTypes: QuestionType[] = [
    'mcq_single',
    'mcq_multiple',
    'dropdown',
    'matching',
    'ordering',
  ];

  const typeCompetency: ClassCompetencyBar[] = questionTypes.map((typeKey) => {
    const qs = questions.filter((q) => q.type === typeKey);
    let totalChecks = 0;
    let correctChecks = 0;
    let wrongChecks = 0;

    for (const q of qs) {
      const st = trapByQuestionId.get(q.id);
      if (st) {
        totalChecks += st.totalChecks;
        correctChecks += st.correctCount;
        wrongChecks += st.wrongCount;
      }
    }

    const accuracyPercent =
      totalChecks > 0 ? Math.round((correctChecks / totalChecks) * 100) : 0;

    return {
      key: typeKey,
      label: QUESTION_TYPE_LABELS[typeKey],
      questionCountInBank: qs.length,
      totalChecks,
      correctChecks,
      wrongChecks,
      accuracyPercent,
    };
  });

  const attemptScores = attempts.map(getAttemptCertiportScore);
  const classAverageScore1000 =
    attemptScores.length > 0
      ? Math.round(
          attemptScores.reduce((acc, s) => acc + s, 0) / attemptScores.length
        )
      : 0;
  const classPassRatePercent =
    attemptScores.length > 0
      ? Math.round(
          (attemptScores.filter((s) => s >= 700).length /
            attemptScores.length) *
            100
        )
      : 0;

  const totalActiveStudents = studentRows.filter(
    (r) =>
      r.student.activeStatus === 'online' ||
      r.student.activeStatus === 'studying' ||
      r.student.status === 'online' ||
      r.student.status === 'studying'
  ).length;

  return {
    studentRows,
    trapQuestions,
    topicCompetency,
    typeCompetency,
    classAverageScore1000,
    classPassRatePercent,
    totalActiveStudents,
  };
}

// ============================================================================
// NHẬP DANH SÁCH HỌC SINH HÀNG LOẠT TỪ EXCEL (.XLSX)
// ============================================================================

export function buildSampleStudentImportExcelBytes(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const sampleStudents = [
    {
      'Mã học sinh (Username)': 'HS003',
      'Họ và tên (FullName)': 'Lê Thị Bảo Ngọc',
      'Mật khẩu (Password)': '123456',
      'Lớp / Đội tuyển (ClassName)': 'Lớp 12A1 - Đội tuyển GenAI',
    },
    {
      'Mã học sinh (Username)': 'HS004',
      'Họ và tên (FullName)': 'Phạm Quốc Khánh',
      'Mật khẩu (Password)': '123456',
      'Lớp / Đội tuyển (ClassName)': 'Lớp 12A1 - Đội tuyển GenAI',
    },
    {
      'Mã học sinh (Username)': 'HS005',
      'Họ và tên (FullName)': 'Đặng Hoàng Minh',
      'Mật khẩu (Password)': '123456',
      'Lớp / Đội tuyển (ClassName)': 'Lớp 12A2 - CLB AI',
    },
  ];
  const ws = XLSX.utils.json_to_sheet(sampleStudents);
  ws['!cols'] = [{ wch: 24 }, { wch: 28 }, { wch: 20 }, { wch: 30 }];
  XLSX.utils.book_append_sheet(wb, ws, 'DanhSachHocSinh');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}

function getField(row: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const val = row[k];
    if (val !== undefined && val !== null && String(val).trim() !== '') {
      return String(val).trim();
    }
  }
  return '';
}

export function parseStudentsFromExcelBytes(
  bytes: ArrayBuffer | Uint8Array
): UserAccount[] {
  const wb = XLSX.read(bytes, { type: 'array' });
  const firstSheet = wb.SheetNames[0];
  if (!firstSheet) {
    throw new Error('File Excel không có trang tính nào.');
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets[firstSheet],
    { defval: '' }
  );

  if (rows.length === 0) {
    throw new Error('File Excel danh sách học sinh đang trống.');
  }

  const accounts: UserAccount[] = [];
  const nowIso = new Date().toISOString();

  rows.forEach((row) => {
    const rawId = getField(row, [
      'Mã học sinh (Username)',
      'Mã học sinh',
      'Mã HS',
      'Username',
      'username',
      'ID',
      'id',
    ]);
    const fullName = getField(row, [
      'Họ và tên (FullName)',
      'Họ và tên',
      'Họ tên',
      'FullName',
      'fullName',
    ]);
    if (!rawId || !fullName) return;

    const cleanId = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
    if (!cleanId) return;

    const password =
      getField(row, [
        'Mật khẩu (Password)',
        'Mật khẩu',
        'Password',
        'password',
      ]) || '123456';

    const className =
      getField(row, [
        'Lớp / Đội tuyển (ClassName)',
        'Lớp / Đội tuyển',
        'Lớp',
        'ClassName',
        'className',
      ]) || 'Lớp Luyện thi Certiport GenAI';

    accounts.push({
      id: cleanId,
      username: cleanId,
      password,
      fullName,
      role: 'student',
      className,
      lastLogin: nowIso,
      status: 'offline',
      activeStatus: 'offline',
      totalStudyMinutes: 0,
      totalStudySeconds: 0,
      bookmarkedQuestions: [],
      wrongQuestions: [],
      masteredQuestions: [],
      practiceProgress: {},
      createdAt: nowIso,
    });
  });

  if (accounts.length === 0) {
    throw new Error(
      'Không tìm thấy dòng học sinh hợp lệ (cần có cột Mã học sinh và Họ và tên).'
    );
  }

  return accounts;
}

// ============================================================================
// XUẤT BÁO CÁO KẾT QUẢ LỚP HỌC (.XLSX) GỒM 3 SHEET CHUẨN HỒ SƠ GIẢNG DẠY
// ============================================================================

export function buildClassReportWorkbookBytes(
  questions: Question[],
  users: UserAccount[],
  attempts: ExamAttempt[]
): Uint8Array {
  const analytics = computeClassAnalytics(questions, users, attempts);
  const wb = XLSX.utils.book_new();

  // SHEET 1: Tổng hợp kết quả học sinh
  const sheet1Rows = analytics.studentRows.map((row, idx) => ({
    STT: idx + 1,
    'Mã HS': row.student.username,
    'Họ và tên': row.student.fullName,
    Lớp: row.student.className || 'Lớp Luyện thi Certiport',
    'Trạng thái':
      row.student.activeStatus === 'online' ||
      row.student.activeStatus === 'studying'
        ? 'Đang trực tuyến'
        : 'Ngoại tuyến',
    'Lần đăng nhập cuối': new Date(row.student.lastLogin).toLocaleString(
      'vi-VN'
    ),
    'Tổng TG ôn tập (phút)': Math.round(
      (row.student.totalStudySeconds || 0) / 60
    ),
    'Số câu đã luyện': row.practicedCount,
    'Số câu còn trong Kho câu sai': row.wrongPoolCount,
    'Số đề đã thi': row.attemptCount,
    'Điểm cao nhất (/1000)': row.highestScore1000,
    'Điểm trung bình (/1000)': row.averageScore1000,
    'Đánh giá chuẩn Certiport':
      row.highestScore1000 >= 700
        ? 'ĐẠT (PASS >= 700)'
        : row.attemptCount > 0
          ? 'CHƯA ĐẠT (< 700)'
          : 'Chưa thi thử',
  }));
  const ws1 = XLSX.utils.json_to_sheet(sheet1Rows);
  ws1['!cols'] = [
    { wch: 6 },
    { wch: 12 },
    { wch: 24 },
    { wch: 24 },
    { wch: 16 },
    { wch: 22 },
    { wch: 20 },
    { wch: 16 },
    { wch: 24 },
    { wch: 14 },
    { wch: 20 },
    { wch: 22 },
    { wch: 22 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'TongHopKetQuaHocSinh');

  // SHEET 2: Chi tiết lịch sử thi thử
  const sheet2Rows = attempts.map((att, idx) => {
    const cScore = getAttemptCertiportScore(att);
    return {
      STT: idx + 1,
      'Mã lượt thi': att.id,
      'Ngày giờ nộp bài': new Date(att.completedAt).toLocaleString('vi-VN'),
      'Mã HS': att.username,
      'Họ và tên': att.fullName,
      'Chế độ / Bộ đề': att.mode || att.examSet,
      'Số câu đúng': `${att.score ?? att.correctCount} / ${att.totalQuestions}`,
      'Tỷ lệ đúng (%)':
        att.percentage ??
        Math.round(
          ((att.score ?? att.correctCount) / Math.max(1, att.totalQuestions)) *
            100
        ),
      'Điểm quy đổi Certiport (/1000)': cScore,
      'Thời gian làm bài (giây)': att.durationSeconds,
      'Kết quả': cScore >= 700 ? 'PASS (Đạt)' : 'FAIL (Chưa đạt)',
    };
  });
  const ws2 = XLSX.utils.json_to_sheet(
    sheet2Rows.length > 0
      ? sheet2Rows
      : [
          {
            STT: 1,
            'Mã lượt thi': '-',
            'Ngày giờ nộp bài': '-',
            'Mã HS': '-',
            'Họ và tên': 'Chưa có lượt thi thử nào',
            'Chế độ / Bộ đề': '-',
            'Số câu đúng': '0 / 0',
            'Tỷ lệ đúng (%)': 0,
            'Điểm quy đổi Certiport (/1000)': 0,
            'Thời gian làm bài (giây)': 0,
            'Kết quả': '-',
          },
        ]
  );
  ws2['!cols'] = [
    { wch: 6 },
    { wch: 22 },
    { wch: 22 },
    { wch: 12 },
    { wch: 24 },
    { wch: 30 },
    { wch: 14 },
    { wch: 15 },
    { wch: 26 },
    { wch: 20 },
    { wch: 16 },
  ];
  XLSX.utils.book_append_sheet(wb, ws2, 'ChiTietLichSuThiThu');

  // SHEET 3: Thống kê câu hỏi hay sai
  const sheet3Rows = analytics.trapQuestions.map((trap, idx) => ({
    'Hạng độ khó': idx + 1,
    'Mã câu hỏi': trap.question.id.toUpperCase(),
    'Mã đề': String(trap.question.examSet),
    'Chuyên đề': String(trap.question.topic),
    'Dạng câu hỏi': QUESTION_TYPE_LABELS[trap.question.type],
    'Nội dung câu hỏi': trap.question.prompt,
    'Số lượt làm sai': trap.wrongCount,
    'Tổng số lượt trả lời': trap.totalChecks,
    'Tỷ lệ trả lời sai (%)': trap.wrongRatePercent,
    'Số HS đang vướng trong Kho câu sai': trap.studentsCurrentlyStruggling,
    'Giải thích đáp án chuẩn': trap.question.explanation,
  }));
  const ws3 = XLSX.utils.json_to_sheet(sheet3Rows);
  ws3['!cols'] = [
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
    { wch: 28 },
    { wch: 28 },
    { wch: 52 },
    { wch: 16 },
    { wch: 18 },
    { wch: 20 },
    { wch: 28 },
    { wch: 46 },
  ];
  XLSX.utils.book_append_sheet(wb, ws3, 'ThongKeCauHoiHaySai');

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Uint8Array(out);
}
