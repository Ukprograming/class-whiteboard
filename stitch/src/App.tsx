import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Screen, ChatMessage, Stroke } from './types';

// Component Imports
import StudentLogin from './components/StudentLogin';
import TeacherLogin from './components/TeacherLogin';
import StudentWhiteboard from './components/StudentWhiteboard';
import StudentNoteSubmission from './components/StudentNoteSubmission';
import TeacherWhiteboard from './components/TeacherWhiteboard';
import FileDialog from './components/FileDialog';
import TeacherChatPanel from './components/TeacherChatPanel';
import StudentScreenMonitor from './components/StudentScreenMonitor';
import StudentScreenModal from './components/StudentScreenModal';
import SettingsPaletteDetail from './components/SettingsPaletteDetail';

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<Screen>('student_login');
  const [transitionType, setTransitionType] = useState<'push' | 'push_back' | 'slide_up' | 'none'>('none');

  // App-wide Shared States (Durable State Pattern)
  const [nickname, setNickname] = useState('たろう');
  const [classCode, setClassCode] = useState('123456');
  const [myStrokes, setMyStrokes] = useState<Stroke[]>([]);
  const [teacherStrokes, setTeacherStrokes] = useState<Stroke[]>([]);
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);

  // File Operations Modal State
  const [showFileDialog, setShowFileDialog] = useState(false);
  const [fileDialogOrigin, setFileDialogOrigin] = useState<Screen>('teacher_whiteboard');

  // Custom Toast State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Real-time synced Chat Messages list
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      id: 'msg_1',
      sender: '鈴木一郎',
      senderId: 'student_1',
      text: '先生、問4の解き方が分かりません。',
      timestamp: '10:02',
      isTeacher: false,
    },
    {
      id: 'msg_2',
      sender: 'あなた',
      senderId: 'teacher',
      text: 'まずはxの値を求めてから、両辺に2を掛けてみてね！',
      timestamp: '10:05',
      isTeacher: true,
    },
    {
      id: 'msg_3',
      sender: '田中太郎',
      senderId: 'student_2',
      text: 'これで合ってますか？（ノートを提出しました）',
      timestamp: '10:11',
      isTeacher: false,
    },
  ]);

  // Toast trigger helper
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => {
      setToastMessage(null);
    }, 4000);
  };

  // Safe Navigation with transition settings
  const navigateTo = (nextScreen: Screen, transition: 'push' | 'push_back' | 'slide_up' | 'none') => {
    setTransitionType(transition);
    setCurrentScreen(nextScreen);
  };

  // Add message helper
  const handleAddChatMessage = (senderId: string, text: string) => {
    const isTeacher = senderId === 'teacher';
    const newMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      sender: isTeacher ? 'あなた' : '鈴木一郎',
      senderId: senderId,
      text: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      isTeacher: isTeacher,
    };
    setChatMessages((prev) => [...prev, newMessage]);
  };

  // Trigger File Dialog Overlay
  const triggerFileDialog = (origin: Screen) => {
    setFileDialogOrigin(origin);
    setTransitionType('slide_up');
    setShowFileDialog(true);
  };

  const closeFileDialog = () => {
    setTransitionType('push_back');
    setShowFileDialog(false);
  };

  // Animation variants depending on transition selection
  const getVariants = () => {
    switch (transitionType) {
      case 'push':
        return {
          initial: { x: '100%', opacity: 0 },
          animate: { x: 0, opacity: 1 },
          exit: { x: '-100%', opacity: 0 },
        };
      case 'push_back':
        return {
          initial: { x: '-100%', opacity: 0 },
          animate: { x: 0, opacity: 1 },
          exit: { x: '100%', opacity: 0 },
        };
      case 'slide_up':
        return {
          initial: { y: '100%', opacity: 0 },
          animate: { y: 0, opacity: 1 },
          exit: { y: '100%', opacity: 0 },
        };
      case 'none':
      default:
        return {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
        };
    }
  };

  return (
    <div className="relative overflow-hidden w-screen h-screen bg-[#F0F2F5]">
      {/* Dynamic Slide In-Out Container */}
      <AnimatePresence mode="wait">
        <motion.div
          key={currentScreen}
          variants={getVariants()}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{ type: 'tween', duration: 0.35, ease: 'easeInOut' }}
          className="w-full h-full"
        >
          {/* SCREEN 1: Student Login */}
          {currentScreen === 'student_login' && (
            <StudentLogin
              onJoin={(nick, code) => {
                setNickname(nick);
                setClassCode(code);
                navigateTo('student_whiteboard', 'push');
              }}
              onNavigateToTeacher={() => navigateTo('teacher_login', 'push')}
            />
          )}

          {/* SCREEN 2: Student Whiteboard */}
          {currentScreen === 'student_whiteboard' && (
            <StudentWhiteboard
              nickname={nickname}
              classCode={classCode}
              strokes={myStrokes}
              setStrokes={setMyStrokes}
              onNavigateToChat={() => navigateTo('teacher_chat_panel', 'none')}
              onSubmit={() => navigateTo('student_note_submission', 'push')}
            />
          )}

          {/* SCREEN 3: Note Submission Screen (Student) */}
          {currentScreen === 'student_note_submission' && (
            <StudentNoteSubmission
              onBack={() => navigateTo('student_whiteboard', 'push_back')}
              onSubmitNotebook={(imageSrc) => {
                showToast('ノートが先生に正常に提出されました！');
                navigateTo('student_whiteboard', 'push_back');
              }}
            />
          )}

          {/* SCREEN 4: Teacher Login */}
          {currentScreen === 'teacher_login' && (
            <TeacherLogin
              onLogin={(code) => {
                setClassCode(code);
                navigateTo('student_screen_monitor', 'push');
              }}
              onNavigateToStudent={() => navigateTo('student_login', 'push_back')}
            />
          )}

          {/* SCREEN 5: Student Screen Confirmation View (Teacher Monitor) */}
          {currentScreen === 'student_screen_monitor' && (
            <StudentScreenMonitor
              students={[]} // Generated inside component as 24 slots
              myStrokes={myStrokes}
              onSelectStudent={(id) => {
                setSelectedStudentId(id);
                navigateTo('student_screen_modal', 'slide_up');
              }}
              onNavigateToPalette={() => navigateTo('settings_palette_detail', 'none')}
              onBackToBoard={() => navigateTo('teacher_whiteboard', 'push_back')}
            />
          )}

          {/* SCREEN 6: Student Screen Expansion Modal */}
          {currentScreen === 'student_screen_modal' && (
            <StudentScreenModal
              studentId={selectedStudentId || 'student_1'}
              studentName={selectedStudentId === 'student_1' ? 'たろう (あなた)' : '鈴木一郎'}
              myStrokes={myStrokes}
              onClose={() => navigateTo('student_screen_monitor', 'push_back')}
              onSendFeedback={(comment) => {
                showToast(`フィードバック「${comment}」を送信しました！`);
                navigateTo('student_screen_monitor', 'push_back');
              }}
            />
          )}

          {/* SCREEN 7: Settings Palette Detail */}
          {currentScreen === 'settings_palette_detail' && (
            <SettingsPaletteDetail onBackToGrid={() => navigateTo('student_screen_monitor', 'none')} />
          )}

          {/* SCREEN 8: Teacher Whiteboard */}
          {currentScreen === 'teacher_whiteboard' && (
            <TeacherWhiteboard
              strokes={teacherStrokes}
              setStrokes={setTeacherStrokes}
              onNavigateToFile={() => triggerFileDialog('teacher_whiteboard')}
              onNavigateToChat={() => navigateTo('teacher_chat_panel', 'none')}
              onNavigateToGrid={() => navigateTo('student_screen_monitor', 'push')}
            />
          )}

          {/* SCREEN 10: Teacher Chat Panel */}
          {currentScreen === 'teacher_chat_panel' && (
            <TeacherChatPanel
              chatMessages={chatMessages}
              onAddChatMessage={(destId, txt) => handleAddChatMessage(destId, txt)}
              onNavigateToBoard={() => navigateTo('teacher_whiteboard', 'none')}
              onNavigateToFile={() => triggerFileDialog('teacher_chat_panel')}
            />
          )}
        </motion.div>
      </AnimatePresence>

      {/* OVERLAY: File Operations Dialog (Screen 9) */}
      <AnimatePresence>
        {showFileDialog && (
          <FileDialog onClose={closeFileDialog} />
        )}
      </AnimatePresence>

      {/* Floating Elegant Toast Alert */}
      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-gray-900/95 text-white text-sm font-bold py-3.5 px-6 rounded-xl shadow-2xl flex items-center gap-2.5 z-50 backdrop-blur-md border border-white/10"
          >
            <span className="w-2.5 h-2.5 bg-green-400 rounded-full animate-ping" />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
