import Folder from '../../vendor/lucide/folder-open.js';
import Download from '../../vendor/lucide/download.js';
import Pointer from '../../vendor/lucide/mouse-pointer-2.js';
import Pipette from '../../vendor/lucide/pipette.js';
import Fit from '../../vendor/lucide/scan.js';
import ImageIcon from '../../vendor/lucide/image.js';
import Sliders from '../../vendor/lucide/sliders-horizontal.js';
import Scaling from '../../vendor/lucide/scaling.js';
import Help from '../../vendor/lucide/circle-question-mark.js';
import Arrow from '../../vendor/lucide/arrow-right.js';
import Kernel from '../../vendor/lucide/grid-3x3.js';

const icons = { folder: Folder, download: Download, pointer: Pointer, pipette: Pipette, fit: Fit, image: ImageIcon, levels: Sliders, resize: Scaling, help: Help, arrow: Arrow, kernel: Kernel };
export function renderIcons() {
  const ns = 'http://www.w3.org/2000/svg';
  for (const element of document.querySelectorAll('[data-icon]')) {
    const svg = document.createElementNS(ns, 'svg');
    for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
    for (const [tag, attrs] of icons[element.dataset.icon]) {
      const part = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) part.setAttribute(key, value);
      svg.append(part);
    }
    element.replaceChildren(svg);
  }
}
