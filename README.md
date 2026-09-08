# 千语集 · Qonlang

给所有造语者的工作台：录入词汇与词根、制订音变规则、按音系自动标音、自动 gloss 例句、自定义文字与皮肤。
先验语、后验语、单语、语系都能用；软件不内置任何一门语言的术语，一切分类由你定义。

A workbench for every conlanger: lexicon and roots, sound-change rules, automatic
phonemic transcription, automatic interlinear glossing. Works for a priori and
a posteriori languages alike; nothing language-specific is baked in.

设计大纲见 [docs/outline.md](docs/outline.md)。

## 开发

```bash
npm install
npm run dev        # Electron 桌面版（热更新）
npm run dev:web    # 纯网页版
npm test           # 引擎层单元测试
npm run build:win  # Windows 安装包（另有 build:mac / build:linux）
npm run build:web  # 网页版静态文件 → dist/web
```

Windows 下若 PowerShell 提示「禁止运行脚本」，双击 `dev.cmd` 启动开发版，或改用 `npm.cmd run dev`；
也可以直接用 `npm run build:unpack` 打出免安装的 `dist/win-unpacked/qonlang.exe`。

## 结构

```
src/main/        Electron 主进程：窗口、文件对话框、备份、偏好
src/preload/     IPC 桥
src/renderer/    界面（Svelte 5 + TypeScript）
  src/lib/core/      数据模型、工厂、序列化（纯 TS，无 UI 依赖）
  src/lib/platform/  平台适配层：Electron 与网页两套实现，同一接口
  src/lib/state/     运行时状态（Svelte runes）
  src/lib/i18n/      界面文案，中文 / English
  src/lib/engine/    音变、音系、形态、gloss 引擎（纯 TS）
  src/lib/script/    自定义文字：字体解析、内嵌字体、转写→文字映射
  src/lib/skin/      皮肤预设与可下载字体目录（均为 OFL）
  src/views/         各页面
tests/           Vitest
docs/            大纲与规则语言文档
```

## 许可

MIT
