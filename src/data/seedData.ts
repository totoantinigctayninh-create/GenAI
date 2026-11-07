import type { ExamAttempt, Question, UserAccount } from '../types/exam.ts';

/**
 * Tài khoản Quản trị viên mặc định duy nhất để Giáo viên đăng nhập quản lý hệ thống.
 * Toàn bộ dữ liệu ảo (học sinh mẫu HS001/HS002, câu hỏi mẫu q1..q8, lịch sử thi mẫu ATT_001/ATT_002) đã được xóa bỏ hoàn toàn.
 */
export const DEFAULT_ADMIN_ACCOUNT: UserAccount = {
  id: 'admin',
  username: 'admin',
  password: 'admin123',
  fullName: 'Giáo viên Quản trị',
  role: 'teacher',
  className: 'Hội đồng Khảo thí Certiport',
  lastLogin: new Date().toISOString(),
  status: 'online',
  activeStatus: 'online',
  totalStudyMinutes: 0,
  totalStudySeconds: 0,
  completedExams: 0,
  bestScore: 0,
  bookmarkedQuestions: [],
  wrongQuestions: [],
  masteredQuestions: [],
  practiceProgress: {},
  createdAt: '2026-11-01T00:00:00.000Z',
};

export const SEED_USERS: UserAccount[] = [DEFAULT_ADMIN_ACCOUNT];

export const SEED_QUESTIONS: Question[] = [];

export const SEED_ATTEMPTS: ExamAttempt[] = [];

/**
 * Danh sách ID dữ liệu ảo cũ dùng để tự động dọn sạch khỏi Firestore & bộ nhớ trình duyệt
 */
export const LEGACY_SEED_USER_IDS = ['HS001', 'HS002'];
export const LEGACY_SEED_QUESTION_IDS = [
  'q1',
  'q2',
  'q3',
  'q4',
  'q5',
  'q6',
  'q7',
  'q8',
];
export const LEGACY_SEED_ATTEMPT_IDS = ['ATT_001', 'ATT_002'];
export const LEGACY_SEED_CREATED_PREFIX = '2026-10-25T08:';

// ============================================================================
// DỮ LIỆU KIỂM THỬ ĐƠN VỊ (CHỈ SỬ DỤNG TRONG CÁC FILE UNIT TEST *.test.ts)
// ============================================================================
export const TEST_FIXTURE_USERS: UserAccount[] = [
  DEFAULT_ADMIN_ACCOUNT,
  {
    id: 'HS001',
    username: 'HS001',
    password: '123456',
    fullName: 'Nguyễn Minh Anh',
    role: 'student',
    className: 'Lớp 12A1 - Đội tuyển GenAI',
    lastLogin: '2026-11-01T14:20:00.000Z',
    status: 'online',
    activeStatus: 'online',
    totalStudyMinutes: 46,
    totalStudySeconds: 2740,
    completedExams: 4,
    bestScore: 875,
    bookmarkedQuestions: ['q1', 'q6'],
    wrongQuestions: ['q4', 'q7'],
    masteredQuestions: ['q3'],
    practiceProgress: {
      q1: {
        answeredAt: '2026-11-01T14:10:00.000Z',
        isCorrect: true,
        attemptsCount: 1,
      },
      q4: {
        answeredAt: '2026-11-01T14:12:00.000Z',
        isCorrect: false,
        attemptsCount: 2,
      },
      q7: {
        answeredAt: '2026-11-01T14:14:00.000Z',
        isCorrect: false,
        attemptsCount: 1,
      },
    },
    createdAt: '2026-10-20T08:00:00.000Z',
  },
  {
    id: 'HS002',
    username: 'HS002',
    password: '123456',
    fullName: 'Trần Hoàng Nam',
    role: 'student',
    className: 'Lớp 12A2 - Tin học Ứng dụng',
    lastLogin: '2026-11-01T10:30:00.000Z',
    status: 'offline',
    activeStatus: 'offline',
    totalStudyMinutes: 32,
    totalStudySeconds: 1920,
    completedExams: 2,
    bestScore: 750,
    bookmarkedQuestions: ['q2'],
    wrongQuestions: ['q6', 'q8'],
    masteredQuestions: [],
    practiceProgress: {
      q6: {
        answeredAt: '2026-10-31T09:05:00.000Z',
        isCorrect: false,
        attemptsCount: 1,
      },
      q8: {
        answeredAt: '2026-10-31T09:08:00.000Z',
        isCorrect: false,
        attemptsCount: 1,
      },
    },
    createdAt: '2026-10-20T08:30:00.000Z',
  },
];

