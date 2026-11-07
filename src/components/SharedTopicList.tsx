import React from 'react';
import { CERTIPORT_TOPICS, Question } from '../types/exam';
import { getShortTopicName } from '../utils/uiFormatting';

interface SharedTopicListProps {
  questions: Question[];
  practiceProgress?: Record<string, unknown>;
  onSelectTopicPractice: (topic: string) => void;
}

export const SharedTopicList: React.FC<SharedTopicListProps> = ({
  questions,
  practiceProgress = {},
  onSelectTopicPractice,
}) => {
  const totalBankCount = questions.length;

  return (
    <div
      data-testid="shared-topic-list"
      className="divide-y divide-[var(--color-border-subtle)] border-y border-[var(--color-border-subtle)]"
    >
      {CERTIPORT_TOPICS.map((topic) => {
        const topicQuestions = questions.filter((q) => q.topic === topic);
        const count = topicQuestions.length;
        const weightPercent =
          totalBankCount > 0 ? Math.round((count / totalBankCount) * 100) : 0;
        const practicedCount = topicQuestions.filter(
          (q) => practiceProgress[q.id] !== undefined
        ).length;
        const shortName = getShortTopicName(topic);
        const tooltipText =
          practicedCount > 0
            ? `Tỉ trọng đề: ${weightPercent}% (${count} câu) — Đã luyện ${practicedCount}/${count} câu`
            : `Tỉ trọng trong ngân hàng: ${weightPercent}% (${count} câu)`;

        return (
          <div
            key={topic}
            title={tooltipText}
            className="group py-3.5 flex items-center justify-between gap-4 transition-colors duration-150"
          >
            {/* Tên chuyên đề rút gọn */}
            <div className="min-w-0 flex-1 flex items-center gap-4">
              <span className="text-[15px] font-medium text-[var(--color-text-primary)]">
                {shortName}
              </span>

              {/* Thanh tiến độ mảnh thể hiện tỉ trọng ngân hàng (kèm tooltip %) */}
              <div
                aria-label={tooltipText}
                className="hidden sm:block w-28 md:w-36 h-1.5 rounded-full bg-slate-200/80 dark:bg-slate-800 overflow-hidden shrink-0"
              >
                <div
                  className="h-full rounded-full bg-teal-700 dark:bg-teal-500 transition-all duration-150"
                  style={{ width: `${Math.max(4, weightPercent)}%` }}
                />
              </div>
            </div>

            {/* Số câu canh phải + Liên kết chữ "Luyện" cuối hàng */}
            <div className="flex items-center gap-4 shrink-0 tabular-nums">
              <span className="text-[15px] text-[var(--color-text-muted)] text-right min-w-[60px]">
                {count} câu
              </span>

              <button
                type="button"
                disabled={count === 0}
                onClick={() => onSelectTopicPractice(topic)}
                className="text-[15px] font-semibold text-teal-700 dark:text-teal-400 hover:underline disabled:opacity-40 cursor-pointer opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100 transition-opacity duration-150"
              >
                Luyện
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
};
