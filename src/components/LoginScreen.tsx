import React, { useState } from 'react';
import {
  Award,
  BookOpen,
  KeyRound,
  Lock,
  LogIn,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { CERTIPORT_TOPICS, UserAccount } from '../types/exam';

interface LoginScreenProps {
  onLogin: (username: string, password: string) => Promise<void>;
  isLoading: boolean;
  errorMessage: string | null;
  seededUsers: UserAccount[];
  questionsCount: number;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  onLogin,
  isLoading,
  errorMessage,
  seededUsers,
  questionsCount,
}) => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const studentCount = seededUsers.filter((u) => u.role === 'student').length;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onLogin(username, password);
  };

  const handleQuickFillAndLogin = async (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    await onLogin(u, p);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Top Bar tuân thủ chuẩn 3-zone contract */}
      <header className="flex items-center justify-between gap-8 px-6 py-4 bg-white border-b border-slate-200">
        <a
          href="#top"
          className="text-lg font-bold tracking-tight text-teal-800 whitespace-nowrap shrink-0"
        >
          Certiport GenAI Prep
        </a>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <a
            href="#login-panel"
            className="hover:text-teal-700 transition-colors whitespace-nowrap shrink-0"
          >
            Đăng nhập phòng thi
          </a>
          <a
            href="#exam-domains"
            className="hover:text-teal-700 transition-colors whitespace-nowrap shrink-0"
          >
            Chuyên đề Certiport
          </a>
          <a
            href="#scoring-standard"
            className="hover:text-teal-700 transition-colors whitespace-nowrap shrink-0"
          >
            Quy tắc chấm điểm
          </a>
          <a
            href="#admin-access"
            className="hover:text-teal-700 transition-colors whitespace-nowrap shrink-0"
          >
            Quản trị Ngân hàng Đề
          </a>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => handleQuickFillAndLogin('admin', 'admin123')}
            className="px-4 py-2 text-xs font-semibold text-white bg-teal-700 rounded-lg hover:bg-teal-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Quản trị Ngân hàng Đề (Giáo viên)
          </button>
        </div>
      </header>

      {/* Main Content Split */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 sm:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Cột trái: Giới thiệu hệ thống luyện thi Certiport Generative AI */}
        <section className="lg:col-span-7 bg-gradient-to-br from-sky-50 via-white to-teal-50/40 border border-slate-200 rounded-2xl p-6 sm:p-8 flex flex-col justify-between space-y-8">
          <div className="space-y-4">
            <div className="text-xs font-semibold text-teal-700">
              Hệ thống khảo thí & ôn luyện chứng chỉ quốc tế · Cloud Firestore đồng bộ thời gian thực
            </div>

            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-bold text-slate-900 tracking-tight leading-tight text-balance">
              Luyện thi Chứng chỉ Quốc tế Certiport Generative AI
            </h1>

            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              Môi trường mô phỏng sát 100% cấu trúc câu hỏi tương tác của bài thi Certiport chính thức:
              Menu thả xuống (- Select -), Trắc nghiệm đơn & đa lựa chọn, Ghép nối mảnh ghép (Matching)
              và Sắp xếp thứ tự quy trình (Ordering), hỗ trợ đính kèm hình ảnh đề thi trực tiếp.
            </p>
          </div>

          {/* 4 Chuyên đề cốt lõi */}
          <div id="exam-domains" className="space-y-3">
            <h2 className="text-sm font-semibold text-slate-900">
              4 Chuyên đề Trọng tâm trong Ngân hàng Đề ({questionsCount} câu hỏi hiện có · {studentCount} học sinh)
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {CERTIPORT_TOPICS.map((topic) => (
                <div
                  key={topic}
                  className="p-3.5 rounded-xl bg-white border border-slate-200 flex items-start gap-3"
                >
                  <BookOpen className="w-4 h-4 text-teal-700 shrink-0 mt-0.5" />
                  <span className="text-xs sm:text-sm font-medium text-slate-800">
                    {topic}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Quy chuẩn chấm điểm Certiport All-or-Nothing */}
          <div
            id="scoring-standard"
            className="p-4 rounded-xl bg-white border border-slate-200 space-y-2"
          >
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-900">
              <Award className="w-4 h-4 text-teal-700" />
              <span>Cơ chế chấm điểm & Bốc đề Ngẫu nhiên theo Tỉ lệ Ngân hàng</span>
            </div>
            <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
              Hệ thống tự động bốc ngẫu nhiên câu hỏi theo đúng tỉ lệ Chuyên đề trong Ngân hàng đề.
              Mỗi câu hỏi chỉ được tính <strong>1 điểm (ĐÚNG)</strong> khi học sinh trả lời chính xác
              100% tất cả các ý. Nếu sai bất kỳ 1 ý nhỏ nào, câu hỏi đó được tính <strong>0 điểm (SAI)</strong>.
            </p>
          </div>
        </section>

        {/* Cột phải: Khung Đăng nhập bằng Mã định danh & Mật khẩu */}
        <section
          id="login-panel"
          className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-xs flex flex-col justify-between space-y-6"
        >
          <div className="space-y-6">
            <div className="space-y-1.5">
              <h2 className="text-xl font-bold text-slate-900">
                Đăng nhập Hệ thống
              </h2>
              <p className="text-xs sm:text-sm text-slate-500">
                Sử dụng Mã học sinh hoặc Tài khoản Giáo viên được cấp.
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

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="username-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Mã định danh (Mã học sinh / Username Giáo viên)
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
                    placeholder="Nhập Mã học sinh hoặc admin..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="password-input"
                  className="block text-xs font-semibold text-slate-700"
                >
                  Mật khẩu (Password)
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
                    placeholder="Nhập mật khẩu..."
                    className="w-full pl-10 pr-4 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600 focus:border-teal-600"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 px-4 rounded-lg bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <LogIn className="w-4 h-4" />
                <span>{isLoading ? 'Đang xác thực...' : 'Đăng nhập vào Hệ thống'}</span>
              </button>
            </form>
          </div>

          {/* Cổng đăng nhập nhanh dành cho Giáo viên Quản trị */}
          <div id="admin-access" className="pt-5 border-t border-slate-200 space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                <KeyRound className="w-3.5 h-3.5 text-teal-700" />
                Tài khoản Quản trị viên (Dành cho Giáo viên)
              </span>
            </div>

            <button
              type="button"
              disabled={isLoading}
              onClick={() => handleQuickFillAndLogin('admin', 'admin123')}
              className="w-full p-3.5 rounded-xl border border-slate-200 hover:border-teal-600 hover:bg-sky-50/50 transition-colors flex items-center justify-between text-left cursor-pointer"
            >
              <div>
                <div className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-teal-700" />
                  <span>Giáo viên Quản trị Ngân hàng Câu hỏi & Học sinh</span>
                </div>
                <div className="text-xs text-slate-500 font-mono mt-0.5">
                  Tài khoản: admin · Mật khẩu mặc định: admin123
                </div>
              </div>
              <span className="text-xs font-bold text-teal-700 whitespace-nowrap">
                Vào Quản trị →
              </span>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};
