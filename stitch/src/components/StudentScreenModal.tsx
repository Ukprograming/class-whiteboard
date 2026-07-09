import React, { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { X, Pencil, Eraser, Check, Send } from 'lucide-react';
import { Stroke } from '../types';

interface StudentScreenModalProps {
  studentName: string;
  studentId: string;
  myStrokes: Stroke[]; // 生徒「たろう」が現在描いたストローク
  onClose: () => void;
  onSendFeedback: (comment: string) => void;
}

export default function StudentScreenModal({
  studentName,
  studentId,
  myStrokes,
  onClose,
  onSendFeedback,
}: StudentScreenModalProps) {
  const [tool, setTool] = useState<'pencil' | 'eraser'>('pencil');
  const [color, setColor] = useState('#C53030'); // 赤ペン指導
  const [feedbackStrokes, setFeedbackStrokes] = useState<Stroke[]>([
    // 初期指導用の大きな赤マルのストロークなど
    {
      points: [
        { x: 300, y: 300 },
        { x: 350, y: 250 },
        { x: 450, y: 250 },
        { x: 500, y: 300 },
        { x: 480, y: 400 },
        { x: 380, y: 450 },
        { x: 300, y: 400 },
        { x: 300, y: 300 },
      ], // 大きな「ハナマル」風の円
      color: '#C53030',
      width: 6,
    }
  ]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
  const [comment, setComment] = useState('よくできました。次のステップに進んでください。');

  const svgRef = useRef<SVGSVGElement | null>(null);

  const colors = [
    { id: '#C53030', name: '赤', bg: 'bg-[#C53030]' },
    { id: '#F56565', name: '明るい赤', bg: 'bg-[#F56565]' },
    { id: '#2B6CB0', name: '青', bg: 'bg-[#2B6CB0]' },
    { id: '#2F855A', name: '緑', bg: 'bg-[#2F855A]' },
    { id: '#1A202C', name: '黒', bg: 'bg-[#1A202C]' },
  ];

  const getCoordinates = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const rect = svgRef.current.getBoundingClientRect();

    let clientX = 0;
    let clientY = 0;

    if ('touches' in e) {
      if (e.touches.length === 0) return { x: 0, y: 0 };
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = ((clientX - rect.left) / rect.width) * 1000;
    const y = ((clientY - rect.top) / rect.height) * 800;
    return { x, y };
  };

  const handleStart = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    e.preventDefault();
    const coord = getCoordinates(e);
    setIsDrawing(true);
    setCurrentStroke([coord]);
  };

  const handleMove = (e: React.MouseEvent<SVGSVGElement> | React.TouchEvent<SVGSVGElement>) => {
    if (!isDrawing) return;
    const coord = getCoordinates(e);
    setCurrentStroke((prev) => [...prev, coord]);
  };

  const handleEnd = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentStroke.length > 0) {
      const finalStroke: Stroke = {
        points: currentStroke,
        color: tool === 'eraser' ? '#ffffff' : color,
        width: tool === 'eraser' ? 24 : 6,
      };
      setFeedbackStrokes((prev) => [...prev, finalStroke]);
    }
    setCurrentStroke([]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSendFeedback(comment);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-xs">
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[1100px] h-[90vh] flex flex-col overflow-hidden border border-gray-100"
        data-purpose="screen-expansion-modal"
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-gray-200 flex items-center justify-between shrink-0 bg-gray-50">
          <div className="flex items-center space-x-2">
            <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-full">
              回答拡大
            </span>
            <h2 className="text-lg font-bold text-gray-800">
              {studentName} さん のノート
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-200 rounded-full transition-colors focus:outline-none text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <X className="w-7 h-7 text-gray-400" />
          </button>
        </header>

        {/* Content Columns */}
        <div className="flex-grow flex flex-col md:flex-row overflow-hidden">
          {/* Left Block: Interactive grading canvas */}
          <section className="flex-grow bg-[#F7FAFC] p-4 flex flex-col relative border-r border-gray-200">
            <div className="text-xs font-bold text-gray-400 uppercase mb-2 tracking-wide flex items-center justify-between">
              <span>赤ペン指導キャンバス</span>
              <span className="text-[10px] text-red-500 lowercase">※ドラッグして直接赤ペンでハナマル等を描けます</span>
            </div>

            <div className="flex-grow bg-white border border-gray-200 rounded-xl overflow-hidden relative shadow-inner">
              <svg
                ref={svgRef}
                className="w-full h-full cursor-crosshair select-none touch-none"
                viewBox="0 0 1000 800"
                onMouseDown={handleStart}
                onMouseMove={handleMove}
                onMouseUp={handleEnd}
                onMouseLeave={handleEnd}
                onTouchStart={handleStart}
                onTouchMove={handleMove}
                onTouchEnd={handleEnd}
              >
                {/* Math sheet grid background for notebook styling */}
                <defs>
                  <pattern id="modalGrid" width="30" height="30" patternUnits="userSpaceOnUse">
                    <path d="M 30 0 L 0 0 0 30" fill="none" stroke="#edf2f7" strokeWidth="1" />
                  </pattern>
                </defs>
                <rect width="100%" height="100%" fill="url(#modalGrid)" />

                {/* Render Student's original work in background */}
                {studentId === 'student_1' ? (
                  myStrokes.map((stroke, index) => {
                    if (stroke.points.length < 2) return null;
                    const pathData = `M ${stroke.points[0].x} ${stroke.points[0].y} ` +
                      stroke.points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ');
                    return (
                      <path
                        key={`std-${index}`}
                        d={pathData}
                        fill="none"
                        stroke={stroke.color}
                        strokeWidth={stroke.width + 1}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        opacity={0.65}
                      />
                    );
                  })
                ) : (
                  // ダミーの手書き数式
                  <g opacity={0.6}>
                    <path d="M 150 150 Q 250 100 350 200 T 550 100" fill="none" stroke="#2B6CB0" strokeWidth="4" />
                    <text x="180" y="250" fontSize="28" fontWeight="bold" fill="#1A202C">y = x² + 2x - 4</text>
                  </g>
                )}

                {/* Render feedback strokes on top */}
                {feedbackStrokes.map((stroke, index) => {
                  if (stroke.points.length < 2) return null;
                  const pathData = `M ${stroke.points[0].x} ${stroke.points[0].y} ` +
                    stroke.points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ');
                  return (
                    <path
                      key={`fb-${index}`}
                      d={pathData}
                      fill="none"
                      stroke={stroke.color}
                      strokeWidth={stroke.width}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  );
                })}

                {/* Render current feedback drawing stroke */}
                {isDrawing && currentStroke.length > 1 && (
                  <path
                    d={`M ${currentStroke[0].x} ${currentStroke[0].y} ` +
                      currentStroke.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')}
                    fill="none"
                    stroke={tool === 'eraser' ? '#ffffff' : color}
                    strokeWidth={tool === 'eraser' ? 24 : 6}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>

              {/* Floating Mini toolbar */}
              <div className="absolute top-4 left-4 flex bg-white rounded-xl shadow-md p-1 border border-gray-200 gap-1">
                <button
                  onClick={() => setTool('pencil')}
                  className={`p-2 rounded-lg transition-colors ${tool === 'pencil' ? 'bg-red-50 text-red-600 font-bold' : 'text-gray-400 hover:bg-gray-50'}`}
                  title="ペン"
                >
                  <Pencil className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setTool('eraser')}
                  className={`p-2 rounded-lg transition-colors ${tool === 'eraser' ? 'bg-red-50 text-red-600 font-bold' : 'text-gray-400 hover:bg-gray-50'}`}
                  title="消しゴム"
                >
                  <Eraser className="h-5 w-5" />
                </button>
                <button
                  onClick={() => setFeedbackStrokes([])}
                  className="p-2 text-xs font-bold text-gray-400 hover:text-red-500 hover:bg-gray-50 rounded-lg"
                >
                  指導全消去
                </button>
              </div>
            </div>
          </section>

          {/* Right Block: Feedback settings & submit */}
          <aside className="w-full md:w-[350px] p-6 flex flex-col justify-between shrink-0 bg-white">
            <div className="space-y-6">
              {/* Color Selection Palette */}
              <div className="space-y-3">
                <label className="block text-sm font-bold text-gray-700">指導カラー</label>
                <div className="flex gap-2.5">
                  {colors.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        setColor(c.id);
                        if (tool === 'eraser') setTool('pencil');
                      }}
                      className={`w-8 h-8 rounded-full ${c.bg} transition-all transform hover:scale-110 flex items-center justify-center ${
                        color === c.id && tool === 'pencil' ? 'ring-2 ring-offset-2 ring-blue-400' : ''
                      }`}
                      title={c.name}
                    >
                      {color === c.id && tool === 'pencil' && (
                        <Check className="h-4 w-4 text-white font-black" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text feedback editor */}
              <form onSubmit={handleSubmit} className="space-y-3">
                <label className="block text-sm font-bold text-gray-700" htmlFor="feedback-comment">
                  フィードバックコメント
                </label>
                <textarea
                  id="feedback-comment"
                  className="w-full h-32 border border-gray-300 rounded-xl p-3 text-sm focus:outline-none focus:border-red-500"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="例: よくできました。次のステップに進んでください。"
                />
              </form>
            </div>

            {/* Submit Action Button */}
            <div className="pt-4 border-t border-gray-150">
              <button
                onClick={handleSubmit}
                className="w-full bg-[#E53E3E] hover:bg-[#C53030] text-white font-bold py-3.5 px-4 rounded-xl transition-all shadow-[0_4px_14px_0_rgba(229,62,62,0.39)] flex items-center justify-center gap-2 transform active:scale-95"
                data-purpose="send-feedback-btn"
              >
                <Send className="h-5 w-5" />
                <span>フィードバックを送信</span>
              </button>
            </div>
          </aside>
        </div>

      </motion.div>
    </div>
  );
}
