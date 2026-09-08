/**
 * 皮肤：颜色变量覆盖 + 各处字体。存在偏好里（应用级，不进项目文件）。
 * 预设只是一组初值，用户改动后即为「自定义」。
 */

export type FontSlot = 'ui' | 'data' | 'mono' | 'corpusText' | 'corpusTr' | 'gloss' | 'script'

export interface Skin {
  preset: string
  light: Record<string, string>
  dark: Record<string, string>
  fonts: Record<FontSlot, string>
  /** 下载字体时加在 URL 前面的镜像前缀（国内加速用），空为直连 */
  mirror: string
}

export const EMPTY_FONTS: Record<FontSlot, string> = { ui: '', data: '', mono: '', corpusText: '', corpusTr: '', gloss: '', script: '' }

export const DEFAULT_SKIN: Skin = { preset: 'default', light: {}, dark: {}, fonts: { ...EMPTY_FONTS }, mirror: '' }

/** 可编辑的颜色变量（顺序即界面顺序） */
export const SKIN_VARS: { name: string; key: string }[] = [
  { name: '--bg', key: 'bg' },
  { name: '--bg-elev', key: 'bgElev' },
  { name: '--bg-sunken', key: 'bgSunken' },
  { name: '--bg-hover', key: 'bgHover' },
  { name: '--border', key: 'border' },
  { name: '--border-strong', key: 'borderStrong' },
  { name: '--text', key: 'text' },
  { name: '--text-2', key: 'text2' },
  { name: '--text-3', key: 'text3' },
  { name: '--accent', key: 'accent' },
  { name: '--accent-hover', key: 'accentHover' },
  { name: '--accent-soft', key: 'accentSoft' },
  { name: '--accent-text', key: 'accentText' },
  { name: '--danger', key: 'danger' },
  { name: '--warn', key: 'warn' }
]

export const FONT_VARS: Record<FontSlot, string> = {
  ui: '--font-ui',
  data: '--font-data',
  mono: '--font-mono',
  corpusText: '--font-corpus-text',
  corpusTr: '--font-corpus-tr',
  gloss: '--font-gloss',
  script: '--font-script'
}

export interface SkinPreset {
  id: string
  name: { zh: string; en: string }
  /** 预览色：背景 / 强调 / 文字 */
  swatch: [string, string, string]
  light: Record<string, string>
  dark: Record<string, string>
  fonts: Partial<Record<FontSlot, string>>
}

const KAI = "'LXGW WenKai', 'KaiTi', 'STKaiti', 'Noto Serif SC', serif"
const SONG = "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif"

