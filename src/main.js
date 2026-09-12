import { readImage, imageBlob } from './io/browser-image.js';
import { channelsFor, composeChannels, channelThumbnail } from './domain/channels.js';
import { rgbToLab, pixelAt } from './domain/color.js';
import { makeSample } from './domain/sample.js';
import { renderIcons } from './ui/icons.js';

const $ = id => document.getElementById(id);
const state = { source: null, view: null, enabled: new Set(), tool: 'pointer', fit: true, selection: null, loading: false, rendering: false, exporting: false, revision: 0 };
const canvas = $('canvas'), context = canvas.getContext('2d');
renderIcons();

function showError(error) {
  $('error-text').textContent = error.message || String(error);
  $('error').hidden = false;
}

function updateControls() {
  const unavailable = !state.source || state.loading;
  for (const id of ['eyedropper', 'fit', 'actual']) $(id).disabled = unavailable;
  $('open').disabled = $('empty-open').disabled = $('sample').disabled = state.loading;
  $('save').disabled = unavailable || state.rendering || state.exporting;
  for (const input of $('channels').querySelectorAll('input')) input.disabled = state.loading;
  $('workspace').setAttribute('aria-busy', String(state.loading || state.rendering));
}

function setTool(tool) {
  state.tool = tool;
  for (const id of ['pointer', 'eyedropper']) {
    $(id).classList.toggle('selected', id === tool);
    $(id).setAttribute('aria-pressed', String(id === tool));
  }
  canvas.classList.toggle('pipette-active', tool === 'eyedropper');
}

function fitImage() {
  if (!state.source) return;
  const { width, height } = state.source;
  const room = $('workspace');
  const padding = window.innerWidth <= 680 ? 32 : 64;
  const scale = state.fit ? Math.min(1, Math.max(1, room.clientWidth - padding) / width, Math.max(1, room.clientHeight - padding) / height) : 1;
  $('image-stage').style.width = `${width * scale}px`;
  $('image-stage').style.height = `${height * scale}px`;
  $('display-scale').textContent = `${Number((scale * 100).toFixed(1))} %`;
  $('fit').classList.toggle('selected', state.fit);
  $('actual').classList.toggle('selected', !state.fit);
  positionMarker();
}

function positionMarker() {
  const marker = $('pick-marker');
  marker.hidden = !state.selection;
  if (!state.selection || !state.source) return;
  marker.style.left = `${(state.selection.x + 0.5) / state.source.width * 100}%`;
  marker.style.top = `${(state.selection.y + 0.5) / state.source.height * 100}%`;
}

function resetPixel() {
  state.selection = null;
  for (const id of ['pixel-x', 'pixel-y', 'pixel-r', 'pixel-g', 'pixel-b', 'pixel-alpha', 'pixel-l', 'pixel-a', 'pixel-lab-b', 'hex']) $(id).textContent = '—';
  $('color-swatch').style.background = 'transparent';
  $('pick-state').textContent = 'Не выбран';
  positionMarker();
}

function showPixel() {
  if (!state.selection || !state.view) return;
  const { x, y } = state.selection;
  const rgba = pixelAt(state.view, x, y);
  if (!rgba) return;
  const [r, g, b, alpha] = rgba;
  const lab = rgbToLab(r, g, b);
  const values = { 'pixel-x': x, 'pixel-y': y, 'pixel-r': r, 'pixel-g': g, 'pixel-b': b, 'pixel-alpha': alpha, 'pixel-l': lab[0].toFixed(2), 'pixel-a': lab[1].toFixed(2), 'pixel-lab-b': lab[2].toFixed(2) };
  for (const [id, value] of Object.entries(values)) $(id).textContent = value;
  $('hex').textContent = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('').toUpperCase();
  $('color-swatch').style.background = `rgba(${r},${g},${b},${alpha / 255})`;
  $('pick-state').textContent = 'Выбран';
  positionMarker();
}

function drawChannelPanel() {
  const definitions = channelsFor(state.source.metadata.model);
  $('channel-model').textContent = `${definitions.length} · ${state.source.metadata.model === 'G' ? 'Gray' : state.source.metadata.model === 'GA' ? 'Gray + A' : state.source.metadata.model}`;
  $('channels').replaceChildren();
  for (const channel of definitions) {
    const label = document.createElement('label');
    label.className = 'channel-row';
    label.dataset.channel = channel.id;
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.enabled.has(channel.id);
    checkbox.setAttribute('aria-label', channel.name);
    const thumbFrame = document.createElement('span');
    thumbFrame.className = 'thumbnail';
    const thumb = document.createElement('canvas');
    const raster = channelThumbnail(state.source, channel.index);
    thumb.width = raster.width;
    thumb.height = raster.height;
    thumb.getContext('2d').putImageData(new ImageData(raster.data, raster.width, raster.height), 0, 0);
    thumb.setAttribute('aria-label', `Канал: ${channel.name}`);
    thumbFrame.append(thumb);
    const name = document.createElement('span');
    name.className = 'channel-name';
    name.textContent = channel.name;
    const badge = document.createElement('span');
    badge.className = `channel-badge ${channel.id}`;
    badge.textContent = channel.short;
    label.append(checkbox, thumbFrame, name, badge);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) state.enabled.add(channel.id);
      else state.enabled.delete(channel.id);
      renderView();
    });
    $('channels').append(label);
  }
}

