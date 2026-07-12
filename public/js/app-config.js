// Public staging config for GitHub Pages.
// A publishable key is designed to be public. Never put service-role/secret
// keys, database passwords, access tokens, or invite codes in this file.
window.CLASS_WHITEBOARD_CONFIG = {
  environment: "staging",
  teacherSignupEnabled: false,
  supabaseUrl: "https://jgovtvleosgymlffaxnu.supabase.co",
  supabaseAnonKey: "sb_publishable_6-eIWc7mFGm8Q4TpapjNFw_ddi8t7l4",
  storageBucket: "class-whiteboard",
  edgeFunctionBaseUrl: "https://jgovtvleosgymlffaxnu.supabase.co/functions/v1",
  realtimePrivateChannels: true,
  freeTierMode: true,
  thumbnailIntervalMs: 12000,
  monitoringIntervalMs: 8000,
  notebookIntervalMs: 12000,
  sharedBoardSnapshotIntervalMs: 60000,
  maxRealtimePayloadBytes: 180000,
};