export const SKIN_PRESETS: SkinPreset[] = [
  { id: 'default', name: { zh: '默认', en: 'Default' }, swatch: ['#fafaf7', '#0e9f8a', '#1f1f1f'], light: {}, dark: {}, fonts: {} },
  {
    id: 'ancient',
    name: { zh: '中国古代', en: 'Classical Chinese' },
    swatch: ['#f6efe1', '#a23b2c', '#3b2f22'],
    light: {
      '--bg': '#f6efe1',
      '--bg-elev': '#fbf6ea',
      '--bg-sunken': '#efe5d0',
      '--bg-hover': '#f1e8d6',
      '--border': '#dccfb4',
      '--border-strong': '#c4b28f',
      '--text': '#3b2f22',
      '--text-2': '#6e5c48',
      '--text-3': '#9a8a74',
      '--accent': '#a23b2c',
      '--accent-hover': '#8a2f22',
      '--accent-soft': '#f3e0d8',
      '--accent-text': '#8a2f22'
    },
    dark: {
      '--bg': '#1f1a14',
      '--bg-elev': '#28221a',
      '--bg-sunken': '#17130e',
      '--bg-hover': '#31291f',
      '--border': '#3d3327',
      '--border-strong': '#54473a',
      '--text': '#ebdfc9',
      '--text-2': '#b8a88e',
      '--text-3': '#85775f',
      '--accent': '#d4664f',
      '--accent-hover': '#e07b66',
      '--accent-soft': '#3d2520',
      '--accent-text': '#e7907c'
    },
    fonts: { ui: KAI, corpusTr: KAI, corpusText: "'Gentium Plus', 'Charis SIL', serif" }
  },
  {
    id: 'bamboo',
    name: { zh: '竹林', en: 'Bamboo grove' },
    swatch: ['#f3f7f0', '#3f7d4c', '#23301f'],
    light: {
      '--bg': '#f3f7f0',
      '--bg-elev': '#ffffff',
      '--bg-sunken': '#e8efe3',
      '--bg-hover': '#ecf2e7',
      '--border': '#cfdcc6',
      '--border-strong': '#aabf9f',
      '--text': '#23301f',
      '--text-2': '#586652',
      '--text-3': '#889580',
      '--accent': '#3f7d4c',
      '--accent-hover': '#356b41',
      '--accent-soft': '#e0eedd',
      '--accent-text': '#2f6a3b'
    },
    dark: {
      '--bg': '#131a12',
      '--bg-elev': '#1b241a',
      '--bg-sunken': '#0e130d',
      '--bg-hover': '#222d21',
      '--border': '#2c392b',
      '--border-strong': '#3f4f3d',
      '--text': '#e4ece1',
      '--text-2': '#a6b3a2',
      '--text-3': '#748070',
      '--accent': '#6fb37a',
      '--accent-hover': '#85c48f',
      '--accent-soft': '#1f3524',
      '--accent-text': '#93cf9d'
    },
    fonts: { ui: SONG, corpusTr: SONG }
  },
  {
    id: 'fantasy',
    name: { zh: '西幻', en: 'High fantasy' },
    swatch: ['#f4f1ea', '#6b4fa3', '#2b2333'],
    light: {
      '--bg': '#f4f1ea',
      '--bg-elev': '#fbf9f4',
      '--bg-sunken': '#ebe6db',
      '--bg-hover': '#efeae0',
      '--border': '#d8cfbe',
      '--border-strong': '#bfb29b',
      '--text': '#2b2333',
      '--text-2': '#5f5569',
      '--text-3': '#8f8698',
      '--accent': '#6b4fa3',
      '--accent-hover': '#583f8b',
      '--accent-soft': '#e9e2f5',
      '--accent-text': '#563b8a',
      '--warn': '#b8860b'
    },
    dark: {
      '--bg': '#16121f',
      '--bg-elev': '#1f1a2b',
      '--bg-sunken': '#100d17',
      '--bg-hover': '#282235',
      '--border': '#322a43',
      '--border-strong': '#4a405f',
      '--text': '#ebe6f2',
      '--text-2': '#b0a8bf',
      '--text-3': '#7d7590',
      '--accent': '#a98be0',
      '--accent-hover': '#bba2ea',
      '--accent-soft': '#2c2244',
      '--accent-text': '#c3acef'
    },
    fonts: { data: "'Cinzel', 'Gentium Plus', serif", corpusText: "'Gentium Plus', 'Charis SIL', serif", ui: "'Inter', 'Noto Sans SC', sans-serif" }
  },
  {
    id: 'sea',
    name: { zh: '海蓝', en: 'Sea' },
    swatch: ['#eef4f8', '#2a6fb0', '#1c2a36'],
    light: {
      '--bg': '#eef4f8',
      '--bg-elev': '#ffffff',
      '--bg-sunken': '#e1eaf1',
      '--bg-hover': '#e7eef4',
      '--border': '#cbd8e3',
      '--border-strong': '#a5b9ca',
      '--text': '#1c2a36',
      '--text-2': '#4f6272',
      '--text-3': '#82939f',
      '--accent': '#2a6fb0',
      '--accent-hover': '#235e96',
      '--accent-soft': '#dcebf8',
      '--accent-text': '#1f5b93'
    },
    dark: {
      '--bg': '#0f161d',
      '--bg-elev': '#172029',
      '--bg-sunken': '#0a1015',
      '--bg-hover': '#1e2a35',
      '--border': '#25323f',
      '--border-strong': '#384a5b',
      '--text': '#e2ebf2',
      '--text-2': '#a2b3c2',
      '--text-3': '#6f8191',
      '--accent': '#5aa0e6',
      '--accent-hover': '#77b2ee',
      '--accent-soft': '#173047',
      '--accent-text': '#8dc0f0'
    },
    fonts: {}
  },
  {
    id: 'ink',
    name: { zh: '墨夜', en: 'Ink night' },
    swatch: ['#f7f7f5', '#333333', '#111111'],
    light: {
      '--bg': '#f7f7f5',
      '--bg-elev': '#ffffff',
      '--bg-sunken': '#ececea',
      '--bg-hover': '#f0f0ee',
      '--border': '#dedddb',
      '--border-strong': '#bdbcb9',
      '--text': '#111111',
      '--text-2': '#555555',
      '--text-3': '#8a8a8a',
      '--accent': '#333333',
      '--accent-hover': '#111111',
      '--accent-soft': '#e8e8e6',
      '--accent-text': '#222222'
    },
    dark: {
      '--bg': '#0d0d0d',
      '--bg-elev': '#151515',
      '--bg-sunken': '#070707',
      '--bg-hover': '#1d1d1d',
      '--border': '#262626',
      '--border-strong': '#3b3b3b',
      '--text': '#f0f0f0',
      '--text-2': '#b5b5b5',
      '--text-3': '#7c7c7c',
      '--accent': '#d9d9d9',
      '--accent-hover': '#ffffff',
      '--accent-soft': '#262626',
      '--accent-text': '#e6e6e6'
    },
    fonts: { ui: KAI, corpusTr: KAI }
  }
]

