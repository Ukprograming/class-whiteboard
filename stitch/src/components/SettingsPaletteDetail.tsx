import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Grid, Palette, ChevronLeft, Check, Sparkles, Sliders, Type, Star, Award, Heart } from 'lucide-react';

interface SettingsPaletteDetailProps {
  onBackToGrid: () => void;
}

export default function SettingsPaletteDetail({ onBackToGrid }: SettingsPaletteDetailProps) {
  const [activeTab, setActiveTab] = useState<'colors' | 'shapes' | 'stamps'>('colors');
  const [selectedColor, setSelectedColor] = useState('#2C5282');
  const [selectedShape, setSelectedShape] = useState('circle');
  const [selectedStamp, setSelectedStamp] = useState('star');

  const paletteColors = [
    { code: '#2C5282', name: 'クラシックブルー' },
    { code: '#C53030', name: 'ティーチャーズレッド' },
    { code: '#2F855A', name: '黒板グリーン' },
    { code: '#1A202C', name: 'チャコール' },
    { code: '#D69E2E', name: 'アテンションイエロー' },
    { code: '#805AD5', name: 'クリエイティブパープル' },
    { code: '#DD6B20', name: 'エネルギッシュオレンジ' },
    { code: '#319795', name: 'ティールグリーン' },
  ];

  const shapes = [
    { id: 'pointer', name: '選択カーソル', path: 'M4 4l12 12H9l-5 5V4z' },
    { id: 'circle', name: '円・楕円', icon: 'circle' },
    { id: 'rect', name: '正方形・長方形', icon: 'square' },
    { id: 'line', name: '直線矢印', path: 'M5 12h14M12 5l7 7-7 7' },
    { id: 'triangle', name: '三角形・多角形', path: 'M12 3l9 16H3L12 3z' },
  ];

  const stamps = [
    { id: 'star', name: 'たいへんよくできました', icon: Star, color: 'text-yellow-500 bg-yellow-50 border-yellow-200' },
    { id: 'award', name: '合格リボン', icon: Award, color: 'text-red-500 bg-red-50 border-red-200' },
    { id: 'heart', name: 'がんばりましょう', icon: Heart, color: 'text-pink-500 bg-pink-50 border-pink-200' },
  ];

  return (
    <div className="min-h-screen bg-[#F0F2F5] font-sans text-gray-800 flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-gray-200 bg-white flex items-center justify-between px-6 sticky top-0 z-40 shadow-xs">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBackToGrid}
            className="p-2 hover:bg-gray-150 rounded-lg transition-colors text-gray-600 flex items-center gap-1 text-sm font-medium"
          >
            <ChevronLeft className="h-5 w-5" />
            <span>確認ビューへ戻る</span>
          </button>
          <span className="text-gray-300">|</span>
          <h1 className="text-lg font-bold text-gray-800">パレット詳細・描画ツール設定</h1>
        </div>

        {/* Green Grid layout icon switch */}
        <div className="flex items-center">
          <button
            onClick={onBackToGrid}
            className="bg-white border border-gray-300 hover:bg-gray-100 rounded-lg p-2.5 flex items-center shadow-xs transition-colors"
            title="グリッドビューへ"
          >
            <Grid className="h-5 w-5 text-emerald-600" />
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-grow p-6 max-w-[1100px] mx-auto w-full space-y-6">
        <header className="mb-4">
          <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Sliders className="h-6 w-6 text-blue-600" />
            ツールパレットのカスタマイズ
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            授業中に使用するパレットの優先カラーやスタンプを詳細に設定できます。
          </p>
        </header>

        {/* Tab Selection */}
        <div className="flex bg-white rounded-xl p-1 shadow-sm border border-gray-200 max-w-md">
          {[
            { id: 'colors', label: 'カラーパレット' },
            { id: 'shapes', label: '図形・シェイプ' },
            { id: 'stamps', label: 'スタンプ・評価' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all ${
                activeTab === tab.id ? 'bg-[#2C5282] text-white' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Active Tab Panel */}
        <section className="bg-white rounded-2xl p-8 shadow-sm border border-gray-200">
          {activeTab === 'colors' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <h3 className="text-base font-bold text-gray-800 mb-2">描画ペンのプリセット（お気に入り）</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {paletteColors.map((color) => (
                  <button
                    key={color.code}
                    onClick={() => setSelectedColor(color.code)}
                    className={`p-4 border rounded-xl flex items-center gap-4 transition-all hover:border-gray-300 relative ${
                      selectedColor === color.code ? 'border-blue-500 bg-blue-50/50' : 'border-gray-200'
                    }`}
                  >
                    <span className="w-8 h-8 rounded-full border border-gray-150 shrink-0" style={{ backgroundColor: color.code }} />
                    <div className="text-left">
                      <span className="block text-sm font-bold text-gray-800">{color.name}</span>
                      <span className="text-xs font-mono text-gray-400">{color.code}</span>
                    </div>
                    {selectedColor === color.code && (
                      <Check className="absolute top-2 right-2 w-4 h-4 text-blue-600" />
                    )}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'shapes' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <h3 className="text-base font-bold text-gray-800 mb-2 font-sans">クイックアクセス図形リスト</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {shapes.map((sh) => (
                  <button
                    key={sh.id}
                    onClick={() => setSelectedShape(sh.id)}
                    className={`p-4 border rounded-xl flex items-center justify-between transition-all hover:border-gray-300 ${
                      selectedShape === sh.id ? 'border-blue-500 bg-blue-50/30' : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center space-x-3 text-left">
                      <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center text-gray-600 font-bold shrink-0">
                        {sh.icon === 'circle' ? (
                          <div className="w-5 h-5 rounded-full border-2 border-gray-600" />
                        ) : sh.icon === 'square' ? (
                          <div className="w-5 h-5 border-2 border-gray-600" />
                        ) : (
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path d={sh.path} strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <div>
                        <span className="block text-sm font-bold text-gray-800">{sh.name}</span>
                        <span className="text-xs text-gray-400">図形ツールに配置</span>
                      </div>
                    </div>
                    {selectedShape === sh.id && <Check className="w-5 h-5 text-blue-600 shrink-0" />}
                  </button>
                ))}
              </div>
            </motion.div>
          )}

          {activeTab === 'stamps' && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <h3 className="text-base font-bold text-gray-800 mb-2">スタンプライブラリ</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {stamps.map((st) => (
                  <button
                    key={st.id}
                    onClick={() => setSelectedStamp(st.id)}
                    className={`p-5 border rounded-2xl flex flex-col items-center justify-center text-center transition-all ${st.color} ${
                      selectedStamp === st.id ? 'ring-2 ring-blue-500 scale-[1.02]' : 'hover:opacity-90'
                    }`}
                  >
                    <st.icon className="h-10 w-10 mb-3" />
                    <span className="text-sm font-bold text-gray-800">{st.name}</span>
                    <span className="text-xs text-gray-400 mt-1">ワンクリックで押印</span>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </section>

        {/* Live Preview Container Card */}
        <section className="bg-gray-900 text-white rounded-2xl p-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="space-y-2">
            <h3 className="text-lg font-bold flex items-center gap-1.5 text-yellow-400">
              <Sparkles className="h-5 w-5" />
              設定適用プレビュー
            </h3>
            <p className="text-xs text-gray-400 max-w-md">
              こちらで選択したペン設定、図形ツールは、実際のホワイトボード画面に即座に反映され、よりスピーディな指導が可能です。
            </p>
          </div>

          <div className="flex gap-4 shrink-0 bg-white/5 p-4 rounded-xl border border-white/10 items-center">
            <div className="text-center px-4 border-r border-white/10">
              <span className="block text-[10px] text-gray-400 font-bold uppercase">現在のアクティブ色</span>
              <div className="flex items-center gap-2 mt-1.5 justify-center">
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: selectedColor }} />
                <span className="text-sm font-mono font-bold text-white">{selectedColor}</span>
              </div>
            </div>
            <div className="text-center px-4">
              <span className="block text-[10px] text-gray-400 font-bold uppercase">アクティブシェイプ</span>
              <span className="block text-sm font-bold text-white mt-1.5 capitalize">{selectedShape}</span>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
