export type UserRole = 'teacher' | 'student';

export type ActiveStatus = 'online' | 'studying' | 'offline' | 'in_exam';
export type UserStatus = ActiveStatus;

export interface PracticeQuestionStat {
  answeredAt: string;
  isCorrect: boolean;
  attemptsCount: number;
}

export interface UserAccount {
  id: string;
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
  className?: string;
  lastLogin: string;
  status: UserStatus;
  activeStatus?: ActiveStatus;
  totalStudyMinutes: number;
  totalStudySeconds?: number;
  completedExams?: number;
  bestScore?: number;
  bookmarkedQuestions?: string[];
  wrongQuestions?: string[];
  masteredQuestions?: string[];
  practiceProgress?: Record<string, PracticeQuestionStat>;
  createdAt?: string;
}

export type QuestionType =
  | 'mcq_single'
  | 'mcq_multiple'
  | 'dropdown'
  | 'matching'
  | 'ordering';

export type QuestionTypeFilter =
  | 'ALL'
  | 'mcq'
  | 'mcq_single'
  | 'mcq_multiple'
  | 'dropdown'
  | 'matching'
  | 'ordering';

export type CertiportTopic =
  | '1. Tổng quan & Mô hình GenAI'
  | '2. Kỹ thuật viết Prompt'
  | '3. Đạo đức, Pháp lý & Bảo mật'
  | '4. Ứng dụng & Công cụ thực tế';

export type TopicCategory = CertiportTopic;

export type ExamSet = 'Đề 1' | 'Đề 2' | 'Đề 3' | 'Đề 4' | 'Đề 5';
export type ExamSetId = ExamSet;

export interface QuestionOption {
  id: string;
  text: string;
}
export type McqOption = QuestionOption;

export interface DropdownSubItem {
  id: string;
  statement: string;
  choices: string[];
  options?: string[];
}

export interface MatchingPair {
  id: string;
  left: string;
  right: string;
}

export interface OrderingStep {
  id: string;
  text: string;
}

export type CorrectAnswerValue =
  | string
  | string[]
  | Record<string, string>;

export type QuestionAnswer = CorrectAnswerValue;
export type UserAnswer = CorrectAnswerValue;

export interface Question {
  id: string;
  type: QuestionType;
  topic: CertiportTopic | string;
  examSet: ExamSet | string;
  prompt: string;
  instruction?: string;
  imageUrl?: string;
  options?: QuestionOption[];
  maxSelect?: number;
  maxSelections?: number;
  subItems?: DropdownSubItem[];
  dropdownOptions?: string[];
  dropdownColumns?: [string, string];
  pairs?: MatchingPair[];
  steps?: OrderingStep[];
  correctAnswer: CorrectAnswerValue;
  explanation: string;
  createdAt?: string;
}

export interface MockExamQuestionResult {
  questionId: string;
  orderNumber: number;
  topic: string;
  type: QuestionType;
  prompt: string;
  answered: boolean;
  flagged: boolean;
  isCorrect: boolean;
  userAnswer: UserAnswer | null;
}

export interface BreakdownStatItem {
  key: string;
  label: string;
  correct: number;
  total: number;
  percentage: number;
}

export interface ExamAttempt {
  id: string;
  userId?: string;
  username: string;
  fullName: string;
  examSet: string;
  mode?: string;
  correctCount: number;
  score?: number;
  totalQuestions: number;
  certiportScore: number;
  percentage?: number;
  passed?: boolean;
  wrongQuestionIds?: string[];
  questionOrderIds?: string[];
  questionResults?: MockExamQuestionResult[];
  topicBreakdown?: BreakdownStatItem[];
  typeBreakdown?: BreakdownStatItem[];
  durationSeconds: number;
  timeLimitSeconds?: number;
  autoSubmittedOnTimeout?: boolean;
  completedAt: string;
}

export const CERTIPORT_TOPICS: CertiportTopic[] = [
  '1. Tổng quan & Mô hình GenAI',
  '2. Kỹ thuật viết Prompt',
  '3. Đạo đức, Pháp lý & Bảo mật',
  '4. Ứng dụng & Công cụ thực tế',
];

export const EXAM_SETS: ExamSet[] = ['Đề 1', 'Đề 2', 'Đề 3', 'Đề 4', 'Đề 5'];

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  mcq_single: 'Trắc nghiệm 1 đáp án (Radio)',
  mcq_multiple: 'Trắc nghiệm nhiều đáp án (Checkbox)',
  dropdown: 'Menu thả xuống (- Select -)',
  matching: 'Kéo thả nối câu (Puzzle Matching)',
  ordering: 'Sắp xếp thứ tự (Ordering)',
};

export const QUESTION_FILTER_OPTIONS: { value: QuestionTypeFilter; label: string }[] = [
  { value: 'ALL', label: 'Tất cả 4 dạng bài tập' },
  { value: 'mcq', label: 'Dạng 1: Trắc nghiệm (1 hoặc nhiều lựa chọn)' },
  { value: 'dropdown', label: 'Dạng 2: Menu thả xuống (- Select -)' },
  { value: 'matching', label: 'Dạng 3: Kéo thả nối câu (Puzzle Matching)' },
  { value: 'ordering', label: 'Dạng 4: Sắp xếp thứ tự (Ordering)' },
  { value: 'mcq_single', label: '↳ Chỉ Trắc nghiệm 1 đáp án (Radio)' },
  { value: 'mcq_multiple', label: '↳ Chỉ Trắc nghiệm nhiều đáp án (Checkbox)' },
];

export const MOCK_EXAM_MAX_QUESTIONS = 45;
export const MOCK_EXAM_DURATION_SECONDS = 50 * 60; // 50 phút = 3000 giây
export const MOCK_EXAM_WARNING_THRESHOLD_SECONDS = 5 * 60; // Cảnh báo đỏ khi còn < 5 phút (300 giây)
export const CERTIPORT_PASS_SCORE = 700; // >= 700/1000 là ĐẠT (PASS)
