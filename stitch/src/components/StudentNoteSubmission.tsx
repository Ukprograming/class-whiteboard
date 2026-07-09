import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Camera, ChevronDown, Check, ArrowLeft } from 'lucide-react';

interface StudentNoteSubmissionProps {
  onBack: () => void;
  onSubmitNotebook: (imageSrc: string) => void;
}

export default function StudentNoteSubmission({ onBack, onSubmitNotebook }: StudentNoteSubmissionProps) {
  const [paperSize, setPaperSize] = useState('A4');
  const [hasCamera, setHasCamera] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [capturedImage, setCapturedImage] = useState<string>(
    'https://lh3.googleusercontent.com/aida-public/AB6AXuBZWkY_gXQu2uSvLU5gOvwlo3rtz3GO4UZQQkwsr6OL9Rz4VJOvCILH1VmC2hGFv5waGSulE4lU7RxTJ0ENWvPhi1vrOmynlU4sVz3ylrTnrthkcozeewQKheMkzfE3dea61P011e4hnNtkwBXJ1ila0fHHZZMeHVsyV1MIWpdWeZB7bbwMTzCcF2rIFME5TBRRICm6jWoSZcVN83dmepHGUAfoRlsHyOV9_aTBCsgmUTPZTEgjXu1rdA'
  );
  const [expandedFeedback, setExpandedFeedback] = useState<number | null>(4); // デフォルトで最後の先生のコメントを開いておく

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // カメラの起動
  useEffect(() => {
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
        }
        setHasCamera(true);
        setCameraActive(true);
      } catch (err) {
        console.warn('Camera could not be accessed, using mock instead:', err);
        setHasCamera(false);
        setCameraActive(false);
      }
    }
    startCamera();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // 撮影アクション
  const handleCapture = () => {
    if (cameraActive && videoRef.current) {
      const canvas = document.createElement('canvas');
      canvas.width = videoRef.current.videoWidth || 640;
      canvas.height = videoRef.current.videoHeight || 480;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        setCapturedImage(dataUrl);
      }
    } else {
      // モック撮影（画像を反転させたりして、撮影した風にする）
      const mockImages = [
        'https://lh3.googleusercontent.com/aida-public/AB6AXuBZWkY_gXQu2uSvLU5gOvwlo3rtz3GO4UZQQkwsr6OL9Rz4VJOvCILH1VmC2hGFv5waGSulE4lU7RxTJ0ENWvPhi1vrOmynlU4sVz3ylrTnrthkcozeewQKheMkzfE3dea61P011e4hnNtkwBXJ1ila0fHHZZMeHVsyV1MIWpdWeZB7bbwMTzCcF2rIFME5TBRRICm6jWoSZcVN83dmepHGUAfoRlsHyOV9_aTBCsgmUTPZTEgjXu1rdA',
        'https://lh3.googleusercontent.com/aida-public/AB6AXuD9q76uiOllPNmwv_YeT0Sy5YvKEUHERSnTQCmTxnaNDibAiQzR27TO9CWKCzvz5DUZt9Qd8n1FVGSiASIpZTAiDxCymXHozMr0pHSRMogdlTFuEjSe_6vLOIPo9fyHEpe5hdJZJHQxa6g5M9qShlyoy4EG2KTrUah8RuWjJmGlIdYdI4OoiaDlQfrxkGMzIqLiluh10EjuaAG-rZiawLn0Ojr4L1SHRFETmbk2xregDpPlas0c9tW3dA'
      ];
      // ランダムに切り替え
      const nextIdx = Math.floor(Math.random() * mockImages.length);
      setCapturedImage(mockImages[nextIdx]);
    }
  };

  const handleSendNote = () => {
    onSubmitNotebook(capturedImage);
  };

  const feedbacks = [
    { id: 1, text: 'よくできました。次のステップに進んでください。', isAnnotated: false },
    { id: 2, text: '今日もみたいから募集しています。', isAnnotated: false },
    { id: 3, text: '先生提出していたんです。', isAnnotated: false },
    { id: 4, text: '先生はあかったんです。次のステップには進んでください。', isAnnotated: false },
    {
      id: 5,
      title: '先生のみになってです。',
      text: 'よくできました。次のステップに進んでください。',
      isAnnotated: true,
      image: 'https://lh3.googleusercontent.com/aida-public/AB6AXuD9q76uiOllPNmwv_YeT0Sy5YvKEUHERSnTQCmTxnaNDibAiQzR27TO9CWKCzvz5DUZt9Qd8n1FVGSiASIpZTAiDxCymXHozMr0pHSRMogdlTFuEjSe_6vLOIPo9fyHEpe5hdJZJHQxa6g5M9qShlyoy4EG2KTrUah8RuWjJmGlIdYdI4OoiaDlQfrxkGMzIqLiluh10EjuaAG-rZiawLn0Ojr4L1SHRFETmbk2xregDpPlas0c9tW3dA'
    }
  ];

  return (
    <div className="min-h-screen flex flex-col font-sans text-gray-800 bg-[#f8fafc] bg-[linear-gradient(to_right,#e2e8f0_1px,transparent_1px),linear-gradient(to_bottom,#e2e8f0_1px,transparent_1px)] bg-[size:20px_20px]">
      {/* Top Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between sticky top-0 z-50 shadow-sm" data-purpose="main-header">
        <div className="flex items-center gap-4">
          <button
            onClick={onBack}
            aria-label="Back"
            className="p-2 hover:bg-gray-100 rounded-full transition-colors focus:outline-none"
          >
            <ArrowLeft className="h-6 w-6 text-gray-600" />
          </button>
          <h1 className="text-xl font-bold">ノート提出画面（生徒用）</h1>
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">用紙サイズ</span>
            <select
              value={paperSize}
              onChange={(e) => setPaperSize(e.target.value)}
              className="rounded border-gray-300 py-1.5 pl-3 pr-8 text-sm focus:ring-[#3182ce] focus:border-[#3182ce]"
              data-purpose="paper-size-select"
            >
              <option>A4</option>
              <option>B5</option>
            </select>
          </div>

          <button
            onClick={handleSendNote}
            className="bg-[#3182ce] hover:bg-blue-700 text-white px-6 py-2 rounded-md font-medium shadow-sm transition-all"
            data-purpose="submit-button"
          >
            提出する
          </button>
        </div>
      </header>

      {/* Main Grid Content */}
      <main className="flex-grow p-6 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-[1400px] mx-auto w-full">
        
        {/* Column 1: Camera Block */}
        <section className="bg-white rounded-lg shadow-md flex flex-col overflow-hidden" data-purpose="camera-card">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold">カメラ</h2>
          </div>
          <div className="p-5 flex-grow space-y-6 flex flex-col justify-between">
            <div className="aspect-[4/3] bg-gray-950 rounded-lg relative overflow-hidden flex items-center justify-center border border-gray-300" data-purpose="camera-feed">
              {cameraActive ? (
                <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
              ) : (
                <div className="text-white opacity-50 flex flex-col items-center p-4 text-center">
                  <Camera className="h-16 w-16 mb-2" />
                  <span className="text-sm font-medium">Live Camera Feed</span>
                  <span className="text-xs text-gray-400 mt-1">（ブラウザのカメラを取得中、または許可されていません）</span>
                </div>
              )}
            </div>

            <div data-purpose="camera-selector" className="space-y-2">
              <label className="block text-sm font-bold text-gray-700">カメラ選択</label>
              <div className="border border-[#3182ce] rounded-md divide-y overflow-hidden shadow-sm">
                <div className="p-3 flex justify-between items-center bg-blue-50 text-brand-blue cursor-pointer">
                  <span className="text-sm text-[#3182ce] font-medium">Webcam B-X366(登録) Web Camera (有効)</span>
                  <Check className="h-4 w-4 text-[#3182ce]" />
                </div>
                <div className="p-3 bg-white text-gray-600 hover:bg-gray-50 cursor-pointer">
                  <span className="text-sm">Alternative Back Camera</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Column 2: Capture Preview Block */}
        <section className="bg-white rounded-lg shadow-md flex flex-col overflow-hidden" data-purpose="preview-card">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold">キャプチャプレビュー</h2>
          </div>
          <div className="p-5 flex-grow flex flex-col items-center justify-between">
            <div className="flex-grow w-full bg-gray-50 rounded-lg flex items-center justify-center mb-6 p-4 border border-gray-200 min-h-[300px]">
              <img
                alt="Captured Notebook Preview"
                className="max-h-full max-w-full object-contain shadow-sm border border-gray-300 rounded"
                data-purpose="preview-image"
                src={capturedImage}
              />
            </div>

            <button
              onClick={handleCapture}
              className="w-full flex items-center justify-center gap-2 border-2 border-[#3182ce] text-[#3182ce] px-8 py-2.5 rounded-md font-bold hover:bg-blue-50 transition-colors"
              data-purpose="capture-button"
            >
              <Camera className="h-6 w-6" />
              撮影する
            </button>
          </div>
        </section>

        {/* Column 3: Teacher Feedbacks */}
        <section className="bg-white rounded-lg shadow-md flex flex-col overflow-hidden" data-purpose="feedback-card">
          <div className="p-5 border-b border-gray-100">
            <h2 className="text-lg font-bold">先生からのフィードバック</h2>
          </div>
          <div className="flex-grow overflow-y-auto max-h-[550px] p-5 space-y-3 custom-scrollbar" data-purpose="feedback-list">
            {feedbacks.map((item, idx) => {
              if (!item.isAnnotated) {
                return (
                  <div
                    key={item.id}
                    onClick={() => setExpandedFeedback(idx)}
                    className={`p-4 bg-white border rounded-lg text-sm hover:bg-gray-50 cursor-pointer transition-all ${
                      expandedFeedback === idx ? 'border-blue-300 ring-2 ring-blue-100' : ''
                    }`}
                  >
                    {item.text}
                  </div>
                );
              } else {
                return (
                  <div
                    key={item.id}
                    className="border rounded-lg overflow-hidden bg-white ring-1 ring-gray-200 shadow-sm"
                    data-purpose="expanded-feedback"
                  >
                    <div
                      onClick={() => setExpandedFeedback(expandedFeedback === idx ? null : idx)}
                      className="p-4 bg-gray-50 flex justify-between items-center border-b cursor-pointer hover:bg-gray-100 transition-colors"
                    >
                      <span className="text-sm font-medium">{item.title}</span>
                      <ChevronDown
                        className={`h-4 w-4 text-gray-500 transition-transform duration-200 ${
                          expandedFeedback === idx ? 'transform rotate-180' : ''
                        }`}
                      />
                    </div>

                    {expandedFeedback === idx && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="p-4 bg-white flex gap-4 border-t border-gray-100"
                      >
                        <div className="w-1/2 border border-gray-200 rounded overflow-hidden">
                          <img
                            alt="Graded Notebook with Red Marks"
                            className="w-full h-auto object-cover"
                            data-purpose="annotated-image"
                            src={item.image}
                          />
                        </div>
                        <div className="w-1/2 flex flex-col justify-center">
                          <div className="text-[#c53030] font-bold text-lg leading-relaxed">
                            よくできました。
                            <br />
                            次のステップに
                            <br />
                            進んでください。
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </div>
                );
              }
            })}
          </div>
        </section>

      </main>
    </div>
  );
}
