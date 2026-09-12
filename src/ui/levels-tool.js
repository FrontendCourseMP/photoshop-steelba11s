import { applyLevels, buildHistograms, defaultLevels } from '../domain/levels.js';

const $ = id => document.getElementById(id);
const clamp = (v, low, high) => Math.min(high, Math.max(low, v));

export function createLevelsTool({ preview, restore, commit, close }) {
  const dialog = $('levels-dialog');
  let source, settings, max, histograms, revision = 0, session = 0, applying = false;
  const channel = () => $('levels-channel').value;
  const selected = () => settings[channel()];

  function fields() {
    const current = selected();
    $('levels-black').value = current.black;
    $('levels-white').value = current.white;
    $('levels-gamma').value = current.gamma;
    $('levels-black').max = current.white - 1;
    $('levels-white').min = current.black + 1;
    $('levels-white').max = max;
    $('histogram-end').textContent = max;
    const midpoint = current.black + (current.white - current.black) * 0.5 ** current.gamma;
    for (const [id, value, label] of [['black', current.black, 'Точка чёрного'], ['gamma', midpoint, 'Гамма'], ['white', current.white, 'Точка белого']]) {
      const marker = $(`marker-${id}`);
      marker.style.left = `${value / max * 100}%`;
      marker.setAttribute('aria-valuenow', id === 'gamma' ? current.gamma : value);
      marker.setAttribute('aria-valuetext', `${label}: ${id === 'gamma' ? current.gamma : value}`);
      marker.setAttribute('aria-valuemin', id === 'gamma' ? 0.1 : id === 'white' ? current.black + 1 : 0);
      marker.setAttribute('aria-valuemax', id === 'gamma' ? 9.9 : id === 'black' ? current.white - 1 : max);
    }
  }

  function histogram() {
    if (!histograms) return;
    const canvas = $('levels-histogram'), ctx = canvas.getContext('2d');
    const bins = histograms[channel()];
    const logarithmic = $('histogram-log').checked;
    let peak = 0;
    for (const value of bins) peak = Math.max(peak, value);
    const transform = value => logarithmic ? Math.log1p(value) : value;
    const height = canvas.height, width = canvas.width;
    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = '#394039';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath(); ctx.moveTo(0, height * i / 4); ctx.lineTo(width, height * i / 4); ctx.stroke();
    }
    ctx.fillStyle = { master: '#c3d4b3', red: '#ea8989', green: '#8ac797', blue: '#8eaded', alpha: '#bec6c0' }[channel()];
    bins.forEach((value, index) => {
      const barHeight = transform(peak) ? transform(value) / transform(peak) * (height - 6) : 0;
      ctx.fillRect(index * width / bins.length, height - barHeight, Math.max(1, width / bins.length), barHeight);
    });
    $('histogram-peak').textContent = logarithmic ? `log(1 + n) · ${Math.log1p(peak).toFixed(2)}` : `${peak.toLocaleString('ru-RU')} px`;
  }

  async function refreshPreview() {
    if (!dialog.open || applying) return;
    const current = ++revision;
    $('levels-error').textContent = '';
    if (!$('levels-preview').checked) { restore(); return; }
    $('levels-progress').textContent = 'Предпросмотр…';
    try {
      const result = await applyLevels(source, structuredClone(settings), max, () => current !== revision);
      if (result && current === revision) await preview(result);
    } catch (error) { if (current === revision) $('levels-error').textContent = error.message; }
    finally { if (current === revision) $('levels-progress').textContent = ''; }
  }

  function change(id, value) {
    if (!dialog.open || applying) return;
    const current = selected();
    if (!Number.isFinite(value)) return;
    if (id === 'black') current.black = clamp(Math.round(value), 0, current.white - 1);
    if (id === 'white') current.white = clamp(Math.round(value), current.black + 1, max);
    if (id === 'gamma') current.gamma = Math.round(clamp(value, .1, 9.9) * 100) / 100;
    fields();
    refreshPreview();
  }

  for (const id of ['black', 'white', 'gamma']) {
    $(`levels-${id}`).addEventListener('input', event => { if (event.target.validity.valid) change(id, event.target.valueAsNumber); });
    $(`levels-${id}`).addEventListener('change', event => { change(id, event.target.valueAsNumber); fields(); });
    const marker = $(`marker-${id}`);
    function move(event) {
      const bounds = $('levels-track').getBoundingClientRect();
      const value = clamp((event.clientX - bounds.left) / bounds.width, 0, 1) * max;
      const current = selected();
      change(id, id === 'gamma' ? Math.log(clamp((value - current.black) / (current.white - current.black), .0001, .9999)) / Math.log(.5) : value);
    }
    marker.addEventListener('pointerdown', event => {
      if (applying || event.button !== 0) return;
      event.preventDefault(); marker.focus(); marker.setPointerCapture(event.pointerId); move(event);
    });
    marker.addEventListener('pointermove', event => { if (marker.hasPointerCapture(event.pointerId)) move(event); });
    marker.addEventListener('pointerup', event => { if (marker.hasPointerCapture(event.pointerId)) marker.releasePointerCapture(event.pointerId); });
    marker.addEventListener('keydown', event => {
      if (applying || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : -1;
      if (event.key === 'Home') change(id, id === 'white' ? selected().black + 1 : id === 'gamma' ? 9.9 : 0);
      else if (event.key === 'End') change(id, id === 'black' ? selected().white - 1 : id === 'gamma' ? .1 : max);
      else change(id, selected()[id] + direction * (id === 'gamma' ? -.05 : 1));
    });
  }

  function finish() { revision++; session++; dialog.close(); close(); }
  function cancel() { if (applying) return; restore(); finish(); }
  $('levels-channel').addEventListener('change', () => { fields(); histogram(); });
  for (const id of ['histogram-linear', 'histogram-log']) $(id).addEventListener('change', histogram);
  $('levels-preview').addEventListener('change', () => { $('levels-progress').textContent = ''; refreshPreview(); });
  $('levels-reset').addEventListener('click', () => { settings = defaultLevels(max); fields(); refreshPreview(); });
  for (const id of ['levels-close', 'levels-cancel']) $(id).addEventListener('click', cancel);
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  $('levels-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (applying) return;
    applying = true;
    revision++;
    $('levels-error').textContent = '';
    $('levels-progress').textContent = 'Применение…';
    for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = true;
    try {
      const result = await applyLevels(source, settings, max);
      const colorChanged = ['red', 'green', 'blue'].some(id => settings[id].black !== 0 || settings[id].white !== max || settings[id].gamma !== 1);
      await commit(result, { colorChanged });
      finish();
    } catch (error) { $('levels-error').textContent = error.message; }
    finally {
      applying = false;
      for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = false;
      $('levels-progress').textContent = '';
    }
  });

  return {
    async open(image) {
      source = image;
      max = image.metadata.format === 'GB7' ? 127 : 255;
      settings = defaultLevels(max);
      histograms = null;
      const current = ++session;
      revision++;
      $('levels-channel').value = 'master';
      $('levels-channel').querySelector('[value="alpha"]').disabled = !image.metadata.model.endsWith('A');
      $('levels-preview').checked = true;
      $('histogram-linear').checked = true;
      $('levels-error').textContent = '';
      $('levels-progress').textContent = 'Гистограмма…';
      $('levels-histogram').getContext('2d').clearRect(0, 0, 768, 280);
      $('histogram-peak').textContent = '';
      fields();
      dialog.showModal();
      try {
        const result = await buildHistograms(source, max, () => current !== session);
        if (current === session && result) { histograms = result; histogram(); $('levels-progress').textContent = ''; }
      } catch (error) { if (current === session) $('levels-error').textContent = error.message; }
    },
  };
}
