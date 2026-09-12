import { interpolationMethods, resizeRaster } from '../domain/resample.js';
import { validateSize } from '../domain/raster.js';

const $ = id => document.getElementById(id);
const round = value => Number(value.toFixed(4));

export function createResizeTool({ commit, close }) {
  const dialog = $('resize-dialog');
  let source, unit = 'px', applying = false;

  function dimensions() {
    const width = $('resize-width').valueAsNumber, height = $('resize-height').valueAsNumber;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Введите положительные ширину и высоту.');
    if (unit === 'px' && (!Number.isInteger(width) || !Number.isInteger(height))) throw new Error('Размеры в пикселях должны быть целыми.');
    const result = unit === 'px' ? { width, height } : { width: Math.round(source.width * width / 100), height: Math.round(source.height * height / 100) };
    validateSize(result.width, result.height);
    return result;
  }

  function summary() {
    try {
      const size = dimensions();
      $('resize-after').textContent = `${(size.width * size.height / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} Мп`;
      $('resize-pixels').textContent = `${size.width} × ${size.height} px`;
      $('resize-error').textContent = '';
      $('resize-apply').disabled = applying;
    } catch (error) {
      $('resize-after').textContent = '—';
      $('resize-pixels').textContent = '—';
      $('resize-error').textContent = error.message;
      $('resize-apply').disabled = true;
    }
  }

  function link(changed) {
    if ($('resize-linked').checked) {
      const value = $(`resize-${changed}`).valueAsNumber;
      if (Number.isFinite(value) && value > 0) {
        const other = changed === 'width' ? 'height' : 'width';
        const ratio = changed === 'width' ? source.height / source.width : source.width / source.height;
        $(`resize-${other}`).value = unit === 'percent' ? value : Math.max(1, Math.round(value * ratio));
      }
    }
    summary();
  }

  function methodDescription() {
    const text = interpolationMethods[$('resize-method').value].description;
    $('resize-method-info').title = text;
    $('resize-method-tooltip').textContent = text;
  }

  function cancel() { if (applying) return; dialog.close(); close(); }
  for (const id of ['resize-close', 'resize-cancel']) $(id).addEventListener('click', cancel);
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel(); });
  for (const id of ['width', 'height']) $(`resize-${id}`).addEventListener('input', () => link(id));
  $('resize-linked').addEventListener('change', () => link('width'));
  $('resize-method').addEventListener('change', methodDescription);
  $('resize-unit').addEventListener('change', () => {
    try {
      const size = dimensions();
      unit = $('resize-unit').value;
      $('resize-width').value = unit === 'px' ? size.width : round(size.width / source.width * 100);
      $('resize-height').value = unit === 'px' ? size.height : round(size.height / source.height * 100);
      for (const id of ['resize-width', 'resize-height']) {
        $(id).min = unit === 'px' ? 1 : .0001;
        $(id).step = unit === 'px' ? 1 : 'any';
      }
      summary();
    } catch (error) { $('resize-unit').value = unit; $('resize-error').textContent = error.message; }
  });
  $('resize-form').addEventListener('submit', async event => {
    event.preventDefault();
    if (applying) return;
    try {
      const size = dimensions();
      applying = true;
      for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = true;
      $('resize-progress').textContent = 'Изменение размера…';
      const result = await resizeRaster(source, size.width, size.height, $('resize-method').value);
      await commit(result);
      dialog.close(); close();
    } catch (error) { $('resize-error').textContent = error.message; }
    finally {
      applying = false;
      for (const control of dialog.querySelectorAll('button, input, select')) control.disabled = false;
      $('resize-progress').textContent = '';
    }
  });

  return {
    open(image) {
      source = image;
      unit = 'px';
      $('resize-unit').value = unit;
      $('resize-method').value = 'bilinear';
      $('resize-linked').checked = true;
      $('resize-width').value = image.width;
      $('resize-height').value = image.height;
      for (const id of ['resize-width', 'resize-height']) { $(id).min = 1; $(id).step = 1; }
      $('resize-before').textContent = `${(image.width * image.height / 1e6).toLocaleString('ru-RU', { maximumFractionDigits: 3 })} Мп`;
      $('resize-original').textContent = `${image.width} × ${image.height} px`;
      $('resize-progress').textContent = '';
      methodDescription(); summary(); dialog.showModal();
    },
  };
}
