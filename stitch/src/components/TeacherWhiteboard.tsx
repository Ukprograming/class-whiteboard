import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Pointer,
  Pencil,
  Highlighter,
  Eraser,
  StickyNote,
  Type,
  FileText,
  Smile,
  Grid,
  MessageSquare,
  FileDown
} from 'lucide-react';
import { Stroke } from '../types';

interface TeacherWhiteboardProps {
  strokes: Stroke[];
  setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  onNavigateToFile: () => void;
  onNavigateToChat: () => void;
  onNavigateToGrid: () => void;
}

export default function TeacherWhiteboard({
  strokes,
  setStrokes,
  onNavigateToFile,
  onNavigateToChat,
  onNavigateToGrid,
}: TeacherWhiteboardProps) {
  const [tool, setTool] = useState<'pointer' | 'pencil' | 'highlighter' | 'eraser' | 'shape'>('pencil');
  const [color, setColor] = useState('#2C5282'); // 先生用はブルーなどシックな色
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // 初期のスケッチ描画用（サンプル）
  useEffect(() => {
    if (strokes.length === 0) {
      setStrokes([
        {
          points: [
            { x: 150, y: 150 },
            { x: 300, y: 150 },
            { x: 225, y: 150 },
            { x: 225, y: 300 },
          ], // 'T'
          color: '#1A365D',
          width: 5,
        },
        {
          points: [
            { x: 320, y: 180 },
            { x: 320, y: 300 },
            { x: 380, y: 300 },
            { x: 380, y: 180 },
          ], // 'U'
          color: '#1A365D',
          width: 5,
        },
      ]);
    }
  }, []);

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
    if (tool === 'pointer') return;
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
      let finalStroke: Stroke;

      if (tool === 'eraser') {
        finalStroke = {
          points: currentStroke,
          color: '#ffffff',
          width: 28,
        };
      } else if (tool === 'highlighter') {
        finalStroke = {
          points: currentStroke,
          color: 'rgba(252, 211, 77, 0.5)', // 半透明のイエロー
          width: 14,
        };
      } else {
        finalStroke = {
          points: currentStroke,
          color: color,
          width: 5,
        };
      }

      setStrokes((prev) => [...prev, finalStroke]);
    }
    setCurrentStroke([]);
  };

  return (
    <div className="h-screen flex flex-col font-sans text-gray-800 overflow-hidden bg-[#e2e8f0]">
      {/* Top Header */}
      <header className="h-14 border-b border-gray-300 bg-white flex items-center justify-between px-6 z-10">
        <div className="flex items-center space-x-4">
          <button
            onClick={onNavigateToFile}
            data-purpose="file-menu"
            className="flex items-center space-x-1.5 border border-gray-300 rounded-[6px] px-3 py-1.5 hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            <span>ファイル</span>
            <ChevronDownIcon />
          </button>
          <span className="text-gray-400">|</span>
          <div className="text-base font-semibold text-gray-700">先生用ホワイトボード</div>
        </div>

        <div className="flex items-center space-x-4">
          {/* Layout Grid Switch Button */}
          <button
            onClick={onNavigateToGrid}
            className="p-2 text-gray-600 hover:text-blue-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
            title="生徒画面確認ビューへ"
          >
            <Grid className="h-5 w-5" />
          </button>

          {/* Chat Panel Switch Button */}
          <button
            onClick={onNavigateToChat}
            data-purpose="chat-button"
            className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg"
          >
            <MessageSquare className="h-5 w-5 text-gray-500" />
            <span>チャット</span>
          </button>
        </div>
      </header>

      {/* Workspace */}
      <main className="relative flex-grow flex items-center justify-center overflow-hidden">
        {/* Draw Area */}
        <svg
          ref={svgRef}
          className="w-full h-full bg-white select-none cursor-crosshair touch-none"
          viewBox="0 0 1000 800"
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onMouseLeave={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
        >
          {/* Dots background pattern */}
          <defs>
            <pattern id="dotGrid" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="10" cy="10" r="1.5" fill="#cbd5e1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#dotGrid)" />

          {/* Render past strokes */}
          {strokes.map((stroke, index) => {
            if (stroke.points.length < 2) return null;
            const pathData = `M ${stroke.points[0].x} ${stroke.points[0].y} ` +
              stroke.points.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ');
            return (
              <path
                key={index}
                d={pathData}
                fill="none"
                stroke={stroke.color}
                strokeWidth={stroke.width}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Render current stroke */}
          {isDrawing && currentStroke.length > 1 && (
            <path
              d={`M ${currentStroke[0].x} ${currentStroke[0].y} ` +
                currentStroke.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')}
              fill="none"
              stroke={tool === 'eraser' ? '#dddddd' : tool === 'highlighter' ? 'rgba(252, 211, 77, 0.6)' : color}
              strokeWidth={tool === 'eraser' ? 28 : tool === 'highlighter' ? 14 : 5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </svg>

        {/* Left Floating Palette (Teacher Toolbar) */}
        <aside className="absolute left-6 top-1/2 -translate-y-1/2 flex flex-col bg-white rounded-2xl p-2.5 space-y-3 shadow-xl border border-gray-100">
          <button
            onClick={() => setTool('pointer')}
            className={`p-2 rounded-xl transition-colors ${tool === 'pointer' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            title="選択"
          >
            <Pointer className="h-6 w-6" />
          </button>

          <button
            onClick={() => setTool('pencil')}
            className={`p-2 rounded-xl transition-colors ${tool === 'pencil' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            title="手書きペン"
          >
            <Pencil className="h-6 w-6" />
          </button>

          <button
            onClick={() => setTool('highlighter')}
            className={`p-2 rounded-xl transition-colors ${tool === 'highlighter' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            title="蛍光ペン"
          >
            <Highlighter className="h-6 w-6" />
          </button>

          <button
            onClick={() => setTool('eraser')}
            className={`p-2 rounded-xl transition-colors ${tool === 'eraser' ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            title="消しゴム"
          >
            <Eraser className="h-6 w-6" />
          </button>

          <hr className="border-gray-200" />

          {/* Color Palettes for Pencil */}
          <div className="flex flex-col items-center space-y-2 py-1">
            {[
              { id: '#2C5282', bg: 'bg-[#2C5282]' },
              { id: '#C53030', bg: 'bg-[#C53030]' },
              { id: '#2F855A', bg: 'bg-[#2F855A]' },
              { id: '#1A202C', bg: 'bg-[#1A202C]' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setColor(c.id);
                  if (tool === 'eraser' || tool === 'highlighter') setTool('pencil');
                }}
                className={`w-5 h-5 rounded-full ${c.bg} transition-all transform hover:scale-110 ${
                  color === c.id && tool === 'pencil' ? 'ring-2 ring-offset-2 ring-blue-500' : ''
                }`}
                title={c.id}
              />
            ))}
          </div>

          <hr className="border-gray-200" />

          <button className="p-2 rounded-xl text-gray-500 hover:bg-gray-50" title="付箋">
            <StickyNote className="h-6 w-6" />
          </button>

          <button className="p-2 rounded-xl text-gray-500 hover:bg-gray-50" title="テキスト">
            <Type className="h-6 w-6" />
          </button>

          <button className="p-2 rounded-xl text-gray-500 hover:bg-gray-50" title="スタンプ">
            <Smile className="h-6 w-6" />
          </button>

          {/* PDF Red Highlight Icon */}
          <button className="p-2 rounded-xl text-[#C53030] hover:bg-red-50 bg-red-100/50 flex flex-col items-center justify-center" title="PDF">
            <FileText className="h-6 w-6" />
            <span className="text-[9px] font-black tracking-tighter mt-0.5">PDF</span>
          </button>
        </aside>

        {/* Clear Action button */}
        <div className="absolute bottom-6 left-6 flex bg-white rounded-xl shadow-md p-1 border border-gray-200">
          <button
            onClick={() => setStrokes([])}
            className="px-4 py-2 text-gray-500 hover:text-red-500 hover:bg-gray-50 rounded-lg transition-colors text-sm font-medium"
          >
            画面をクリア
          </button>
        </div>
      </main>
    </div>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