/** 可下载字体目录：全部 OFL（可免费商用），直链单文件 TTF */
export interface FontEntry {
  family: string
  file: string
  url: string
  desc: { zh: string; en: string }
  tags: string[]
}

const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
export const FONT_CATALOG: FontEntry[] = [
  { family: 'LXGW WenKai', file: 'LXGWWenKai-Regular.ttf', url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.510/LXGWWenKai-Regular.ttf', desc: { zh: '霞鹜文楷：温润的楷体，适合界面与译文', en: 'A warm Kai-style CJK font, good for UI and translations' }, tags: ['cjk', 'kai'] },
  { family: 'LXGW WenKai TC', file: 'LXGWWenKaiTC-Regular.ttf', url: GF + 'lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf', desc: { zh: '霞鹜文楷 TC：繁体字形版本', en: 'Traditional-Chinese variant of LXGW WenKai' }, tags: ['cjk', 'kai'] },
  { family: 'Noto Serif SC', file: 'NotoSerifSC[wght].ttf', url: GF + 'notoserifsc/NotoSerifSC%5Bwght%5D.ttf', desc: { zh: '思源宋体（可变字重）', en: 'Source Han Serif SC (variable weight)' }, tags: ['cjk', 'serif'] },
  { family: 'Noto Sans SC', file: 'NotoSansSC[wght].ttf', url: GF + 'notosanssc/NotoSansSC%5Bwght%5D.ttf', desc: { zh: '思源黑体（可变字重）', en: 'Source Han Sans SC (variable weight)' }, tags: ['cjk', 'sans'] },
  { family: 'Ma Shan Zheng', file: 'MaShanZheng-Regular.ttf', url: GF + 'mashanzheng/MaShanZheng-Regular.ttf', desc: { zh: '马善政毛笔楷书', en: 'Brush-style regular script' }, tags: ['cjk', 'brush'] },
  { family: 'Zhi Mang Xing', file: 'ZhiMangXing-Regular.ttf', url: GF + 'zhimangxing/ZhiMangXing-Regular.ttf', desc: { zh: '志莽行书', en: 'Semi-cursive brush script' }, tags: ['cjk', 'brush'] },
  { family: 'Long Cang', file: 'LongCang-Regular.ttf', url: GF + 'longcang/LongCang-Regular.ttf', desc: { zh: '龙藏体：手写风', en: 'Handwritten CJK style' }, tags: ['cjk', 'brush'] },
  { family: 'Charis SIL', file: 'CharisSIL-Regular.ttf', url: GF + 'charissil/CharisSIL-Regular.ttf', desc: { zh: 'SIL 语言学衬线体，IPA 全覆盖', en: 'SIL linguistics serif with full IPA coverage' }, tags: ['latin', 'ipa', 'serif'] },
  { family: 'Gentium Plus', file: 'GentiumPlus-Regular.ttf', url: GF + 'gentiumplus/GentiumPlus-Regular.ttf', desc: { zh: 'Gentium Plus 完整版（内置的是拉丁子集）', en: 'Full Gentium Plus (the bundled one is a Latin subset)' }, tags: ['latin', 'ipa', 'serif'] },
  { family: 'Noto Serif', file: 'NotoSerif[wdth,wght].ttf', url: GF + 'notoserif/NotoSerif%5Bwdth,wght%5D.ttf', desc: { zh: 'Noto 衬线体（可变）', en: 'Noto Serif (variable)' }, tags: ['latin', 'serif'] },
  { family: 'Cinzel', file: 'Cinzel[wght].ttf', url: GF + 'cinzel/Cinzel%5Bwght%5D.ttf', desc: { zh: '罗马碑铭风大写体，西幻标题', en: 'Roman inscription capitals, fantasy titles' }, tags: ['latin', 'display'] },
  { family: 'Uncial Antiqua', file: 'UncialAntiqua-Regular.ttf', url: GF + 'uncialantiqua/UncialAntiqua-Regular.ttf', desc: { zh: '安色尔体：中世纪手抄本风', en: 'Uncial, medieval manuscript feel' }, tags: ['latin', 'display'] },
  { family: 'MedievalSharp', file: 'MedievalSharp.ttf', url: GF + 'medievalsharp/MedievalSharp.ttf', desc: { zh: '中世纪哥特风', en: 'Medieval gothic style' }, tags: ['latin', 'display'] },
  { family: 'Noto Sans Runic', file: 'NotoSansRunic-Regular.ttf', url: GF + 'notosansrunic/NotoSansRunic-Regular.ttf', desc: { zh: '卢恩文字（示例 Aelith 刻文可用）', en: 'Runic block (used by the Aelith example script)' }, tags: ['script'] },
  { family: 'Noto Sans Symbols 2', file: 'NotoSansSymbols2-Regular.ttf', url: GF + 'notosanssymbols2/NotoSansSymbols2-Regular.ttf', desc: { zh: '各类符号补全', en: 'Miscellaneous symbols' }, tags: ['symbols'] },
  { family: 'JetBrains Mono', file: 'JetBrainsMono[wght].ttf', url: GF + 'jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf', desc: { zh: '等宽，规则源代码与 gloss 行', en: 'Monospace for rule source and gloss lines' }, tags: ['mono'] }
]

/** 常见系统字体，供字体输入框的提示列表 */
export const COMMON_SYSTEM_FONTS = ['Inter', 'Gentium Plus', 'Charis SIL', 'Doulos SIL', 'Segoe UI', 'Microsoft YaHei', 'SimSun', 'KaiTi', 'FangSong', 'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Noto Serif CJK SC', 'Source Han Sans SC', 'Source Han Serif SC', 'Times New Roman', 'Georgia', 'Cambria', 'Consolas', 'Cascadia Code', 'Segoe UI Historic', 'Segoe UI Symbol']
