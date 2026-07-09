export type Screen =
  | 'student_login'
  | 'student_whiteboard'
  | 'student_note_submission'
  | 'teacher_login'
  | 'student_screen_monitor'
  | 'student_screen_modal'
  | 'settings_palette_detail'
  | 'teacher_whiteboard'
  | 'file_dialog'
  | 'teacher_chat_panel';

export interface Student {
  id: string;
  name: string;
  status: 'editing' | 'sharing' | 'waiting';
  sketchUrl?: string; // 手書き画像のURL
  sketchSvg?: string; // SVGでの手書き（リアルタイム同期用）
}

export interface ChatMessage {
  id: string;
  sender: string;
  senderId: string; // 'teacher' or student id
  text: string;
  timestamp: string;
  isTeacher: boolean;
}

export interface Stroke {
  points: { x: number; y: number }[];
  color: string;
  width: number;
}
