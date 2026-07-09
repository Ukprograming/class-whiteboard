import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Eye, EyeOff } from 'lucide-react';

interface TeacherLoginProps {
  onLogin: (classCode: string) => void;
  onNavigateToStudent: () => void;
}

export default function TeacherLogin({ onLogin, onNavigateToStudent }: TeacherLoginProps) {
  const [classCode, setClassCode] = useState('123456');
  const [password, setPassword] = useState('123456789');
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (classCode.trim()) {
      onLogin(classCode);
    }
  };

  return (
    <div className="bg-[#DDE1E4] min-h-screen flex items-center justify-center p-4">
      <motion.main
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-[420px]"
        data-purpose="login-container"
      >
        <section className="bg-white rounded-[12px] shadow-[0_4px_20px_rgba(0,0,0,0.08)] px-10 py-12" data-purpose="login-card">
          <header className="text-center mb-8">
            <h1 className="text-xl font-bold text-gray-500 mb-2">Class Whiteboard</h1>
            <h2 className="text-3xl font-bold text-[#1A1C1E]">先生ログイン画面</h2>
          </header>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Class Code Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700" htmlFor="class-code">
                クラスコード
              </label>
              <div className="relative flex border border-gray-300 rounded-md overflow-hidden h-[46px] focus-within:border-[#638AB7]">
                <div className="bg-[#F0F2F5] border-r border-gray-300 w-12 flex items-center justify-center">
                  {/* Avatar Icon */}
                  <div className="w-6 h-6 bg-[#4A7752] border-2 border-[#C19A6B] rounded-sm flex items-center justify-center overflow-hidden relative">
                    <div className="w-2.5 h-2.5 bg-white rounded-full absolute top-0.5"></div>
                    <div className="w-4 h-2 bg-white rounded-t-md absolute bottom-0"></div>
                  </div>
                </div>
                <input
                  className="block w-full border-0 px-3 py-2 text-gray-900 placeholder-gray-400 focus:ring-0 focus:outline-none text-base"
                  id="class-code"
                  name="class-code"
                  placeholder="例: 123456"
                  type="text"
                  value={classCode}
                  onChange={(e) => setClassCode(e.target.value)}
                  required
                />
              </div>
            </div>

            {/* Password Input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700" htmlFor="password">
                パスワード
              </label>
              <div className="relative flex border border-gray-300 rounded-md overflow-hidden h-[46px] focus-within:border-[#638AB7]">
                <div className="bg-[#F0F2F5] border-r border-gray-300 w-12 flex items-center justify-center">
                  <Lock className="h-5 w-5 text-gray-500" />
                </div>
                <input
                  className="block w-full border-0 px-3 py-2 text-gray-900 placeholder-gray-400 focus:ring-0 focus:outline-none text-base tracking-widest"
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <div className="flex items-center pr-3 bg-white">
                  <button
                    className="text-gray-400 hover:text-gray-600 focus:outline-none"
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                className="w-full bg-[#638AB7] hover:bg-[#5579A3] text-white font-bold py-3 px-4 rounded-md transition-colors text-lg"
                type="submit"
              >
                ログイン
              </button>
            </div>

            {/* Footer / Switch Button */}
            <div className="text-center mt-6 flex flex-col gap-2">
              <a className="text-[#5579A3] text-sm hover:underline" href="#">
                パスワードをお忘れですか？
              </a>
              <button
                type="button"
                onClick={onNavigateToStudent}
                className="text-gray-400 text-xs hover:text-gray-600 mt-2 underline"
              >
                生徒ログインへ戻る
              </button>
            </div>
          </form>
        </section>
      </motion.main>
    </div>
  );
}