async function renderView() {
  const revision = ++state.revision;
  state.rendering = true;
  updateControls();
  $('status').textContent = 'Обработка каналов…';
  try {
    const output = await composeChannels(state.source, state.source.metadata.model, new Set(state.enabled), () => revision !== state.revision);
    if (!output || revision !== state.revision) return;
    state.view = output;
    canvas.width = output.width;
    canvas.height = output.height;
    context.putImageData(new ImageData(output.data, output.width, output.height), 0, 0);
    showPixel();
    $('status').textContent = 'Готово';
  } catch (error) {
    if (revision === state.revision) showError(error);
  } finally {
    if (revision === state.revision) {
      state.rendering = false;
      updateControls();
    }
  }
}

async function installImage(source, name) {
  state.source = source;
  state.view = null;
  state.enabled = new Set(channelsFor(source.metadata.model).map(channel => channel.id));
  state.fit = true;
  state.filename = name.replace(/\.[^.]+$/, '');
  $('document-name').textContent = name;
  $('document-name').title = name;
  $('document-format').textContent = source.metadata.format;
  const original = source.metadata;
  $('dimensions').textContent = `${original.width ?? source.width} × ${original.height ?? source.height} px`;
  $('depth').textContent = source.metadata.depth;
  $('empty').hidden = true;
  $('image-stage').hidden = false;
  resetPixel();
  drawChannelPanel();
  fitImage();
  await renderView();
}

async function loadFile(file) {
  if (!file || state.loading) return;
  state.loading = true;
  $('error').hidden = true;
  $('status').textContent = 'Загрузка изображения…';
  updateControls();
  try {
    const image = await readImage(file);
    await installImage(image, file.name);
  } catch (error) {
    showError(error);
    $('status').textContent = state.source ? 'Изображение сохранено в рабочей области' : 'Файл не загружен';
  } finally {
    state.loading = false;
    updateControls();
    $('file').value = '';
  }
}

for (const id of ['open', 'empty-open']) $(id).addEventListener('click', () => $('file').click());
$('file').addEventListener('change', event => loadFile(event.target.files[0]));
$('sample').addEventListener('click', async () => {
  state.loading = true;
  updateControls();
  try { await installImage(makeSample(), 'Цветовая мишень.png'); }
  catch (error) { showError(error); }
  finally { state.loading = false; updateControls(); }
});
$('pointer').addEventListener('click', () => setTool('pointer'));
$('eyedropper').addEventListener('click', () => setTool('eyedropper'));
$('fit').addEventListener('click', () => { state.fit = true; fitImage(); });
$('actual').addEventListener('click', () => { state.fit = false; fitImage(); });
new ResizeObserver(fitImage).observe($('workspace'));

canvas.addEventListener('pointerdown', event => {
  if (event.button !== 0 || state.tool !== 'eyedropper' || !state.view || state.loading || state.rendering) return;
  const box = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - box.left) * state.view.width / box.width);
  const y = Math.floor((event.clientY - box.top) * state.view.height / box.height);
  if (!pixelAt(state.view, x, y)) return;
  state.selection = { x, y };
  showPixel();
});
canvas.addEventListener('keydown', event => {
  if (state.tool !== 'eyedropper' || !state.view || state.loading || state.rendering) return;
  const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1], Enter: [0, 0] };
  const offset = offsets[event.key];
  if (!offset) return;
  event.preventDefault();
  const selected = state.selection ?? { x: Math.floor(state.view.width / 2), y: Math.floor(state.view.height / 2) };
  state.selection = { x: Math.max(0, Math.min(state.view.width - 1, selected.x + offset[0])), y: Math.max(0, Math.min(state.view.height - 1, selected.y + offset[1])) };
  showPixel();
});

let dragDepth = 0;
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => {
  event.preventDefault();
  dragDepth = 0;
  $('workspace').classList.remove('dragging');
  const files = event.dataTransfer.files;
  if (files.length > 1) showError(new Error('Откройте одно изображение за раз.'));
  else loadFile(files[0]);
});
$('workspace').addEventListener('dragenter', event => {
  event.preventDefault();
  if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepth++; $('workspace').classList.add('dragging'); }
});
$('workspace').addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('workspace').classList.remove('dragging'); });
$('error-close').addEventListener('click', () => { $('error').hidden = true; });

const notes = { png: 'Без потерь, с сохранением прозрачности.', jpg: 'Прозрачность заменяется белым фоном. JPEG сохраняется с потерями.', gb7: '128 оттенков серого. Alpha меньше 128 станет прозрачной, от 128 — непрозрачной.' };
$('export-name').addEventListener('input', () => $('export-name').setCustomValidity(''));
$('export-dialog').addEventListener('cancel', event => { if (state.exporting) event.preventDefault(); });
function lockExport(locked) {
  for (const id of ['export-submit', 'export-close', 'export-cancel', 'export-format', 'export-name']) $(id).disabled = locked;
}
$('export-format').addEventListener('change', () => { $('export-note').textContent = notes[$('export-format').value]; });
$('save').addEventListener('click', () => {
  $('export-name').value = state.filename;
  $('export-dialog').showModal();
});
for (const id of ['export-close', 'export-cancel']) $(id).addEventListener('click', () => $('export-dialog').close());
$('export-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.exporting || !state.view) return;
  const name = $('export-name').value.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  if (!name) {
    $('export-name').setCustomValidity('Введите имя файла.');
    $('export-name').reportValidity();
    return;
  }
  state.exporting = true;
  lockExport(true);
  updateControls();
  const format = $('export-format').value;
  const snapshot = state.view;
  try {
    const blob = await imageBlob(snapshot, format);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${name}.${format}`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    $('export-dialog').close();
    $('status').textContent = `Сохранено: ${name}.${format}`;
  } catch (error) { $('export-dialog').close(); showError(error); }
  finally { state.exporting = false; lockExport(false); updateControls(); }
});
