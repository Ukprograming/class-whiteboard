import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Pencil, Send, CheckCircle2, ChevronRight, FileText, AlertCircle, X } from 'lucide-react';
import { ChatMessage } from '../types';

interface TeacherChatPanelProps {
  chatMessages: ChatMessage[];
  onAddChatMessage: (senderId: string, text: string) => void;
  onNavigateToBoard: () => void;
  onNavigateToFile: () => void;
}

export default function TeacherChatPanel({
  chatMessages,
  onAddChatMessage,
  onNavigateToBoard,
  onNavigateToFile,
}: TeacherChatPanelProps) {
  const [selectedStudentId, setSelectedStudentId] = useState('student_1');
  const [inputText, setInputText] = useState('');

  const students = [
    { id: 'student_1', name: '鈴木一郎', isOnline: true, hasNotification: true, tag: '質問中' },
    { id: 'student_2', name: '田中太郎', isOnline: true, hasNotification: true, tag: '提出完了' },
    { id: 'student_3', name: '佐藤花子', isOnline: true, hasNotification: false, tag: '閲覧中' },
    { id: 'student_4', name: '高橋美咲', isOnline: false, hasNotification: false, tag: 'オフライン' },
    { id: 'student_5', name: '伊藤健太', isOnline: true, hasNotification: false, tag: '閲覧中' },
  ];

  // 選択されている生徒宛の（または生徒からの）メッセージのみをフィルタ
  const currentMessages = chatMessages.filter(
    (msg) => msg.senderId === selectedStudentId || (msg.isTeacher && msg.senderId === 'teacher')
  );

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    onAddChatMessage(selectedStudentId, inputText);
    setInputText('');
  };

  return (
    <div className="h-screen flex font-sans bg-[#F1F3F5] text-gray-800 overflow-hidden">
      
      {/* Sidebar: Student list with active notices */}
      <aside className="w-80 border-r border-gray-200 bg-white flex flex-col shrink-0 h-full">
        <header className="p-4 border-b border-gray-150 bg-gray-50 flex items-center justify-between">
          <h2 className="text-lg font-bold text-gray-800">チャットルーム一覧</h2>
          <span className="bg-red-500 text-white text-xs font-black px-2 py-0.5 rounded-full animate-pulse">2件の質問</span>
        </header>

        <nav className="flex-grow overflow-y-auto divide-y divide-gray-100 p-2 space-y-1">
          {students.map((st) => (
            <div
              key={st.id}
              onClick={() => setSelectedStudentId(st.id)}
              className={`p-3.5 rounded-xl cursor-pointer transition-all flex items-center justify-between relative ${
                selectedStudentId === st.id ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
              }`}
            >
              <div className="flex items-center space-x-3">
                <div className="relative">
                  {/* Avatar Icon placeholder */}
                  <div className="w-10 h-10 bg-[#E9ECEF] rounded-full flex items-center justify-center text-sm font-bold text-[#495057] border border-gray-200">
                    {st.name[0]}
                  </div>
                  {st.isOnline && (
                    <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 border-2 border-white rounded-full"></div>
                  )}
                </div>
                <div>
                  <div className="text-sm font-bold text-gray-800">{st.name}</div>
                  <div className="flex items-center space-x-1 mt-0.5">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                        st.tag === '質問中'
                          ? 'bg-red-50 text-red-600 border border-red-100'
                          : st.tag === '提出完了'
                          ? 'bg-emerald-50 text-emerald-600 border border-emerald-100'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {st.tag}
                    </span>
                  </div>
                </div>
              </div>

              {/* Notice badge or arrow */}
              {st.hasNotification ? (
                <div className="flex items-center space-x-1 bg-red-100 text-red-600 rounded-full px-2 py-0.5 text-[10px] font-black animate-bounce shrink-0">
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>質問あり!</span>
                </div>
              ) : (
                <ChevronRight className="h-4 w-4 text-gray-400" />
              )}
            </div>
          ))}
        </nav>

        {/* Toolbar Switch at Bottom */}
        <footer className="p-4 border-t border-gray-150 bg-gray-50 flex items-center justify-between">
          {/* File Operations Shortcut */}
          <button
            onClick={onNavigateToFile}
            className="flex items-center space-x-1.5 bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 px-3.5 py-2 rounded-lg text-xs font-bold transition-all"
          >
            <FileText className="w-4 h-4 text-gray-500" />
            <span>file-text</span>
          </button>

          {/* Toggle to Board view: Pencil Icon */}
          <button
            onClick={onNavigateToBoard}
            className="p-2.5 bg-white border border-gray-200 hover:bg-teal-50 text-teal-600 rounded-xl shadow-xs transition-colors focus:ring-2 focus:ring-teal-200"
            title="ホワイトボードへ戻る"
          >
            <Pencil className="h-5 w-5 text-teal-600" />
          </button>
        </footer>
      </aside>

      {/* Main Chat Panel */}
      <section className="flex-grow flex flex-col bg-white h-full relative">
        {/* Chat Area Header */}
        <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center space-x-2">
            <span className="text-gray-400 text-sm">対話中:</span>
            <span className="text-base font-bold text-gray-800">
              {students.find((s) => s.id === selectedStudentId)?.name || '選択してください'}
            </span>
          </div>
          <div className="text-xs text-gray-400">メッセージログ</div>
        </header>

        {/* Message History */}
        <div className="flex-grow overflow-y-auto p-6 space-y-4 bg-[#F8F9FA] custom-scrollbar">
          {currentMessages.length === 0 ? (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              ここから質問を受け付けたり回答を送信できます。
            </div>
          ) : (
            currentMessages.map((msg) => (
              <div key={msg.id} className={`flex ${msg.isTeacher ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-md rounded-2xl p-4 shadow-sm text-sm ${
                    msg.isTeacher
                      ? 'bg-[#638AB7] text-white rounded-tr-none'
                      : 'bg-white text-gray-800 border border-gray-150 rounded-tl-none'
                  }`}
                >
                  <div className="font-bold mb-1 text-[11px] opacity-75">
                    {msg.isTeacher ? 'あなた (先生)' : msg.sender}
                  </div>
                  <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  <div className={`text-[10px] text-right mt-1.5 ${msg.isTeacher ? 'text-blue-100' : 'text-gray-400'}`}>
                    {msg.timestamp}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Message Input Form */}
        <form onSubmit={handleSend} className="p-4 border-t border-gray-150 bg-white flex gap-3 shrink-0">
          <input
            className="flex-grow border border-gray-300 rounded-xl px-4 py-3 focus:outline-none focus:border-[#638AB7] text-sm"
            placeholder="メッセージを入力してください..."
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />
          <button
            type="submit"
            className="bg-[#638AB7] hover:bg-[#5579A3] text-white px-5 py-3 rounded-xl flex items-center justify-center font-bold text-sm transition-all shadow-sm active:scale-95 shrink-0"
          >
            <Send className="h-4.5 w-4.5" />
          </button>
        </form>
      </section>

    </div>
  );
}
