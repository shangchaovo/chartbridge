import {DEFAULT_DRAWING_COLOR, DRAWING_PALETTE, QUICK_DRAWING_COLORS, normalizeDrawingColor, colorRgb, rgbColor, colorHsv, hsvColor} from './drawing-colors.js';

let openPicker = null, nextId = 0;
export function mountDrawingColorControl({host, input, recent = () => [], onChange, beforeOpen}) {
  let color = normalizeDrawingColor(input.value) || DEFAULT_DRAWING_COLOR, hsv = colorHsv(color), disabled = false;
  const id = `drawing-color-popover-${++nextId}`;
  host.dataset.drawingColorControl = '';
  const swatch = (value, label = value.toUpperCase()) => `<button type="button" class="color-chip" data-color="${value}" style="--chip-color:${value}" title="${label}" aria-label="${label}" aria-pressed="false"></button>`;
  const controls = document.createElement('div');
  controls.className = 'drawing-color-controls';
  controls.innerHTML = `<button type="button" class="drawing-color-trigger" aria-label="画线颜色" title="颜色" aria-haspopup="dialog" aria-expanded="false" aria-controls="${id}"><span></span></button><span class="drawing-quick-colors" role="group" aria-label="快捷颜色">${QUICK_DRAWING_COLORS.map(([value, label]) => swatch(value, label)).join('')}</span>`;
  host.append(controls);
  const trigger = controls.querySelector('.drawing-color-trigger'), popup = document.createElement('div');
  popup.id = id; popup.className = 'drawing-color-popover'; popup.setAttribute('popover', 'manual');
  popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', '画线颜色');
  popup.innerHTML = `<div class="color-picker-heading"><strong>颜色</strong><button type="button" class="color-picker-close" aria-label="关闭颜色面板">×</button></div><div class="color-picker-quick"><span>常用颜色</span><div>${QUICK_DRAWING_COLORS.map(([value, label]) => swatch(value, label)).join('')}</div></div><div class="color-palette" role="group" aria-label="预设颜色">${DRAWING_PALETTE.map(value => swatch(value)).join('')}</div><div class="color-recent" hidden><span>最近使用</span><div class="color-recent-chips"></div></div><details class="color-custom"><summary>自定义颜色</summary><div class="color-sv" role="slider" tabindex="0" aria-label="饱和度与亮度" aria-valuemin="0" aria-valuemax="100"><span></span></div><label class="color-hue-label"><span>色相</span><input class="color-hue" type="range" min="0" max="359" step="1" aria-label="色相"></label><div class="color-values"><label>HEX<input class="color-hex" aria-label="HEX 颜色" maxlength="7" spellcheck="false"></label>${['R','G','B'].map(channel => `<label>${channel}<input class="color-rgb" type="number" min="0" max="255" step="1" aria-label="${channel}" required></label>`).join('')}</div></details><p class="color-picker-hint">所选颜色将用于之后的新图形</p>`;
  host.append(popup);
  const pad = popup.querySelector('.color-sv'), hue = popup.querySelector('.color-hue'), hex = popup.querySelector('.color-hex'), rgb = [...popup.querySelectorAll('.color-rgb')];
  function sync() {
    trigger.style.setProperty('--chip-color', color); trigger.title = `颜色 · ${color.toUpperCase()}`;
    host.querySelectorAll('[data-color]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.color === color)));
    hex.value = color.toUpperCase(); colorRgb(color).forEach((value, index) => { rgb[index].value = value; });
    hue.value = Math.round(hsv.h);
    pad.style.setProperty('--hue-color', hsvColor({h: hsv.h, s: 1, v: 1}));
    pad.querySelector('span').style.cssText = `left:${hsv.s * 100}%;top:${(1 - hsv.v) * 100}%;background:${color}`;
    pad.setAttribute('aria-valuenow', String(Math.round(hsv.s * 100)));
    pad.setAttribute('aria-valuetext', `饱和度 ${Math.round(hsv.s * 100)}%，亮度 ${Math.round(hsv.v * 100)}%`);
  }
  function select(value, closeAfter = false) {
    if (disabled || !normalizeDrawingColor(value)) return;
    color = normalizeDrawingColor(value); input.value = color; hsv = colorHsv(color); sync(); onChange?.(color);
    if (closeAfter) close(true);
  }
  function close(restoreFocus = false) {
    if (!popup.matches(':popover-open')) return;
    color = normalizeDrawingColor(input.value) || DEFAULT_DRAWING_COLOR; hsv = colorHsv(color); sync();
    popup.hidePopover(); trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keys, true);
    window.removeEventListener('resize', reposition); window.removeEventListener('scroll', reposition, true);
    host.closest('dialog')?.removeEventListener('close', close);
    if (openPicker === controller) openPicker = null;
    if (restoreFocus) trigger.focus();
  }
  function outside(event) { if (!host.contains(event.target)) close(); }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); }
    if (event.key === 'Tab') {
      const buttons = [...popup.querySelectorAll('button,input,summary,[tabindex="0"]')].filter(element => element.getClientRects().length && !element.disabled);
      if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
    }
  }
  function reposition() {
    const bounds = trigger.getBoundingClientRect(), pad = 8;
    popup.style.maxHeight = `${innerHeight - pad * 2}px`;
    popup.style.left = `${Math.max(pad, Math.min(bounds.left, innerWidth - popup.offsetWidth - pad))}px`;
    const below = bounds.bottom + 6;
    popup.style.top = `${Math.max(pad, below + popup.offsetHeight <= innerHeight - pad ? below : bounds.top - popup.offsetHeight - 6)}px`;
  }
  function open() {
    if (disabled) return;
    if (popup.matches(':popover-open')) { close(); return; }
    openPicker?.close(); beforeOpen?.(); openPicker = controller;
    const colors = [...new Set(recent().map(normalizeDrawingColor).filter(Boolean))].slice(0, 10);
    popup.querySelector('.color-recent').hidden = !colors.length;
    popup.querySelector('.color-recent-chips').innerHTML = colors.map(value => swatch(value)).join('');
    sync(); popup.showPopover(); reposition(); trigger.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', keys, true);
    window.addEventListener('resize', reposition); window.addEventListener('scroll', reposition, true);
    host.closest('dialog')?.addEventListener('close', close);
    popup.querySelector(`[data-color="${color}"]`)?.focus();
    if (!popup.contains(document.activeElement)) popup.querySelector('.color-picker-close').focus();
  }
  controls.addEventListener('click', event => {
    const chip = event.target.closest('[data-color]');
    if (chip) { select(chip.dataset.color); close(); } else if (event.target.closest('.drawing-color-trigger')) open();
  });
  popup.addEventListener('click', event => {
    const chip = event.target.closest('[data-color]');
    if (chip) select(chip.dataset.color, true);
  });
  popup.querySelector('.color-picker-close').onclick = () => close(true);
  popup.querySelector('details').addEventListener('toggle', () => { if (popup.matches(':popover-open')) reposition(); });
  hex.onchange = () => { const value = hex.value.trim(); if (normalizeDrawingColor(value.startsWith('#') ? value : `#${value}`)) select(value.startsWith('#') ? value : `#${value}`); else sync(); };
  hex.oninput = () => { const value = hex.value.trim(), normalized = normalizeDrawingColor(value.startsWith('#') ? value : `#${value}`); if (normalized) select(normalized); };
  rgb.forEach(field => {
    field.oninput = () => { if (rgb.every(element => element.value.trim() && element.validity.valid)) select(rgbColor(rgb.map(element => Number(element.value)))); };
    field.onchange = () => { if (rgb.every(element => element.value.trim() && element.validity.valid)) select(rgbColor(rgb.map(element => Number(element.value)))); else sync(); };
  });
  hue.oninput = () => { hsv.h = Number(hue.value); color = hsvColor(hsv); sync(); };
  hue.onchange = () => select(color);
  const sample = event => {
    const bounds = pad.getBoundingClientRect();
    hsv.s = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    hsv.v = 1 - Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    color = hsvColor(hsv); sync();
  };
  let pointer = null;
  pad.onpointerdown = event => { if (event.button !== 0) return; event.preventDefault(); pad.focus(); pointer = event.pointerId; pad.setPointerCapture(pointer); sample(event); };
  pad.onpointermove = event => { if (pointer === event.pointerId) sample(event); };
  pad.onpointerup = event => { if (pointer !== event.pointerId) return; sample(event); pointer = null; pad.releasePointerCapture(event.pointerId); select(color); };
  pad.onpointercancel = () => { pointer = null; color = normalizeDrawingColor(input.value) || DEFAULT_DRAWING_COLOR; hsv = colorHsv(color); sync(); };
  pad.onkeydown = event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation(); const step = event.shiftKey ? .1 : .01;
    if (event.key === 'ArrowLeft') hsv.s = Math.max(0, hsv.s - step);
    if (event.key === 'ArrowRight') hsv.s = Math.min(1, hsv.s + step);
    if (event.key === 'ArrowUp') hsv.v = Math.min(1, hsv.v + step);
    if (event.key === 'ArrowDown') hsv.v = Math.max(0, hsv.v - step);
    select(hsvColor(hsv));
  };
  const controller = {
    close,
    setColor(value) { color = normalizeDrawingColor(value) || DEFAULT_DRAWING_COLOR; input.value = color; hsv = colorHsv(color); sync(); },
    setDisabled(value) { disabled = value; if (disabled) close(); controls.querySelectorAll('button').forEach(button => { button.disabled = disabled; }); },
  };
  sync(); return controller;
}