export const TEST_FIXTURE_QUESTIONS: Question[] = [
  {
    id: 'q1',
    type: 'dropdown',
    topic: '3. Đạo đức, Pháp lý & Bảo mật',
    examSet: 'Ngân hàng chung',
    prompt:
      'Đánh giá các tuyên bố sau về Trí tuệ nhân tạo (AI) và thị trường việc làm. Hãy chọn Yes nếu tuyên bố đúng hoặc No nếu tuyên bố sai cho từng nhận định dưới đây:',
    instruction:
      'Lưu ý chuẩn Certiport: Bạn phải chọn đúng tất cả các mệnh đề trong bảng mới nhận được điểm của câu hỏi này.',
    dropdownOptions: ['Yes', 'No'],
    dropdownColumns: [
      'Tuyên bố nhận định về AI & Thị trường việc làm',
      'Đánh giá (Yes / No)',
    ],
    subItems: [
      {
        id: 'q1_s1',
        statement: 'Có nỗi sợ rằng AI sẽ tiếp quản việc làm và nhân loại',
        choices: ['Yes', 'No'],
        options: ['Yes', 'No'],
      },
      {
        id: 'q1_s2',
        statement: 'AI có thể đóng vai trò như một công cụ tạo việc làm',
        choices: ['Yes', 'No'],
        options: ['Yes', 'No'],
      },
      {
        id: 'q1_s3',
        statement: 'Mọi công việc cuối cùng sẽ được điều hành bởi AI',
        choices: ['Yes', 'No'],
        options: ['Yes', 'No'],
      },
    ],
    correctAnswer: {
      q1_s1: 'Yes',
      q1_s2: 'Yes',
      q1_s3: 'No',
    },
    explanation:
      'Trong xã hội tồn tại tâm lý lo ngại AI thay thế con người (Yes), đồng thời AI cũng tạo ra nhiều ngành nghề mới và hỗ trợ năng suất (Yes). Tuy nhiên, AI không thể điều hành mọi công việc vì nhiều lĩnh vực đòi hỏi sự thấu cảm, phán đoán đạo đức và kỹ năng con người (No).',
    createdAt: '2026-10-25T08:00:00.000Z',
  },
  {
    id: 'q2',
    type: 'dropdown',
    topic: '1. Tổng quan & Mô hình GenAI',
    examSet: 'Ngân hàng chung',
    prompt:
      'Hãy phân loại từng mô hình AI tạo sinh dưới đây thuộc nhóm "Mô hình văn bản" hay "Mô hình hình ảnh" bằng cách chọn giá trị tương ứng ở menu thả xuống:',
    instruction:
      'Chọn chính xác phân loại của cả 4 mô hình từ menu thả xuống (- Select -).',
    dropdownOptions: ['Mô hình văn bản', 'Mô hình hình ảnh'],
    dropdownColumns: [
      'Tên công cụ / Mô hình AI tạo sinh',
      'Loại mô hình chuẩn',
    ],
    subItems: [
      {
        id: 'q2_s1',
        statement: 'OpenAI GPTx',
        choices: ['Mô hình văn bản', 'Mô hình hình ảnh'],
        options: ['Mô hình văn bản', 'Mô hình hình ảnh'],
      },
      {
        id: 'q2_s2',
        statement: 'Google Gemini',
        choices: ['Mô hình văn bản', 'Mô hình hình ảnh'],
        options: ['Mô hình văn bản', 'Mô hình hình ảnh'],
      },
      {
        id: 'q2_s3',
        statement: 'DALL-E',
        choices: ['Mô hình văn bản', 'Mô hình hình ảnh'],
        options: ['Mô hình văn bản', 'Mô hình hình ảnh'],
      },
      {
        id: 'q2_s4',
        statement: 'Adobe Firefly',
        choices: ['Mô hình văn bản', 'Mô hình hình ảnh'],
        options: ['Mô hình văn bản', 'Mô hình hình ảnh'],
      },
    ],
    correctAnswer: {
      q2_s1: 'Mô hình văn bản',
      q2_s2: 'Mô hình văn bản',
      q2_s3: 'Mô hình hình ảnh',
      q2_s4: 'Mô hình hình ảnh',
    },
    explanation:
      'OpenAI GPTx và Google Gemini là các mô hình ngôn ngữ lớn (LLM) chuyên xử lý và sinh văn bản, trong khi DALL-E (của OpenAI) và Adobe Firefly là các mô hình chuyên tạo và chỉnh sửa hình ảnh từ mô tả văn bản.',
    createdAt: '2026-10-25T08:05:00.000Z',
  },
  {
    id: 'q3',
    type: 'mcq_single',
    topic: '1. Tổng quan & Mô hình GenAI',
    examSet: 'Ngân hàng chung',
    prompt:
      'Việc sử dụng dữ liệu thay đổi nhanh chóng để tạo đầu ra khi sử dụng AI tạo sinh có ảnh hưởng gì?',
    instruction: 'Chọn 1 đáp án đúng nhất.',
    options: [
      {
        id: 'q3_opt1',
        text: 'Dữ liệu hiện tại trở nên lỗi thời',
      },
      {
        id: 'q3_opt2',
        text: 'Mô hình tự động xóa toàn bộ trọng số đã huấn luyện trước đó',
      },
      {
        id: 'q3_opt3',
        text: 'Chi phí phần cứng giảm xuống bằng không khi truy vấn',
      },
      {
        id: 'q3_opt4',
        text: 'Mô hình không cần bất kỳ câu lệnh (prompt) nào từ người dùng',
      },
    ],
    correctAnswer: 'q3_opt1',
    explanation:
      'Các mô hình AI tạo sinh được huấn luyện trên dữ liệu tính đến một thời điểm cắt (knowledge cutoff). Khi sử dụng dữ liệu biến đổi liên tục theo thời gian thực, dữ liệu hiện tại trong mô hình nhanh chóng trở nên lỗi thời.',
    createdAt: '2026-10-25T08:10:00.000Z',
  },
  {
    id: 'q4',
    type: 'mcq_multiple',
    topic: '4. Ứng dụng & Công cụ thực tế',
    examSet: 'Ngân hàng chung',
    prompt:
      'Một công ty giải trí đang tìm cách sử dụng AI tạo sinh để phát triển chiến dịch tiếp thị. Hai yếu tố nào cần cân nhắc khi lựa chọn công cụ? (Chọn 2)',
    instruction: 'Chọn chính xác 2 phương án đúng để đạt điểm câu hỏi này.',
    maxSelect: 2,
    maxSelections: 2,
    options: [
      {
        id: 'q4_opt1',
        text: 'Dễ sử dụng',
      },
      {
        id: 'q4_opt2',
        text: 'Chi phí',
      },
      {
        id: 'q4_opt3',
        text: 'Số lượng bóng bán dẫn bên trong bo mạch chủ máy trạm cá nhân',
      },
      {
        id: 'q4_opt4',
        text: 'Tốc độ quay của ổ cứng cơ học lưu trữ ngoại tuyến',
      },
    ],
    correctAnswer: ['q4_opt1', 'q4_opt2'],
    explanation:
      'Khi doanh nghiệp lựa chọn công cụ AI tạo sinh cho chiến dịch tiếp thị, tính "Dễ sử dụng" (khả năng tích hợp nhanh cho nhân sự) và "Chi phí" (ngân sách bản quyền/API) là hai tiêu chí cốt lõi chuẩn bài thi Certiport.',
    createdAt: '2026-10-25T08:15:00.000Z',
  },
  {
    id: 'q5',
    type: 'mcq_single',
    topic: '2. Kỹ thuật viết Prompt',
    examSet: 'Ngân hàng chung',
    prompt:
      'Bạn muốn sử dụng kỹ thuật nhắc ngược (reverse prompting) để AI tạo sơ yếu lý lịch (resume) với mức độ chi tiết phù hợp. Câu lệnh nào đạt mục tiêu tốt nhất?',
    instruction: 'Chọn 1 đáp án đúng nhất.',
    options: [
      {
        id: 'q5_opt1',
        text: 'Hỏi tôi về từng chi tiết chính cần thiết cho resume của tôi, sau đó sử dụng thông tin đó để tạo resume.',
      },
      {
        id: 'q5_opt2',
        text: 'Hãy viết ngay một resume bất kỳ cho kỹ sư phần mềm mà không cần hỏi thêm thông tin.',
      },
      {
        id: 'q5_opt3',
        text: 'Liệt kê định nghĩa của từ resume trong từ điển tiếng Anh.',
      },
      {
        id: 'q5_opt4',
        text: 'Dịch sơ yếu lý lịch có sẵn của tôi sang 5 ngôn ngữ khác nhau.',
      },
    ],
    correctAnswer: 'q5_opt1',
    explanation:
      'Kỹ thuật nhắc ngược (Reverse Prompting) yêu cầu mô hình AI chủ động đặt câu hỏi cho người dùng để thu thập đầy đủ ngữ cảnh và thông tin chi tiết trước khi tạo ra kết quả cuối cùng.',
    createdAt: '2026-10-25T08:20:00.000Z',
  },
  {
    id: 'q6',
    type: 'matching',
    topic: '4. Ứng dụng & Công cụ thực tế',
    examSet: 'Ngân hàng chung',
    prompt:
      'Hãy ghép từng kịch bản ứng dụng AI tạo sinh ở cột bên trái với loại mô hình chuyển đổi AI tương ứng ở cột bên phải:',
    instruction:
      'Chọn mảnh ghép ở cột phải gắn vào từng kịch bản ở cột trái sao cho khớp 100%.',
    pairs: [
      {
        id: 'q6_p1',
        left: 'Một đoạn lời dẫn biến thành nhân vật trên màn hình lồng tiếng',
        right: 'Âm thanh sang video (audio-to-video)',
      },
      {
        id: 'q6_p2',
        left: 'Chuyển ngữ một video',
        right: 'Video sang văn bản (video-to-text)',
      },
      {
        id: 'q6_p3',
        left: 'Nhập một cụm từ và tạo ra bức ảnh',
        right: 'Văn bản sang hình ảnh (text-to-image)',
      },
      {
        id: 'q6_p4',
        left: 'Nói vào ứng dụng ngôn ngữ nước ngoài và nhìn thấy bản dịch',
        right: 'Âm thanh sang văn bản (audio-to-text)',
      },
    ],
    correctAnswer: {
      q6_p1: 'Âm thanh sang video (audio-to-video)',
      q6_p2: 'Video sang văn bản (video-to-text)',
      q6_p3: 'Văn bản sang hình ảnh (text-to-image)',
      q6_p4: 'Âm thanh sang văn bản (audio-to-text)',
    },
    explanation:
      'Xác định đúng dạng đầu vào (Input) và đầu ra (Output): lời dẫn âm thanh tạo nhân vật hình ảnh chuyển động là audio-to-video; ghi phụ đề/chuyển ngữ từ video là video-to-text; nhập câu lệnh tạo ảnh là text-to-image; nói và hiển thị chữ dịch là audio-to-text.',
    createdAt: '2026-10-25T08:25:00.000Z',
  },
  {
    id: 'q7',
    type: 'matching',
    topic: '3. Đạo đức, Pháp lý & Bảo mật',
    examSet: 'Ngân hàng chung',
    prompt:
      'Hãy khớp từng vấn đề của đầu ra AI tạo sinh ở cột bên trái với đặc điểm mô tả chính xác ở cột bên phải:',
    instruction: 'Ghép đúng cả 3 cặp khái niệm để được tính điểm tuyệt đối.',
    pairs: [
      {
        id: 'q7_p1',
        left: 'Ảo giác (Hallucination)',
        right: 'Đầu ra không dựa trên dữ liệu đào tạo hoặc kiến thức tương tự',
      },
      {
        id: 'q7_p2',
        left: 'Thông tin sai lệch (Misinformation)',
        right: 'Đầu ra trình bày thông tin sai lệch là thực tế',
      },
      {
        id: 'q7_p3',
        left: 'Thiên vị (Bias)',
        right: 'Đầu ra có lợi cho những người có địa vị kinh tế xã hội nhất định',
      },
    ],
    correctAnswer: {
      q7_p1: 'Đầu ra không dựa trên dữ liệu đào tạo hoặc kiến thức tương tự',
      q7_p2: 'Đầu ra trình bày thông tin sai lệch là thực tế',
      q7_p3: 'Đầu ra có lợi cho những người có địa vị kinh tế xã hội nhất định',
    },
    explanation:
      'Ảo giác (Hallucination) là khi AI tự bịa ra nội dung không có trong dữ liệu huấn luyện; Thông tin sai lệch (Misinformation) là trình bày nội dung sai sự thật như một thực tế; Thiên vị (Bias) là sự ưu ái hoặc định kiến lệch lạc đối với một nhóm đối tượng nhất định.',
    createdAt: '2026-10-25T08:30:00.000Z',
  },
  {
    id: 'q8',
    type: 'ordering',
    topic: '1. Tổng quan & Mô hình GenAI',
    examSet: 'Ngân hàng chung',
    prompt:
      'Hãy sắp xếp các bước sau theo đúng thứ tự quy trình cơ bản từ đầu đến cuối để huấn luyện một mô hình ngôn ngữ lớn (LLM):',
    instruction:
      'Sử dụng nút Lên / Xuống để sắp xếp đúng thứ tự 4 bước quy trình huấn luyện LLM.',
    steps: [
      {
        id: 'q8_step1',
        text: 'Thu thập tập dữ liệu',
      },
      {
        id: 'q8_step2',
        text: 'Tiền xử lý và làm sạch tập dữ liệu',
      },
      {
        id: 'q8_step3',
        text: 'Chuẩn bị dữ liệu để đưa vào mô hình',
      },
      {
        id: 'q8_step4',
        text: 'Điều chỉnh các siêu tham số',
      },
    ],
    correctAnswer: ['q8_step1', 'q8_step2', 'q8_step3', 'q8_step4'],
    explanation:
      'Quy trình chuẩn huấn luyện LLM bắt đầu từ (1) Thu thập tập dữ liệu -> (2) Tiền xử lý và làm sạch tập dữ liệu -> (3) Chuẩn bị dữ liệu để đưa vào mô hình -> (4) Điều chỉnh các siêu tham số (hyperparameters) để tối ưu hiệu năng.',
    createdAt: '2026-10-25T08:35:00.000Z',
  },
];

export const TEST_FIXTURE_ATTEMPTS: ExamAttempt[] = [
  {
    id: 'ATT_001',
    userId: 'HS001',
    username: 'HS001',
    fullName: 'Nguyễn Minh Anh',
    examSet: 'Đề tổng hợp (8 câu chuẩn Certiport)',
    mode: 'full',
    correctCount: 7,
    score: 7,
    totalQuestions: 8,
    certiportScore: 875,
    percentage: 88,
    passed: true,
    durationSeconds: 410,
    completedAt: '2026-11-01T14:15:00.000Z',
  },
  {
    id: 'ATT_002',
    userId: 'HS002',
    username: 'HS002',
    fullName: 'Trần Hoàng Nam',
    examSet: 'Đề tổng hợp (8 câu chuẩn Certiport)',
    mode: 'full',
    correctCount: 6,
    score: 6,
    totalQuestions: 8,
    certiportScore: 750,
    percentage: 75,
    passed: true,
    durationSeconds: 525,
    completedAt: '2026-10-31T09:10:00.000Z',
  },
];
