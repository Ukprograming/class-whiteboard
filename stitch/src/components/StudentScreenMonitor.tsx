import React, { useMemo } from 'react';
import { motion } from 'motion/react';
import { Grid, Palette, ChevronLeft, User, Share2, Hourglass, CheckSquare } from 'lucide-react';
import { Student, Stroke } from '../types';

interface StudentScreenMonitorProps {
  students: Student[];
  myStrokes: Stroke[]; // 生徒「たろう」が現在描いているストローク
  onSelectStudent: (studentId: string) => void;
  onNavigateToPalette: () => void;
  onBackToBoard: () => void;
}

export default function StudentScreenMonitor({
  students,
  myStrokes,
  onSelectStudent,
  onNavigateToPalette,
  onBackToBoard,
}: StudentScreenMonitorProps) {
  // 24名の接続中生徒グリッドを動的に生成
  const monitorList = useMemo(() => {
    const list: Student[] = [];
    // 最初の数人を定義
    const defaultStudents: { name: string; status: 'editing' | 'sharing' | 'waiting' }[] = [
      { name: 'たろう (あなた)', status: 'editing' },
      { name: 'すずき', status: 'sharing' },
      { name: 'さとう', status: 'waiting' },
      { name: 'たなか', status: 'editing' },
      { name: 'いとう', status: 'sharing' },
      { name: 'わたなべ', status: 'waiting' },
      { name: '山本', status: 'editing' },
      { name: '中村', status: 'waiting' },
      { name: '小林', status: 'sharing' },
      { name: '加藤', status: 'editing' },
    ];

    for (let i = 0; i < 24; i++) {
      if (i < defaultStudents.length) {
        list.push({
          id: `student_${i + 1}`,
          name: defaultStudents[i].name,
          status: defaultStudents[i].status,
        });
      } else {
        const lastNames = ['吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '斎藤', '清水', '山崎', '森', '池田', '橋本'];
        const statuses: ('editing' | 'sharing' | 'waiting')[] = ['editing', 'sharing', 'waiting'];
        list.push({
          id: `student_${i + 1}`,
          name: lastNames[(i - defaultStudents.length) % lastNames.length],
          status: statuses[i % 3],
        });
      }
    }
    return list;
  }, []);

  return (
    <div className="min-h-screen bg-[#F0F2F5] font-sans text-gray-800 flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-gray-200 bg-white flex items-center justify-between px-6 sticky top-0 z-40 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToBoard}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors text-gray-600 flex items-center gap-1.5 text-sm font-medium"
          >
            <ChevronLeft className="h-5 w-5" />
            <span>ホワイトボードへ戻る</span>
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-lg font-bold text-gray-800">生徒画面確認ビュー</h1>
        </div>

        {/* Palette Details & Green Grid layout buttons */}
        <div className="flex items-center space-x-2">
          {/* Palette Switch Button with emerald icon */}
          <button
            onClick={onNavigateToPalette}
            className="bg-white border border-gray-300 hover:bg-gray-50 rounded-lg px-4 py-2 flex items-center space-x-2 shadow-xs transition-colors text-sm font-medium"
          >
            <Palette className="h-5 w-5 text-emerald-600" />
            <span className="text-gray-700">パレット詳細</span>
          </button>
        </div>
      </header>

      {/* Main Grid Workspace */}
      <main className="flex-grow p-6 max-w-[1440px] mx-auto w-full">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 leading-tight">全員のワークスペース</h2>
            <p className="text-sm text-gray-500 mt-1">リアルタイムで接続中（24名の生徒）</p>
          </div>
          {/* Status indicators */}
          <div className="flex items-center space-x-4 text-xs font-semibold">
            <span className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span> <span className="text-gray-600">編集中 (8)</span></span>
            <span className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span> <span className="text-gray-600">画面共有中 (6)</span></span>
            <span className="flex items-center space-x-1"><span className="w-2.5 h-2.5 rounded-full bg-gray-400"></span> <span className="text-gray-600">待機中 (10)</span></span>
          </div>
        </header>

        {/* 24-Grid Blocks */}
        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {monitorList.map((student) => {
            const isMe = student.id === 'student_1';
            return (
              <motion.article
                whileHover={{ scale: 1.02, y: -2 }}
                key={student.id}
                onClick={() => onSelectStudent(student.id)}
                className="bg-white rounded-xl shadow-xs border border-gray-200 overflow-hidden cursor-pointer flex flex-col justify-between hover:shadow-md transition-all h-[170px]"
                data-purpose="student-card"
              >
                {/* Card Title & Status Header */}
                <header className="p-3 border-b border-gray-100 flex items-center justify-between shrink-0 bg-gray-50/50">
                  <div className="flex items-center space-x-2">
                    <User className={`h-4 w-4 ${isMe ? 'text-blue-500' : 'text-gray-400'}`} />
                    <span className={`text-xs font-bold truncate max-w-[80px] ${isMe ? 'text-blue-600' : 'text-gray-700'}`}>
                      {student.name}
                    </span>
                  </div>

                  {/* Status Badge */}
                  <div className="flex items-center">
                    {student.status === 'editing' ? (
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" title="編集中" />
                    ) : student.status === 'sharing' ? (
                      <span className="w-2 h-2 rounded-full bg-emerald-500" title="画面共有中" />
                    ) : (
                      <span className="w-2 h-2 rounded-full bg-gray-400" title="待機中" />
                    )}
                  </div>
                </header>

                {/* Simulated Whiteboard Sketch Preview */}
                <div className="flex-grow flex items-center justify-center p-2 relative bg-gray-50">
                  {isMe ? (
                    /* 「たろう」のリアルなホワイトボード内容を描画 */
                    myStrokes.length > 0 ? (
                      <svg className="w-full h-full max-h-[90px]" viewBox="0 0 1000 800">
                        {myStrokes.map((stroke, index) => {
                          if (stroke.points.length < 2) return null;
                          const pathData = `M ${stroke.points[0].x} ${stroke.points[0].y} ` +
                            stroke.points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ');
                          return (
                            <path
                              key={index}
                              d={pathData}
                              fill="none"
                              stroke={stroke.color}
                              strokeWidth={stroke.width * 2}
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          );
                        })}
                      </svg>
                    ) : (
                      <span className="text-[10px] text-gray-400 font-medium">白紙</span>
                    )
                  ) : (
                    /* ほかの生徒用の模擬手書きプレビュー */
                    <svg className="w-full h-full max-h-[90px]" viewBox="0 0 100 80">
                      {student.status === 'editing' ? (
                        <>
                          <path d="M 20 40 Q 50 10 80 40" fill="none" stroke="#2B6CB0" strokeWidth="2" strokeLinecap="round" />
                          <circle cx="50" cy="45" r="12" fill="none" stroke="#2D3748" strokeWidth="1" />
                        </>
                      ) : student.status === 'sharing' ? (
                        <>
                          <path d="M 15 20 L 85 20 L 50 70 Z" fill="none" stroke="#C53030" strokeWidth="2.5" />
                          <line x1="15" y1="20" x2="50" y2="70" stroke="#C53030" strokeWidth="1" />
                        </>
                      ) : (
                        <span className="text-[10px] text-gray-300 font-medium">スケッチなし</span>
                      )}
                    </svg>
                  )}
                </div>

                {/* Footer status label */}
                <footer className="p-2 border-t border-gray-100 bg-white shrink-0 flex items-center justify-between text-[10px] text-gray-400">
                  <span className="font-mono">ID: {student.id}</span>
                  <span className="font-medium">
                    {student.status === 'editing' ? '手書き中...' : student.status === 'sharing' ? '共有中' : '待機'}
                  </span>
                </footer>
              </motion.article>
            );
          })}
        </section>
      </main>
    </div>
  );
}
