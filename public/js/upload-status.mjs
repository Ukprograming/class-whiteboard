export function installUploadStatus() {
  const panel = document.createElement('section');
  panel.className = 'board-upload-status hidden';
  panel.setAttribute('aria-label', 'ファイル送信状況');
  const label = document.createElement('p');
  label.setAttribute('role', 'status');
  label.setAttribute('aria-live', 'polite');
  const progress = document.createElement('progress');
  progress.max = 100;
  progress.setAttribute('aria-label', 'ファイル送信の進捗');
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '閉じる';
  panel.append(label, progress, close);
  document.body.append(panel);
  const jobs = new Map();
  let lastText = '';
  const render = () => {
    panel.classList.toggle('hidden', jobs.size === 0);
    if (!jobs.size) return;
    const active = [...jobs.values()].filter(job => job.state === 'uploading');
    const job = active.at(-1) || [...jobs.values()].at(-1);
    const percent = Math.min(100, Math.floor((job.sent || 0) / job.total * 100)) || 0;
    const message = job.state === 'error'
      ? 'ファイル送信に失敗しました。接続を確認して、もう一度ボードを保存してください。'
      : job.retrying
        ? '接続を確認しています。送信済みの位置から自動で再試行します…'
        : `ファイル送信中 ${percent}%${active.length > 1 ? `（${active.length}件）` : ''}：${job.fileName}。送信後にボードを保存します。`;
    if (message !== lastText) { label.textContent = message; lastText = message; }
    progress.value = percent;
    progress.hidden = job.state === 'error';
    close.hidden = active.length > 0;
  };
  close.addEventListener('click', () => { jobs.clear(); render(); });
  window.addEventListener('board-asset-upload', ({ detail }) => {
    if (!detail?.id) return;
    if (detail.state === 'complete') jobs.delete(detail.id);
    else {
      // A new save supersedes an old error message, never another active upload.
      if (!jobs.has(detail.id)) {
        for (const [id, job] of jobs) if (job.state === 'error') jobs.delete(id);
      }
      jobs.set(detail.id, { ...jobs.get(detail.id), ...detail });
    }
    render();
  });
}
