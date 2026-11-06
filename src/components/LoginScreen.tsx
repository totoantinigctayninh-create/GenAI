import React, { useRef, useState } from 'react';
import { Lock, LogIn, ShieldCheck, UserCheck } from 'lucide-react';
import { ThemeToggleButton } from '../context/ThemeContext';
import { UserAccount } from '../types/exam';
import { compressImageFileToBase64 } from '../utils/questionBankUtils';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<void>;
  isLoading: boolean;
  errorMessage: string | null;
  seededUsers: UserAccount[];
  questionsCount: number;
  departmentLogoUrl?: string;
  onUpdateDepartmentLogo?: (newLogoUrl: string) => Promise<void>;
}

/**
 * Biểu trưng chính thức mặc định của Tổ Toán - Tin · Trường IGC Tây Ninh
 * Thiết kế sắc nét ở kích thước lớn (Crest Học thuật & Công nghệ AI)
 */
export const IgcToanTinDefaultEmblem: React.FC<{ className?: string }> = ({
  className = 'w-28 h-28',
}) => (
  <svg
    viewBox="0 0 160 160"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    aria-label="Biểu trưng Tổ Toán - Tin Trường IGC Tây Ninh"
  >
    <defs>
      <linearGradient id="igcCrestBg" x1="0" y1="0" x2="160" y2="160" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#0F766E" />
        <stop offset="60%" stopColor="#115E59" />
        <stop offset="100%" stopColor="#0F172A" />
      </linearGradient>
      <linearGradient id="igcGold" x1="20" y1="20" x2="140" y2="140" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#FDE68A" />
        <stop offset="50%" stopColor="#F59E0B" />
        <stop offset="100%" stopColor="#D97706" />
      </linearGradient>
    </defs>

    {/* Nền khiên huy hiệu */}
    <rect
      x="8"
      y="8"
      width="144"
      height="144"
      rx="34"
      fill="url(#igcCrestBg)"
    />
    <rect
      x="15"
      y="15"
      width="130"
      height="130"
      rx="27"
      stroke="url(#igcGold)"
      strokeOpacity="0.55"
      strokeWidth="2"
    />

    {/* Vòng hào quang Toán - Tin & Mạng nơ-ron */}
    <circle
      cx="80"
      cy="68"
      r="36"
      stroke="url(#igcGold)"
      strokeWidth="2"
      strokeDasharray="5 4"
    />
    <circle
      cx="80"
      cy="68"
      r="28"
      stroke="#5EEAD4"
      strokeOpacity="0.3"
      strokeWidth="1.5"
    />

    {/* Biểu tượng Toán học (Pi) kết hợp Vi mạch AI */}
    <path
      d="M58 55H102M69 55V83M91 55V78C91 81.5 93.5 83.5 97 83.5"
      stroke="#FFFFFF"
      strokeWidth="6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <circle cx="58" cy="55" r="4.5" fill="#FCD34D" />
    <circle cx="102" cy="55" r="4.5" fill="#FCD34D" />
    <circle cx="80" cy="41" r="4.5" fill="#5EEAD4" />
    <path d="M80 45.5V55" stroke="#5EEAD4" strokeWidth="2.5" strokeLinecap="round" />

    {/* Dải băng TỔ TOÁN - TIN */}
    <text
      x="80"
      y="29"
      textAnchor="middle"
      fill="#FDE68A"
      fontSize="8.5"
      fontWeight="800"
      letterSpacing="0.14em"
    >
      TỔ TOÁN - TIN
    </text>

    {/* Dải băng trường IGC TÂY NINH */}
    <rect x="24" y="114" width="112" height="22" rx="11" fill="#0F172A" stroke="url(#igcGold)" strokeWidth="1.2" />
    <text
      x="80"
      y="128.5"
      textAnchor="middle"
      fill="#F8FAFC"
      fontSize="10.5"
      fontWeight="800"
      letterSpacing="0.12em"
    >
      IGC TÂY NINH
    </text>
  </svg>
);

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  isLoading,
  errorMessage,
  questionsCount,
  departmentLogoUrl = '',
  onUpdateDepartmentLogo,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(username, password);
  };

  const handleUploadLogoFile = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateDepartmentLogo) return;
    try {
      const base64 = await compressImageFileToBase64(file);
      await onUpdateDepartmentLogo(base64);
    } catch {
      // Bỏ qua nếu ảnh không hợp lệ
    } finally {
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = '';
      }
    }
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

          {/* LOGO TRUNG TÂM KÍCH THƯỚC LỚN, HOÀNH TRÁNG & CHUYÊN NGHIỆP */}
          <div className="relative z-10 my-6 sm:my-8 flex flex-col items-center">
            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/*"
              onChange={handleUploadLogoFile}
              className="hidden"
              id="department-logo-file-input"
              data-testid="department-logo-file-input"
            />
            <div
              data-testid="department-logo-container"
              onClick={() => {
                if (onUpdateDepartmentLogo) {
                  logoFileInputRef.current?.click();
                }
              }}
              title="Logo Tổ Toán - Tin · Trường IGC Tây Ninh"
              className="keep-light w-44 h-44 sm:w-52 sm:h-52 rounded-full bg-white shadow-2xl ring-8 ring-white/15 flex items-center justify-center p-2 overflow-hidden transition-transform duration-300 hover:scale-[1.02] cursor-pointer"
            >
              {departmentLogoUrl ? (
                <img
                  src={departmentLogoUrl}
                  alt="Logo Tổ Toán - Tin Trường IGC Tây Ninh"
                  className="w-full h-full object-contain rounded-full"
                />
              ) : (
                <IgcToanTinDefaultEmblem className="w-full h-full" />
              )}
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
