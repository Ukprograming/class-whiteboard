import React from 'react';
import { motion } from 'motion/react';
import { FileSpreadsheet, FileText, Image, Save, FilePlus, X, HelpCircle, AlertCircle } from 'lucide-react';

interface FileDialogProps {
  onClose: () => void;
}

export default function FileDialog({ onClose }: FileDialogProps) {
  const recentFiles = [
    { name: 'Lesson 1: Introduction to History', date: '2026-07-08 10:15', size: '1.2 MB' },
    { name: 'History Notes (Page 3)', date: '2026-07-08 09:30', size: '840 KB' },
    { name: 'Science Diagram: Photosynthesis', date: '2026-07-07 15:45', size: '2.4 MB' },
    { name: 'English Vocab Quiz 2', date: '2026-07-07 11:20', size: '512 KB' },
  ];

  return (
    <div className="fixed inset-0 bg-black/45 flex items-center justify-center z-50 p-4 backdrop-blur-xs">
      <motion.div
        initial={{ y: 50, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 50, opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 280 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[640px] overflow-hidden border border-gray-100"
        data-purpose="file-dialog"
      >
        {/* Header */}
        <header className="px-6 py-5 border-b border-gray-150 flex items-center justify-between bg-gray-50">
          <div className="flex items-center space-x-2">
            <h2 className="text-xl font-bold text-gray-800">ファイル操作</h2>
            <HelpCircle className="h-4.5 w-4.5 text-gray-400 cursor-pointer hover:text-gray-600 transition-colors" />
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200 rounded-full transition-colors focus:outline-none"
            aria-label="Close"
          >
            <X className="w-7 h-7 text-gray-400" />
          </button>
        </header>

        {/* Content Body */}
        <div className="p-6 space-y-6">
          {/* Quick Actions Grid */}
          <div>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">アクション</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: '上書き保存', icon: Save, color: 'text-blue-600 bg-blue-50 hover:bg-blue-100 border-blue-100' },
                { label: '名前を付けて保存', icon: FilePlus, color: 'text-emerald-600 bg-emerald-50 hover:bg-emerald-100 border-emerald-100' },
                { label: 'PDFエクスポート', icon: FileText, color: 'text-red-600 bg-red-50 hover:bg-red-100 border-red-100' },
                { label: 'PNGエクスポート', icon: Image, color: 'text-purple-600 bg-purple-50 hover:bg-purple-100 border-purple-100' },
              ].map((act, index) => (
                <button
                  key={index}
                  onClick={() => alert(`${act.label}をシミュレートしました。`)}
                  className={`flex flex-col items-center justify-center p-4 border rounded-xl transition-all active:scale-[0.98] ${act.color}`}
                >
                  <act.icon className="h-6 w-6 mb-2" />
                  <span className="text-xs font-bold text-center leading-tight text-gray-700">{act.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Recent Files Section */}
          <div>
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">最近使用したファイル</h3>
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
              {recentFiles.map((file, index) => (
                <div key={index} className="flex items-center justify-between p-3.5 hover:bg-gray-50 transition-colors cursor-pointer">
                  <div className="flex items-center space-x-3 overflow-hidden pr-2">
                    <FileSpreadsheet className="h-5 w-5 text-gray-400 shrink-0" />
                    <span className="text-sm font-medium text-gray-700 truncate">{file.name}</span>
                  </div>
                  <div className="flex items-center space-x-3 shrink-0 text-xs text-gray-400 font-mono">
                    <span>{file.date}</span>
                    <span className="bg-gray-100 px-1.5 py-0.5 rounded text-[10px]">{file.size}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer Buttons */}
        <footer className="px-6 py-4 border-t border-gray-150 flex justify-end bg-gray-50">
          <button
            onClick={onClose}
            className="px-6 py-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-100 hover:text-gray-800 transition-all font-medium text-sm"
          >
            キャンセル
          </button>
        </footer>
      </motion.div>
    </div>
  );
}
