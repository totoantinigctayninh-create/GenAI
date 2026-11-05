import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMockExamQuestionPool,
  buildProportionalExamPool,
  computeUpdatedWrongQuestions,
  evaluateExamSet,
  evaluateQuestion,
  filterPracticeQuestions,
  formatCountdownClock,
  formatPracticeTimerLabel,
  getCorrectAnswerBreakdown,
  getUserAnswerBreakdown,
  isQuestionAnswered,
  resolvePracticeSessionPool,
} from './scoring';
import {
  SEED_ATTEMPTS,
  SEED_QUESTIONS,
  SEED_USERS,
  TEST_FIXTURE_QUESTIONS,
} from '../data/seedData';

const FIXTURE_QUESTIONS = TEST_FIXTURE_QUESTIONS;

test('All virtual seed data (SEED_QUESTIONS, SEED_ATTEMPTS, virtual students) is removed from live defaults', () => {
  assert.equal(SEED_QUESTIONS.length, 0);
  assert.equal(SEED_ATTEMPTS.length, 0);
  assert.equal(SEED_USERS.filter((u) => u.role === 'student').length, 0);
  assert.equal(SEED_USERS.length, 1);
  assert.equal(SEED_USERS[0].username, 'admin');
});

test('Certiport Question 1 (dropdown Yes/No): strict all-or-nothing evaluation', () => {
  const q1 = FIXTURE_QUESTIONS.find((q) => q.id === 'q1')!;
  assert.ok(q1);

  assert.equal(
    evaluateQuestion(q1, {
      q1_s1: 'Yes',
      q1_s2: 'Yes',
      q1_s3: 'No',
    }),
    true
  );

  assert.equal(
    evaluateQuestion(q1, {
      q1_s1: 'Yes',
      q1_s2: 'Yes',
      q1_s3: 'Yes',
    }),
    false
  );

  assert.equal(
    evaluateQuestion(q1, {
      q1_s1: 'Yes',
      q1_s2: 'Yes',
    }),
    false
  );
});

test('Certiport Question 2 (dropdown classification): strict all-or-nothing evaluation', () => {
  const q2 = FIXTURE_QUESTIONS.find((q) => q.id === 'q2')!;
  assert.ok(q2);

  assert.equal(
    evaluateQuestion(q2, {
      q2_s1: 'Mô hình văn bản',
      q2_s2: 'Mô hình văn bản',
      q2_s3: 'Mô hình hình ảnh',
      q2_s4: 'Mô hình hình ảnh',
    }),
    true
  );

  assert.equal(
    evaluateQuestion(q2, {
      q2_s1: 'Mô hình văn bản',
      q2_s2: 'Mô hình hình ảnh',
      q2_s3: 'Mô hình hình ảnh',
      q2_s4: 'Mô hình hình ảnh',
    }),
    false
  );
});

test('Certiport Question 3 & 5 (mcq_single): single choice accuracy', () => {
  const q3 = FIXTURE_QUESTIONS.find((q) => q.id === 'q3')!;
  const q5 = FIXTURE_QUESTIONS.find((q) => q.id === 'q5')!;

  assert.equal(evaluateQuestion(q3, 'q3_opt1'), true);
  assert.equal(evaluateQuestion(q3, 'q3_opt2'), false);
  assert.equal(evaluateQuestion(q3, ''), false);

  assert.equal(evaluateQuestion(q5, 'q5_opt1'), true);
  assert.equal(evaluateQuestion(q5, 'q5_opt3'), false);
});

test('Certiport Question 4 (mcq_multiple): must select both exact options', () => {
  const q4 = FIXTURE_QUESTIONS.find((q) => q.id === 'q4')!;

  assert.equal(evaluateQuestion(q4, ['q4_opt1', 'q4_opt2']), true);
  assert.equal(evaluateQuestion(q4, ['q4_opt2', 'q4_opt1']), true);
  assert.equal(evaluateQuestion(q4, ['q4_opt1']), false);
  assert.equal(evaluateQuestion(q4, ['q4_opt1', 'q4_opt3']), false);
  assert.equal(evaluateQuestion(q4, ['q4_opt1', 'q4_opt2', 'q4_opt3']), false);
});

test('Certiport Question 6 & 7 (matching): all puzzle pairs must match', () => {
  const q6 = FIXTURE_QUESTIONS.find((q) => q.id === 'q6')!;
  const q7 = FIXTURE_QUESTIONS.find((q) => q.id === 'q7')!;

  assert.equal(
    evaluateQuestion(q6, {
      q6_p1: 'Âm thanh sang video (audio-to-video)',
      q6_p2: 'Video sang văn bản (video-to-text)',
      q6_p3: 'Văn bản sang hình ảnh (text-to-image)',
      q6_p4: 'Âm thanh sang văn bản (audio-to-text)',
    }),
    true
  );

  assert.equal(
    evaluateQuestion(q6, {
      q6_p1: 'Video sang văn bản (video-to-text)',
      q6_p2: 'Âm thanh sang video (audio-to-video)',
      q6_p3: 'Văn bản sang hình ảnh (text-to-image)',
      q6_p4: 'Âm thanh sang văn bản (audio-to-text)',
    }),
    false
  );

  assert.equal(
    evaluateQuestion(q7, {
      q7_p1: 'Đầu ra không dựa trên dữ liệu đào tạo hoặc kiến thức tương tự',
      q7_p2: 'Đầu ra trình bày thông tin sai lệch là thực tế',
      q7_p3: 'Đầu ra có lợi cho những người có địa vị kinh tế xã hội nhất định',
    }),
    true
  );
});

