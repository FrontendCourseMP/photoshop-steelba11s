# Photoshop Файзуллин Артур

Небольшой редактор изображений на React + Vite. Поддерживает загрузку PNG/JPG/GB7, просмотр каналов, пипетку с RGB/LAB, уровни, масштабирование изображения и экспорт в PNG/JPG/GB7.

## Запуск

```bash
npm install
npm run dev
```

После запуска Vite откроет приложение на локальном адресе, обычно:

```text
http://localhost:5173
```

## Проверки

```bash
npm run typecheck
npm test -- --run
npm run build
```

`npm run build` сначала проверяет TypeScript, затем собирает production-версию в папку `dist`.

## Формат GB7

GB7 хранит 7-битное grayscale-изображение и опциональную маску прозрачности. При импорте GB7 можно оставить файл в native grayscale-режиме или конвертировать его в RGBA для обычной работы редактора.
