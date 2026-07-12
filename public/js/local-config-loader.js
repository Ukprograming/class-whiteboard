(() => {
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (!localHosts.has(window.location.hostname)) return;
  document.write('<script src="./js/app-config.local.js"><\/script>');
})();
