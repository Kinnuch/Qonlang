<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import { focusField } from '$lib/ui/focus'
  import { lazy, lazyMore } from '$lib/ui/lazy.svelte'
  import { sectionCollapsed } from '$lib/ui/section.svelte'
  import SectionHead from '$lib/ui/SectionHead.svelte'
  import { customFieldTitle } from '$lib/core/customFields'
  import type { PageView } from '$lib/state/ui.svelte'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  /** 文字：字形表 / 映射规则 / 预览；字体导入与内嵌；检视器编辑字形或文字属性并试写。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { createScript, newId } from '$lib/core/factory'
  import type {
    Glyph,
    GlyphDrawing,
    Script,
    ScriptPacking,
    ScriptType,
    ParenMode
  } from '$lib/core/model'
  import GlyphPad from '$lib/ui/GlyphPad.svelte'
  import Menu from '$lib/ui/Menu.svelte'
  import { drawnGlyphs, freePrivateChar } from '$lib/script/drawnFont'
  import { buildScriptFont, dataUrlToBuffer } from '$lib/script/fontBuild'
  import { toWoff } from '$lib/script/fontWriter'
  import { hasDrawingContent } from '$lib/script/glyphGeometry'
  import { parseFont } from '$lib/script/fontParse'
  import {
    BUILTIN_GLYPH_CATEGORIES as BUILTIN_CATS,
    glyphCategorizer
  } from '$lib/script/categorize'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveItem } from '$lib/core/move'
  import {
    ensureScriptFont,
    fontCss,
    fontDataUrl,
    base64ToBuffer,
    fontFamilyCss
  } from '$lib/script/fonts'
  import { autoMappingRows, expandRules, lexemeScript } from '$lib/script/render'
  import { sentenceScriptText } from '$lib/script/lexiconScript'
  import { parseRuleText, runRules, type RuleProgram } from '$lib/engine/sca'
  import { parseGlyphLines } from '$lib/importers/glyphLines'
  import type { PreviewData } from '$lib/importers/preview'
  import { languageParseOptions } from '$lib/engine/phon'
  import Portal from '$lib/ui/Portal.svelte'
  import ImportPreview from '$lib/ui/ImportPreview.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import RuleList from '$lib/ui/RuleList.svelte'
  import RuleEditor from '$lib/ui/RuleEditor.svelte'
  import { flashOn } from '$lib/ui/flash'
  import {
    Plus,
    Trash2,
    Download,
    FileType,
    ClipboardPaste,
    Wand2,
    List,
    Code,
    X,
    Pencil,
    PenTool,
    FileOutput
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let {
    inspectorTitle = $bindable(''),
    inspectorTitleStyle = $bindable('')
  }: { inspectorTitle?: string; inspectorTitleStyle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const lang = $derived(
    projectState.currentLanguage ??
      project.languages.find((l) => l.id === project.settings.defaultLanguageId) ??
      project.languages[0] ??
      null
  )

  type Tab = 'glyphs' | 'rules' | 'preview'
  const TABS: Tab[] = ['glyphs', 'rules', 'preview']
  const TYPES: ScriptType[] = [
    'alphabet',
    'abjad',
    'abugida',
    'syllabary',
    'logographic',
    'featural',
    'mixed',
    'other'
  ]
  /** 回到这一页时接着用上次的文字、子页、选中的字形、筛选与预览文本；换了语言就不恢复选中与滚动 */
  const memo = ui.memo<{
    lang: string | null
    tab: Tab
    selectedScript: string | null
    selectedGlyph: string | null
    catFilter: string
    rulesView: 'list' | 'source'
    testText: string
  }>('script')
  const sameLang = memo.lang === projectState.currentLanguageId
  let tab = $state<Tab>(memo.tab ?? 'glyphs')
  let selectedScript = $state<string | null>(sameLang ? (memo.selectedScript ?? null) : null)
  let selectedGlyph = $state<string | null>(sameLang ? (memo.selectedGlyph ?? null) : null)
  // 从一致性检查跳过来：选中那套文字
  $effect(() => {
    const id = ui.takePending('script')
    if (!id) return
    // 可能是别的语言的文字：先切到那门语言
    const owner = project.languages.find((l) => l.scripts.some((sc) => sc.id === id))
    if (owner && owner.id !== lang?.id) projectState.currentLanguageId = owner.id
    selectedScript = id
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('script', {
      kind: 'script',
      lang: projectState.currentLanguageId,
      id: selectedScript,
      tab,
      glyph: selectedGlyph
    })
  })
  $effect(() => {
    const r = ui.takeRestore('script')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedScript = v.id ?? null
    if (v.tab === 'glyphs' || v.tab === 'rules' || v.tab === 'preview') tab = v.tab
    selectedGlyph = v.glyph ?? null
    ui.restoreScroll('script', r.scroll)
  })
  /** Ctrl / Shift 多选出来的字形 */
  let multiGlyphs = $state<string[]>([])
  let lastGlyphIndex = $state(-1)
  let catFilter = $state<string>(sameLang ? (memo.catFilter ?? '') : '')
  let rulesView = $state<'list' | 'source'>(memo.rulesView ?? 'list')
  let pasteOpen = $state(false)
  let pasteText = $state('')
  /** 粘贴的字符表逐行拆开：字符、转写、名称 */
  const pasteItems = $derived(parseGlyphLines(pasteText))
  /** 从字体读出来、还没导入的字形：先在检视器里看样例，确认了再连字体一起放进来 */
  let fontPending = $state.raw<{
    name: string
    dataUrl: string
    family: string
    /** 样例里临时用来显示这个字体的 font-family */
    previewFamily: string
    glyphs: { char: string; name: string; value: string }[]
  } | null>(null)
  let testText = $state(memo.testText ?? '')
  let importedFlash = $state(0)
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      tab,
      selectedScript,
      selectedGlyph,
      catFilter,
      rulesView,
      testText
    })
  })
  if (sameLang && !ui.restoring('script')) ui.restoreScroll('script', ui.lastScroll('script'))

  const script = $derived(
    lang?.scripts.find((s) => s.id === selectedScript) ?? lang?.scripts[0] ?? null
  )
  const glyph = $derived(script?.glyphs.find((g) => g.id === selectedGlyph) ?? null)
  const categories = $derived.by(() => {
    const set = new Set<string>()
    for (const g of script?.glyphs ?? []) if (g.category) set.add(g.category)
    return [
      ...BUILTIN_CATS.filter((c) => set.has(c)),
      ...[...set].filter((c) => !BUILTIN_CATS.includes(c)).sort()
    ]
  })
  const shownGlyphs = $derived.by(() => {
    const pq = parseQuery(ui.search, SEARCH_FIELDS.script)
    return (script?.glyphs ?? []).filter(
      (g) =>
        (!catFilter || g.category === catFilter) &&
        matchQuery(pq, (f) =>
          f === 'char'
            ? [g.char]
            : f === 'value'
              ? [g.value]
              : f === 'name'
                ? [g.name]
                : f === 'category'
                  ? [g.category]
                  : [g.char, g.name, g.value, g.category]
        )
    )
  })
  const catLabel = (c: string): string =>
    BUILTIN_CATS.includes(c) ? t(`script.categories.${c}`) : c

  $effect(() => {
    const importing = tab === 'glyphs' && (pasteOpen || !!fontPending)
    inspectorTitle = importing
      ? t('importPreview.title')
      : glyph && tab === 'glyphs'
        ? glyph.char
        : script
          ? script.name
          : t('script.title')
    // 标题显示的是字形本身时，用这套文字的字体，否则会是方框
    inspectorTitleStyle =
      !importing && glyph && tab === 'glyphs' && script ? fontFamilyCss(script) : ''
  })
  $effect(() => {
    if (script) ensureScriptFont(script)
  })

  // 规则程序（防抖）
  let program = $state<RuleProgram | null>(null)
  $effect(() => {
    if (!lang || !script) {
      program = null
      return
    }
    const text = expandRules(script, lang)
    const opts = languageParseOptions(lang, project)
    const id = setTimeout(() => (program = parseRuleText(text, opts)), 120)
    return () => clearTimeout(id)
  })
  const userProgram = $derived.by(() => {
    if (!lang || !script) return null
    return parseRuleText(
      script.rules.replace(/^\s*@glyphs\s*$/m, ''),
      languageParseOptions(lang, project)
    )
  })
  const autoLines = $derived(script ? autoMappingRows(script, lang) : [])
  // 字形多的时候分批画
  const lzG = lazy(80)
  let lastGlyphs = -1
  $effect(() => {
    const n = shownGlyphs.length
    if (n === lastGlyphs) return
    lastGlyphs = n
    lzG.reset()
  })
  /** 「转写来源」里能挑的词干槽：词类里定义的，加上词条里实际填过的 */
  const stemNames = $derived(
    [
      ...new Set([
        ...project.posList.flatMap((p) => (p.stemSlots ?? []).map((s) => s.name)),
        ...project.lexemes.flatMap((l) => Object.keys(l.stems ?? {}))
      ])
    ].filter(Boolean)
  )
  const testResults = $derived.by(() => {
    if (!program) return []
    return testText
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ w, out: runRules(program!, w, { trace: false }).output }))
  })
  const previewLexemes = $derived(
    lang ? project.lexemes.filter((l) => l.languageId === lang.id).slice(0, 40) : []
  )
  const previewSentences = $derived(
    lang ? project.sentences.filter((s) => s.languageId === lang.id).slice(0, 10) : []
  )

  function touch(): void {
    projectState.touch()
  }
  function addScript(): void {
    if (!lang) return
    const s = createScript(t('script.newName'))
    lang.scripts.push(s)
    selectedScript = s.id
    touch()
  }
  function removeScript(s: Script): void {
    if (!lang) return
    const idx = lang.scripts.indexOf(s)
    const snap = $state.snapshot(s) as Script
    lang.scripts.splice(idx, 1)
    selectedScript = lang.scripts[0]?.id ?? null
    touch()
    ui.toast(t('script.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          lang!.scripts.splice(Math.min(idx, lang!.scripts.length), 0, snap)
          selectedScript = snap.id
          touch()
        }
      }
    })
  }
  function addGlyph(): void {
    if (!script) return
    const g: Glyph = {
      id: newId(),
      char: '',
      name: '',
      value: '',
      category: catFilter || 'letter',
      notes: ''
    }
    script.glyphs.push(g)
    selectedGlyph = g.id
    touch()
    queueMicrotask(() => document.getElementById('g-char')?.focus())
  }
  // ───── 手写板 ─────
  /** 正在手写板上画的字形 */
  let padGlyphId = $state<string | null>(null)
  /** 手写一个新字形：先建一条空字形，再打开手写板 */
  function drawNewGlyph(): void {
    addGlyph()
    padGlyphId = selectedGlyph
  }
  /** 内嵌字体里已经有的码位：新画的字不占它们 */
  function embeddedCodepoints(s: Script): number[] {
    const url = s.font.dataUrl
    if (!url) return []
    try {
      return parseFont(base64ToBuffer(url.slice(url.indexOf(',') + 1))).glyphs.map(
        (x) => x.codepoint
      )
    } catch {
      return []
    }
  }
  /** 手写板开着、这套文字有内嵌字体时，把字体数据交给手写板（从字体载入字形用） */
  const padFontData = $derived(
    padGlyphId && script?.font.dataUrl ? dataUrlToBuffer(script.font.dataUrl) : null
  )
  /** 画完保存：没笔画也没轮廓就去掉手写；字符还空着就分一个私用区码位（项目里别的文字用了的、内嵌字体里有的都跳过） */
  function saveDrawing(g: Glyph, d: GlyphDrawing): void {
    padGlyphId = null
    if (!hasDrawingContent(d)) {
      if (g.drawing) {
        delete g.drawing
        touch()
      }
      return
    }
    g.drawing = JSON.parse(JSON.stringify(d)) as GlyphDrawing
    if (!g.char && script) {
      const used = project.languages.flatMap((l) =>
        l.scripts.flatMap((s) => s.glyphs.map((x) => x.char))
      )
      g.char = freePrivateChar(used, embeddedCodepoints(script))
    }
    touch()
  }
  // ───── 导出字体 / 写回内嵌字体 ─────
  /** 内嵌字体的字形加上画过的字，重新写成 TTF；两样都没有、或者字体读不了时提示并返回 null */
  function rebuildFont(s: Script): ArrayBuffer | null {
    if (!s.font.dataUrl && !drawnGlyphs(s).length) {
      ui.toast(t('script.fontNothing'))
      return null
    }
    try {
      return buildScriptFont(s)
    } catch (e) {
      ui.toast(t('script.fontBuildFailed', { err: e instanceof Error ? e.message : String(e) }), {
        kind: 'error'
      })
      return null
    }
  }
  /** 存盘用的文件名：原来内嵌的字体文件名，没有就用字体名或文字名 */
  function fontBaseName(s: Script): string {
    const base = s.font.fileName.replace(/\.[^.]+$/, '') || s.font.family || s.name || 'font'
    return base.replace(/[\\/:*?"<>|]/g, '_')
  }
  async function exportFont(kind: 'ttf' | 'woff'): Promise<void> {
    if (!script) return
    const ttf = rebuildFont(script)
    if (!ttf) return
    try {
      const data = kind === 'woff' ? await toWoff(ttf) : ttf
      await platform.saveBinaryFile(`${fontBaseName(script)}.${kind}`, new Uint8Array(data))
    } catch (e) {
      ui.toast(t('script.fontBuildFailed', { err: e instanceof Error ? e.message : String(e) }), {
        kind: 'error'
      })
    }
  }
  /** 用重新写成的 TTF 换掉内嵌字体；画过的字留着（跟字体里的一样） */
  function writeBackFont(): void {
    const s = script
    if (!s) return
    const ttf = rebuildFont(s)
    if (!ttf) return
    const bytes = new Uint8Array(ttf)
    let bin = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const fileName = `${fontBaseName(s)}.ttf`
    const prev = { ...s.font }
    s.font = { family: s.font.family, dataUrl: fontDataUrl(fileName, btoa(bin)), fileName }
    ensureScriptFont(s)
    touch()
    ui.toast(t('script.fontWrittenBack', { name: fileName }), {
      action: {
        label: t('common.undo'),
        run: () => {
          s.font = prev
          ensureScriptFont(s)
          touch()
        }
      }
    })
  }
  function pickGlyph(e: MouseEvent, g: Glyph, i: number): void {
    if (e.shiftKey && lastGlyphIndex >= 0) {
      const [a, b] = [Math.min(lastGlyphIndex, i), Math.max(lastGlyphIndex, i)]
      multiGlyphs = shownGlyphs.slice(a, b + 1).map((x) => x.id)
    } else if (e.ctrlKey || e.metaKey) {
      multiGlyphs = multiGlyphs.includes(g.id)
        ? multiGlyphs.filter((x) => x !== g.id)
        : [...multiGlyphs, g.id]
      lastGlyphIndex = i
    } else {
      multiGlyphs = []
      lastGlyphIndex = i
    }
    selectedGlyph = g.id
  }
  function removeSelectedGlyphs(): void {
    if (!script || multiGlyphs.length < 2) return
    const ids = new Set(multiGlyphs)
    const snap = $state.snapshot(script.glyphs) as Glyph[]
    script.glyphs = script.glyphs.filter((g) => !ids.has(g.id))
    if (selectedGlyph && ids.has(selectedGlyph)) selectedGlyph = null
    multiGlyphs = []
    touch()
    ui.toast(t('script.bulkDeleted', { n: ids.size }), {
      action: {
        label: t('common.undo'),
        run: () => {
          if (script) script.glyphs = snap
          touch()
        }
      }
    })
  }
  async function categorizeSelectedGlyphs(): Promise<void> {
    if (!script || !multiGlyphs.length) return
    const cat = (await ui.prompt(t('script.bulkCategoryPrompt'), ''))?.trim()
    if (cat === undefined || cat === null) return
    for (const g of script.glyphs) if (multiGlyphs.includes(g.id)) g.category = cat
    touch()
  }
  /** 改一项音节拼合设置；第一次改时补齐默认值 */
  function setPacking(key: string, value: string | boolean): void {
    if (!script) return
    const cur: ScriptPacking = script.packing ?? {
      enabled: false,
      killer: '',
      letterMap: '',
      marked: '',
      lengths: '',
      baseVowels: '',
      dummyVowel: 'a',
      letters: '',
      vowels: ''
    }
    script.packing = { ...cur, [key]: value }
    touch()
  }
  function removeGlyph(g: Glyph): void {
    if (!script) return
    script.glyphs.splice(script.glyphs.indexOf(g), 1)
    if (selectedGlyph === g.id) selectedGlyph = null
    touch()
  }
  /** 按转写值（元音 / 辅音 / 音节 / 标点……）和字符本身分类；用户自己起名的分类不动 */
  function autoCategorize(): void {
    if (!script) return
    const categorize = glyphCategorizer(lang, script)
    const counts = new Map<string, number>()
    let kept = 0
    let changed = 0
    for (const g of script.glyphs) {
      if (!g.char && !g.value) continue
      if (g.category && !BUILTIN_CATS.includes(g.category)) {
        kept++
        continue
      }
      const c = categorize(g)
      if (g.category !== c) changed++
      g.category = c
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    if (changed) touch()
    if (catFilter && !script.glyphs.some((g) => g.category === catFilter)) catFilter = ''
    const parts = BUILTIN_CATS.filter((c) => counts.has(c))
      .map((c) => t('script.autoCategorizedPart', { cat: catLabel(c), n: counts.get(c) ?? 0 }))
      .join(t('phonology.listSep'))
    ui.toast(
      (parts ? t('script.autoCategorized', { parts }) : t('script.autoCategorizedNone')) +
        (kept ? t('script.autoCategorizedKept', { n: kept }) : '')
    )
  }
  /** 合并字形：已有相同字符的不重复加 */
  function mergeGlyphs(
    items: { char: string; value?: string; name?: string; category?: string }[]
  ): number {
    if (!script) return 0
    const have = new Set(script.glyphs.map((g) => g.char))
    const categorize = glyphCategorizer(lang, script)
    let n = 0
    for (const it of items) {
      if (!it.char || have.has(it.char)) continue
      have.add(it.char)
      script.glyphs.push({
        id: newId(),
        char: it.char,
        name: it.name ?? '',
        value: it.value ?? '',
        category: it.category ?? categorize({ char: it.char, value: it.value ?? '' }),
        notes: ''
      })
      n++
    }
    if (n) {
      touch()
      importedFlash++
    }
    ui.toast(n ? t('script.imported', { n }) : t('script.noGlyphsInFont'))
    return n
  }
  async function importFont(readGlyphs: boolean): Promise<void> {
    if (!script) return
    const files = await platform.readBinaryFiles({
      multiple: false,
      extensions: ['ttf', 'otf', 'ttc', 'woff', 'woff2']
    })
    const f = files[0]
    if (!f) return
    const ext = f.name.toLowerCase().split('.').pop() ?? ''
    const dataUrl = fontDataUrl(f.name, f.base64)
    // 只内嵌字体、或者读不了字形表的格式：直接换上
    if (!readGlyphs || !['ttf', 'otf', 'ttc'].includes(ext)) {
      embedFont(f.name, dataUrl)
      return
    }
    try {
      const parsed = parseFont(base64ToBuffer(f.base64))
      const previewFamily = `qy-font-preview-${Date.now()}`
      try {
        const face = new FontFace(previewFamily, `url(${dataUrl})`)
        void face
          .load()
          .then((ff) => document.fonts.add(ff))
          .catch(() => {})
      } catch {
        /* 非浏览器环境 */
      }
      pasteOpen = false
      fontPending = {
        name: f.name,
        dataUrl,
        family: parsed.family || '',
        previewFamily,
        glyphs: parsed.glyphs
          .filter((g) => g.codepoint > 0x20 && !(g.codepoint >= 0x7f && g.codepoint <= 0xa0))
          .map((g) => ({
            char: g.char,
            name: g.name,
            value: /^[A-Za-z0-9]$/.test(g.char) ? g.char : ''
          }))
      }
    } catch (e) {
      embedFont(f.name, dataUrl)
      ui.toast(String(e), { kind: 'error' })
    }
  }
  function embedFont(fileName: string, dataUrl: string, family = ''): void {
    if (!script) return
    script.font = { family: script.font.family || family, dataUrl, fileName }
    ensureScriptFont(script)
    touch()
  }
  function applyFontPending(): void {
    const p = fontPending
    if (!p || !script) return
    embedFont(p.name, p.dataUrl, p.family)
    mergeGlyphs(p.glyphs)
    fontPending = null
  }
  /** 字形导入样例（粘贴的或从字体读的）：前 60 个，已经有的标出来 */
  const glyphSample = $derived.by(() => {
    if (!script || tab !== 'glyphs') return null
    const items = fontPending ? fontPending.glyphs : pasteOpen ? pasteItems : null
    if (!items) return null
    const have = new Set(script.glyphs.map((g) => g.char))
    return {
      total: items.length,
      skip: items.filter((g) => have.has(g.char)).length,
      glyphs: items.slice(0, 60).map((g) => ({ ...g, skip: have.has(g.char) }))
    }
  })
  /** 测试台：敲的几行按同一套拆法认，已经有的照样标出来 */
  function testGlyphs(text: string): PreviewData | null {
    if (!script) return null
    const items = parseGlyphLines(text)
    if (!items.length) return null
    const have = new Set(script.glyphs.map((g) => g.char))
    return { glyphs: items.slice(0, 60).map((g) => ({ ...g, skip: have.has(g.char) })) }
  }
  function importPaste(): void {
    mergeGlyphs(pasteItems)
    pasteText = ''
    pasteOpen = false
  }
  async function setCategory(g: Glyph, v: string): Promise<void> {
    if (v === '__custom') {
      const name = await ui.prompt(t('script.category'))
      if (!name) return
      g.category = name.trim()
    } else g.category = v
    touch()
  }
  function clearFont(): void {
    if (!script) return
    script.font = { family: script.font.family, dataUrl: null, fileName: '' }
    touch()
  }
</script>

<div class="page">
  <div class="page-head row tabbed">
    <h1>{t('script.title')}</h1>
    <GuideLink section="script" />
    {#if lang}<span class="badge lang-badge" style:background-color={lang.color} style:color="#fff"
        >{lang.name}</span
      >{/if}
    {#if script}
      <div class="seg" data-tour="script-tabs">
        {#each TABS as tb (tb)}<button class:active={tab === tb} onclick={() => (tab = tb)}
            >{t(`script.tabs.${tb}`)}</button
          >{/each}
      </div>
    {/if}
    <div class="booktabs grow">
      {#each lang?.scripts ?? [] as s, si (s.id)}
        <span
          class="tabwrap"
          {...sortable(`script-tabs-${lang?.id}`, si, (from, to) => {
            if (lang && moveItem(lang.scripts, from, to)) touch()
          })}
        >
          <button
            class="tab"
            class:active={script?.id === s.id}
            onclick={() => {
              selectedScript = s.id
              selectedGlyph = null
            }}>{s.name}</button
          >
          <button
            class="pen"
            title={t('common.rename')}
            onclick={() => {
              selectedScript = s.id
              selectedGlyph = null
              ui.inspectorOpen = true
              ui.syntaxOpen = false
              focusField('#s-name')
            }}><Pencil size={11} /></button
          >
        </span>
      {/each}
    </div>
    {#if lang}
      <button class="btn primary" data-tour="script-add" onclick={addScript}
        ><Plus size={16} />{t('script.add')}</button
      >
    {/if}
  </div>
  <Hint id="script" text={t('script.hint')} />

  {#if !lang}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if !script}
    <p class="muted">{t('script.empty')}</p>
  {:else if tab === 'glyphs'}
    <div class="scroll" use:navScroll={'script'}>
      <div class="row wrap tools" data-tour="script-glyph-tools">
        <button class="btn sm" onclick={() => importFont(true)}
          ><FileType size={14} />{t('script.importFromFont')}</button
        >
        <button
          class="btn sm"
          onclick={() => {
            pasteOpen = !pasteOpen
            fontPending = null
          }}><ClipboardPaste size={14} />{t('script.importText')}</button
        >
        <button class="btn ghost sm" onclick={autoCategorize}
          ><Wand2 size={14} />{t('script.autoCategorize')}</button
        >
        <span class="grow"></span>
        <Menu small label={t('script.exportFont')} icon={FileOutput}>
          <button title={t('script.exportFontHint')} onclick={() => exportFont('ttf')}
            >{t('script.exportTtf')}</button
          >
          <button title={t('script.exportFontHint')} onclick={() => exportFont('woff')}
            >{t('script.exportWoff')}</button
          >
          <button title={t('script.writeBackFontHint')} onclick={writeBackFont}
            >{t('script.writeBackFont')}</button
          >
        </Menu>
        <button class="btn sm" title={t('script.drawGlyphHint')} onclick={drawNewGlyph}
          ><PenTool size={14} />{t('script.drawGlyph')}</button
        >
        <button class="btn primary sm" onclick={addGlyph}
          ><Plus size={14} />{t('script.addGlyph')}</button
        >
      </div>
      {#if pasteOpen}
        <div class="card paste">
          <p class="small muted">{t('script.importTextHint')}</p>
          <textarea class="textarea data" rows="6" bind:value={pasteText}></textarea>
          <div class="row">
            <span class="grow"></span><button
              class="btn ghost sm"
              onclick={() => (pasteOpen = false)}>{t('common.cancel')}</button
            ><button class="btn primary sm" onclick={importPaste}
              >{t('script.importTextRun')}</button
            >
          </div>
        </div>
      {/if}
      {#if fontPending}
        <div class="card paste">
          <p class="small">
            {t('script.fontGlyphs', {
              name: fontPending.name,
              n: fontPending.glyphs.length,
              skip: glyphSample?.skip ?? 0
            })}
          </p>
          <div class="row">
            <span class="grow"></span><button
              class="btn ghost sm"
              onclick={() => (fontPending = null)}>{t('common.cancel')}</button
            ><button class="btn primary sm" onclick={applyFontPending}
              >{t('script.importFontRun')}</button
            >
          </div>
        </div>
      {/if}
      {#if categories.length > 1}
        <div class="row wrap">
          <button class="chip" class:active={catFilter === ''} onclick={() => (catFilter = '')}
            >{t('script.allCategories')}</button
          >
          {#each categories as c (c)}<button
              class="chip"
              class:active={catFilter === c}
              onclick={() => (catFilter = c)}>{catLabel(c)}</button
            >{/each}
        </div>
      {/if}
      {#if multiGlyphs.length > 1}
        <div class="row bulk">
          <span class="small">{t('lexicon.selectedN', { n: multiGlyphs.length })}</span>
          <button class="btn ghost sm" onclick={categorizeSelectedGlyphs}
            >{t('script.bulkCategory')}</button
          >
          <button class="btn ghost sm danger" onclick={removeSelectedGlyphs}
            ><Trash2 size={14} />{t('common.delete')}</button
          >
          <button class="btn ghost sm" onclick={() => (multiGlyphs = [])}
            >{t('lexicon.clearSel')}</button
          >
        </div>
      {/if}
      {#if script.glyphs.length === 0}
        <p class="muted">{t('script.noGlyphs')}</p>
      {:else}
        <div class="grid" use:flashOn={importedFlash}>
          {#each shownGlyphs.slice(0, lzG.shown) as g, gi (g.id)}
            <button
              class="gcard"
              class:sel={selectedGlyph === g.id || multiGlyphs.includes(g.id)}
              onclick={(e) => pickGlyph(e, g, gi)}
              title={g.name}
            >
              <span class="gchar" style={fontCss(script)}>{g.char || '·'}</span>
              <span class="gval data">{g.value || ' '}</span>
            </button>
          {/each}
        </div>
        {#if shownGlyphs.length > lzG.shown}<div class="more-mark" use:lazyMore={lzG}></div>{/if}
      {/if}
    </div>
  {:else if tab === 'rules'}
    <div class="scroll">
      <div class="row">
        <span class="grow"></span>
        <HelpDot tip={t('script.rulesHint')} />
        <div class="seg">
          <button class:active={rulesView === 'list'} onclick={() => (rulesView = 'list')}
            ><List size={14} />{t('soundChanges.viewList')}</button
          >
          <button class:active={rulesView === 'source'} onclick={() => (rulesView = 'source')}
            ><Code size={14} />{t('soundChanges.viewSource')}</button
          >
        </div>
      </div>
      {#if t(`script.typeHints.${script.type}`)}
        <Hint id={`script-type-${script.type}`} text={t(`script.typeHints.${script.type}`)} />
      {/if}
      <div class="editor-area" data-tour="script-rules">
        {#if rulesView === 'list'}
          <RuleList bind:text={script.rules} program={userProgram} onchange={touch} />
        {:else}
          <div class="src">
            <RuleEditor
              bind:value={script.rules}
              diagnostics={program?.diagnostics ?? []}
              oninput={touch}
            />
          </div>
        {/if}
      </div>
      <section class="pack">
        <SectionHead
          id="script.packing"
          title={t('script.packing.title')}
          tip={t('script.packing.hint')}
        />
        {#if !sectionCollapsed('script.packing')}
          <label class="row check"
            ><input
              type="checkbox"
              checked={script.packing?.enabled ?? false}
              onchange={(e) => setPacking('enabled', (e.currentTarget as HTMLInputElement).checked)}
            />{t('script.packing.enabled')}</label
          >
          {#if script.packing?.enabled}
            <div class="grid2">
              <label class="field"
                ><span>{t('script.packing.killer')}</span><input
                  class="input data"
                  value={script.packing.killer}
                  oninput={(e) => setPacking('killer', (e.currentTarget as HTMLInputElement).value)}
                /></label
              >
              <label class="field"
                ><span>{t('script.packing.dummyVowel')}</span><input
                  class="input data"
                  value={script.packing.dummyVowel}
                  oninput={(e) =>
                    setPacking('dummyVowel', (e.currentTarget as HTMLInputElement).value)}
                /></label
              >
              <label class="field"
                ><span>{t('script.packing.marked')}</span><input
                  class="input data"
                  value={script.packing.marked}
                  oninput={(e) => setPacking('marked', (e.currentTarget as HTMLInputElement).value)}
                /></label
              >
              <label class="field"
                ><span>{t('script.packing.vowels')}</span><input
                  class="input data"
                  value={script.packing.vowels}
                  oninput={(e) => setPacking('vowels', (e.currentTarget as HTMLInputElement).value)}
                /></label
              >
            </div>
            <label class="field"
              ><span>{t('script.packing.letters')}</span><input
                class="input data"
                value={script.packing.letters}
                oninput={(e) => setPacking('letters', (e.currentTarget as HTMLInputElement).value)}
              /></label
            >
            <div class="grid2">
              <label class="field"
                ><span>{t('script.packing.letterMap')}</span><textarea
                  class="textarea data"
                  rows="4"
                  value={script.packing.letterMap}
                  oninput={(e) =>
                    setPacking('letterMap', (e.currentTarget as HTMLTextAreaElement).value)}
                ></textarea></label
              >
              <div class="col">
                <label class="field"
                  ><span>{t('script.packing.lengths')}</span><textarea
                    class="textarea data"
                    rows="2"
                    value={script.packing.lengths}
                    oninput={(e) =>
                      setPacking('lengths', (e.currentTarget as HTMLTextAreaElement).value)}
                  ></textarea></label
                >
                <label class="field"
                  ><span>{t('script.packing.baseVowels')}</span><textarea
                    class="textarea data"
                    rows="2"
                    value={script.packing.baseVowels}
                    oninput={(e) =>
                      setPacking('baseVowels', (e.currentTarget as HTMLTextAreaElement).value)}
                  ></textarea></label
                >
              </div>
            </div>
          {/if}
        {/if}
      </section>
      <section class="auto">
        <SectionHead id="script.autoRules" title={t('script.autoRules', { n: autoLines.length })} />
        {#if !sectionCollapsed('script.autoRules')}
          <div class="auto-lines">
            {#each autoLines as r, i (i)}<div>
                <span class="mono">{r.from} &gt;</span>
                <span class="glyph-to" style={fontFamilyCss(script)}>{r.to}</span>
              </div>{/each}
          </div>
        {/if}
      </section>
    </div>
  {:else}
    <div class="scroll" data-tour="script-preview">
      {#if previewLexemes.length === 0 && previewSentences.length === 0}
        <p class="muted">{t('script.previewEmpty')}</p>
      {/if}
      {#if previewLexemes.length}
        <h3>{t('script.previewLexicon')}</h3>
        <table class="tbl">
          <tbody>
            {#each previewLexemes as l (l.id)}
              <tr>
                <td class="data">{l.lemma}</td>
                <td
                  class="scr"
                  style={fontCss(script)}
                  dir={script.direction === 'rtl' ? 'rtl' : 'ltr'}
                  >{lexemeScript(lang, script, l)}</td
                >
                <td class="muted small"
                  >{l.senses
                    .map((s) => pickText(s.definition, glossLangs))
                    .filter(Boolean)
                    .join('; ')}</td
                >
              </tr>
            {/each}
          </tbody>
        </table>
      {/if}
      {#if previewSentences.length}
        <h3>{t('script.previewCorpus')}</h3>
        {#each previewSentences as s (s.id)}
          <div class="card sent">
            <div
              class="scr big"
              style={fontCss(script)}
              dir={script.direction === 'rtl' ? 'rtl' : 'ltr'}
            >
              {sentenceScriptText(project, lang, script, s)}
            </div>
            <div class="data">{s.text}</div>
            <div class="small muted">{pickText(s.translation, glossLangs)}</div>
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

{#if lang && script}
  {@const sc = script}
  <Portal>
    {#if glyphSample}
      <ImportPreview
        kind={glyphSample.total ? 'glyphs' : 'empty'}
        total={glyphSample.total}
        glyphs={glyphSample.glyphs}
        glyphStyle={fontPending
          ? `font-family:"${fontPending.previewFamily}",var(--font-script)`
          : fontFamilyCss(sc)}
        source={fontPending?.name ?? ''}
        testParse={testGlyphs}
        testPlaceholder={t('importPreview.phGlyphs')}
      />
    {:else if tab === 'glyphs' && glyph}
      {@const g = glyph}
      <div class="preview-glyph" style={fontCss(sc)}>{g.char || '·'}</div>
      <div class="row wrap draw-row">
        <button class="btn sm" onclick={() => (padGlyphId = g.id)}
          ><PenTool size={14} />{g.drawing ? t('script.editDrawing') : t('script.drawThis')}</button
        >
        {#if g.drawing}
          <button
            class="btn ghost sm"
            onclick={() => {
              delete g.drawing
              touch()
            }}>{t('script.removeDrawing')}</button
          >
        {/if}
      </div>
      <div class="field">
        <label for="g-char">{t('script.char')}</label><input
          id="g-char"
          class="input data"
          style={fontFamilyCss(sc)}
          bind:value={g.char}
          oninput={touch}
        />
      </div>
      <div class="field">
        <label for="g-val">{t('script.value')}</label><input
          id="g-val"
          class="input data"
          bind:value={g.value}
          oninput={touch}
          placeholder={t('script.valueHint')}
        />
      </div>
      <div class="field">
        <label for="g-name">{t('script.name')}</label><input
          id="g-name"
          class="input"
          bind:value={g.name}
          oninput={touch}
        />
      </div>
      <div class="field">
        <label for="g-cat">{t('script.category')}</label>
        <select
          id="g-cat"
          class="select"
          value={g.category}
          onchange={(e) => setCategory(g, (e.currentTarget as HTMLSelectElement).value)}
        >
          {#each [...new Set( [...BUILTIN_CATS, ...categories, g.category] )].filter(Boolean) as c (c)}<option
              value={c}>{catLabel(c)}</option
            >{/each}
          <option value="__custom">{t('script.categories.custom')}</option>
        </select>
      </div>
      <div class="field">
        <label for="g-notes">{t('common.notes')}</label><textarea
          id="g-notes"
          class="textarea"
          bind:value={g.notes}
          oninput={touch}
        ></textarea>
      </div>
      <button class="btn sm danger" onclick={() => removeGlyph(g)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    {:else}
      <div class="field">
        <label for="s-name">{t('common.name')}</label><input
          id="s-name"
          class="input"
          bind:value={sc.name}
          oninput={touch}
        />
      </div>
      <div class="field">
        <label for="s-type">{t('script.type')}</label>
        <select id="s-type" class="select" bind:value={sc.type} onchange={touch}
          >{#each TYPES as ty (ty)}<option value={ty}>{t(`script.types.${ty}`)}</option
            >{/each}</select
        >
      </div>
      <div class="field">
        <label for="s-dir">{t('script.direction')}</label>
        <select id="s-dir" class="select" bind:value={sc.direction} onchange={touch}>
          <option value="ltr">{t('phonology.dir.ltr')}</option><option value="rtl"
            >{t('phonology.dir.rtl')}</option
          ><option value="ttb">{t('phonology.dir.ttb')}</option>
        </select>
      </div>
      <label class="field check">
        <input type="checkbox" bind:checked={sc.vertical} onchange={touch} />
        <span>{t('script.vertical')}</span>
        <HelpDot tip={t('script.verticalHint')} />
      </label>
      <div class="field">
        <label for="s-parens">{t('script.parens')} <HelpDot tip={t('script.parensHint')} /></label>
        <select
          id="s-parens"
          class="select"
          value={sc.parens ?? 'keep'}
          onchange={(e) => {
            sc.parens = (e.currentTarget as HTMLSelectElement).value as ParenMode
            touch()
          }}
        >
          {#each ['keep', 'include', 'omit'] as pm (pm)}
            <option value={pm}>{t(`script.parensModes.${pm}`)}</option>
          {/each}
        </select>
      </div>
      <div class="field">
        <label for="s-from">{t('script.from')} <HelpDot tip={t('script.fromHint')} /></label>
        <select
          id="s-from"
          class="select"
          value={sc.from ?? 'lemma'}
          onchange={(e) => {
            const v = (e.currentTarget as HTMLSelectElement).value
            if (v === 'lemma') delete sc.from
            else sc.from = v
            touch()
          }}
        >
          <option value="lemma">{t('script.fromLemma')}</option>
          {#each stemNames as n (n)}<option value={`stem:${n}`}
              >{t('script.fromStem', { name: n })}</option
            >{/each}
          {#each lang?.orthographies ?? [] as o (o.id)}<option value={`pron:${o.id}`}
              >{t('script.fromPron', { name: o.name })}</option
            >{/each}
          {#each project.customFields as f (f.id)}<option value={`custom:${f.id}`}
              >{t('script.fromCustom', { name: customFieldTitle(f, glossLangs) })}</option
            >{/each}
        </select>
      </div>
      <div class="field">
        <span class="small muted">{t('script.font')} <HelpDot tip={t('script.fontHint')} /></span>
        <input
          class="input"
          bind:value={sc.font.family}
          oninput={touch}
          placeholder={t('script.fontFamily')}
        />
        <div class="row wrap">
          <button class="btn sm" onclick={() => importFont(false)}
            ><Download size={14} />{t('script.importFont')}</button
          >
          {#if sc.font.dataUrl}<span class="small muted"
              >{t('script.fontEmbedded', { name: sc.font.fileName })}</span
            ><button class="btn ghost icon sm" title={t('script.clearFont')} onclick={clearFont}
              ><X size={14} /></button
            >{/if}
        </div>
      </div>
      <div class="field">
        <label for="s-test">{t('script.test')}</label>
        <textarea
          id="s-test"
          class="textarea data"
          rows="3"
          bind:value={testText}
          placeholder={t('script.testPlaceholder')}
        ></textarea>
        {#if testResults.length}
          <table class="res">
            <tbody
              >{#each testResults as r, ri (ri)}<tr
                  ><td class="data">{r.w}</td><td
                    class="scr"
                    style={fontCss(sc)}
                    dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}>{r.out}</td
                  ></tr
                >{/each}</tbody
            >
          </table>
        {/if}
      </div>
      <div class="field">
        <label for="s-notes">{t('common.notes')}</label><textarea
          id="s-notes"
          class="textarea"
          bind:value={sc.notes}
          oninput={touch}
        ></textarea>
      </div>
      <button class="btn sm danger" onclick={() => removeScript(sc)}
        ><Trash2 size={14} />{t('common.delete')}</button
      >
    {/if}
  </Portal>
{/if}

{#if padGlyphId && script}
  {@const pg = script.glyphs.find((x) => x.id === padGlyphId)}
  {#if pg}
    <GlyphPad
      drawing={pg.drawing}
      fontData={padFontData}
      char={pg.char}
      title={t('glyphPad.title', { name: pg.name || pg.value || t('script.untitledGlyph') })}
      onsave={(d) => saveDrawing(pg, d)}
      oncancel={() => (padGlyphId = null)}
    />
  {/if}
{/if}

<style>
  .field.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
  }
  .pack {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pack .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 6px 12px;
  }
  .pack .col {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bulk {
    gap: 8px;
    padding: 4px 0;
  }
  .page {
    padding: 20px 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    height: 100%;
  }
  .page-head {
    gap: 10px;
    flex-wrap: wrap;
  }
  .chip {
    padding: 2px 10px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    font-size: 13px;
    cursor: pointer;
    color: var(--text-2);
  }
  .chip.active {
    border-color: var(--accent);
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }
  .tools {
    gap: 8px;
  }
  .paste {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(72px, 1fr));
    gap: 8px;
    border-radius: var(--radius-sm);
  }
  .gcard {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 8px 4px 6px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
    cursor: pointer;
    min-width: 0;
  }
  .gcard:hover {
    border-color: var(--border-strong);
  }
  .gcard.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .gchar {
    font-size: 30px;
    line-height: 1.2;
    color: var(--text);
  }
  .gval {
    font-size: 12px;
    color: var(--text-2);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .editor-area {
    /* 不跟着拉伸：编辑规则时这一块会变高，下面的「音节拼合」「自动映射」照样往下排 */
    flex: none;
    min-height: 240px;
    display: flex;
    flex-direction: column;
  }
  .src {
    flex: 1;
    min-height: 240px;
    display: flex;
  }
  .auto,
  .pack {
    flex: none;
  }
  .more-mark {
    height: 1px;
  }
  .auto-lines {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-size: 12px;
    max-height: 240px;
    overflow: auto;
    line-height: 1.7;
    white-space: pre;
  }
  .auto-lines .glyph-to {
    font-size: 16px;
  }
  .draw-row {
    gap: 6px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .tbl {
    border-collapse: collapse;
    font-size: 14px;
  }
  .tbl td {
    padding: 4px 10px;
    border-bottom: 1px solid var(--border);
  }
  .scr {
    font-size: 20px;
    line-height: 1.4;
  }
  .scr.big {
    font-size: 26px;
  }
  .sent {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .preview-glyph {
    font-size: 64px;
    line-height: 1.2;
    text-align: center;
    padding: 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-elev);
  }
  .res {
    border-collapse: collapse;
    font-size: 14px;
    margin-top: 6px;
  }
  .res td {
    padding: 2px 8px 2px 0;
  }
  h3 {
    margin: 4px 0 2px;
  }
</style>
