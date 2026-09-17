# 千语集 · Qonlang 标志

从设计稿「千语集logo与说明.ai」导出，矢量图都是轮廓路径，不依赖字体。

## 色值

| 名称 | 色值      | 用途                                   |
| ---- | --------- | -------------------------------------- |
| 白   | `#ffffff` | 浅底；绿底、深底上的标志               |
| 绿   | `#0e9f8a` | 主色（也是软件的强调色）；浅底上的标志 |
| 黄   | `#ffde80` | 绿底、深底上的标志；应用图标里的 Q     |
| 深   | `#2e3a38` | 深底；浅底上的标志                     |

浅底上用绿或深色的标志，绿底、深底上用白或黄色的标志。

## 文件

| 文件                                       | 内容                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `lockup-full-{teal,dark,white,yellow}.svg` | 图标 + Qonlang + 千语集                                      |
| `lockup-en-*.svg`                          | 图标 + Qonlang                                               |
| `lockup-zh-*.svg`                          | 图标 + 千语集                                                |
| `wordmark-{full,en,zh}.svg`                | 只有文字（绿色）                                             |
| `mark-{teal,dark,white,yellow}.svg`        | 只有图标                                                     |
| `icon-rounded-{teal,dark}.svg`             | 圆角底的应用图标（Windows、macOS、Linux 用的就是绿色这一个） |
| `icon-square-{teal,dark}.svg`              | 方底，给会自己裁圆角的平台                                   |
| `icon-1024.png`                            | 圆角绿底应用图标，1024 × 1024                                |
| `social-preview.png`                       | GitHub 仓库的社交预览图，1280 × 640                          |

标志四周要留出空白，不能跟别的图文挤在一起（设计稿里的「不可侵犯区域」大约是图标高度的四分之一）。

## 软件里用到的地方

- `build/icon.ico`、`build/icon.icns`、`build/icon.png`、`resources/icon.png`：安装包与窗口图标（macOS 版按系统规范在 1024 画布里留 100 的边）。
- `src/renderer/src/assets/brand/`：导航栏的图标、开始页的应用图标与字标、设置页「关于」的整套标志。单色的几个把颜色换成了 `currentColor`，跟着 `--brand-mark`（浅色主题绿、深色主题黄）走。
- `src/renderer/public/favicon.svg`：网页版的标签页图标。
