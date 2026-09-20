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
  /** 给某套自定义文字单独指定的字体：文字 id → 字体名（覆盖文字自带的字体） */
  scriptFonts?: Record<string, string>
  /** 自定义背景图：盖在整个窗口上的一层半透明图，不挡点击；换预设不动它 */
  background?: SkinBackground
}

export type BackgroundFit = 'cover' | 'contain' | 'tile' | 'center' | 'stretch'
export const BACKGROUND_FITS: BackgroundFit[] = ['cover', 'contain', 'tile', 'center', 'stretch']

export interface SkinBackground {
  /** 图片（缩到长边不超过 2400 像素的 data URL）；空表示没有 */
  image: string
  /** 缩过之后的图片尺寸（平铺、居中按它乘缩放） */
  width: number
  height: number
  fit: BackgroundFit
  /** 不透明度 0–1 */
  opacity: number
  /** 平铺、居中时的缩放（1 为原大小） */
  scale: number
  /** 模糊（像素） */
  blur: number
  /** 平铺、居中、适应时图从哪对齐 */
  position: 'center' | 'top' | 'bottom' | 'left' | 'right'
}

export const DEFAULT_BACKGROUND: SkinBackground = {
  image: '',
  width: 0,
  height: 0,
  fit: 'cover',
  opacity: 0.18,
  scale: 1,
  blur: 0,
  position: 'center'
}

/** 背景图那一层的样式（写在一个固定铺满窗口、不接鼠标的层上） */
export function backgroundStyle(b: SkinBackground | undefined): string {
  if (!b?.image) return ''
  const k = Math.max(0.05, b.scale)
  const size =
    b.fit === 'cover'
      ? 'cover'
      : b.fit === 'contain'
        ? 'contain'
        : b.fit === 'stretch'
          ? '100% 100%'
          : `${Math.round(b.width * k)}px ${Math.round(b.height * k)}px`
  return [
    `background-image:url("${b.image}")`,
    `background-size:${size}`,
    `background-repeat:${b.fit === 'tile' ? 'repeat' : 'no-repeat'}`,
    `background-position:${b.position}`,
    `opacity:${Math.min(1, Math.max(0, b.opacity))}`,
    // 模糊后边缘会发虚透出底色：往外多铺一点
    b.blur > 0 ? `filter:blur(${b.blur}px);inset:-${b.blur * 2}px` : ''
  ]
    .filter(Boolean)
    .join(';')
}

export const EMPTY_FONTS: Record<FontSlot, string> = {
  ui: '',
  data: '',
  mono: '',
  corpusText: '',
  corpusTr: '',
  gloss: '',
  script: ''
}

export const DEFAULT_SKIN: Skin = {
  preset: 'default',
  light: {},
  dark: {},
  fonts: { ...EMPTY_FONTS },
  mirror: '',
  scriptFonts: {}
}

/** 可编辑的颜色变量（顺序即界面顺序） */
/** 预设里会写、但不在颜色表里单独改的变量：换皮肤时也要先清掉 */
export const SKIN_EXTRA_VARS = ['--accent-contrast', '--skin-pattern', '--skin-pattern-size']

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

/** 用户保存的预设：名称为纯字符串 */
export interface UserSkinPreset {
  id: string
  name: string
  light: Record<string, string>
  dark: Record<string, string>
  fonts: Record<FontSlot, string>
}

export interface SkinPreset {
  id: string
  /** 预设排在第几排 */
  row: 1 | 2
  name: { zh: string; en: string }
  /** 预览色：背景 / 强调 / 文字 */
  swatch: [string, string, string]
  /** 预览卡上叠的花纹（星月夜的星点） */
  swatchPattern?: string
  light: Record<string, string>
  dark: Record<string, string>
  fonts: Partial<Record<FontSlot, string>>
}

const KAI = "'LXGW WenKai', 'KaiTi', 'STKaiti', 'Noto Serif SC', serif"
const SONG = "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif"

