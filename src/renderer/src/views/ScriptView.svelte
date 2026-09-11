<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import type { PageView } from '$lib/state/ui.svelte'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  /** 文字：字形表 / 映射规则 / 预览；字体导入与内嵌；检视器编辑字形或文字属性并试写。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { createScript, newId } from '$lib/core/factory'
  import type { Glyph, Script, ScriptPacking, ScriptType, ParenMode } from '$lib/core/model'
  import { parseFont, guessCategory } from '$lib/script/fontParse'
  import {
    ensureScriptFont,
    fontCss,
    fontDataUrl,
    base64ToBuffer,
    fontFamilyCss
  } from '$lib/script/fonts'
  import { autoMappingLines, expandRules, renderScript } from '$lib/script/render'
  import { parseRuleText, runRules, type RuleProgram } from '$lib/engine/sca'
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
    Upload,
    FileType,
    ClipboardPaste,
    Wand2,
    List,
    Code,
    X
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
  const BUILTIN_CATS = [
    'letter',
    'vowel',
    'consonant',
    'syllable',
    'mark',
    'number',
    'punct',
    'glyph',
    'space',
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
  const pasteItems = $derived(
    pasteText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [char, value = '', ...rest] = line.split(/\t+| +/)
        return { char, value, name: rest.join(' ') }
      })
  )
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
    const text = expandRules(script)
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
  const autoLines = $derived(script ? autoMappingLines(script) : [])
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
  function autoCategorize(): void {
    if (!script) return
    for (const g of script.glyphs) if (g.char) g.category = guessCategory(g.char)
    touch()
  }
  /** 合并字形：已有相同字符的不重复加 */
  function mergeGlyphs(
    items: { char: string; value?: string; name?: string; category?: string }[]
  ): number {
    if (!script) return 0
    const have = new Set(script.glyphs.map((g) => g.char))
    let n = 0
    for (const it of items) {
      if (!it.char || have.has(it.char)) continue
      have.add(it.char)
      script.glyphs.push({
        id: newId(),
        char: it.char,
        name: it.name ?? '',
        value: it.value ?? '',
        category: it.category ?? guessCategory(it.char),
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
    {#if lang}<span class="badge" style:background={lang.color} style:color="#fff">{lang.name}</span
      >{/if}
    {#if script}
      <div class="seg">
        {#each TABS as tb (tb)}<button class:active={tab === tb} onclick={() => (tab = tb)}
            >{t(`script.tabs.${tb}`)}</button
          >{/each}
      </div>
    {/if}
    <div class="booktabs grow">
      {#each lang?.scripts ?? [] as s (s.id)}
        <button
          class="tab"
          class:active={script?.id === s.id}
          onclick={() => {
            selectedScript = s.id
            selectedGlyph = null
          }}>{s.name}</button
        >
      {/each}
    </div>
    {#if lang}
      <button class="btn primary" onclick={addScript}><Plus size={16} />{t('script.add')}</button>
    {/if}
  </div>
  <Hint id="script" text={t('script.hint')} />

  {#if !lang}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if !script}
    <p class="muted">{t('script.empty')}</p>
  {:else if tab === 'glyphs'}
    <div class="scroll" use:navScroll={'script'}>
      <div class="row wrap tools">
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
          {#each shownGlyphs as g, gi (g.id)}
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
      <div class="editor-area">
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
      <details class="pack">
        <summary class="small muted"
          >{t('script.packing.title')} <HelpDot tip={t('script.packing.hint')} /></summary
        >
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
      </details>
      <details class="auto">
        <summary class="small muted">{t('script.autoRules', { n: autoLines.length })}</summary>
        <pre class="mono">{autoLines.join('\n')}</pre>
      </details>
    </div>
  {:else}
    <div class="scroll">
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
                  >{l.scriptForms?.[script.id] || renderScript(lang, script, l.lemma)}</td
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
              {renderScript(lang, script, s.text)}
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
      />
    {:else if tab === 'glyphs' && glyph}
      {@const g = glyph}
      <div class="preview-glyph" style={fontCss(sc)}>{g.char || '·'}</div>
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
        <span class="small muted">{t('script.font')} <HelpDot tip={t('script.fontHint')} /></span>
        <input
          class="input"
          bind:value={sc.font.family}
          oninput={touch}
          placeholder={t('script.fontFamily')}
        />
        <div class="row wrap">
          <button class="btn sm" onclick={() => importFont(false)}
            ><Upload size={14} />{t('script.importFont')}</button
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
              >{#each testResults as r (r.w)}<tr
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
    /* basis 必须是 auto：写成 flex:1 时高度只按剩余空间算，
       规则一多就溢出去盖住后面的「自动映射」折叠块 */
    flex: 1 1 auto;
    min-height: 240px;
    display: flex;
    flex-direction: column;
  }
  .src {
    flex: 1;
    min-height: 240px;
    display: flex;
  }
  .auto {
    flex: none;
  }
  .auto pre {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-size: 12px;
    max-height: 240px;
    overflow: auto;
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
