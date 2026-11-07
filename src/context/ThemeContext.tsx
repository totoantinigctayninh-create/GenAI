import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';

export type ThemeMode = 'light' | 'dark';

const THEME_STORAGE_KEY = 'igc_genai_theme_mode_v1';

interface ThemeContextValue {
  theme: ThemeMode;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  isDark: false,
  toggleTheme: () => {},
  setTheme: () => {},
});

function getInitialTheme(): ThemeMode {
  try {
    const params = new URLSearchParams(window.location.search);
    const urlTheme = params.get('theme');
    if (urlTheme === 'dark' || urlTheme === 'light') {
      return urlTheme;
    }
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === 'dark' || saved === 'light') {
      return saved;
    }
  } catch {
    // Bỏ qua lỗi truy cập localStorage
  }
  return 'light';
}

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<ThemeMode>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
      root.setAttribute('data-theme', 'dark');
    } else {
      root.classList.remove('dark');
      root.setAttribute('data-theme', 'light');
    }
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Bỏ qua
    }
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => {
    setThemeState(mode);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark: theme === 'dark',
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

interface ThemeToggleButtonProps {
  variant?: 'sidebar' | 'compact' | 'floating';
  className?: string;
  testId?: string;
}

export const ThemeToggleButton: React.FC<ThemeToggleButtonProps> = ({
  variant = 'compact',
  className = '',
  testId = 'theme-toggle-btn',
}) => {
  const { isDark, toggleTheme } = useTheme();

  if (variant === 'sidebar') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={isDark}
        data-testid={testId}
        onClick={toggleTheme}
        title={isDark ? 'Chuyển sang giao diện sáng' : 'Chuyển sang giao diện tối'}
        className={`w-full px-3 py-2 text-[14px] font-medium rounded-lg border transition-colors inline-flex items-center justify-between gap-2 cursor-pointer ${
          isDark
            ? 'bg-slate-800 border-slate-700 text-slate-100 hover:bg-slate-700'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
        } ${className}`}
      >
        <span className="inline-flex items-center gap-2">
          {isDark ? (
            <Sun className="w-4 h-4 text-amber-400 shrink-0" />
          ) : (
            <Moon className="w-4 h-4 text-teal-700 shrink-0" />
          )}
          <span>Chế độ tối</span>
        </span>
        <span
          aria-hidden="true"
          className={`w-8 h-4.5 rounded-full p-0.5 transition-colors inline-flex items-center shrink-0 ${
            isDark ? 'bg-teal-600 justify-end' : 'bg-slate-300 justify-start'
          }`}
        >
          <span className="w-3.5 h-3.5 rounded-full bg-white shadow-xs" />
        </span>
      </button>
    );
  }

  if (variant === 'floating') {
    return (
      <button
        type="button"
        data-testid={testId}
        onClick={toggleTheme}
        title={
          isDark
            ? 'Chuyển sang Giao diện Sáng'
            : 'Chuyển sang Giao diện Tối (Giảm mỏi mắt khi ôn tập)'
        }
        className={`px-3.5 py-2 rounded-full border text-xs font-bold shadow-sm transition-all inline-flex items-center gap-2 cursor-pointer ${
          isDark
            ? 'bg-slate-800/95 border-slate-700 text-amber-300 hover:bg-slate-700'
            : 'bg-white/95 border-slate-200/90 text-slate-700 hover:bg-slate-50'
        } ${className}`}
      >
        {isDark ? (
          <>
            <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>Giao diện Sáng</span>
          </>
        ) : (
          <>
            <Moon className="w-3.5 h-3.5 text-teal-700 shrink-0" />
            <span>Giao diện Tối</span>
          </>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      onClick={toggleTheme}
      title={
        isDark
          ? 'Chuyển sang Giao diện Sáng'
          : 'Chuyển sang Giao diện Tối (Giảm mỏi mắt)'
      }
      className={`px-2 py-1 rounded-md border text-[11px] font-semibold transition-colors inline-flex items-center gap-1 cursor-pointer ${
        isDark
          ? 'border-slate-700 bg-slate-800 text-amber-300 hover:bg-slate-700'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      } ${className}`}
    >
      {isDark ? (
        <>
          <Sun className="w-3 h-3 text-amber-400 shrink-0" />
          <span>Sáng</span>
        </>
      ) : (
        <>
          <Moon className="w-3 h-3 text-teal-700 shrink-0" />
          <span>Tối</span>
        </>
      )}
    </button>
  );
};