test('Certiport Question 8 (ordering): exact LLM training sequence required', () => {
  const q8 = FIXTURE_QUESTIONS.find((q) => q.id === 'q8')!;

  assert.equal(
    evaluateQuestion(q8, ['q8_step1', 'q8_step2', 'q8_step3', 'q8_step4']),
    true
  );
  assert.equal(
    evaluateQuestion(q8, ['q8_step1', 'q8_step3', 'q8_step2', 'q8_step4']),
    false
  );
  assert.equal(evaluateQuestion(q8, ['q8_step1', 'q8_step2', 'q8_step3']), false);
});

test('evaluateExamSet computes Certiport 1000-point scale, topic/type breakdowns, and questionResults', () => {
  const perfectAnswers = {
    q1: { q1_s1: 'Yes', q1_s2: 'Yes', q1_s3: 'No' },
    q2: {
      q2_s1: 'Mô hình văn bản',
      q2_s2: 'Mô hình văn bản',
      q2_s3: 'Mô hình hình ảnh',
      q2_s4: 'Mô hình hình ảnh',
    },
    q3: 'q3_opt1',
    q4: ['q4_opt1', 'q4_opt2'],
    q5: 'q5_opt1',
    q6: {
      q6_p1: 'Âm thanh sang video (audio-to-video)',
      q6_p2: 'Video sang văn bản (video-to-text)',
      q6_p3: 'Văn bản sang hình ảnh (text-to-image)',
      q6_p4: 'Âm thanh sang văn bản (audio-to-text)',
    },
    q7: {
      q7_p1: 'Đầu ra không dựa trên dữ liệu đào tạo hoặc kiến thức tương tự',
      q7_p2: 'Đầu ra trình bày thông tin sai lệch là thực tế',
      q7_p3: 'Đầu ra có lợi cho những người có địa vị kinh tế xã hội nhất định',
    },
    q8: ['q8_step1', 'q8_step2', 'q8_step3', 'q8_step4'],
  };

  const summary = evaluateExamSet(FIXTURE_QUESTIONS, perfectAnswers, { q2: true });
  assert.equal(summary.score, 8);
  assert.equal(summary.totalQuestions, 8);
  assert.equal(summary.certiportScore, 1000);
  assert.equal(summary.percentage, 100);
  assert.equal(summary.passed, true);
  assert.equal(summary.answeredCount, 8);
  assert.equal(summary.unansweredCount, 0);
  assert.equal(summary.flaggedCount, 1);
  assert.deepEqual(summary.wrongQuestionIds, []);
  assert.equal(summary.questionResults.length, 8);
  assert.equal(summary.topicBreakdown.length, 4);
  assert.equal(summary.typeBreakdown.length, 5);

  for (const q of FIXTURE_QUESTIONS) {
    assert.equal(isQuestionAnswered(q, perfectAnswers[q.id as keyof typeof perfectAnswers]), true);
  }
});

test('getCorrectAnswerBreakdown and getUserAnswerBreakdown format answers for all 5 question types', () => {
  for (const q of FIXTURE_QUESTIONS) {
    const breakdown = getCorrectAnswerBreakdown(q);
    assert.ok(breakdown.length >= 1);
    const userBreakdown = getUserAnswerBreakdown(q, q.correctAnswer);
    assert.ok(userBreakdown.length >= 1);
  }
});

test('filterPracticeQuestions filters 3D criteria + bookmarks accurately', () => {
  const mcqOnly = filterPracticeQuestions(
    FIXTURE_QUESTIONS,
    { topic: 'ALL', questionType: 'mcq', examSet: 'ALL', onlyBookmarked: false },
    []
  );
  assert.equal(mcqOnly.length, 3);

  const bookmarked = filterPracticeQuestions(
    FIXTURE_QUESTIONS,
    { topic: 'ALL', questionType: 'ALL', examSet: 'ALL', onlyBookmarked: true },
    ['q1', 'q6']
  );
  assert.deepEqual(
    bookmarked.map((q) => q.id),
    ['q1', 'q6']
  );
});

