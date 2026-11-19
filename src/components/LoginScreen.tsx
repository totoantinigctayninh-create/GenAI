import React, { useState } from 'react';
import { Lock, LogIn, ShieldCheck, UserCheck } from 'lucide-react';
import { ThemeToggleButton } from '../context/ThemeContext';
import { UserAccount } from '../types/exam';
import {
  DEFAULT_DEPARTMENT_LOGO_URL,
  resolveDepartmentLogoUrl,
} from '../utils/branding';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<void>;
  isLoading: boolean;
  errorMessage: string | null;
  seededUsers: UserAccount[];
  questionsCount: number;
  departmentLogoUrl?: string;
}

/**
 * Biểu trưng chính thức mặc định của Tổ Toán - Tin · Trường TH-THCS-THPT IGC Tây Ninh
 */
export const IgcToanTinDefaultEmblem: React.FC<{ className?: string }> = ({
  className = 'w-28 h-28',
}) => (
  <img
    src={DEFAULT_DEPARTMENT_LOGO_URL}
    alt="Logo Tổ Toán - Tin Trường TH-THCS-THPT IGC Tây Ninh"
    className={`${className} object-contain rounded-full`}
  />
);

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  isLoading,
  errorMessage,
  questionsCount,
  departmentLogoUrl = '',
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const resolvedLogoUrl = resolveDepartmentLogoUrl(departmentLogoUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(username, password);
  };

  return (
    <div
      data-testid="login-screen-no-header"
      className="min-h-screen bg-slate-100 flex items-center justify-center p-4 sm:p-6 lg:p-10"
    >
      <main className="w-full max-w-5xl bg-white rounded-[32px] shadow-xl border border-slate-200/90 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
        {/* CỘT TRÁI (6/12): KHỐI THƯƠNG HIỆU HOÀNH TRÁNG - TỔ TOÁN - TIN · TRƯỜNG IGC TÂY NINH */}
        <section className="lg:col-span-6 bg-gradient-to-br from-teal-900 via-teal-800 to-slate-900 text-white p-8 sm:p-12 flex flex-col items-center justify-between text-center relative overflow-hidden">
          {/* Hiệu ứng ánh sáng nền tinh tế */}
          <div className="w-80 h-80 rounded-full bg-teal-400/10 blur-3xl absolute -top-24 -left-24 pointer-events-none" />
          <div className="w-80 h-80 rounded-full bg-amber-400/10 blur-3xl absolute -bottom-24 -right-24 pointer-events-none" />

          {/* Định danh Trường phía trên */}
          <div className="relative z-10">
            <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 border border-white/15 text-amber-300 text-[11px] sm:text-xs font-extrabold uppercase tracking-wider whitespace-nowrap">
              Trường Tiểu học, THCS & THPT IGC Tây Ninh
            </span>
          </div>

          {/* LOGO TRUNG TÂM KÍCH THƯỚC LỚN, SẮC NÉT (CHỈ HIỂN THỊ, KHÔNG CHO CHỈNH SỬA NGOÀI ĐĂNG NHẬP) */}
          <div className="relative z-10 my-6 sm:my-8 flex flex-col items-center">
            <div
              data-testid="department-logo-container"
              title="Logo Tổ Toán - Tin · Trường TH-THCS-THPT IGC Tây Ninh"
              className="keep-light w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-white shadow-2xl ring-8 ring-white/15 flex items-center justify-center p-1.5 overflow-hidden"
            >
              <img
                src={resolvedLogoUrl}
                alt="Logo Tổ Toán - Tin Trường TH-THCS-THPT IGC Tây Ninh"
                className="w-full h-full object-contain rounded-full"
              />
            </div>

            <div className="mt-6 space-y-2">
              <div className="text-xs sm:text-sm font-extrabold uppercase tracking-[0.14em] text-amber-300 whitespace-nowrap">
                SẢN PHẨM CHUYÊN MÔN · TỔ TOÁN - TIN
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white leading-tight whitespace-nowrap">
                Hệ thống Ôn luyện Gen AI
              </h1>
              <p className="text-xs sm:text-sm text-teal-100/85 font-medium max-w-sm mx-auto">
                Chứng chỉ Quốc tế Certiport Generative AI
              </p>
            </div>
          </div>

          {/* Dải thông số tối giản ở chân cột trái */}
          <div className="relative z-10 w-full pt-5 border-t border-white/10 flex items-center justify-center gap-6 text-xs text-teal-100/90 font-semibold tabular-nums">
            <span>{questionsCount} Câu hỏi chuẩn hóa</span>
            <span className="w-1 h-1 rounded-full bg-amber-400" />
            <span>Thang điểm 1000</span>
          </div>
        </section>

        {/* CỘT PHẢI (6/12): FORM ĐĂNG NHẬP TỐI GIẢN, SANG TRỌNG */}
        <section
          id="login-panel"
          className="lg:col-span-6 p-8 sm:p-12 lg:p-14 flex flex-col justify-between bg-white"
        >
          <div className="flex justify-end">
            <ThemeToggleButton variant="floating" testId="login-theme-toggle-btn" />
          </div>

          <div className="my-auto space-y-7 py-4">
            <div className="space-y-1.5">
              <div className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-teal-700">
                <ShieldCheck className="w-4 h-4" />
                <span>Cổng Đăng nhập Trực tuyến</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                Đăng nhập Hệ thống
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Dành cho Học sinh & Giáo viên Tổ Toán - Tin · IGC Tây Ninh
              </p>
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-xs sm:text-sm text-rose-800 font-medium"
              >
                {errorMessage}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="space-y-1.5">
                <label
                  htmlFor="username-input"
                  className="block text-xs font-bold text-slate-700"
                >
                  Tài khoản / Mã Học sinh
                </label>
                <div className="relative">
                  <UserCheck className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="username-input"
                    type="text"
                    required
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Nhập Mã học sinh hoặc tài khoản Giáo viên"
                    className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 transition-colors"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password-input"
                  className="block text-xs font-bold text-slate-700"
                >
                  Mật khẩu
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="password-input"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Nhập mật khẩu"
                    className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-slate-300 bg-slate-50/50 focus:bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600 transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-3.5 px-5 rounded-xl bg-teal-800 hover:bg-teal-900 disabled:opacity-60 text-white text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm cursor-pointer mt-2"
              >
                <LogIn className="w-4 h-4" />
                <span>
                  {isLoading ? 'Đang đăng nhập...' : 'Vào Phòng Ôn & Thi'}
                </span>
              </button>
            </form>
          </div>

          <div className="pt-6 border-t border-slate-100 flex items-center justify-between text-[11px] font-medium text-slate-400">
            <span>Tổ Toán - Tin · Trường IGC Tây Ninh</span>
            <span>Certiport GenAI Prep</span>
          </div>
        </section>
      </main>
    </div>
  );
};