/** 星月夜的星点：大小不一的黄、蓝小点，按两种间距错开铺，看着不成格子 */
const STARS_LIGHT = [
  'radial-gradient(circle at 18% 22%, rgba(214, 170, 30, 0.22) 0 1.6px, transparent 2.4px)',
  'radial-gradient(circle at 63% 71%, rgba(40, 70, 150, 0.16) 0 1.2px, transparent 1.9px)',
  'radial-gradient(circle at 81% 34%, rgba(214, 170, 30, 0.14) 0 0.9px, transparent 1.5px)',
  'radial-gradient(circle at 37% 86%, rgba(40, 70, 150, 0.12) 0 0.8px, transparent 1.4px)'
].join(', ')
const STARS_DARK = [
  'radial-gradient(circle at 18% 22%, rgba(240, 200, 80, 0.30) 0 1.6px, transparent 2.6px)',
  'radial-gradient(circle at 63% 71%, rgba(120, 160, 240, 0.20) 0 1.2px, transparent 2px)',
  'radial-gradient(circle at 81% 34%, rgba(240, 210, 110, 0.20) 0 0.9px, transparent 1.6px)',
  'radial-gradient(circle at 37% 86%, rgba(150, 180, 255, 0.16) 0 0.8px, transparent 1.5px)'
].join(', ')
const STARS_SIZE = '97px 89px, 61px 67px, 43px 53px, 131px 113px'