test('computeUpdatedWrongQuestions tracks wrong answers and mastery transitions', () => {
  const step1 = computeUpdatedWrongQuestions(['q4'], ['q3'], 'q3', false, false);
  assert.deepEqual(step1.wrongQuestions, ['q4', 'q3']);
  assert.deepEqual(step1.masteredQuestions, []);

  const step2 = computeUpdatedWrongQuestions(
    step1.wrongQuestions,
    step1.masteredQuestions,
    'q4',
    true,
    true
  );
  assert.deepEqual(step2.wrongQuestions, ['q3']);
  assert.deepEqual(step2.masteredQuestions, ['q4']);
});

test('buildMockExamQuestionPool shuffles without mutating and respects 45-question cap', () => {
  const originalIds = FIXTURE_QUESTIONS.map((q) => q.id);
  const pool = buildMockExamQuestionPool(FIXTURE_QUESTIONS, 45);
  assert.equal(pool.length, FIXTURE_QUESTIONS.length);
  assert.deepEqual(
    FIXTURE_QUESTIONS.map((q) => q.id),
    originalIds
  );

  // If bank has > 45 items, caps at 45
  const largeBank = Array.from({ length: 60 }, (_, idx) => ({
    ...FIXTURE_QUESTIONS[idx % FIXTURE_QUESTIONS.length],
    id: `mock_q_${idx + 1}`,
  }));
  const cappedPool = buildMockExamQuestionPool(largeBank, 45);
  assert.equal(cappedPool.length, 45);
});

test('buildProportionalExamPool draws questions matching the exact topic ratios in the question bank', () => {
  // Create a 100-question bank with 40 / 30 / 20 / 10 distribution across the 4 topics
  const counts = [40, 30, 20, 10];
  const customBank = counts.flatMap((count, topicIdx) =>
    Array.from({ length: count }, (_, qIdx) => ({
      ...FIXTURE_QUESTIONS[0],
      id: `prop_t${topicIdx + 1}_q${qIdx + 1}`,
      topic: FIXTURE_QUESTIONS.find((s) => s.topic.startsWith(`${topicIdx + 1}.`))?.topic ?? `Topic ${topicIdx + 1}`,
    }))
  );

  const draw20 = buildProportionalExamPool(customBank, 20);
  assert.equal(draw20.questions.length, 20);
  assert.equal(draw20.totalBankSize, 100);
  assert.equal(draw20.targetCount, 20);

  // 40% of 20 = 8, 30% of 20 = 6, 20% of 20 = 4, 10% of 20 = 2
  const allocCounts = draw20.topicAllocations.map((a) => a.allocatedCount);
  assert.deepEqual(allocCounts, [8, 6, 4, 2]);
});

test('formatCountdownClock formats 50-minute timer accurately', () => {
  assert.equal(formatCountdownClock(3000), '50:00');
  assert.equal(formatCountdownClock(299), '04:59');
  assert.equal(formatCountdownClock(5), '00:05');
  assert.equal(formatCountdownClock(0), '00:00');
});

test('resolvePracticeSessionPool supports choosing ALL questions or a custom number of questions', () => {
  const allResult = resolvePracticeSessionPool(FIXTURE_QUESTIONS, {
    questionCountMode: 'ALL',
    customQuestionCount: 8,
    timeLimitMinutes: 0,
    shuffleQuestions: false,
    focusMode: true,
  });
  assert.equal(allResult.questions.length, FIXTURE_QUESTIONS.length);
  assert.deepEqual(
    allResult.questions.map((q) => q.id),
    FIXTURE_QUESTIONS.map((q) => q.id)
  );

  const customResult = resolvePracticeSessionPool(FIXTURE_QUESTIONS, {
    questionCountMode: 'CUSTOM',
    customQuestionCount: 4,
    timeLimitMinutes: 15,
    shuffleQuestions: true,
    focusMode: true,
  });
  assert.equal(customResult.questions.length, 4);
  assert.equal(customResult.targetCount, 4);
});

test('formatPracticeTimerLabel handles unlimited time (0 min) and countdown timers', () => {
  const unlimited = formatPracticeTimerLabel(0, 125);
  assert.equal(unlimited.isUnlimited, true);
  assert.equal(unlimited.displayClock, '02:05');
  assert.equal(unlimited.isWarning, false);
  assert.equal(unlimited.isExpired, false);

  const countdownNormal = formatPracticeTimerLabel(30, 600);
  assert.equal(countdownNormal.isUnlimited, false);
  assert.equal(countdownNormal.displayClock, '20:00');
  assert.equal(countdownNormal.isWarning, false);
  assert.equal(countdownNormal.isExpired, false);

  const countdownWarning = formatPracticeTimerLabel(30, 1600); // 200s remaining (< 300s)
  assert.equal(countdownWarning.isWarning, true);
  assert.equal(countdownWarning.isExpired, false);

  const countdownExpired = formatPracticeTimerLabel(15, 900);
  assert.equal(countdownExpired.isExpired, true);
  assert.equal(countdownExpired.displayClock, '00:00');
});


