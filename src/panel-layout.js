// Panel sizes are personal browser preferences, separate from the shared chart.
export function initPanelLayout() {
  const main = document.querySelector('.main-column');
  const workspace = document.querySelector('.workspace');
  const root = document.documentElement;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const panels = [
    {id:'research-resizer', key:'shanhai-research-height', css:'--research-height', axis:'y', className:'resizing-height',
      initial:() => Math.min(340, main.clientHeight * .42),
      bounds:() => {
        const fixed = [...main.children].filter(el => !el.matches('.chart-area,.research-dock')).reduce((sum, el) => sum + el.getBoundingClientRect().height, 0);
        const max = Math.max(120, main.clientHeight - fixed - (document.body.classList.contains('chart-collapsed') ? 0 : 200));
        return [Math.min(180, max), max];
      }},
    {id:'watchlist-resizer', key:'shanhai-watchlist-width', css:'--watchlist-width', axis:'x', className:'resizing-width',
      initial:() => 286,
      bounds:() => [240, Math.max(240, Math.min(560, workspace.clientWidth - 450))]},
  ];
  for (const panel of panels) {
    const handle = document.getElementById(panel.id);
    const stored = Number(localStorage.getItem(panel.key));
    panel.value = stored > 0 && Number.isFinite(stored) ? stored : panel.initial();
    const apply = value => {
      const [min, max] = panel.bounds();
      panel.value = clamp(value, min, max);
      root.style.setProperty(panel.css, `${Math.round(panel.value)}px`);
      handle.setAttribute('aria-valuemin', String(Math.round(min)));
      handle.setAttribute('aria-valuemax', String(Math.round(max)));
      handle.setAttribute('aria-valuenow', String(Math.round(panel.value)));
      handle.setAttribute('aria-valuetext', `${Math.round(panel.value)} 像素`);
    };
    const save = () => localStorage.setItem(panel.key, String(Math.round(panel.value)));
    panel.refresh = () => apply(panel.value);
    let drag = null;
    const coordinate = event => panel.axis === 'y' ? event.clientY : event.clientX;
    const end = (cancel = false) => {
      if (!drag) return;
      const {pointerId, value} = drag;
      drag = null;
      if (cancel) apply(value); else save();
      document.body.classList.remove(panel.className);
      if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    };
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag = {pointerId:event.pointerId, coordinate:coordinate(event), value:panel.value};
      handle.setPointerCapture(event.pointerId);
      handle.focus({preventScroll:true});
      document.body.classList.add(panel.className);
    });
    handle.addEventListener('pointermove', event => {
      if (drag?.pointerId === event.pointerId) apply(drag.value + drag.coordinate - coordinate(event));
    });
    handle.addEventListener('pointerup', () => end());
    handle.addEventListener('pointercancel', () => end(true));
    handle.addEventListener('lostpointercapture', () => end());
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && drag) {event.preventDefault(); end(true);}
    });
    handle.addEventListener('dblclick', () => {apply(panel.initial()); save();});
    handle.addEventListener('keydown', event => {
      const grow = panel.axis === 'y' ? 'ArrowUp' : 'ArrowLeft';
      const shrink = panel.axis === 'y' ? 'ArrowDown' : 'ArrowRight';
      if (![grow, shrink, 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const [min, max] = panel.bounds();
      apply(event.key === 'Home' ? min : event.key === 'End' ? max : panel.value + (event.key === grow ? 1 : -1) * (event.shiftKey ? 40 : 12));
      save();
    });
    apply(panel.value);
  }
  const refresh = () => panels.forEach(panel => panel.refresh());
  const observer = new ResizeObserver(refresh);
  observer.observe(main);
  observer.observe(workspace);
  return refresh;
}