export const SKIN_PRESETS: SkinPreset[] = [
  {
    id: 'default',
    row: 1,
    name: { zh: '亚夜花园·青', en: 'Yaye Garden · Cyan' },
    swatch: ['#fafaf7', '#0e9f8a', '#1f1f1f'],
    light: {},
    dark: {},
    fonts: {}
  },
  {
    id: 'bamboo',
    row: 1,
    name: { zh: '林中幻想·绿', en: 'Forest Fantasia · Green' },
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
      '--accent-text': '#93cf9d',
      '--accent-contrast': '#0e1a10'
    },
    fonts: { ui: SONG, corpusTr: SONG }
  },
  {
    id: 'fantasy',
    row: 1,
    name: { zh: '契耶西塔·紫', en: 'Qiyexita · Purple' },
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
      '--accent-text': '#c3acef',
      '--accent-contrast': '#1a1030'
    },
    fonts: {
      data: "'Cinzel', 'Gentium Plus', serif",
      corpusText: "'Gentium Plus', 'Charis SIL', serif",
      ui: "'Inter', 'Noto Sans SC', sans-serif"
    }
  },
  {
    // 靛：偏蓝的紫，比契耶西塔冷、深，底色带一点海雾的灰蓝
    id: 'norian',
    row: 1,
    name: { zh: '海岛诺连·靛', en: 'Nuolian Isle · Indigo' },
    swatch: ['#f1f3f9', '#3f47b5', '#1b1f3a'],
    light: {
      '--bg': '#f1f3f9',
      '--bg-elev': '#fbfcff',
      '--bg-sunken': '#e5e8f3',
      '--bg-hover': '#e9ecf6',
      '--border': '#cfd4e8',
      '--border-strong': '#a9b0d0',
      '--text': '#1b1f3a',
      '--text-2': '#4c5275',
      '--text-3': '#8187a6',
      '--accent': '#3f47b5',
      '--accent-hover': '#343b9c',
      '--accent-soft': '#e0e3f8',
      '--accent-text': '#343b9c'
    },
    dark: {
      '--bg': '#0f1120',
      '--bg-elev': '#171a2e',
      '--bg-sunken': '#0a0c17',
      '--bg-hover': '#1f2339',
      '--border': '#272b47',
      '--border-strong': '#3b4166',
      '--text': '#e5e7f5',
      '--text-2': '#a8acc9',
      '--text-3': '#7478a0',
      '--accent': '#8088f0',
      '--accent-hover': '#9aa0f5',
      '--accent-soft': '#232850',
      '--accent-text': '#a6acf7',
      '--accent-contrast': '#0c0f2a'
    },
    fonts: {}
  },
  {
    id: 'sea',
    row: 1,
    name: { zh: '蓝地渐歌·蓝', en: 'Blueland Song · Blue' },
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
      '--accent-text': '#8dc0f0',
      '--accent-contrast': '#08182a'
    },
    fonts: {}
  },
  {
    // 夜空一样的蓝黑，满屏细碎的星点（黄、蓝两种），强调色在深色里是星星的暖黄
    id: 'ink',
    row: 2,
    name: { zh: '星月夜·黑', en: 'Starry Night · Black' },
    swatch: ['#12151f', '#e8c34a', '#e9e6d8'],
    swatchPattern: STARS_DARK,
    light: {
      '--bg': '#f3f2ec',
      '--bg-elev': '#fbfaf5',
      '--bg-sunken': '#e8e6dc',
      '--bg-hover': '#ecebe3',
      '--border': '#d7d5ca',
      '--border-strong': '#b5b2a3',
      '--text': '#12151f',
      '--text-2': '#4a4f60',
      '--text-3': '#838795',
      '--accent': '#1f2a48',
      '--accent-hover': '#141c33',
      '--accent-soft': '#e2e4ea',
      '--accent-text': '#1f2a48',
      '--warn': '#b98a00',
      '--skin-pattern': STARS_LIGHT,
      '--skin-pattern-size': STARS_SIZE
    },
    dark: {
      '--bg': '#0b0e17',
      '--bg-elev': '#121624',
      '--bg-sunken': '#070911',
      '--bg-hover': '#1a1f30',
      '--border': '#222840',
      '--border-strong': '#363e5c',
      '--text': '#ece9dc',
      '--text-2': '#b1b2bb',
      '--text-3': '#7b7f90',
      '--accent': '#e8c34a',
      '--accent-hover': '#f2d36b',
      '--accent-soft': '#2a2a2c',
      '--accent-text': '#f0cf62',
      '--accent-contrast': '#141726',
      '--skin-pattern': STARS_DARK,
      '--skin-pattern-size': STARS_SIZE
    },
    fonts: { ui: KAI, corpusTr: KAI }
  },
  {
    id: 'ancient',
    row: 2,
    name: { zh: '山海经·褐', en: 'Shanhaijing · Brown' },
    swatch: ['#f6efe1', '#8a5a2e', '#3b2f22'],
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
      '--accent': '#8a5a2e',
      '--accent-hover': '#744a24',
      '--accent-soft': '#efe0cc',
      '--accent-text': '#744a24'
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
      '--accent': '#c8955f',
      '--accent-hover': '#d6a877',
      '--accent-soft': '#3a2c1e',
      '--accent-text': '#ddb283',
      '--accent-contrast': '#1f160c'
    },
    fonts: { ui: KAI, corpusTr: KAI, corpusText: "'Gentium Plus', 'Charis SIL', serif" }
  },
  {
    // 红配白：雪白的底，正红的强调
    id: 'meizhusa',
    row: 2,
    name: { zh: '梅珠撒·红', en: 'Meizhusa · Red' },
    swatch: ['#fffafa', '#c8102e', '#2a1416'],
    light: {
      '--bg': '#fffafa',
      '--bg-elev': '#ffffff',
      '--bg-sunken': '#f8eeee',
      '--bg-hover': '#fbf0f0',
      '--border': '#efdada',
      '--border-strong': '#dcb5b8',
      '--text': '#2a1416',
      '--text-2': '#664346',
      '--text-3': '#9c7f81',
      '--accent': '#c8102e',
      '--accent-hover': '#a90d27',
      '--accent-soft': '#fbe2e6',
      '--accent-text': '#a90d27',
      '--danger': '#b3261e'
    },
    dark: {
      '--bg': '#1a0f11',
      '--bg-elev': '#241518',
      '--bg-sunken': '#12090b',
      '--bg-hover': '#2e1b1f',
      '--border': '#3a2327',
      '--border-strong': '#553439',
      '--text': '#f8eced',
      '--text-2': '#c9aeb1',
      '--text-3': '#927579',
      '--accent': '#ef4058',
      '--accent-hover': '#f5647a',
      '--accent-soft': '#3f1a21',
      '--accent-text': '#f7798c'
    },
    fonts: {}
  },
  {
    // 黄蓝红：深藏青的底，金黄的强调，红色当警示
    id: 'vaqif',
    row: 2,
    name: { zh: '瓦其夫·黄', en: 'Waqifu · Yellow' },
    swatch: ['#13204a', '#f2c230', '#d8342c'],
    light: {
      '--bg': '#f6f3e6',
      '--bg-elev': '#fffdf4',
      '--bg-sunken': '#ebe6d0',
      '--bg-hover': '#efead6',
      '--border': '#d9d1b0',
      '--border-strong': '#b8ad83',
      '--text': '#13204a',
      '--text-2': '#414c73',
      '--text-3': '#7d839c',
      '--accent': '#e3a900',
      '--accent-hover': '#cc9700',
      '--accent-soft': '#f8ebb8',
      '--accent-text': '#8a6200',
      '--accent-contrast': '#13204a',
      '--danger': '#d0312a',
      '--warn': '#c26a00'
    },
    dark: {
      '--bg': '#0f1a3a',
      '--bg-elev': '#16234a',
      '--bg-sunken': '#0a1330',
      '--bg-hover': '#1d2c57',
      '--border': '#243767',
      '--border-strong': '#34497f',
      '--text': '#f3eed8',
      '--text-2': '#bfc2cf',
      '--text-3': '#858ca6',
      '--accent': '#f2c230',
      '--accent-hover': '#ffd24f',
      '--accent-soft': '#2c3558',
      '--accent-text': '#ffd24f',
      '--accent-contrast': '#0f1a3a',
      '--danger': '#e8463d',
      '--warn': '#f08c2a'
    },
    fonts: {}
  },
  {
    // 橙白：暖白的底，柔和的杏橙
    id: 'xuelizi',
    row: 2,
    name: { zh: '雪利兹·橙', en: 'Xuelizi · Orange' },
    swatch: ['#fffaf4', '#e8833a', '#3a2a1e'],
    light: {
      '--bg': '#fffaf4',
      '--bg-elev': '#ffffff',
      '--bg-sunken': '#fbefe2',
      '--bg-hover': '#fcf2e7',
      '--border': '#f0dcc6',
      '--border-strong': '#dfbd9b',
      '--text': '#3a2a1e',
      '--text-2': '#6e5846',
      '--text-3': '#a08a78',
      '--accent': '#e07a30',
      '--accent-hover': '#c96a24',
      '--accent-soft': '#fde8d6',
      '--accent-text': '#b35c1b'
    },
    dark: {
      '--bg': '#1c1510',
      '--bg-elev': '#261d16',
      '--bg-sunken': '#15100b',
      '--bg-hover': '#30251c',
      '--border': '#3d2f23',
      '--border-strong': '#574332',
      '--text': '#f7ebe0',
      '--text-2': '#c7b19f',
      '--text-3': '#917b69',
      '--accent': '#f3a263',
      '--accent-hover': '#f7b580',
      '--accent-soft': '#3f2a1b',
      '--accent-text': '#f7b88a',
      '--accent-contrast': '#2a1809'
    },
    fonts: {}
  }
]

