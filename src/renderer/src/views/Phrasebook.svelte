<script lang="ts">
  import { orthoIpaLabel } from '$lib/ui/labels'
  import { navScroll } from '$lib/ui/navScroll'
  import { scrollToItem } from '$lib/ui/reveal'
  import type { PageView } from '$lib/state/ui.svelte'
  import { platform } from '$lib/platform'
  import Menu from '$lib/ui/Menu.svelte'
  import TableImportDialog from '$lib/ui/TableImportDialog.svelte'
  import { guideUrl } from '$lib/core/guide'
  import { toCsv } from '$lib/core/csv'
  import { normalizeSentence } from '$lib/core/sentenceDedup'
  import {
    importPhraseRecords,
    importPhrasesJson,
    previewPhrasesJson,
    phraseFields,
    phrasesToJson,
    phrasesToRows
  } from '$lib/importers/corpusIO'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  /** 短语簿：分类 → 短语；检视器编辑原文、译文、发音、变体、标签。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { i18n, t, pickText } from '$lib/i18n/index.svelte'
  import { createPhrase } from '$lib/core/factory'
  import type { Id, Phrase, Token } from '$lib/core/model'
  import { transcribe } from '$lib/core/pronounce'
  import { textScript } from '$lib/script/lexiconScript'
  import { fontCss } from '$lib/script/fonts'
  import { analyzeSentence, analyzeToken, glossIndexFor } from '$lib/engine/gloss'
  import { WordResolver } from '$lib/engine/gloss/resolve'
  import { spanTokens, tokenSpans, tokensMatchText } from '$lib/engine/gloss/tokens'
  import { rewriteWordInText, tokenizeOptionsFor, writeChoice } from '$lib/engine/gloss/assign'
  import {
    wordHover,
    type HoverAssign,
    type HoverChoice,
    type HoverPart
  } from '$lib/state/wordHover.svelte'
  import Portal from '$lib/ui/Portal.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import Workbench, { type BenchResult, type BenchSaved } from '$lib/ui/Workbench.svelte'
  import { pinChoices } from '$lib/engine/compose'
  import { uiGlossCode } from '$lib/core/glossInputs'
  import { Plus, Trash2, X, Wand2, Upload, Download, PencilRuler } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveById } from '$lib/core/move'
  import { lazy, lazyMore } from '$lib/ui/lazy.svelte'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const langId = $derived(
    projectState.currentLanguageId ??
      project.settings.defaultLanguageId ??
      project.languages[0]?.id ??
      null
  )
  const language = $derived(project.languages.find((l) => l.id === langId) ?? null)

  /** 回到这一页时接着用上次的分类与选中的短语；换了语言就不恢复 */
  const memo = ui.memo<{
    lang: Id | null
    selectedId: Id | null
    category: string
    /** 开着的工作台：填回哪一条、拼到哪儿了（跳去词库新建词条再回来，照原样摆回去） */
    bench: { targetId: Id | null; initial: string; saved?: BenchSaved } | null
  }>('phrasebook')
  const sameLang = memo.lang === projectState.currentLanguageId
  let selectedId = $state<Id | null>(sameLang ? (memo.selectedId ?? null) : null)
  let category = $state<string>(sameLang ? (memo.category ?? '') : '')
  /** 表格导入对话框 */
  let importOpen = $state(false)
  /** 导入面板一打开先去选 JSON（菜单里点的是「从 JSON 导入」）；每点一次菜单都重开一次面板 */
  let importJson = $state(false)
  let importNonce = $state(0)
  const query = $derived(ui.search)

  const inLang = $derived(project.phrasebook.filter((p) => !langId || p.languageId === langId))
  const categories = $derived([...new Set(inLang.map((p) => p.category).filter(Boolean))].sort())
  const list = $derived.by(() => {
    const pq = parseQuery(query, SEARCH_FIELDS.phrasebook)
    return inLang.filter(
      (p) =>
        (!category || p.category === category) &&
        (!pq.terms.length || matchQuery(pq, (f) => phraseFieldValues(p, f)))
    )
  })
  /** 搜索用：短语在某个字段里的文字 */
  function phraseFieldValues(p: Phrase, field: string | null): string[] {
    const tr = Object.values(p.translation)
    switch (field) {
      case 'text':
        return [p.text, ...p.variants.map((v) => v.text)]
      case 'tr':
        return tr
      case 'category':
        return [p.category]
      case 'tag':
        return p.tags
      case 'ipa':
        return Object.values(p.pronunciations).map((x) => x.ipa)
      default:
        return [p.text, ...tr]
    }
  }
  const selected = $derived(project.phrasebook.find((p) => p.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.phrasebook.flatMap((p) => p.tags))].sort())
  /** 悬浮认词：跟语料页共用一套判断（engine/gloss/resolve.ts）；项目一改就换一个新的 */
  let resolverCache: { key: string; r: WordResolver } | null = null
  function resolver(): WordResolver {
    const key = (langId ?? '') + '|' + project.meta.updatedAt
    if (resolverCache?.key !== key) resolverCache = { key, r: new WordResolver(project, langId) }
    return resolverCache.r
  }
  /** 现算的分析：没存过分析的短语每次照原文分析一遍，项目一改就重算 */
  const freshTokens = new Map<Id, { key: string; tokens: Token[] }>()
  /** 存下来的分析还对得上原文吗（原文改过就作废） */
  function ownTokens(p: Phrase): Token[] | null {
    if (!p.tokens?.length) return null
    const surfaces = p.tokens.map((t) => t.surface)
    return tokensMatchText(p.text, surfaces, tokenizeOptionsFor(project, p.languageId))
      ? p.tokens
      : null
  }
  /**
   * 这条短语的分析：存过的以存的为准，没存过就现算。
   * 跟例句走同一个 analyzeSentence，切分、并词、隔开写的词两边才一个样子。
   */
  function tokensOf(p: Phrase): Token[] {
    const own = ownTokens(p)
    if (own) return own
    const key = p.text + '|' + project.meta.updatedAt
    const hit = freshTokens.get(p.id)
    if (hit?.key === key) return hit.tokens
    const tokens = analyzeSentence(project, {
      languageId: p.languageId,
      text: p.text,
      translation: p.translation,
      tokens: []
    }).tokens
    freshTokens.set(p.id, { key, tokens })
    return tokens
  }
  /**
   * 画一条短语要的东西：原文切成的段，能拿到分析的话每一段还指着第几个分析。
   * **列表里不整句分析**——一屏几十条短语，每条都 analyzeSentence 进页面要卡近一秒；
   * 存过分析的短语直接用存的（不花钱），其余只按写法逐词判断能不能点（`tokenOf` 一个写法只算一次），
   * 真要整句分析（悬浮、改词）时才现算那一条。
   */
  function phraseView(p: Phrase): {
    tokens: Token[] | null
    spans: { text: string; word: boolean; at: number }[]
  } {
    const opts = tokenizeOptionsFor(project, p.languageId)
    const own = ownTokens(p)
    if (own)
      return {
        tokens: own,
        spans: spanTokens(
          p.text,
          own.map((t) => t.surface),
          opts
        )
      }
    // 没存过分析：at 是「第几个词」，悬浮时再换算成第几个分析
    let wi = -1
    return {
      tokens: null,
      spans: tokenSpans(p.text, opts).map((s) => ({ ...s, at: s.word ? ++wi : -1 }))
    }
  }
  /** 同一个写法只分析一次：列表里每个词都要判断能不能点，不能为此把整句分析一遍 */
  let tokenCache: { key: string; m: Map<string, Token> } | null = null
  function tokenOf(word: string, languageId: Id): Token {
    const key = languageId + '|' + project.meta.updatedAt
    if (tokenCache?.key !== key) tokenCache = { key, m: new Map() }
    let tk = tokenCache.m.get(word)
    if (!tk) {
      const analyses = analyzeToken(
        glossIndexFor(project, languageId),
        word,
        project.settings.morphemeBoundaries
      )
      const i = analyses.findIndex((a) => a.lexemeId)
      tk = { surface: word, analyses, chosen: Math.max(0, i), confirmed: false }
      tokenCache.m.set(word, tk)
    }
    return tk
  }
  /** 现算这条短语的整句分析，并把「第几个词」换算成「第几个分析」（带空格的词形并成了一个） */
  function analyzeAtWord(p: Phrase, wordIndex: number): { tokens: Token[]; at: number } {
    const tokens = tokensOf(p)
    const spans = spanTokens(
      p.text,
      tokens.map((t) => t.surface),
      tokenizeOptionsFor(project, p.languageId)
    )
    let wi = -1
    for (const s of spans) if (s.word && ++wi === wordIndex) return { tokens, at: s.at }
    return { tokens, at: -1 }
  }
  /** 第一次在这条短语上改词：把现算的那份分析存进短语，往后以存的为准 */
  function storeTokens(p: Phrase): Token[] {
    if (!ownTokens(p)) {
      p.tokens = tokensOf(p)
      freshTokens.delete(p.id)
    }
    return p.tokens ?? []
  }
  /** 原文改了：存过分析的跟着重算（确认过的词照旧留着） */
  function reanalyze(p: Phrase): void {
    if (!p.tokens?.length) return
    p.tokens = analyzeSentence(project, {
      languageId: p.languageId,
      text: p.text,
      translation: p.translation,
      tokens: p.tokens
    }).tokens
  }
  /**
   * 认词要先把整份词库的索引建起来（大项目几百毫秒），进页面时先别做：
   * 列表照样立刻画出来，空下来再补上下划线。悬浮、点词不等这个，该建的时候就地建。
   */
  let linksReady = $state(false)
  $effect(() => {
    const idle = requestIdleCallback(() => (linksReady = true), { timeout: 400 })
    return () => cancelIdleCallback(idle)
  })
  /** 这一段能不能点：有分析就按分析判断，没有就按写法现查一个词 */
  function spanLinkable(
    p: Phrase,
    tokens: Token[] | null,
    sp: { text: string; at: number }
  ): boolean {
    if (!linksReady) return false
    const tk = tokens ? tokens[sp.at] : tokenOf(sp.text, p.languageId)
    return !!tk && resolver().linkable(tk)
  }
  /**
   * 悬浮卡里挑中了一个词条 / 语素 / 切法：写进这条短语自己的分析，原文不动。
   * 勾了「同时改原文」的才连原文一起换，发音跟着重算（手改成不规则的不动）。
   */
  function assignWord(
    id: Id,
    at: number,
    surface: string,
    index: number | null,
    c: HoverChoice
  ): void {
    const p = project.phrasebook.find((x) => x.id === id)
    if (!p) return
    const tk = storeTokens(p)[at]
    if (!tk || tk.surface !== surface) return
    if (!writeChoice(project, tk, index, c)) return
    if (wordHover.rewriteText && index === null && rewriteWordInText(project, p, at)) derivePron(p)
    touch()
  }
  function assignOf(p: Phrase, at: number, surface: string): HoverAssign {
    const id = p.id
    return {
      languageId: p.languageId,
      surface,
      onAssign: (index, c) => assignWord(id, at, surface, index, c)
    }
  }
  /**
   * 悬浮到一个词上：这时才需要整句分析。列表里没分析过的（`tokens` 为 null），
   * `spanAt` 是「第几个词」，现算一遍再换算成第几个分析。
   */
  function hoverWord(e: MouseEvent, p: Phrase, listTokens: Token[] | null, spanAt: number): void {
    const { tokens, at } = listTokens
      ? { tokens: listTokens, at: spanAt }
      : analyzeAtWord(p, spanAt)
    const tk = tokens[at]
    if (!tk) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const parts: HoverPart[] = resolver().hoverParts(tk)
    const assign = assignOf(p, at, tk.surface)
    // 拆出来的某一段没找到：直接打开那一段的「没有找到」；整个词都没找到也一样（跟语料一致）
    const miss = parts.findIndex((x) => x.missing)
    if (miss >= 0) return wordHover.showMissing(parts[miss].label, miss, rect, parts, assign)
    const target = resolver().resolveWord(tk)
    if (target?.lexemeId) wordHover.show(target.lexemeId, rect, parts, assign)
    else if (target?.morphemeId) wordHover.showMorpheme(target.morphemeId, rect, parts, assign)
    else wordHover.showMissing(tk.surface, null, rect, parts, assign)
  }
  function clickWord(
    e: MouseEvent,
    p: Phrase,
    tokens: Token[] | null,
    sp: { text: string; at: number }
  ): void {
    const tk = tokens ? tokens[sp.at] : tokenOf(sp.text, p.languageId)
    const target = tk ? resolver().resolveWord(tk) : null
    if (!target) return
    e.stopPropagation()
    wordHover.hide(true)
    if (target.morphemeId) {
      const m = project.morphemes.find((x) => x.id === target.morphemeId)
      ui.jump('morphemes', 'morpheme', target.morphemeId, m?.languageId)
      return
    }
    const id = target.lexemeId!
    ui.jump('lexicon', 'lexeme', id, project.lexemes.find((l) => l.id === id)?.languageId)
  }

  $effect(() => {
    inspectorTitle = importOpen
      ? t('importPreview.title')
      : selected
        ? t('phrasebook.phrase')
        : t('phrasebook.title')
  })
  $effect(() => {
    const id = ui.takePending('phrase')
    if (id) reveal(id)
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('phrasebook', {
      kind: 'phrase',
      lang: projectState.currentLanguageId,
      id: selectedId,
      category
    })
  })
  $effect(() => {
    const r = ui.takeRestore('phrasebook')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    category = v.category ?? ''
    ui.restoreScroll('phrasebook', r.scroll)
  })
  $effect(() => {
    Object.assign(memo, { lang: projectState.currentLanguageId, selectedId, category })
  })
  if (sameLang && !ui.restoring('phrasebook'))
    ui.restoreScroll('phrasebook', ui.lastScroll('phrasebook'))
  /** 从别处跳过来：清掉筛选、选中、滚过去闪一下 */
  let flashId = $state<Id | null>(null)
  function reveal(id: Id): void {
    const ph = project.phrasebook.find((x) => x.id === id)
    if (!ph) return
    if (langId && ph.languageId !== langId) projectState.currentLanguageId = ph.languageId
    category = ''
    ui.search = ''
    selectedId = id
    void scrollToItem('phrasebook', `.item[data-id="${id}"]`, () => {
      const i = list.findIndex((x) => x.id === id)
      if (i >= 0) lz.ensure(i + 1)
    }).then(() => flash(id))
  }
  // 分批渲染：先画一屏，滚到快见底了再画下一批（短语一多，进页面整份重画会卡一下）
  const lz = lazy(20)
  let lastCount = -1
  $effect(() => {
    const n = list.length
    if (n === lastCount) return
    lastCount = n
    lz.reset()
  })
  /** 滚到了再闪：高亮从头到尾都看得见 */
  function flash(id: Id): void {
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
  }

  function touch(): void {
    projectState.touch()
  }
  // ───── 译文工作台 ─────
  /** 开着工作台：填回哪一条（原文还空着的那条；原文已经写了就另加一条） */
  let bench = $state<{ targetId: Id | null; initial: string } | null>(
    sameLang && memo.bench ? { targetId: memo.bench.targetId, initial: memo.bench.initial } : null
  )
  function closeBench(): void {
    bench = null
    memo.bench = null
  }
  /** 工作台里的译文按界面语言写（跟释义输入框默认给的那种一致） */
  const benchGloss = $derived(uiGlossCode(i18n.locale, i18n.custom?.base))
  function openBench(p: Phrase): void {
    bench = { targetId: p.id, initial: p.translation[benchGloss] ?? '' }
    memo.bench = { ...bench }
  }
  function benchDone(r: BenchResult): void {
    if (!langId) return
    let p = bench?.targetId ? project.phrasebook.find((x) => x.id === bench!.targetId) : undefined
    if (!p || p.text.trim()) {
      project.phrasebook.unshift(createPhrase(langId, category))
      p = project.phrasebook[0]
    }
    p.text = r.text
    if (r.translation) p.translation[benchGloss] = r.translation
    // 挑定的词存成这条短语自己的分析（跟悬浮卡「改」存的是同一种）
    const tokens = analyzeSentence(project, {
      languageId: p.languageId,
      text: p.text,
      translation: p.translation,
      tokens: []
    }).tokens
    pinChoices(tokens, r.words, (w) => {
      const l = w.lexemeId ? project.lexemes.find((x) => x.id === w.lexemeId) : undefined
      return l ? pickText(l.senses[0]?.definition, glossLangs) : ''
    })
    p.tokens = tokens
    derivePron(p)
    closeBench()
    selectedId = p.id
    touch()
    ui.toast(t('bench.added'))
  }
  function add(): void {
    if (!langId) return
    const p = createPhrase(langId, category)
    project.phrasebook.unshift(p)
    selectedId = p.id
    touch()
    queueMicrotask(() => document.getElementById('ph-text')?.focus())
  }
  function remove(p: Phrase): void {
    const idx = project.phrasebook.indexOf(p)
    const snap = $state.snapshot(p) as Phrase
    project.phrasebook.splice(idx, 1)
    if (selectedId === p.id) selectedId = null
    touch()
    ui.toast(t('phrasebook.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.phrasebook.splice(Math.min(idx, project.phrasebook.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }
  /**
   * 按规则标音：手改过（不规则）的默认不动；有没动的，提示条里可以一并按规则重算（force）。
   */
  function derivePron(p: Phrase, force = false): void {
    if (!language) return
    let kept = 0
    for (const o of language.orthographies) {
      const ipa = transcribe(language, o, p.text)
      if (ipa == null) continue
      const cur = p.pronunciations[o.id]
      if (cur?.irregular && !force) {
        if (cur.ipa !== ipa) kept++
        continue
      }
      p.pronunciations[o.id] = { ipa, irregular: false }
    }
    touch()
    if (kept)
      ui.toast(t('phrasebook.pronKept', { n: kept }), {
        action: { label: t('phrasebook.pronOverwrite'), run: () => derivePron(p, true) }
      })
  }
  /** 勾掉「不规则」：这一套正字法马上按规则重算 */
  function setIrregular(p: Phrase, orthoId: string, on: boolean): void {
    const o = language?.orthographies.find((x) => x.id === orthoId)
    if (!language || !o) return
    const cur = p.pronunciations[orthoId]?.ipa ?? ''
    p.pronunciations[orthoId] = on
      ? { ipa: cur, irregular: true }
      : { ipa: transcribe(language, o, p.text) ?? cur, irregular: false }
    touch()
  }
  /** 导出当前列表里的短语（跟着当前语言、分类与搜索走） */
  async function exportPhrases(kind: 'csv' | 'json'): Promise<void> {
    const base = `${language?.name ?? project.meta.name}-phrasebook`
    if (kind === 'csv')
      await platform.saveTextFile(`${base}.csv`, '\ufeff' + toCsv(phrasesToRows(list, glossLangs)))
    else await platform.saveTextFile(`${base}.json`, phrasesToJson(list))
  }
  function openImport(jsonFirst: boolean): void {
    importJson = jsonFirst
    importNonce++
    importOpen = true
  }
  /** 导入面板里选了千语集导出的 JSON */
  function runPhrasesJson(content: string): void {
    if (!langId) return
    const r = importPhrasesJson(project, langId, content)
    if (!r) {
      ui.error(t('io.badJson'))
      return
    }
    importOpen = false
    touch()
    ui.toast(t('io.imported', { n: r.created, skipped: r.skipped }))
  }
  /** 这门语言里已经有的原文（规范化后）：导入样例拿它标「会跳过」 */
  const existingTexts = $derived(
    new Set(
      project.phrasebook
        .filter((p) => p.languageId === langId)
        .map((p) => normalizeSentence(p.text))
    )
  )
  function importPhraseTable(records: Record<string, string>[]): void {
    if (!langId) return
    const r = importPhraseRecords(project, langId, records)
    importOpen = false
    touch()
    ui.toast(t('io.imported', { n: r.created, skipped: r.skipped }))
  }
  async function renameCategory(): Promise<void> {
    if (!category) return
    const name = (await ui.prompt(t('phrasebook.category'), category))?.trim()
    if (!name || name === category) return
    for (const p of inLang) if (p.category === category) p.category = name
    category = name
    touch()
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('phrasebook.title')}</h1>
    <GuideLink section="phrasebook" />
    <span class="grow"></span>
    {#if language}
      <Menu label={t('lexicon.import')} icon={Download} tour="phrasebook-io">
        <button onclick={() => openImport(false)}>{t('io.importTable')}</button>
        <button onclick={() => openImport(true)}>{t('io.importJson')}</button>
      </Menu>
      <Menu label={t('common.export')} icon={Upload} tour="phrasebook-io">
        <button onclick={() => exportPhrases('csv')}>{t('io.exportCsv')}</button>
        <button onclick={() => exportPhrases('json')}>{t('io.exportJsonPlain')}</button>
      </Menu>
    {/if}
    <button class="btn primary" data-tour="phrasebook-add" onclick={add}
      ><Plus size={16} />{t('phrasebook.add')}</button
    >
  </div>
  <Hint id="phrasebook" text={t('phrasebook.hint')} />
  {#if importOpen && language}
    <div class="scroll">
      {#key importNonce}
        <TableImportDialog
          title={t('io.importPhrases')}
          fields={phraseFields(glossLangs, language)}
          guide={guideUrl('phrasebook', 'table-format')}
          exists={(text) => existingTexts.has(normalizeSentence(text))}
          json={{
            preview: (content) => (langId ? previewPhrasesJson(project, langId, content) : null),
            run: runPhrasesJson
          }}
          startWithJson={importJson}
          onimport={importPhraseTable}
          onclose={() => (importOpen = false)}
        />
      {/key}
    </div>
  {:else if bench && language}
    <!-- 译文工作台：先写译文、挑词拼原文，完成后填进这条短语（或者新加一条） -->
    <Workbench
      languageId={language.id}
      initial={bench.initial}
      glossLang={benchGloss}
      kind="phrase"
      saved={memo.bench?.saved ?? null}
      onsave={(s) => memo.bench && (memo.bench.saved = s)}
      ondone={benchDone}
      oncancel={closeBench}
    />
  {:else if !language}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else}
    <div class="body">
      <aside class="cats" data-tour="phrasebook-cats">
        <button class="cat" class:active={category === ''} onclick={() => (category = '')}
          >{t('phrasebook.allCategories')}<span class="n">{inLang.length}</span></button
        >
        {#each categories as c (c)}
          <button
            class="cat"
            class:active={category === c}
            onclick={() => (category = c)}
            ondblclick={renameCategory}
            >{c}<span class="n">{inLang.filter((p) => p.category === c).length}</span></button
          >
        {/each}
        {#if categories.length === 0}<p class="tiny muted">{t('phrasebook.noCategories')}</p>{/if}
      </aside>
      <div class="scroll" use:navScroll={'phrasebook'}>
        {#if list.length === 0}
          <p class="muted">{t('phrasebook.empty')}</p>
        {:else}
          <div class="list">
            {#each list.slice(0, lz.shown) as p, pi (p.id)}
              {@const view = phraseView(p)}
              <div
                class="card item"
                data-id={p.id}
                class:sel={selectedId === p.id}
                class:flash={flashId === p.id}
                role="button"
                tabindex="0"
                {...sortable('phrases', pi, (from, to) => {
                  if (moveById(project.phrasebook, list[from].id, list[to].id)) touch()
                })}
                onclick={() => (selectedId = p.id)}
                onkeydown={(e) => e.key === 'Enter' && (selectedId = p.id)}
              >
                {#each language.scripts as sc (sc.id)}
                  {@const st = textScript(project, language, sc, p.text)}
                  {#if st}<div
                      class="scr"
                      style={fontCss(sc)}
                      dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
                    >
                      {st}
                    </div>{/if}
                {/each}
                <div class="row">
                  <span class="data text grow words"
                    >{#each view.spans as sp, i (i)}{#if sp.word}<span
                          class="w"
                          class:link={spanLinkable(p, view.tokens, sp)}
                          role="link"
                          tabindex="-1"
                          onmouseenter={(e) => hoverWord(e, p, view.tokens, sp.at)}
                          onmouseleave={() => wordHover.hide()}
                          onclick={(e) => clickWord(e, p, view.tokens, sp)}
                          onkeydown={() => {}}>{sp.text}</span
                        >{:else}{sp.text}{/if}{/each}{#if !p.text}—{/if}</span
                  >
                  {#if p.category && !category}<span class="badge">{p.category}</span>{/if}
                </div>
                {#each language.orthographies as o (o.id)}
                  {#if p.pronunciations[o.id]?.ipa}<div class="small data muted">
                      /{p.pronunciations[o.id].ipa}/
                    </div>{/if}
                {/each}
                <div class="small tr">{pickText(p.translation, glossLangs)}</div>
                {#if p.variants.length}<div class="tiny muted">
                    {p.variants.map((v) => v.text).join(' · ')}
                  </div>{/if}
              </div>
            {/each}
            {#if list.length > lz.shown}<div class="more-mark" use:lazyMore={lz}></div>{/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

{#if selected && language && !importOpen}
  {@const p = selected}
  <Portal>
    <div class="field">
      <label for="ph-text">{t('phrasebook.text')}</label>
      <textarea
        id="ph-text"
        class="textarea data"
        rows="2"
        bind:value={p.text}
        oninput={touch}
        onchange={() => {
          reanalyze(p)
          derivePron(p)
        }}
      ></textarea>
    </div>
    <div class="field">
      <div class="row tr-head">
        <span class="small muted grow">{t('corpus.translation')}</span>
        <button
          class="btn ghost sm"
          class:active={bench?.targetId === p.id}
          title={t('bench.openHint')}
          onclick={() => openBench(p)}><PencilRuler size={13} />{t('bench.open')}</button
        >
      </div>
      <LocalizedInput bind:value={p.translation} onchange={touch} />
    </div>
    <div class="field">
      <label for="ph-cat">{t('phrasebook.category')}</label>
      <input id="ph-cat" class="input" list="ph-cats" bind:value={p.category} oninput={touch} />
      <datalist id="ph-cats"
        >{#each categories as c (c)}<option value={c}></option>{/each}</datalist
      >
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted grow">{t('lexicon.pronunciations')}</span><button
          class="btn ghost sm"
          onclick={() => derivePron(p)}><Wand2 size={13} />{t('phrasebook.derivePron')}</button
        >
      </div>
      {#each language.orthographies as o (o.id)}
        <div class="row kv">
          <span class="small oname" title={o.name}
            >{orthoIpaLabel(o.name, language.orthographies.length)}</span
          >
          <input
            class="input data"
            value={p.pronunciations[o.id]?.ipa ?? ''}
            oninput={(e) => {
              p.pronunciations[o.id] = {
                ipa: (e.currentTarget as HTMLInputElement).value,
                irregular: true
              }
              touch()
            }}
          />
          <label class="row small" title={t('lexicon.irregular')}
            ><input
              type="checkbox"
              checked={p.pronunciations[o.id]?.irregular ?? false}
              onchange={(e) => setIrregular(p, o.id, (e.currentTarget as HTMLInputElement).checked)}
            />!</label
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted">{t('phrasebook.variants')}</span><HelpDot key="variants" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            p.variants.push({ text: '', note: '' })
            touch()
          }}><Plus size={13} />{t('common.add')}</button
        >
      </div>
      {#each p.variants as v, i (i)}
        <div class="row kv">
          <input
            class="input data grow"
            placeholder={t('phrasebook.variantText')}
            bind:value={v.text}
            oninput={touch}
          />
          <input
            class="input grow"
            placeholder={t('phrasebook.variantNote')}
            bind:value={v.note}
            oninput={touch}
          />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              p.variants.splice(i, 1)
              touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput bind:tags={p.tags} suggestions={allTags} onchange={touch} />
    </div>
    <button class="btn sm danger" onclick={() => remove(p)}
      ><Trash2 size={14} />{t('common.delete')}</button
    >
  </Portal>
{/if}

<style>
  .item.flash {
    animation: jump-flash 1.8s ease-out;
  }
  @keyframes jump-flash {
    0%,
    35% {
      background: color-mix(in srgb, var(--accent) 26%, transparent);
      border-color: var(--accent);
    }
    100% {
      background: var(--bg-elev);
    }
  }
  .link {
    cursor: pointer;
    border-radius: 3px;
  }
  .link:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
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
  }
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 16px;
  }
  .cats {
    width: 180px;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    overflow: auto;
  }
  .cat {
    display: flex;
    align-items: center;
    gap: 6px;
    text-align: start;
    border: 0;
    background: none;
    padding: 5px 8px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    color: var(--text-2);
    font-size: 13px;
  }
  .cat:hover {
    background: var(--bg-hover);
  }
  .cat.active {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .cat.active .n {
    color: var(--text-2);
  }
  .cat .n {
    margin-inline-start: auto;
    font-size: 11px;
    color: var(--text-3);
  }
  .scroll {
    flex: 1;
    min-width: 0;
    overflow: auto;
    padding-inline-end: 4px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .more-mark {
    height: 1px;
  }
  .item {
    padding: 8px 12px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item:hover {
    border-color: var(--border-strong);
  }
  .item.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  .text {
    font-size: 15px;
    font-family: var(--font-corpus-text);
  }
  .tr {
    font-family: var(--font-corpus-tr);
    color: var(--text-2);
  }
  .scr {
    font-size: 20px;
    line-height: 1.3;
  }
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .oname {
    width: 124px;
    flex: none;
    color: var(--text-2);
  }
  .tiny {
    font-size: 11px;
  }
</style>
