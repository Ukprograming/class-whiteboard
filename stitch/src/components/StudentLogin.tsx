import React, { useState } from 'react';
import { motion } from 'motion/react';

interface StudentLoginProps {
  onJoin: (nickname: string, classCode: string) => void;
  onNavigateToTeacher: () => void;
}

export default function StudentLogin({ onJoin, onNavigateToTeacher }: StudentLoginProps) {
  const [classCode, setClassCode] = useState('123456');
  const [nickname, setNickname] = useState('たろう');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (classCode.trim() && nickname.trim()) {
      onJoin(nickname, classCode);
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f4f8] flex items-center justify-center p-4">
      <motion.main
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="bg-white w-full max-w-md rounded-[32px] p-10 shadow-[0_10px_40px_rgba(0,0,0,0.05)] flex flex-col items-center"
        data-purpose="login-container"
      >
        <header className="text-center mb-6">
          <h1 className="text-2xl font-bold text-[#2c4a70] mb-3 tracking-wide">
            生徒ログイン画面
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            クラスコードを入力して、授業に参加しましょう。
          </p>
        </header>

        <form onSubmit={handleSubmit} className="w-full space-y-5" data-purpose="student-login-form">
          <div className="space-y-2">
            <label className="block text-sm font-bold ml-1 text-[#2c4a70]" htmlFor="class-code">
              クラスコード
            </label>
            <input
              className="w-full h-12 px-4 rounded-xl border-2 border-[#b3d4f0] focus:border-sky-300 focus:outline-none focus:ring-0 placeholder-gray-400 transition-colors text-gray-700 font-sans"
              id="class-code"
              name="class_code"
              placeholder="例: 123456"
              type="text"
              value={classCode}
              onChange={(e) => setClassCode(e.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-bold ml-1 text-[#2c4a70]" htmlFor="nickname">
              ニックネーム
            </label>
            <input
              className="w-full h-12 px-4 rounded-xl border border-gray-200 focus:border-sky-300 focus:outline-none focus:ring-0 placeholder-gray-400 transition-colors text-gray-700 font-sans"
              id="nickname"
              name="nickname"
              placeholder="例: たろう"
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              required
            />
          </div>

          <div className="pt-4">
            <button
              className="w-full h-14 bg-[#7cb9e8] hover:bg-sky-400 text-white font-bold text-lg rounded-full shadow-sm transition-all transform active:scale-[0.98]"
              type="submit"
            >
              参加する
            </button>
          </div>
        </form>

        <footer className="mt-8 text-center">
          <button
            onClick={onNavigateToTeacher}
            className="text-gray-400 text-sm underline decoration-gray-300 underline-offset-4 hover:text-gray-600 transition-colors"
          >
            先生のログインはこちら
          </button>
        </footer>
      </motion.main>
    </div>
  );
}
