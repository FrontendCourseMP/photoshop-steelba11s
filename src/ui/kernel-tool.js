import { channelsFor } from '../domain/channels.js';
import { convolveRaster, kernelPresets, parseCoefficient } from '../domain/kernels.js';

const $ = id => document.getElementById(id);

export function createKernelTool({ preview, restore, commit, close }) {
  const dialog = $('kernel-dialog');
  const fields = [];
  let source, revision = 0, timer, applying = false, committing = false;

  for (const [id, preset] of Object.entries(kernelPresets)) $('kernel-preset').add(new Option(preset.name, id));
  $('kernel-preset').add(new Option('Своё ядро', 'custom'));
  for (let i = 0; i < 9; i++) {
    const input = document.createElement('input');
    input.type = 'text'; input.inputMode = 'decimal'; input.required = true;
    input.id = `kernel-value-${i}`;
    input.setAttribute('aria-label', `Ядро: строка ${Math.floor(i / 3) + 1}, столбец ${i % 3 + 1}`);
    input.autocomplete = 'off'; input.spellcheck = false;
    input.addEventListener('input', () => { if (dialog.open && !applying) { $('kernel-preset').value = 'custom'; refresh(); } });
    fields.push(input); $('kernel-grid').append(input);
  }

  function settings() {
    let invalid = false;
    const kernel = fields.map(input => {
      try { const value = parseCoefficient(input.value); input.setCustomValidity(''); return value; }
      catch (error) { invalid = true; input.setCustomValidity(error.message); return 0; }
    });
    if (invalid) throw new Error('Проверьте коэффициенты ядра: допустимы числа и дроби с ненулевым знаменателем.');
    const channels = [];
    for (const input of $('kernel-channels').querySelectorAll('input:checked')) {
      if (input.value === 'gray') channels.push(0, 1, 2);
      else channels.push({ red: 0, green: 1, blue: 2, alpha: 3 }[input.value]);
    }
    if (!channels.length) throw new Error('Выберите хотя бы один канал.');
    return { kernel, channels, padding: $('kernel-padding').value };
  }

  function progress(fraction, phase) {
    const percent = Math.round(fraction * 100);
    $('kernel-progress').hidden = false;
    $('kernel-progress').value = percent;
    const label = { copy: 'Подготовка', padding: 'Обработка краёв', convolution: 'Свёртка' }[phase];
    $('kernel-status').textContent = `${label} · ${percent}%`;
  }

  function clearProgress() { $('kernel-status').textContent = ''; $('kernel-progress').hidden = true; }
  function lock() {
    for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = applying;
    $('kernel-close').disabled = $('kernel-cancel').disabled = committing;
  }

  function finish(cancelled) {
    revision++; clearTimeout(timer);
    applying = false; committing = false; lock(); clearProgress();
    if (cancelled) restore();
    dialog.close(); close();
  }

  function refresh() {
    if (!dialog.open || applying) return;
    const current = ++revision;
    clearTimeout(timer); clearProgress();
    let parameters;
    try { parameters = settings(); $('kernel-error').textContent = ''; $('kernel-apply').disabled = false; }
    catch (error) { $('kernel-error').textContent = error.message; $('kernel-apply').disabled = true; restore(); return; }
    if (!$('kernel-preview').checked) { restore(); return; }
    $('kernel-status').textContent = 'Предпросмотр…';
    timer = setTimeout(async () => {
      try {
        const result = await convolveRaster(source, parameters, {
          cancelled: () => current !== revision,
          onProgress: (fraction, phase) => { if (current === revision) progress(fraction, phase); },
        });
        if (result && current === revision && dialog.open) {
          $('kernel-status').textContent = 'Отрисовка…';
          await preview(result);
        }
      } catch (error) { if (current === revision) { restore(); $('kernel-error').textContent = error.message; } }
      finally { if (current === revision) clearProgress(); }
    }, 120);
  }

  function setPreset(id) {
    $('kernel-preset').value = id;
    kernelPresets[id].values.forEach((value, index) => { fields[index].value = value; fields[index].setCustomValidity(''); });
  }

  function defaults() {
    setPreset('identity');
    $('kernel-padding').value = 'replicate';
    $('kernel-preview').checked = true;
    for (const input of $('kernel-channels').querySelectorAll('input')) input.checked = input.value !== 'alpha';
    $('kernel-error').textContent = '';
  }

  $('kernel-preset').addEventListener('change', () => { if (kernelPresets[$('kernel-preset').value]) setPreset($('kernel-preset').value); refresh(); });
  $('kernel-padding').addEventListener('change', refresh);
  $('kernel-preview').addEventListener('change', refresh);
  $('kernel-channels').addEventListener('change', refresh);
  $('kernel-reset').addEventListener('click', () => { defaults(); refresh(); });
  for (const id of ['kernel-close', 'kernel-cancel']) $(id).addEventListener('click', () => { if (!committing) finish(true); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!committing) finish(true); });
  $('kernel-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (applying) return;
    let parameters;
    try { parameters = settings(); }
    catch (error) { $('kernel-error').textContent = error.message; return; }
    const current = ++revision;
    clearTimeout(timer); applying = true; lock();
    $('kernel-error').textContent = '';
    try {
      const result = await convolveRaster(source, parameters, {
        cancelled: () => current !== revision,
        onProgress: (fraction, phase) => { if (current === revision) progress(fraction, phase); },
      });
      if (!result || current !== revision) return;
      committing = true; lock(); $('kernel-status').textContent = 'Применение…';
      await commit(result);
      finish(false);
    } catch (error) { if (current === revision) { restore(); $('kernel-error').textContent = error.message; } }
    finally { if (current === revision) { applying = false; committing = false; lock(); clearProgress(); } }
  });

  return {
    open(image) {
      source = image; revision++; clearTimeout(timer);
      applying = false; committing = false; lock(); clearProgress();
      $('kernel-channels').replaceChildren();
      for (const channel of channelsFor(image.metadata.model)) {
        const label = document.createElement('label'); label.className = 'check-field';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = channel.id;
        input.id = `kernel-channel-${channel.id}`;
        label.append(input, channel.short === 'A' ? 'Alpha' : channel.short);
        $('kernel-channels').append(label);
      }
      defaults(); dialog.showModal();
    },
  };
}
