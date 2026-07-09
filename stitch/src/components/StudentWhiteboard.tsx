import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Pencil, Eraser, MessageSquare, ChevronDown } from 'lucide-react';
import { Stroke } from '../types';

interface StudentWhiteboardProps {
  nickname: string;
  classCode: string;
  strokes: Stroke[];
  setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  onSubmit: () => void;
  onNavigateToChat: () => void;
}

export default function StudentWhiteboard({
  nickname,
  classCode,
  strokes,
  setStrokes,
  onSubmit,
  onNavigateToChat,
}: StudentWhiteboardProps) {
  const [tool, setTool] = useState<'pencil' | 'eraser' | 'line' | 'rect' | 'circle'>('pencil');
  const [color, setColor] = useState('black');
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<{ x: number; y: number }[]>([]);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // 初期のスケッチ描画用（サンプル）
  useEffect(() => {
    if (strokes.length === 0) {
      // 最初は簡単な数式を描いておく
      setStrokes([
        {
          points: [
            { x: 300, y: 200 },
            { x: 350, y: 200 },
            { x: 350, y: 250 },
            { x: 300, y: 250 },
            { x: 300, y: 300 },
            { x: 350, y: 300 },
          ], // '2'
          color: 'blue',
          width: 4,
        },
        {
          points: [
            { x: 380, y: 200 },
            { x: 420, y: 250 },
            { x: 380, y: 250 },
            { x: 420, y: 200 },
          ], // 'x'
          color: 'blue',
          width: 4,
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

    // SVG内の座標にマッピング
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

    if (tool === 'pencil' || tool === 'eraser') {
      setCurrentStroke((prev) => [...prev, coord]);
    } else {
      // 直線、長方形、円の場合は始点と現在の終点のみ保持
      setCurrentStroke((prev) => [prev[0], coord]);
    }
  };

  const handleEnd = () => {
    if (!isDrawing) return;
    setIsDrawing(false);

    if (currentStroke.length > 0) {
      let finalStroke: Stroke;

      if (tool === 'eraser') {
        // 消しゴムツール: 赤消しゴム色（あるいは透明・背景色。ここでは白か、あるいは当たり判定で削除ですが、お絵かきとして白で上書き）
        finalStroke = {
          points: currentStroke,
          color: '#ffffff', // background eraser
          width: 20,
        };
        setStrokes((prev) => [...prev, finalStroke]);
      } else if (tool === 'pencil') {
        finalStroke = {
          points: currentStroke,
          color: color,
          width: 4,
        };
        setStrokes((prev) => [...prev, finalStroke]);
      } else if (tool === 'line') {
        // 直線
        finalStroke = {
          points: currentStroke,
          color: color,
          width: 4,
        };
        setStrokes((prev) => [...prev, finalStroke]);
      } else if (tool === 'rect') {
        // 長方形
        const start = currentStroke[0];
        const end = currentStroke[1] || start;
        // 4隅のポイントをストロークにする、またはSVG側で個別に描画する。ここではポイントの並びで四角形を描画する
        const points = [
          start,
          { x: end.x, y: start.y },
          end,
          { x: start.x, y: end.y },
          start,
        ];
        finalStroke = {
          points,
          color: color,
          width: 4,
        };
        setStrokes((prev) => [...prev, finalStroke]);
      } else if (tool === 'circle') {
        // 円 (擬似的に多角形で円を描く)
        const start = currentStroke[0];
        const end = currentStroke[1] || start;
        const r = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
        const points = [];
        for (let i = 0; i <= 32; i++) {
          const angle = (i * 2 * Math.PI) / 32;
          points.push({
            x: start.x + r * Math.cos(angle),
            y: start.y + r * Math.sin(angle),
          });
        }
        finalStroke = {
          points,
          color: color,
          width: 4,
        };
        setStrokes((prev) => [...prev, finalStroke]);
      }
    }
    setCurrentStroke([]);
  };

  return (
    <div className="h-screen flex flex-col font-sans text-gray-800 overflow-hidden bg-[#f3f4f6]">
      {/* Top Header */}
      <header className="h-14 border-b border-gray-200 bg-white flex items-center justify-between px-4 z-10" data-purpose="top-navigation">
        <div className="flex items-center space-x-3">
          <button className="flex items-center space-x-1 border border-gray-300 rounded px-3 py-1 hover:bg-gray-50 transition-colors">
            <span className="text-sm">ファイル</span>
            <ChevronDown className="h-4 w-4 text-gray-500" />
          </button>
          <div className="text-xs text-gray-400 font-mono">
            生徒: {nickname} (クラス: {classCode})
          </div>
        </div>

        <div className="absolute left-1/2 -translate-x-1/2">
          <span className="text-sm font-medium">現在のモード：{tool === 'eraser' ? '消しゴム' : '描画'}</span>
        </div>

        <div className="flex items-center">
          <button
            onClick={onNavigateToChat}
            className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors bg-gray-100 hover:bg-gray-200 px-4 py-2 rounded-lg"
          >
            <MessageSquare className="h-5 w-5 text-gray-500" />
            <span>チャット</span>
          </button>
        </div>
      </header>

      {/* Main Workspace with canvas and floating drawing tools */}
      <main className="relative flex-grow flex items-center justify-center overflow-hidden">
        {/* SVG Drawing Canvas */}
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
          {/* Grid lines background */}
          <defs>
            <pattern id="grid" width="25" height="25" patternUnits="userSpaceOnUse">
              <path d="M 25 0 L 0 0 0 25" fill="none" stroke="#e5e7eb" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

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

          {/* Render current active drawing stroke */}
          {isDrawing && currentStroke.length > 1 && (
            <path
              d={`M ${currentStroke[0].x} ${currentStroke[0].y} ` +
                currentStroke.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')}
              fill="none"
              stroke={tool === 'eraser' ? '#dddddd' : color}
              strokeWidth={tool === 'eraser' ? 20 : 4}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={tool === 'eraser' ? '5,5' : undefined}
            />
          )}
        </svg>

        {/* Left Toolbar */}
        <aside className="absolute left-4 top-8 flex flex-col bg-white rounded-lg p-1.5 space-y-2 shadow-md border border-gray-200" data-purpose="drawing-toolbar">
          {/* Pencil Tool */}
          <button
            onClick={() => setTool('pencil')}
            className={`p-2 rounded transition-colors ${tool === 'pencil' ? 'bg-gray-100 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            title="ペン"
          >
            <Pencil className="h-6 w-6" />
          </button>

          {/* Eraser Tool */}
          <button
            onClick={() => setTool('eraser')}
            className={`p-2 rounded transition-colors ${tool === 'eraser' ? 'bg-gray-100 text-blue-600' : 'text-gray-500 hover:bg-gray-50'}`}
            title="消しゴム"
          >
            <Eraser className="h-6 w-6" />
          </button>

          <hr className="border-gray-200 mx-2 my-1" />

          {/* Colors Selection */}
          <div className="flex flex-col items-center space-y-2.5 py-2">
            {[
              { id: 'black', bg: 'bg-black' },
              { id: 'red', bg: 'bg-red-600' },
              { id: 'blue', bg: 'bg-blue-600' },
              { id: 'green', bg: 'bg-green-600' },
            ].map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setColor(c.id);
                  if (tool === 'eraser') setTool('pencil');
                }}
                className={`w-4.5 h-4.5 rounded-full ${c.bg} transition-all transform hover:scale-110 ${
                  color === c.id && tool !== 'eraser' ? 'ring-2 ring-offset-2 ring-blue-500' : ''
                }`}
                title={c.id}
              />
            ))}
          </div>

          <hr className="border-gray-200 mx-2 my-1" />

          {/* Shapes Tools */}
          {[
            { id: 'line', label: '直線', icon: 'M20 4L4 20' },
            { id: 'rect', label: '長方形', icon: 'M4 4h16v16H4z' },
          ].map((sh) => (
            <button
              key={sh.id}
              onClick={() => setTool(sh.id as any)}
              className={`p-2 rounded transition-colors text-xs font-bold ${
                tool === sh.id ? 'bg-gray-100 text-blue-600' : 'text-gray-500 hover:bg-gray-50'
              }`}
              title={sh.label}
            >
              <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d={sh.icon} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ))}

          {/* Circle Shape */}
          <button
            onClick={() => setTool('circle')}
            className={`p-2 rounded transition-colors ${
              tool === 'circle' ? 'bg-gray-100 text-blue-600' : 'text-gray-500 hover:bg-gray-50'
            }`}
            title="円"
          >
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="8" />
            </svg>
          </button>
        </aside>

        {/* Clear and Reset Buttons Floating bottom-left */}
        <div className="absolute bottom-6 left-6 flex bg-white rounded-xl shadow-md p-1 border border-gray-100">
          <button
            onClick={() => setStrokes([])}
            className="p-2.5 text-gray-400 hover:text-red-500 hover:bg-gray-50 rounded-lg transition-colors text-xs font-bold"
          >
            全消去
          </button>
        </div>

        {/* Bottom Right Floating Submission Button */}
        <div className="absolute bottom-6 right-6">
          <button
            onClick={onSubmit}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium px-8 py-3 rounded-lg text-lg flex items-center justify-center transition-all shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] transform active:scale-95"
            data-purpose="submit-button"
          >
            ノートを提出する
          </button>
        </div>
      </main>
    </div>
  );
}
