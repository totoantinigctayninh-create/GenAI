import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Flag,
  LayoutGrid,
  X,
} from 'lucide-react';

export interface MobileNavQuestionItem {
  id: string;
  index: number;
  label: string;
  ariaLabel: string;
  cellClassName: string;
  isCurrent: boolean;
  isFlagged?: boolean;
  isBookmarked?: boolean;
  dataAnswered?: boolean;
}

export interface MobileNavLegendItem {
  key: string;
  label: string;
  swatchClassName?: string;
  isFlag?: boolean;
}

interface MobileQuestionNavBarProps {
  currentIndex: number;
  totalQuestions: number;
  summaryText: string;
  flaggedCount?: number;
  sheetTitle: string;
  legendItems: MobileNavLegendItem[];
  items: MobileNavQuestionItem[];
  onPrev: () => void;
  onNext: () => void;
  onSelectIndex: (index: number) => void;
  footerAction?: React.ReactNode;
  testIdPrefix: string;
}

export const MobileQuestionNavBar: React.FC<MobileQuestionNavBarProps> = ({
  currentIndex,
  totalQuestions,
  summaryText,
  flaggedCount = 0,
  sheetTitle,
  legendItems,
  items,
  onPrev,
  onNext,
  onSelectIndex,
  footerAction,
  testIdPrefix,
}) => {
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  useEffect(() => {
    if (!isSheetOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsSheetOpen(false);
      }
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSheetOpen]);

  if (totalQuestions <= 0) {
    return null;
  }

  const displayCurrent = Math.min(currentIndex + 1, totalQuestions);

  return (
    <>
      {/* Thanh điều hướng cố định đáy màn hình dành riêng cho điện thoại / máy tính bảng (< lg) */}
      <nav
        aria-label="Điều hướng câu hỏi di động"
        data-testid={`${testIdPrefix}-mobile-bottom-bar`}
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--color-bg-surface)]/95 backdrop-blur-md border-t border-[var(--color-border-subtle)] shadow-[0_-6px_20px_rgba(15,23,42,0.08)] pb-[env(safe-area-inset-bottom)]"
      >
        <div className="px-2 py-1.5 sm:px-3 sm:py-2 flex items-center justify-between gap-1.5 sm:gap-2 max-w-2xl mx-auto">
          <button
            type="button"
            data-testid={`${testIdPrefix}-mobile-prev-btn`}
            aria-label="Câu trước"
            disabled={currentIndex <= 0}
            onClick={onPrev}
            className="min-h-[44px] px-2 sm:px-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-[var(--color-bg-surface)] hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-40 text-[11px] sm:text-xs font-bold text-[var(--color-text-primary)] inline-flex items-center justify-center gap-0.5 sm:gap-1 shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
          >
            <ChevronLeft className="w-4 h-4 shrink-0" />
            <span>Câu trước</span>
          </button>

          <button
            type="button"
            data-testid={`${testIdPrefix}-mobile-grid-trigger`}
            aria-expanded={isSheetOpen}
            aria-controls={`${testIdPrefix}-mobile-sheet`}
            aria-label={`Mở lưới câu hỏi, đang ở câu ${displayCurrent} trên ${totalQuestions}`}
            onClick={() => setIsSheetOpen(true)}
            className="flex-1 min-w-0 min-h-[44px] px-1.5 sm:px-2.5 py-1 rounded-xl border border-teal-200 dark:border-teal-800 bg-teal-50/90 dark:bg-teal-950/60 hover:bg-teal-100/90 dark:hover:bg-teal-900/60 text-teal-900 dark:text-teal-100 flex flex-col items-center justify-center leading-tight transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-1 text-[11px] sm:text-xs font-extrabold tabular-nums whitespace-nowrap">
              <LayoutGrid className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 text-teal-700 dark:text-teal-300" />
              <span>
                Câu {displayCurrent}/{totalQuestions} · Lưới câu
              </span>
              <ChevronUp className="hidden sm:inline w-3.5 h-3.5 shrink-0 text-teal-700 dark:text-teal-300" />
            </span>
            <span className="text-[10px] sm:text-[11px] font-medium text-teal-800/85 dark:text-teal-200/85 tabular-nums truncate max-w-full">
              {summaryText}
              {flaggedCount > 0 ? ` · Cờ ${flaggedCount}` : ''}
            </span>
          </button>

          <button
            type="button"
            data-testid={`${testIdPrefix}-mobile-next-btn`}
            aria-label="Câu sau"
            disabled={currentIndex >= totalQuestions - 1}
            onClick={onNext}
            className="min-h-[44px] px-2 sm:px-3 rounded-xl bg-teal-700 hover:bg-teal-800 disabled:opacity-40 text-white text-[11px] sm:text-xs font-bold inline-flex items-center justify-center gap-0.5 sm:gap-1 shrink-0 transition-colors cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
          >
            <span>Câu sau</span>
            <ChevronRight className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </nav>

      {/* Ngăn kéo Bottom Sheet lưới câu hỏi cho thiết bị di động */}
      {isSheetOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={`${testIdPrefix}-mobile-sheet-title`}
          data-testid={`${testIdPrefix}-mobile-sheet-backdrop`}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setIsSheetOpen(false);
            }
          }}
          className="lg:hidden fixed inset-0 z-50 bg-slate-950/55 backdrop-blur-[1px] flex flex-col justify-end"
        >
          <div
            id={`${testIdPrefix}-mobile-sheet`}
            data-testid={`${testIdPrefix}-mobile-sheet`}
            className="bg-[var(--color-bg-surface)] border-t border-[var(--color-border-subtle)] rounded-t-3xl shadow-2xl max-h-[75vh] w-full flex flex-col overflow-hidden pb-[env(safe-area-inset-bottom)]"
          >
            {/* Thanh kéo thẩm mỹ */}
            <div className="pt-2.5 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-600" />
            </div>

            {/* Tiêu đề & nút đóng */}
            <div className="px-4 pb-2.5 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-2 shrink-0">
              <div className="min-w-0">
                <h2
                  id={`${testIdPrefix}-mobile-sheet-title`}
                  className="text-sm font-extrabold text-[var(--color-text-primary)] truncate"
                >
                  {sheetTitle}
                </h2>
                <p className="text-xs text-[var(--color-text-secondary)] tabular-nums">
                  {summaryText}
                  {flaggedCount > 0 ? ` · Đang gắn cờ: ${flaggedCount}` : ''}
                </p>
              </div>
              <button
                type="button"
                data-testid={`${testIdPrefix}-mobile-sheet-close`}
                aria-label="Đóng lưới câu hỏi"
                onClick={() => setIsSheetOpen(false)}
                className="min-w-[44px] min-h-[44px] rounded-xl text-[var(--color-text-secondary)] hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center shrink-0 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Chú giải trạng thái */}
            <div className="px-4 py-2 bg-slate-50/90 dark:bg-slate-800/60 border-b border-[var(--color-border-subtle)] flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[11px] text-[var(--color-text-secondary)] tabular-nums shrink-0">
              {legendItems.map((item) => (
                <span
                  key={item.key}
                  className="inline-flex items-center gap-1.5 font-medium"
                >
                  {item.isFlag ? (
                    <Flag className="w-3 h-3 fill-amber-400 text-amber-600 shrink-0" />
                  ) : (
                    <span
                      className={`w-2.5 h-2.5 rounded-xs shrink-0 ${item.swatchClassName || ''}`}
                    />
                  )}
                  <span>{item.label}</span>
                </span>
              ))}
            </div>

            {/* Lưới số câu hỏi cuộn mượt, ô bấm tối thiểu 44px */}
            <div className="px-4 py-3 overflow-y-auto flex-1">
              <div className="grid grid-cols-5 sm:grid-cols-7 gap-2">
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    data-testid={`${testIdPrefix}-mobile-nav-item-${item.index + 1}`}
                    data-current={item.isCurrent ? 'true' : 'false'}
                    data-answered={
                      typeof item.dataAnswered === 'boolean'
                        ? item.dataAnswered
                          ? 'true'
                          : 'false'
                        : undefined
                    }
                    aria-label={item.ariaLabel}
                    onClick={() => {
                      onSelectIndex(item.index);
                      setIsSheetOpen(false);
                    }}
                    className={`min-h-[44px] rounded-xl border text-sm font-mono tabular-nums flex items-center justify-center relative cursor-pointer transition-all ${item.cellClassName}`}
                  >
                    <span>{item.label}</span>
                    {item.isFlagged && (
                      <Flag className="w-3 h-3 fill-amber-400 text-amber-600 absolute -top-1 -right-1 drop-shadow-2xs" />
                    )}
                    {!item.isFlagged && item.isBookmarked && (
                      <span className="absolute top-0.5 right-1 text-[10px] text-amber-500 leading-none">
                        ★
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Hành động phụ ở chân ngăn kéo (nếu có, ví dụ Nộp bài) */}
            {footerAction && (
              <div
                onClick={() => setIsSheetOpen(false)}
                className="px-4 py-3 border-t border-[var(--color-border-subtle)] bg-[var(--color-bg-surface)] shrink-0"
              >
                {footerAction}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
};
