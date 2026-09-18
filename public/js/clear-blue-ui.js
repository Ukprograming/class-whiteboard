// Progressive presentation controls; the existing inputs and change handlers
// remain the source of truth, including custom colors and all original values.
import { replaceMaterialIcons } from './ui-icons.js?v=clear-blue-20260917';
(() => {
  const COLORS = [
    ['#111827', '黒'], ['#ef4444', '赤'], ['#f97316', 'オレンジ'], ['#facc15', '黄'],
    ['#22c55e', '緑'], ['#0ea5e9', '青'], ['#6366f1', '藍'], ['#a855f7', '紫'],
  ];
  const choices = new Map();
  const palettes = new Map();
  let queued = false;

  const chromeToggle = document.getElementById('chromeToggle');
  chromeToggle?.addEventListener('click', () => {
    const hidden = document.body.classList.toggle('chrome-hidden');
    chromeToggle.setAttribute('aria-expanded', String(!hidden));
    const label = hidden ? 'ヘッダーと下部ツールバーを表示' : 'ヘッダーと下部ツールバーを非表示';
    chromeToggle.setAttribute('aria-label', label);
    chromeToggle.title = label;
    // Close the file popup so it does not reappear unexpectedly on restore.
    document.getElementById('fileMenuDropdown')?.classList.add('hidden');
  });

  function sync() {
    queued = false;
    replaceMaterialIcons();
    document.querySelectorAll('#penWidthSelect, #modalDrawWidthSelect').forEach(select => {
      if (choices.has(select)) return;
      const group = document.createElement('div');
      group.className = 'choice-buttons';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', select.getAttribute('aria-label') || '線の太さ');
      select.after(group);
      select.classList.add('choice-source');
      choices.set(select, { group, signature: '' });
    });
    for (const [select, state] of choices) {
      if (!select.isConnected) { choices.delete(select); continue; }
      const options = Array.from(select.options);
      const signature = JSON.stringify(options.map(o => [o.value, o.textContent, o.disabled]));
      if (state.signature !== signature) {
        state.signature = signature;
        state.group.replaceChildren(...options.map(option => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = option.textContent;
          button.dataset.value = option.value;
          button.addEventListener('click', () => {
            select.value = option.value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
            schedule();
          });
          return button;
        }));
      }
      Array.from(state.group.children).forEach((button, index) => {
        const disabled = select.disabled || options[index].disabled;
        if (button.disabled !== disabled) button.disabled = disabled;
        const selected = String(select.value === button.dataset.value);
        if (button.getAttribute('aria-pressed') !== selected) button.setAttribute('aria-pressed', selected);
      });
    }
    document.querySelectorAll('input[type="color"]').forEach(input => {
      if (palettes.has(input)) return;
      const group = document.createElement('span');
      group.className = 'input-color-palette';
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', input.getAttribute('aria-label') || '色を選択');
      input.before(group);
      const buttons = COLORS.map(([color, name]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'color-dot';
        button.style.setProperty('--c', color);
        button.style.backgroundColor = color;
        button.title = name;
        button.setAttribute('aria-label', name);
        button.dataset.color = color;
        button.addEventListener('click', event => {
          event.preventDefault(); // A surrounding label must not open the native picker.
          input.value = color;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          schedule();
        });
        group.append(button);
        return button;
      });
      group.append(input);
      input.title = 'その他の色（自由に指定）';
      if (!input.hasAttribute('aria-label')) input.setAttribute('aria-label', 'その他の色');
      palettes.set(input, buttons);
    });
    for (const [input, buttons] of palettes) {
      if (!input.isConnected) { palettes.delete(input); continue; }
      for (const button of buttons) {
        if (button.disabled !== input.disabled) button.disabled = input.disabled;
        const selected = String(button.dataset.color === input.value.toLowerCase());
        if (button.getAttribute('aria-pressed') !== selected) {
          button.setAttribute('aria-pressed', selected);
          button.classList.toggle('active', selected === 'true');
        }
      }
    }
    const menuButton = document.getElementById('fileMenuBtn');
    const menu = document.getElementById('fileMenuDropdown');
    if (menuButton && menu) menuButton.setAttribute('aria-expanded', String(!menu.classList.contains('hidden')));
    const toggle = document.getElementById('sidebarToggle');
    const sidebar = document.getElementById('wbSidebar');
    if (toggle && sidebar) {
      const expanded = !sidebar.classList.contains('collapsed');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.setAttribute('aria-label', expanded ? 'ツールバーを折りたたむ' : 'ツールバーを開く');
    }
    document.querySelectorAll('.mode-btn').forEach(button => {
      button.setAttribute('aria-pressed', String(button.classList.contains('active')));
      if (!button.hasAttribute('aria-label') && button.title) button.setAttribute('aria-label', button.title);
    });
    const labels = { clearBtn: '全消去', lockBtn: 'ロック', zoomOutBtn: '縮小', zoomInBtn: '拡大' };
    for (const [id, label] of Object.entries(labels)) {
      const button = document.getElementById(id);
      if (button && !button.hasAttribute('aria-label')) button.setAttribute('aria-label', label);
    }
    document.querySelectorAll('.color-dot').forEach(button => {
      if (!button.hasAttribute('aria-label')) {
        const color = button.style.getPropertyValue('--c').trim();
        button.setAttribute('aria-label', COLORS.find(([value]) => value.toLowerCase() === color.toLowerCase())?.[1] || `色 ${color}`);
      }
    });
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(sync);
  }
  // Observe only DOM/state changes relevant to controls, never canvas rendering.
  new MutationObserver(schedule).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['class', 'disabled', 'selected'],
  });
  document.addEventListener('change', schedule);
  document.addEventListener('input', schedule);
  document.addEventListener('click', schedule);
  sync();
})();
