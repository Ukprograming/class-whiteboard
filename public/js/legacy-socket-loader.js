(() => {
  const config = window.CLASS_WHITEBOARD_CONFIG || {};
  const supabaseConfigured = Boolean(config.supabaseUrl && config.supabaseAnonKey);
  if (supabaseConfigured) return;

  document.write('<script src="./socket.io/socket.io.js"><\/script>');
})();