/** 可下载字体目录：全部 OFL（可免费商用），直链单文件 TTF */
export interface FontEntry {
  family: string
  /** 字体自带的中文名，有就显示在英文名下方 */
  zhName?: string
  file: string
  url: string
  desc: { zh: string; en: string }
  tags: string[]
  /** 随软件一起带的字体：点一下就装好，不用联网 */
  builtin?: boolean
}

/** 字体库里的预览文字：拉丁全字母句 */
export const FONT_SAMPLE_LATIN = 'The quick brown fox jumps over the lazy dog'
/** 覆盖汉字的字体再带一小段笔画全的字 */
export const FONT_SAMPLE_CJK = '永东国方'

/**
 * 这个字体的预览文字用什么：按条目自己的标签判断覆盖范围，不看字体名。
 * 文字块、符号字体没有拉丁字形，写拉丁句只会看到回退字体，干脆不预览。
 */
export function fontSample(tags: string[]): string {
  if (tags.includes('script') || tags.includes('symbols')) return ''
  return tags.includes('cjk') ? FONT_SAMPLE_LATIN + ' ' + FONT_SAMPLE_CJK : FONT_SAMPLE_LATIN
}

const GF = 'https://raw.githubusercontent.com/google/fonts/main/ofl/'
export const FONT_CATALOG: FontEntry[] = [
  {
    family: 'gilatod unicode',
    file: 'Gilatod_unicode.otf',
    url: '',
    builtin: true,
    desc: {
      zh: '【荏苒之境】百科标准字体：随软件一起带，点「安装」即可',
      en: 'Gilatod wiki standard font — ships with the app, one click to install'
    },
    tags: ['builtin', 'gilatod', 'unicode']
  },
  {
    family: 'LXGW WenKai',
    zhName: '霞鹜文楷',
    file: 'LXGWWenKai-Regular.ttf',
    url: 'https://github.com/lxgw/LxgwWenKai/releases/download/v1.510/LXGWWenKai-Regular.ttf',
    desc: {
      zh: '温润的楷体，适合界面与译文',
      en: 'A warm Kai-style CJK font, good for UI and translations'
    },
    tags: ['cjk', 'kai']
  },
  {
    family: 'LXGW WenKai TC',
    zhName: '霞鹜文楷 TC',
    file: 'LXGWWenKaiTC-Regular.ttf',
    url: GF + 'lxgwwenkaitc/LXGWWenKaiTC-Regular.ttf',
    desc: { zh: '繁体字形版本', en: 'Traditional-Chinese variant of LXGW WenKai' },
    tags: ['cjk', 'kai']
  },
  {
    family: 'Noto Serif SC',
    zhName: '思源宋体',
    file: 'NotoSerifSC[wght].ttf',
    url: GF + 'notoserifsc/NotoSerifSC%5Bwght%5D.ttf',
    desc: { zh: '可变字重', en: 'Source Han Serif SC (variable weight)' },
    tags: ['cjk', 'serif']
  },
  {
    family: 'Noto Sans SC',
    zhName: '思源黑体',
    file: 'NotoSansSC[wght].ttf',
    url: GF + 'notosanssc/NotoSansSC%5Bwght%5D.ttf',
    desc: { zh: '可变字重', en: 'Source Han Sans SC (variable weight)' },
    tags: ['cjk', 'sans']
  },
  {
    family: 'Ma Shan Zheng',
    zhName: '马善政毛笔楷书',
    file: 'MaShanZheng-Regular.ttf',
    url: GF + 'mashanzheng/MaShanZheng-Regular.ttf',
    desc: { zh: '毛笔楷书', en: 'Brush-style regular script' },
    tags: ['cjk', 'brush']
  },
  {
    family: 'Zhi Mang Xing',
    zhName: '志莽行书',
    file: 'ZhiMangXing-Regular.ttf',
    url: GF + 'zhimangxing/ZhiMangXing-Regular.ttf',
    desc: { zh: '行书风毛笔字', en: 'Semi-cursive brush script' },
    tags: ['cjk', 'brush']
  },
  {
    family: 'Long Cang',
    zhName: '龙藏体',
    file: 'LongCang-Regular.ttf',
    url: GF + 'longcang/LongCang-Regular.ttf',
    desc: { zh: '手写风', en: 'Handwritten CJK style' },
    tags: ['cjk', 'brush']
  },
  {
    family: 'Charis SIL',
    file: 'CharisSIL-Regular.ttf',
    url: GF + 'charissil/CharisSIL-Regular.ttf',
    desc: {
      zh: 'SIL 语言学衬线体，IPA 全覆盖',
      en: 'SIL linguistics serif with full IPA coverage'
    },
    tags: ['latin', 'ipa', 'serif']
  },
  {
    family: 'Gentium Plus',
    file: 'GentiumPlus-Regular.ttf',
    url: GF + 'gentiumplus/GentiumPlus-Regular.ttf',
    desc: {
      zh: 'Gentium Plus 完整版（内置的是拉丁子集）',
      en: 'Full Gentium Plus (the bundled one is a Latin subset)'
    },
    tags: ['latin', 'ipa', 'serif']
  },
  {
    family: 'Noto Serif',
    file: 'NotoSerif[wdth,wght].ttf',
    url: GF + 'notoserif/NotoSerif%5Bwdth,wght%5D.ttf',
    desc: { zh: 'Noto 衬线体（可变）', en: 'Noto Serif (variable)' },
    tags: ['latin', 'serif']
  },
  {
    family: 'Cinzel',
    file: 'Cinzel[wght].ttf',
    url: GF + 'cinzel/Cinzel%5Bwght%5D.ttf',
    desc: { zh: '罗马碑铭风大写体，西幻标题', en: 'Roman inscription capitals, fantasy titles' },
    tags: ['latin', 'display']
  },
  {
    family: 'Uncial Antiqua',
    file: 'UncialAntiqua-Regular.ttf',
    url: GF + 'uncialantiqua/UncialAntiqua-Regular.ttf',
    desc: { zh: '安色尔体：中世纪手抄本风', en: 'Uncial, medieval manuscript feel' },
    tags: ['latin', 'display']
  },
  {
    family: 'MedievalSharp',
    file: 'MedievalSharp.ttf',
    url: GF + 'medievalsharp/MedievalSharp.ttf',
    desc: { zh: '中世纪哥特风', en: 'Medieval gothic style' },
    tags: ['latin', 'display']
  },
  {
    family: 'Noto Sans Runic',
    file: 'NotoSansRunic-Regular.ttf',
    url: GF + 'notosansrunic/NotoSansRunic-Regular.ttf',
    desc: {
      zh: '卢恩文字（示例 Aelith 刻文可用）',
      en: 'Runic block (used by the Aelith example script)'
    },
    tags: ['script']
  },
  {
    family: 'Noto Sans Symbols 2',
    file: 'NotoSansSymbols2-Regular.ttf',
    url: GF + 'notosanssymbols2/NotoSansSymbols2-Regular.ttf',
    desc: { zh: '各类符号补全', en: 'Miscellaneous symbols' },
    tags: ['symbols']
  },
  {
    family: 'JetBrains Mono',
    file: 'JetBrainsMono[wght].ttf',
    url: GF + 'jetbrainsmono/JetBrainsMono%5Bwght%5D.ttf',
    desc: { zh: '等宽，规则源代码与 gloss 行', en: 'Monospace for rule source and gloss lines' },
    tags: ['mono']
  },
  {
    family: 'Andika',
    file: 'Andika-Regular.ttf',
    url: GF + 'andika/Andika-Regular.ttf',
    desc: {
      zh: 'SIL 易读无衬线，字形分得清，IPA 完整',
      en: 'SIL sans built for legibility, full IPA'
    },
    tags: ['latin', 'sans', 'ipa']
  },
  {
    family: 'Cardo',
    file: 'Cardo-Regular.ttf',
    url: GF + 'cardo/Cardo-Regular.ttf',
    desc: {
      zh: '古典学衬线：拉丁、希腊、IPA 与古文字符号',
      en: 'Classicist serif: Latin, Greek, IPA, epigraphy'
    },
    tags: ['latin', 'serif', 'ipa', 'greek']
  },
  {
    family: 'Inter',
    file: 'Inter[opsz,wght].ttf',
    url: GF + 'inter/Inter%5Bopsz,wght%5D.ttf',
    desc: { zh: '界面无衬线（可变字重）', en: 'UI sans (variable)' },
    tags: ['latin', 'sans', 'ui']
  },
  {
    family: 'Noto Sans',
    file: 'NotoSans[wdth,wght].ttf',
    url: GF + 'notosans/NotoSans%5Bwdth,wght%5D.ttf',
    desc: {
      zh: '思源无衬线拉丁版，覆盖广（可变）',
      en: 'Noto Sans Latin, wide coverage (variable)'
    },
    tags: ['latin', 'sans', 'ui']
  },
  {
    family: 'Fira Sans',
    file: 'FiraSans-Regular.ttf',
    url: GF + 'firasans/FiraSans-Regular.ttf',
    desc: { zh: 'humanist 无衬线，小字号清楚', en: 'Humanist sans, clear at small sizes' },
    tags: ['latin', 'sans', 'ui']
  },
  {
    family: 'IBM Plex Sans',
    file: 'IBMPlexSans[wdth,wght].ttf',
    url: GF + 'ibmplexsans/IBMPlexSans%5Bwdth,wght%5D.ttf',
    desc: { zh: 'IBM Plex 无衬线（可变）', en: 'IBM Plex Sans (variable)' },
    tags: ['latin', 'sans', 'ui']
  },
  {
    family: 'EB Garamond',
    file: 'EBGaramond[wght].ttf',
    url: GF + 'ebgaramond/EBGaramond%5Bwght%5D.ttf',
    desc: {
      zh: '加拉蒙复刻，适合词典正文（可变）',
      en: 'Garamond revival, good for dictionary text'
    },
    tags: ['latin', 'serif']
  },
  {
    family: 'Libre Baskerville',
    file: 'LibreBaskerville[wght].ttf',
    url: GF + 'librebaskerville/LibreBaskerville%5Bwght%5D.ttf',
    desc: { zh: '巴斯克维尔风衬线，屏幕友好', en: 'Baskerville-style serif tuned for screens' },
    tags: ['latin', 'serif']
  },
  {
    family: 'Lora',
    file: 'Lora[wght].ttf',
    url: GF + 'lora/Lora%5Bwght%5D.ttf',
    desc: { zh: '书卷气衬线（可变）', en: 'Contemporary book serif (variable)' },
    tags: ['latin', 'serif']
  },
  {
    family: 'Source Serif 4',
    file: 'SourceSerif4[opsz,wght].ttf',
    url: GF + 'sourceserif4/SourceSerif4%5Bopsz,wght%5D.ttf',
    desc: {
      zh: '思源衬线拉丁版（可变，带光学尺寸）',
      en: 'Source Serif 4 (variable, optical size)'
    },
    tags: ['latin', 'serif']
  },
  {
    family: 'Merriweather',
    file: 'Merriweather[opsz,wdth,wght].ttf',
    url: GF + 'merriweather/Merriweather%5Bopsz,wdth,wght%5D.ttf',
    desc: { zh: '屏幕正文衬线（可变）', en: 'Screen-first text serif (variable)' },
    tags: ['latin', 'serif']
  },
  {
    family: 'Fira Code',
    file: 'FiraCode[wght].ttf',
    url: GF + 'firacode/FiraCode%5Bwght%5D.ttf',
    desc: { zh: '等宽，带连字（可变）', en: 'Monospace with ligatures (variable)' },
    tags: ['latin', 'mono']
  },
  {
    family: 'Noto Sans Mono',
    file: 'NotoSansMono[wdth,wght].ttf',
    url: GF + 'notosansmono/NotoSansMono%5Bwdth,wght%5D.ttf',
    desc: { zh: '思源等宽，覆盖广（可变）', en: 'Noto Sans Mono, wide coverage (variable)' },
    tags: ['latin', 'mono']
  },
  {
    family: 'Noto Sans Old Turkic',
    file: 'NotoSansOldTurkic-Regular.ttf',
    url: GF + 'notosansoldturkic/NotoSansOldTurkic-Regular.ttf',
    desc: { zh: '古突厥文（鄂尔浑文）字母', en: 'Old Turkic (Orkhon) letters' },
    tags: ['script', 'oldturkic']
  }
]

/** 常见系统字体，供字体输入框的提示列表 */
export const COMMON_SYSTEM_FONTS = [
  'Inter',
  'Gentium Plus',
  'Charis SIL',
  'Doulos SIL',
  'Segoe UI',
  'Microsoft YaHei',
  'SimSun',
  'KaiTi',
  'FangSong',
  'PingFang SC',
  'Hiragino Sans GB',
  'Noto Sans CJK SC',
  'Noto Serif CJK SC',
  'Source Han Sans SC',
  'Source Han Serif SC',
  'Times New Roman',
  'Georgia',
  'Cambria',
  'Consolas',
  'Cascadia Code',
  'Segoe UI Historic',
  'Segoe UI Symbol'
]
