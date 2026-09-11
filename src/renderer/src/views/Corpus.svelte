<script lang="ts">
  import { navScroll } from '$lib/ui/navScroll'
  import type { PageView } from '$lib/state/ui.svelte'
  import { untrack } from 'svelte'
  import { platform } from '$lib/platform'
  import Menu from '$lib/ui/Menu.svelte'
  import TableImportDialog from '$lib/ui/TableImportDialog.svelte'
  import { guideUrl } from '$lib/core/guide'
  import { toCsv } from '$lib/core/csv'
  import {
    importSentenceRecords,
    importSentencesJson,
    sentenceFields,
    sentencesToJson,
    sentencesToRows,
    sentencesToText
  } from '$lib/importers/corpusIO'
  import { matchQuery, parseQuery } from '$lib/core/query'
  import { SEARCH_FIELDS } from '$lib/core/searchFields'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { i18n, t, pickText } from '$lib/i18n/index.svelte'
  import { createSentence, createLexeme, newId } from '$lib/core/factory'
  import type { Analysis, Id, Sentence, Token, Lexeme } from '$lib/core/model'
  import {
    collectEvidence,
    homographIds,
    piecesOf,
    rankHomographs,
    surfaceKey,
    type SurfaceEvidence
  } from '$lib/engine/gloss/candidates'
  import {
    analyzeSentence,
    analyzeToken,
    buildIndex,
    foldDiacritics,
    interlinear,
    toLeipzig,
    toMarkdown,
    toHtml,
    toLatex,
    renderTemplate,
    coverage,
    LEIPZIG,
    lexemeGloss
  } from '$lib/engine/gloss'
  import Portal from '$lib/ui/Portal.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import Hint from '$lib/ui/Hint.svelte'
  import { flashOn } from '$lib/ui/flash'
  import {
    wordHover,
    type HoverAssign,
    type HoverChoice,
    type HoverPart
  } from '$lib/state/wordHover.svelte'
  import { paradigmAffixes, reverseDerive } from '$lib/engine/morph/reverse'
  import { glossHasMeaning, lexemeMatchesGloss } from '$lib/core/glossMatch'
  import { renderScript, sentenceScript } from '$lib/script/render'
  import { dedupeSentences } from '$lib/state/dedupe'
  import StatsPanel from '$lib/ui/StatsPanel.svelte'
  import { corpusStatsFull } from '$lib/engine/stats'
  import { fontCss, mixedFontCss } from '$lib/script/fonts'
  import {
    Plus,
    Trash2,
    X,
    Copy,
    Wand2,
    RefreshCw,
    CheckCheck,
    Check,
    Sparkles,
    Merge,
    Upload,
    Download
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

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

  /** 回到这一页时接着用上次的子页、选中的句子、导出格式；换了语言就不恢复选中与滚动 */
  const memo = ui.memo<{
    lang: Id | null
    mode: 'entries' | 'stats' | 'abbr'
    selectedId: Id | null
    collapsedId: Id | null
    exportFormat: 'leipzig' | 'markdown' | 'html' | 'latex' | 'template'
    templateId: string
  }>('corpus')
  const sameLang = memo.lang === projectState.currentLanguageId
  let mode = $state<'entries' | 'stats' | 'abbr'>(memo.mode ?? 'entries')
  let selectedId = $state<Id | null>(sameLang ? (memo.selectedId ?? null) : null)
  const query = $derived(ui.search)
  let exportFormat = $state<'leipzig' | 'markdown' | 'html' | 'latex' | 'template'>(
    memo.exportFormat ?? 'leipzig'
  )
  let templateId = $state<string>(memo.templateId ?? '')
  let templateDraft = $state({ name: '', template: '' })
  /** 全部确认后编辑器渐隐中 */
  let fading = $state(false)
  /** 刚确认完、需要闪一下的句子 */
  let justConfirmed = $state<Id | null>(null)
  /** 全部确认后收起了编辑器的那句：检视器仍停在这句上，再点一下卡片才展开 */
  let collapsedId = $state<Id | null>(sameLang ? (memo.collapsedId ?? null) : null)
  /** 表格导入对话框 */
  let importOpen = $state(false)

  const list = $derived.by(() => {
    const pq = parseQuery(query, SEARCH_FIELDS.corpus)
    return project.sentences.filter(
      (s) =>
        (!langId || s.languageId === langId) &&
        (!pq.terms.length || matchQuery(pq, (f) => sentenceFieldValues(s, f)))
    )
  })
  /** 搜索用：例句在某个字段里的文字；gloss 与切分既按语素给，也按整词连起来给 */
  function sentenceFieldValues(s: Sentence, field: string | null): string[] {
    const tr = Object.values(s.translation)
    const morphs = (pick: (m: { form: string; gloss: string }) => string): string[] =>
      s.tokens.flatMap((tk) => {
        const ms = tk.analyses[tk.chosen]?.morphs ?? []
        return ms.length ? [...ms.map(pick), ms.map(pick).join('-')] : []
      })
    switch (field) {
      case 'text':
        return [s.text, ...s.tokens.map((tk) => tk.surface)]
      case 'gloss':
        return morphs((m) => m.gloss)
      case 'morph':
        return morphs((m) => m.form)
      case 'tr':
        return tr
      case 'source':
        return [s.source]
      case 'tag':
        return s.tags
      case 'note':
        return [s.notes, ...s.extraLines.map((x) => x.text)]
      default:
        return [s.text, ...tr]
    }
  }
  const selected = $derived(project.sentences.find((s) => s.id === selectedId) ?? null)
  const allTags = $derived([...new Set(project.sentences.flatMap((s) => s.tags))].sort())
  const abbrMap = $derived(
    new Map(project.abbreviations.map((a) => [a.abbr, pickText(a.name, glossLangs)]))
  )
  const stats = $derived(mode === 'stats' && langId ? corpusStatsFull(project, langId) : null)
  const pctOf = (n: number, total: number): string =>
    total ? `${Math.round((n / total) * 100)}%` : '—'
  function filterFromStats(q: string): void {
    ui.search = q
    mode = 'entries'
  }
  const templates = $derived(project.settings.exportTemplates.filter((x) => x.kind === 'gloss'))

  $effect(() => {
    inspectorTitle =
      mode === 'abbr'
        ? t('corpus.abbr.title')
        : mode === 'stats'
          ? t('corpus.modes.stats')
          : selected
            ? t('corpus.sentence')
            : t('corpus.title')
  })
  $effect(() => {
    const id = ui.takePending('sentence')
    if (id) reveal(id)
  })
  // 「返回」用：报上当前位置，返回时原样恢复
  $effect(() => {
    ui.reportView('corpus', {
      kind: 'sentence',
      lang: projectState.currentLanguageId,
      id: selectedId,
      mode,
      collapsed: collapsedId && collapsedId === selectedId ? '1' : ''
    })
  })
  $effect(() => {
    const r = ui.takeRestore('corpus')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    collapsedId = v.collapsed === '1' ? selectedId : null
    mode = v.mode === 'stats' || v.mode === 'abbr' ? v.mode : 'entries'
    ui.restoreScroll('corpus', r.scroll)
  })
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      mode,
      selectedId,
      collapsedId,
      exportFormat,
      templateId
    })
  })
  if (sameLang && !ui.restoring('corpus')) ui.restoreScroll('corpus', ui.lastScroll('corpus'))
  /** 从别处跳过来：清掉过滤、选中、滚到它并闪一下 */
  let flashId = $state<Id | null>(null)
  function reveal(id: Id): void {
    const s = project.sentences.find((x) => x.id === id)
    if (!s) return
    if (langId && s.languageId !== langId) projectState.currentLanguageId = s.languageId
    ui.search = ''
    mode = 'entries'
    collapsedId = null
    selectedId = id
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        document
          .querySelector(`.item[data-id="${id}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      )
    )
  }
  // 选中尚未分析的句子时自动分析
  $effect(() => {
    if (selected && selected.tokens.length === 0 && selected.text.trim()) {
      analyzeSentence(project, selected)
      projectState.touch()
    }
  })

  function touch(): void {
    projectState.touch()
  }
  function add(): void {
    if (!langId) return
    const s = createSentence(langId)
    project.sentences.unshift(s)
    collapsedId = null
    selectedId = s.id
    mode = 'entries'
    touch()
    queueMicrotask(() => document.getElementById('st-text')?.focus())
  }
  function remove(s: Sentence): void {
    const idx = project.sentences.indexOf(s)
    const snap = $state.snapshot(s) as Sentence
    project.sentences.splice(idx, 1)
    if (selectedId === s.id) selectedId = null
    touch()
    ui.toast(t('corpus.deleted'), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.sentences.splice(Math.min(idx, project.sentences.length), 0, snap)
          selectedId = snap.id
          touch()
        }
      }
    })
  }
  function analyze(force = false): void {
    if (!selected) return
    analyzeSentence(project, selected, { force })
    touch()
  }
  async function runDedup(): Promise<void> {
    if (!langId) return
    const n = await dedupeSentences(project, { languageId: langId })
    if (n) {
      if (selectedId && !project.sentences.some((s) => s.id === selectedId)) selectedId = null
      touch()
    }
  }
  function confirmAll(): void {
    if (!selected || fading) return
    const id = selected.id
    for (const tk of selected.tokens) if (tk.analyses[tk.chosen]) tk.confirmed = true
    touch()
    // 列表卡片长出第三行 gloss 并闪一下；检视器留在这句上，方便接着调整
    fading = true
    setTimeout(() => {
      collapsedId = id
      fading = false
      justConfirmed = id
      setTimeout(() => (justConfirmed = null), 1200)
    }, 420)
  }
  /** 点例句卡片：选中它；已经选中但编辑器收起了，就重新展开 */
  function pick(id: Id): void {
    collapsedId = null
    selectedId = id
  }
  /** 导出当前列表里的例句（跟着当前语言与搜索走） */
  async function exportSentences(
    kind: 'csv' | 'json' | 'leipzig' | 'markdown' | 'html' | 'latex'
  ): Promise<void> {
    const base = `${language?.name ?? project.meta.name}-corpus`
    if (kind === 'csv')
      await platform.saveTextFile(
        `${base}.csv`,
        '\ufeff' + toCsv(sentencesToRows(project, list, glossLangs))
      )
    else if (kind === 'json') await platform.saveTextFile(`${base}.json`, sentencesToJson(list))
    else {
      const ext = { leipzig: 'txt', markdown: 'md', html: 'html', latex: 'tex' }[kind]
      await platform.saveTextFile(
        `${base}.${ext}`,
        sentencesToText(project, list, kind, i18n.locale)
      )
    }
  }
  async function importSentencesFromJson(): Promise<void> {
    if (!langId) return
    const lid = langId
    try {
      const [f] = await platform.readTextFiles({ multiple: false, extensions: ['json'] })
      if (!f) return
      const r = importSentencesJson(project, lid, f.content)
      if (!r) {
        ui.error(t('io.badJson'))
        return
      }
      afterImport(lid, r)
    } catch (e) {
      ui.error((e as Error).message)
    }
  }
  function importSentenceTable(records: Record<string, string>[]): void {
    if (!langId) return
    importOpen = false
    afterImport(langId, importSentenceRecords(project, langId, records))
  }
  /** 导入完：提示条数，再在新导入的句子里查一遍相近的（只差出处的直接合并，其余问一下） */
  function afterImport(lid: Id, r: { created: number; skipped: number; ids: Id[] }): void {
    touch()
    ui.toast(t('io.imported', { n: r.created, skipped: r.skipped }))
    if (r.ids.length)
      void dedupeSentences(project, { languageId: lid, among: new Set(r.ids), silent: true })
  }
  function fullyConfirmed(s: Sentence): boolean {
    const c = coverage(s)
    return c.total > 0 && c.confirmed === c.total
  }
  function lexemeOf(tk: Token): Id | null {
    return tk.analyses[tk.chosen]?.lexemeId ?? null
  }
  /** 这门语言的构形里出现过的词缀，用来反推屈折得厉害的词 */
  const affixes = $derived(
    langId ? paradigmAffixes(project, langId) : { prefixes: [], suffixes: [] }
  )
  /** 悬浮反推用的索引：第一次悬浮才建，项目改动后作废 */
  let idxCache: { key: string; idx: ReturnType<typeof buildIndex> } | null = null
  function hoverIndexOf(): ReturnType<typeof buildIndex> | null {
    if (!langId) return null
    const key = langId + '|' + project.meta.updatedAt
    if (idxCache?.key !== key) idxCache = { key, idx: buildIndex(project, langId) }
    return idxCache.idx
  }
  /** 分析没给出词条时：先查词头/词干/屈折形，再剥一层构形词缀重查 */
  function resolveWord(tk: Token): { lexemeId?: Id; morphemeId?: Id } | null {
    // 1. 用户确认过的分析最可信
    const a = tk.analyses[tk.chosen]
    if (tk.confirmed && a?.lexemeId) return { lexemeId: a.lexemeId }
    const idx = hoverIndexOf()
    // 2. 同一个写法在别处被确认过，照搬那次的结论
    const elsewhere = idx?.confirmed.get(tk.surface)?.find((x) => x.lexemeId)
    if (elsewhere?.lexemeId) return { lexemeId: elsewhere.lexemeId }
    const direct = lexemeOf(tk)
    if (direct) return { lexemeId: direct }
    // 3. 确认过的切分里认出的语素
    const mid =
      a?.morphs.find((m) => m.morphemeId)?.morphemeId ??
      elsewhere?.morphs.find((m) => m.morphemeId)?.morphemeId
    if (idx) {
      const gloss = a?.morphs.map((m) => m.gloss).join(' ') ?? ''
      const byForm = lookupByForm(tk.surface, gloss)
      if (byForm) return { lexemeId: byForm }
      const rev = reverseDerive(tk.surface, affixes, (form) => lookupByForm(form, gloss))
      if (rev) return { lexemeId: rev.lexemeId }
      // 再试剥一个语素前缀 / 后缀（语流前缀、格缀这些都在语素表里）
      const byAffix = stripMorphemeAffix(tk.surface, gloss)
      if (byAffix) return { lexemeId: byAffix }
      // 还不行就逐段试：已确认的切分里，词干那一段往往才是词典里的形式
      for (const m of a?.morphs ?? []) {
        // 已经挂着语素的段（感音、式、体这些）不是词典里的词：跳过去，找词干那一段
        if (m.morphemeId) continue
        const seg = m.form.replace(/^[-=·']+|[-=·']+$/g, '')
        if (seg.length < 2) continue
        const hit =
          lookupByForm(seg, m.gloss || gloss) ??
          stripMorphemeAffix(seg, m.gloss || gloss) ??
          lookupByGlossAndForm(seg, m.gloss || gloss)
        if (hit) return { lexemeId: hit }
      }
      // 词条里找不到就查语素：限定词、小品词这类都在语素表里
      const key = tk.surface.normalize('NFC').toLowerCase()
      const mo = idx.morphemes.get(key)?.[0]
      if (mo) return { morphemeId: mo.id }
    }
    return mid ? { morphemeId: mid } : null
  }
  /** 剥掉一个已知的语素前缀或后缀再查一次 */
  function stripMorphemeAffix(surface: string, gloss: string): Id | null {
    const idx = hoverIndexOf()
    if (!idx) return null
    const w = surface.normalize('NFC').toLowerCase()
    for (const { form } of idx.prefixes)
      if (form && w.startsWith(form) && w.length - form.length > 1) {
        const hit = lookupByForm(w.slice(form.length), gloss)
        if (hit) return hit
      }
    for (const { form } of idx.suffixes)
      if (form && w.endsWith(form) && w.length - form.length > 1) {
        const hit = lookupByForm(w.slice(0, w.length - form.length), gloss)
        if (hit) return hit
      }
    return null
  }
  /**
   * 按形式查词条：同形的候选还要跟标注的意思对得上才认，
   * 一个都对不上就宁可不给，免得悬浮出毫不相干的词。
   */
  function lookupByForm(form: string, gloss: string): Id | null {
    const idx = hoverIndexOf()
    if (!idx) return null
    const key = form.normalize('NFC').toLowerCase()
    const folded = foldDiacritics(key)
    const pool = (k: string): Lexeme[] => [
      ...(idx.lemma.get(k) ?? []),
      ...(idx.forms.get(k) ?? []).map((f) => f.lexeme),
      ...(idx.stems.get(k) ?? [])
    ]
    const cands = pool(key).length ? pool(key) : pool(folded)
    const good = cands.find((l) => lexemeMatchesGloss(l, gloss))
    return good ? good.id : null
  }
  /**
   * 悬浮卡底部的切分：优先用这个词已确认的分析，
   * 每一段能对上语素或词条就挂上，点得开。
   */
  /**
   * 形式对不上时宽一点再找：这门语言里释义对得上 gloss 的词条，某个形式（词头、词干、屈折形，去掉附加符与音节点比）
   * 整个出现在这一段里——带了前缀、重音写法不同的词干也认得出来（wéñgaus 里有 eñgaus）。取包含得最长的那个。
   * gloss 里没有意思成分（纯缩写）时不猜。
   */
  let formCache: { key: string; list: { lexeme: Lexeme; forms: string[] }[] } | null = null
  const foldForm = (x: string): string =>
    foldDiacritics(x.normalize('NFC').toLowerCase()).replace(/[.·='’-]/g, '')
  function lookupByGlossAndForm(form: string, gloss: string): Id | null {
    if (!langId || !glossHasMeaning(gloss)) return null
    const key = langId + '|' + project.meta.updatedAt
    if (formCache?.key !== key)
      formCache = {
        key,
        list: project.lexemes
          .filter((l) => l.languageId === langId)
          .map((l) => ({
            lexeme: l,
            forms: [
              ...new Set(
                [
                  l.lemma,
                  ...Object.values(l.stems),
                  ...Object.values(l.forms).flatMap((f) => f.surface.split(/[,，;；/]\s*/))
                ]
                  .map((x) => foldForm(x ?? ''))
                  .filter((x) => x.length >= 3)
              )
            ]
          }))
      }
    const f = foldForm(form)
    let best: { id: Id; len: number } | null = null
    for (const c of formCache.list) {
      const len = Math.max(0, ...c.forms.filter((x) => f.includes(x)).map((x) => x.length))
      if (len && (!best || len > best.len) && lexemeMatchesGloss(c.lexeme, gloss))
        best = { id: c.lexeme.id, len }
    }
    return best?.id ?? null
  }
  function hoverParts(tk: Token): HoverPart[] {
    const idx = hoverIndexOf()
    const a =
      (tk.confirmed ? tk.analyses[tk.chosen] : null) ??
      idx?.confirmed.get(tk.surface)?.[0] ??
      tk.analyses[tk.chosen]
    if (!a || a.morphs.length < 2) return []
    return a.morphs.map((m) => {
      if (m.morphemeId) return { label: m.form, gloss: m.gloss, morphemeId: m.morphemeId }
      if (m.lexemeId) return { label: m.form, gloss: m.gloss, lexemeId: m.lexemeId }
      const key = m.form
        .normalize('NFC')
        .toLowerCase()
        .replace(/^[-=·']+|[-=·']+$/g, '')
      const mo = idx?.morphemes.get(key)?.[0]
      if (mo) return { label: m.form, gloss: m.gloss, morphemeId: mo.id }
      // 词条：先按形式找；再看整个词分析出来的词条是不是就是这一段（意思对得上）；再按意思 + 形式包含宽一点找
      const main = a.lexemeId ? lexemeById.get(a.lexemeId) : undefined
      const lexemeId =
        lookupByForm(key, m.gloss) ??
        (main && glossHasMeaning(m.gloss) && lexemeMatchesGloss(main, m.gloss) ? main.id : null) ??
        lookupByGlossAndForm(key, m.gloss)
      // 既不是语素也挂不上词条——有没有 gloss 都一样：点开是「没有找到」，要手动指定
      return { label: m.form, gloss: m.gloss, lexemeId, missing: !lexemeId }
    })
  }
  /** 便宜的可点判断：重的反推留到真正悬浮时再做 */
  function linkable(tk: Token): boolean {
    return (
      !!lexemeOf(tk) ||
      (tk.confirmed && (tk.analyses[tk.chosen]?.morphs.length ?? 0) > 0) ||
      !!tk.analyses[tk.chosen]?.morphs.some((m) => m.morphemeId)
    )
  }
  const lexemeById = $derived(new Map(project.lexemes.map((l) => [l.id, l])))
  /** 当前语言里每个词形的旁证：出现在哪些例句、在哪确认成了哪个词条；例句一改就重算 */
  /** 例句改动后稍等一下再重算旁证：打字时每敲一个键就重排全部候选太慢 */
  let evidenceTick = $state(0)
  $effect(() => {
    for (const s of project.sentences) {
      void s.languageId
      for (const v of Object.values(s.translation)) void v
      for (const tk of s.tokens) void (tk.surface + tk.chosen + tk.confirmed)
    }
    const timer = setTimeout(() => evidenceTick++, 300)
    return () => clearTimeout(timer)
  })
  const surfaceEvidence = $derived.by(() => {
    void evidenceTick
    const lid = langId
    return untrack(() =>
      lid ? collectEvidence(project.sentences, lid) : new Map<string, SurfaceEvidence>()
    )
  })
  function definitionPieces(id: Id): string[] {
    const l = lexemeById.get(id)
    return l ? piecesOf(l.senses.flatMap((se) => Object.values(se.definition)).join('；')) : []
  }
  function rankOf(tk: Token, s: Sentence, ids: Id[]): Id[] {
    return rankHomographs(ids, s, surfaceEvidence.get(surfaceKey(tk.surface)), definitionPieces)
  }
  /** 这个词可能是哪个词条：确认过的就是它；几个同形词条时按意思线索挑，挑不出来就都给 */
  function candidatesOf(tk: Token, s: Sentence): { lexemeId?: Id; morphemeId?: Id }[] {
    const a = tk.analyses[tk.chosen]
    if (tk.confirmed) {
      if (a?.lexemeId) return [{ lexemeId: a.lexemeId }]
      const one = resolveWord(tk)
      return one ? [one] : []
    }
    const ids = homographIds(tk)
    if (ids.length > 1) return rankOf(tk, s, ids).map((id) => ({ lexemeId: id }))
    const one = resolveWord(tk)
    return one ? [one] : ids.map((id) => ({ lexemeId: id }))
  }
  /** 几个候选分不出来：这个词在列表里用警告色标出来（与悬浮时并排给候选是同一个判断） */
  function ambiguous(tk: Token, s: Sentence): boolean {
    if (tk.confirmed) return false
    const ids = homographIds(tk)
    return ids.length > 1 && rankOf(tk, s, ids).length > 1
  }
  /** 用户挑中一个候选：写进这个词的分析并确认，以后就固定是它 */
  /**
   * 用户挑中一个候选：写进这个词的分析并确认，以后就固定是它。
   * 按句子与位置重新找这个词——悬浮之后例句可能已经重新分析过，手里拿着的旧对象已经不在句子里了。
   */
  function pickCandidate(
    sid: Id,
    at: number,
    surface: string,
    c: { lexemeId?: Id | null; morphemeId?: Id | null }
  ): void {
    if (!c.lexemeId) return
    const tk = project.sentences.find((x) => x.id === sid)?.tokens[at]
    if (!tk || tk.surface !== surface) return
    let i = tk.analyses.findIndex((x) => x.lexemeId === c.lexemeId)
    if (i < 0) {
      const l = project.lexemes.find((x) => x.id === c.lexemeId)
      tk.analyses.push({
        lexemeId: c.lexemeId,
        slot: null,
        morphs: [
          { form: tk.surface, gloss: l ? lexemeGloss(l, glossLangs) : '?', morphemeId: null }
        ]
      })
      i = tk.analyses.length - 1
    }
    tk.chosen = i
    tk.confirmed = true
    touch()
  }
  /**
   * 悬浮卡里手动指定：整个词（index 为 null）写一条新分析并选中；切分里的一段只改那一段。
   * 按句子与位置重新找这个词——悬浮之后例句可能已经重新分析过。都认出来了就记为已确认。
   */
  function assignWord(
    sid: Id,
    at: number,
    surface: string,
    index: number | null,
    c: HoverChoice
  ): void {
    const tk = project.sentences.find((x) => x.id === sid)?.tokens[at]
    if (!tk || tk.surface !== surface) return
    const l = c.lexemeId ? project.lexemes.find((x) => x.id === c.lexemeId) : undefined
    const m = c.morphemeId ? project.morphemes.find((x) => x.id === c.morphemeId) : undefined
    if (!l && !m) return
    const gloss = l
      ? lexemeGloss(l, glossLangs)
      : m!.gloss || Object.values(m!.meaning).find(Boolean) || m!.form
    const cur = tk.analyses[tk.chosen]
    if (index === null || !cur?.morphs[index]) {
      tk.analyses.push({
        lexemeId: l?.id ?? null,
        slot: null,
        morphs: [{ form: tk.surface, gloss, morphemeId: m?.id ?? null, lexemeId: l?.id ?? null }]
      })
      tk.chosen = tk.analyses.length - 1
    } else {
      const next: Analysis = {
        lexemeId: cur.lexemeId ?? l?.id ?? null,
        slot: cur.slot,
        morphs: cur.morphs.map((x, i) =>
          i === index ? { ...x, gloss, morphemeId: m?.id ?? null, lexemeId: l?.id ?? null } : x
        )
      }
      tk.analyses[tk.chosen] = next
    }
    if (!tk.analyses[tk.chosen].morphs.some((x) => !x.gloss || x.gloss === '?')) tk.confirmed = true
    touch()
  }
  function assignOf(tk: Token, s: Sentence): HoverAssign {
    const sid = s.id
    const at = s.tokens.indexOf(tk)
    const surface = tk.surface
    return {
      languageId: s.languageId,
      onAssign: (index, c) => assignWord(sid, at, surface, index, c)
    }
  }
  function hoverWord(e: MouseEvent, tk: Token, s: Sentence): void {
    const cands = candidatesOf(tk, s)
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    if (cands.length > 1) {
      const at = s.tokens.indexOf(tk)
      const sid = s.id
      const surface = tk.surface
      wordHover.showCandidates(cands, rect, (c) => pickCandidate(sid, at, surface, c))
      return
    }
    const parts = hoverParts(tk)
    const assign = assignOf(tk, s)
    // 拆出来的某一段没找到：直接打开那一段的「没有找到」；整个词都没找到也一样
    const miss = parts.findIndex((p) => p.missing)
    if (miss >= 0) return wordHover.showMissing(parts[miss].label, miss, rect, parts, assign)
    const target = cands[0]
    if (!target) return wordHover.showMissing(tk.surface, null, rect, parts, assign)
    if (target.lexemeId) wordHover.show(target.lexemeId, rect, parts, assign)
    else if (target.morphemeId) wordHover.showMorpheme(target.morphemeId, rect, parts, assign)
  }
  function clickWord(e: MouseEvent, tk: Token, s: Sentence): void {
    const cands = candidatesOf(tk, s)
    // 几个候选分不出来：点一下也先挑，不直接跳到其中一个
    if (cands.length > 1) {
      e.stopPropagation()
      hoverWord(e, tk, s)
      return
    }
    const target = cands[0] ?? resolveWord(tk)
    if (target?.morphemeId) {
      e.stopPropagation()
      wordHover.hide(true)
      const m = project.morphemes.find((x) => x.id === target.morphemeId)
      ui.jump('morphemes', 'morpheme', target.morphemeId, m?.languageId)
      return
    }
    const id = target?.lexemeId
    if (!id) return
    e.stopPropagation()
    wordHover.hide(true)
    ui.jump('lexicon', 'lexeme', id, project.lexemes.find((l) => l.id === id)?.languageId)
  }
  function analysisLabel(a: Analysis): string {
    return a.morphs.map((m) => m.form).join('-') + ' → ' + a.morphs.map((m) => m.gloss).join('-')
  }
  /** 手工修改语素切分 / gloss：写成自定义分析放到首位并选中 */
  function customize(tk: Token, morphsText: string, glossText: string): void {
    const forms = morphsText.split(/[-=]/).map((x) => x.trim())
    const glosses = glossText.split(/[-=]/).map((x) => x.trim())
    const n = Math.max(forms.length, glosses.length, 1)
    const cur = tk.analyses[tk.chosen]
    const morphs = Array.from({ length: n }, (_, i) => ({
      form: forms[i] ?? '',
      gloss: glosses[i] ?? '',
      morphemeId: cur?.morphs[i]?.morphemeId ?? null
    }))
    const custom: Analysis = { lexemeId: cur?.lexemeId ?? null, slot: cur?.slot ?? null, morphs }
    if (cur && tk.analyses.length && (tk as Token & { customIdx?: number }).customIdx === tk.chosen)
      tk.analyses[tk.chosen] = custom
    else {
      tk.analyses.unshift(custom)
      tk.chosen = 0
      ;(tk as Token & { customIdx?: number }).customIdx = 0
    }
    touch()
  }
  function morphsOf(tk: Token): string {
    const a = tk.analyses[tk.chosen]
    return a ? a.morphs.map((m) => m.form).join('-') : tk.surface
  }
  function glossOf(tk: Token): string {
    const a = tk.analyses[tk.chosen]
    return a ? a.morphs.map((m) => m.gloss).join('-') : ''
  }
  function unresolved(tk: Token): boolean {
    const a = tk.analyses[tk.chosen]
    // 猜出来的（去掉附加符才对上、拆成两个词）确认之前也标出来
    return !a || (!!a.guess && !tk.confirmed) || a.morphs.some((m) => m.gloss === '?' || !m.gloss)
  }
  function glossTitle(g: string): string {
    return g
      .split(/[-=.]/)
      .map((part) => (abbrMap.has(part) ? `${part} = ${abbrMap.get(part)}` : ''))
      .filter(Boolean)
      .join('\n')
  }
  function newLexeme(tk: Token): void {
    if (!selected) return
    const l = createLexeme(selected.languageId, tk.surface)
    project.lexemes.push(l)
    const a: Analysis = {
      lexemeId: l.id,
      slot: null,
      morphs: [{ form: tk.surface, gloss: tk.surface, morphemeId: null }]
    }
    tk.analyses.unshift(a)
    tk.chosen = 0
    tk.confirmed = true
    touch()
    ui.toast(t('corpus.lexemeCreated', { w: tk.surface }))
  }
  function refreshCandidates(tk: Token): void {
    if (!selected) return
    const idx = buildIndex(project, selected.languageId)
    const fresh = analyzeToken(idx, tk.surface, project.settings.morphemeBoundaries)
    const cur = tk.analyses[tk.chosen]
    tk.analyses = cur
      ? [cur, ...fresh.filter((a) => JSON.stringify(a) !== JSON.stringify(cur))]
      : fresh
    tk.chosen = 0
    touch()
  }

  const exportText = $derived.by(() => {
    if (!selected) return ''
    const il = interlinear(project, selected, i18n.locale)
    switch (exportFormat) {
      case 'leipzig':
        return toLeipzig(il)
      case 'markdown':
        return toMarkdown(il)
      case 'html':
        return toHtml(il)
      case 'latex':
        return toLatex(il)
      case 'template': {
        const tp = templates.find((x) => x.id === templateId) ?? templates[0]
        return tp ? renderTemplate(tp.template, il, selected) : ''
      }
    }
  })
  async function copyExport(): Promise<void> {
    await navigator.clipboard.writeText(exportText)
    ui.toast(t('soundChanges.copied'))
  }
  function saveTemplate(): void {
    if (!templateDraft.name.trim()) return
    const existing = project.settings.exportTemplates.find(
      (x) => x.kind === 'gloss' && x.name === templateDraft.name.trim()
    )
    if (existing) existing.template = templateDraft.template
    else
      project.settings.exportTemplates.push({
        id: newId(),
        name: templateDraft.name.trim(),
        kind: 'gloss',
        template: templateDraft.template
      })
    templateId = (
      existing ?? project.settings.exportTemplates[project.settings.exportTemplates.length - 1]
    ).id
    touch()
  }
  function loadTemplate(id: string): void {
    templateId = id
    const tp = templates.find((x) => x.id === id)
    if (tp) templateDraft = { name: tp.name, template: tp.template }
  }
  function deleteTemplate(): void {
    const i = project.settings.exportTemplates.findIndex((x) => x.id === templateId)
    if (i >= 0) project.settings.exportTemplates.splice(i, 1)
    templateId = ''
    touch()
  }
  function fillLeipzig(): void {
    let n = 0
    for (const a of LEIPZIG) {
      if (!project.abbreviations.some((x) => x.abbr === a.abbr)) {
        project.abbreviations.push({ abbr: a.abbr, name: { zh: a.zh, en: a.en } })
        n++
      }
    }
    touch()
    ui.toast(t('corpus.abbr.filled', { n }))
  }
</script>

<div class="page">
  <div class="page-head row">
    <h1>{t('corpus.title')}</h1>
    <GuideLink section="corpus" />
    <div class="seg">
      <button class:active={mode === 'entries'} onclick={() => (mode = 'entries')}
        >{t('corpus.modes.entries')}</button
      >
      <button class:active={mode === 'stats'} onclick={() => (mode = 'stats')}
        >{t('corpus.modes.stats')}</button
      >
      <button class:active={mode === 'abbr'} onclick={() => (mode = 'abbr')}
        >{t('corpus.modes.abbreviations')}</button
      >
    </div>
    <span class="grow"></span>
    {#if mode === 'entries' && language}
      <Menu label={t('lexicon.import')} icon={Upload}>
        <button onclick={() => (importOpen = true)}>{t('io.importTable')}</button>
        <button onclick={importSentencesFromJson}>{t('io.importJson')}</button>
      </Menu>
      <Menu label={t('common.export')} icon={Download}>
        <button onclick={() => exportSentences('csv')}>{t('io.exportCsv')}</button>
        <button onclick={() => exportSentences('json')}>{t('io.exportJson')}</button>
        <button onclick={() => exportSentences('leipzig')}>{t('corpus.formats.leipzig')}</button>
        <button onclick={() => exportSentences('markdown')}>{t('corpus.formats.markdown')}</button>
        <button onclick={() => exportSentences('html')}>{t('corpus.formats.html')}</button>
        <button onclick={() => exportSentences('latex')}>{t('corpus.formats.latex')}</button>
      </Menu>
    {/if}
    {#if mode === 'entries'}
      <button class="btn ghost" title={t('corpus.dedup.hintBtn')} onclick={runDedup}
        ><Merge size={16} />{t('corpus.dedup.button')}</button
      >
      <button class="btn primary" onclick={add}><Plus size={16} />{t('corpus.add')}</button>
    {/if}
  </div>

  {#if importOpen}
    <TableImportDialog
      title={t('io.importSentences')}
      fields={sentenceFields(glossLangs)}
      guide={guideUrl('corpus', 'table-format')}
      onimport={importSentenceTable}
      onclose={() => (importOpen = false)}
    />
  {/if}

  {#if !language}
    <p class="muted">{t('lexicon.noLanguage')}</p>
  {:else if mode === 'stats'}
    <div class="scroll stats">
      {#if stats}
        {@const st = stats}
        <StatsPanel
          facts={[
            { label: t('stats.corpus.sentences'), value: st.sentences },
            {
              label: t('stats.corpus.tokens'),
              value: st.tokens,
              sub: t('stats.corpus.avgTokens', { n: st.avgTokens.toFixed(1) })
            },
            {
              label: t('stats.corpus.types'),
              value: st.types,
              sub: t('stats.corpus.hapax', { n: st.hapax })
            },
            {
              label: t('stats.corpus.resolved'),
              value: st.resolvedTokens,
              sub: pctOf(st.resolvedTokens, st.tokens)
            },
            {
              label: t('stats.corpus.confirmed'),
              value: st.confirmedTokens,
              sub: pctOf(st.confirmedTokens, st.tokens)
            },
            {
              label: t('stats.corpus.fullyConfirmed'),
              value: st.fullyConfirmedSentences,
              sub: pctOf(st.fullyConfirmedSentences, st.sentences)
            },
            {
              label: t('stats.corpus.withTranslation'),
              value: st.withTranslation,
              sub: pctOf(st.withTranslation, st.sentences)
            },
            {
              label: t('stats.corpus.withSource'),
              value: st.withSource,
              sub: pctOf(st.withSource, st.sentences)
            },
            { label: t('stats.corpus.withScriptForm'), value: st.withScriptForm },
            {
              label: t('stats.corpus.lexemeCoverage'),
              value: `${Math.round(st.lexemeCoverage * 100)}%`
            },
            {
              label: t('stats.corpus.morphemeCoverage'),
              value: `${Math.round(st.morphemeCoverage * 100)}%`
            },
            { label: t('corpus.stats.unresolved'), value: st.unresolved.length }
          ]}
          groups={[
            {
              title: t('stats.corpus.bySource'),
              buckets: st.bySource,
              onpick: (k) => filterFromStats(k)
            },
            { title: t('stats.corpus.byTag'), buckets: st.byTag },
            { title: t('stats.corpus.byGloss'), buckets: st.byGloss, max: 20 },
            { title: t('stats.corpus.byLength'), buckets: st.byLength, max: 40 }
          ]}
          rankings={[
            {
              title: t('corpus.stats.frequency'),
              items: st.frequency
                .slice(0, 100)
                .map((f) => ({ id: f.surface, label: f.surface, n: f.n })),
              onpick: (w) => filterFromStats(w)
            },
            {
              title: t('stats.corpus.topLexemes'),
              items: st.topLexemes.map((x) => ({ id: x.lexemeId, label: x.lemma, n: x.n })),
              onpick: (id) => ui.jump('lexicon', 'lexeme', id)
            }
          ]}
        />
        <section class="unres">
          <h3>
            {t('corpus.stats.unresolved')} <span class="badge">{st.unresolved.length}</span>
          </h3>
          <div class="chips">
            {#each st.unresolved as w (w)}<button
                class="chip data warn"
                onclick={() => filterFromStats(w)}>{w}</button
              >{/each}
          </div>
        </section>
      {/if}
    </div>
  {:else if mode === 'abbr'}
    <div class="scroll">
      <div class="row">
        <p class="small muted grow">{t('corpus.abbr.hint')}</p>
        <button class="btn sm" onclick={fillLeipzig}
          ><Sparkles size={14} />{t('corpus.abbr.fillLeipzig')}</button
        >
        <button
          class="btn primary sm"
          onclick={() => {
            project.abbreviations.unshift({ abbr: '', name: {} })
            touch()
          }}><Plus size={14} />{t('corpus.abbr.add')}</button
        >
      </div>
      <table class="tbl abbr">
        <thead
          ><tr
            ><th>{t('corpus.abbr.abbr')}</th>{#each glossLangs as g (g)}<th
                >{t('corpus.abbr.name')} ({g})</th
              >{/each}<th></th></tr
          ></thead
        >
        <tbody>
          {#each project.abbreviations as a, i (i)}
            <tr>
              <td><input class="input mono" bind:value={a.abbr} oninput={touch} /></td>
              {#each glossLangs as g (g)}<td
                  ><input class="input" bind:value={a.name[g]} oninput={touch} /></td
                >{/each}
              <td
                ><button
                  class="btn ghost icon sm"
                  onclick={() => {
                    project.abbreviations.splice(i, 1)
                    touch()
                  }}><X size={14} /></button
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <div class="scroll" use:navScroll={'corpus'}>
      <Hint id="corpus" text={t('corpus.hint')} />
      {#snippet editorPanel(s: Sentence)}
        <div class="card editor" class:fading>
          <div class="row toolbar">
            <span class="small muted grow"
              >{t('corpus.coverageLabel', {
                confirmed: coverage(s).confirmed,
                total: coverage(s).total
              })}</span
            >
            <button class="btn sm" onclick={() => analyze(false)}
              ><Wand2 size={14} />{t('corpus.analyze')}</button
            >
            <button class="btn ghost sm" onclick={() => analyze(true)}
              ><RefreshCw size={14} />{t('corpus.reanalyze')}</button
            >
            <button class="btn ghost sm" onclick={confirmAll}
              ><CheckCheck size={14} />{t('corpus.confirmAll')}</button
            >
          </div>
          {#each language.scripts as sc (sc.id)}
            {@const st = sentenceScript(language, sc, s)}
            {#if st}<div
                class="scr"
                style={fontCss(sc)}
                dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
                title={sc.name}
              >
                {st}
              </div>{/if}
          {/each}
          {#if s.tokens.length === 0}
            <p class="small muted">{t('corpus.noTokens')}</p>
          {:else}
            <div class="il">
              {#each s.tokens as tk, i (i)}
                <div class="tok" class:bad={unresolved(tk)} class:ok={tk.confirmed}>
                  <div
                    class="surface data"
                    class:link={linkable(tk)}
                    class:ambiguous={ambiguous(tk, s)}
                    role="link"
                    tabindex="-1"
                    onmouseenter={(e) => hoverWord(e, tk, s)}
                    onmouseleave={() => wordHover.hide()}
                    onclick={(e) => clickWord(e, tk, s)}
                    onkeydown={() => {}}
                  >
                    {tk.surface}
                  </div>
                  <input
                    class="input data m"
                    value={morphsOf(tk)}
                    title={t('corpus.morphs')}
                    onchange={(e) =>
                      customize(tk, (e.currentTarget as HTMLInputElement).value, glossOf(tk))}
                  />
                  <input
                    class="input g"
                    value={glossOf(tk)}
                    title={glossTitle(glossOf(tk)) || t('corpus.gloss')}
                    onchange={(e) =>
                      customize(tk, morphsOf(tk), (e.currentTarget as HTMLInputElement).value)}
                  />
                  <div class="row ctl">
                    <select
                      class="select cand"
                      value={String(tk.chosen)}
                      title={t('corpus.candidates')}
                      onchange={(e) => {
                        tk.chosen = Number((e.currentTarget as HTMLSelectElement).value)
                        touch()
                      }}
                    >
                      {#each tk.analyses as a, j (j)}<option value={String(j)}
                          >{analysisLabel(a)}</option
                        >{/each}
                      {#if tk.analyses.length === 0}<option value="0">—</option>{/if}
                    </select>
                    <button
                      class="btn ghost icon sm"
                      class:on={tk.confirmed}
                      title={t('corpus.confirmed')}
                      onclick={() => {
                        tk.confirmed = !tk.confirmed
                        touch()
                      }}><Check size={14} /></button
                    >
                    <button
                      class="btn ghost icon sm"
                      title={t('corpus.refresh')}
                      onclick={() => refreshCandidates(tk)}><RefreshCw size={12} /></button
                    >
                    {#if unresolved(tk)}<button
                        class="btn ghost sm new"
                        onclick={() => newLexeme(tk)}
                        ><Plus size={12} />{t('corpus.newLexeme')}</button
                      >{/if}
                  </div>
                </div>
              {/each}
            </div>
            <p class="tr">{interlinear(project, s, i18n.locale).translation}</p>
          {/if}
        </div>
      {/snippet}

      {#if selected && collapsedId !== selected.id && !list.some((x) => x.id === selected.id)}
        {@render editorPanel(selected)}
      {/if}

      {#if list.length === 0}
        <p class="muted">{t('corpus.empty')}</p>
      {:else}
        <div class="list">
          {#each list as s (s.id)}
            {#if selectedId === s.id && collapsedId !== s.id}{@render editorPanel(s)}{/if}
            {@const c = coverage(s)}
            {@const done = fullyConfirmed(s)}
            <div
              class="card item"
              data-id={s.id}
              class:sel={selectedId === s.id}
              class:flash={flashId === s.id}
              use:flashOn={justConfirmed === s.id}
              role="button"
              tabindex="0"
              onclick={() => pick(s.id)}
              onkeydown={(e) => e.key === 'Enter' && pick(s.id)}
            >
              {#each language.scripts as sc (sc.id)}
                {@const st = sentenceScript(language, sc, s)}
                {#if st}<div
                    class="scr"
                    style={fontCss(sc)}
                    dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
                    title={sc.name}
                  >
                    {st}
                  </div>{/if}
              {/each}
              <div class="row">
                {#if s.tokens.length}
                  <span class="data text grow words">
                    {#each s.tokens as tk, i (i)}<span
                        class="w"
                        class:link={linkable(tk)}
                        class:ambiguous={ambiguous(tk, s)}
                        role="link"
                        tabindex="-1"
                        onmouseenter={(e) => hoverWord(e, tk, s)}
                        onmouseleave={() => wordHover.hide()}
                        onclick={(e) => clickWord(e, tk, s)}
                        onkeydown={() => {}}>{tk.surface}</span
                      >{/each}
                  </span>
                {:else}
                  <span class="data text grow">{s.text || '—'}</span>
                {/if}
                <span class="badge" class:accent={done}>{c.confirmed}/{c.total}</span>
              </div>
              {#if done}
                {@const il = interlinear(project, s, i18n.locale)}
                <div class="gl" class:slide-in={justConfirmed === s.id}>
                  {#each il.words as w, i (i)}<span class="gw"
                      ><span class="data m">{w.morphs}</span><span class="g">{w.gloss}</span></span
                    >{/each}
                </div>
              {/if}
              <div class="tr-line">{pickText(s.translation, glossLangs)}</div>
              {#if s.tags.length || s.source}<div class="small muted">
                  {[s.source, ...s.tags].filter(Boolean).join(' · ')}
                </div>{/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if selected && mode === 'entries'}
  {@const s = selected}
  <Portal>
    <div class="field">
      <label for="st-text">{t('corpus.text')}</label>
      <textarea
        id="st-text"
        class="textarea data"
        rows="2"
        bind:value={s.text}
        onchange={() => {
          analyzeSentence(project, s)
          touch()
        }}
      ></textarea>
    </div>
    <div class="field">
      <span class="small muted">{t('corpus.translation')}</span>
      <LocalizedInput bind:value={s.translation} languages={glossLangs} onchange={touch} />
    </div>
    {#if language && language.scripts.length}
      <div class="field">
        <span class="small muted">{t('script.override')}</span>
        {#each language.scripts as sc (sc.id)}
          <div class="row kv">
            <span class="small oname">{sc.name}</span>
            <input
              class="input scr"
              style={fontCss(sc)}
              dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
              value={s.scriptForms?.[sc.id] ?? ''}
              placeholder={renderScript(language, sc, s.text)}
              title={t('script.overrideHint')}
              oninput={(e) => {
                if (!s.scriptForms) s.scriptForms = {}
                const v = (e.currentTarget as HTMLInputElement).value
                if (v) s.scriptForms[sc.id] = v
                else delete s.scriptForms[sc.id]
                touch()
              }}
            />
          </div>
        {/each}
      </div>
    {/if}
    {#if language && language.orthographies.length > 1}
      <div class="field">
        <span class="small muted">{t('corpus.orthoTexts')}</span>
        {#each language.orthographies.filter((o) => !o.isPrimary) as o (o.id)}
          <div class="row kv">
            <span class="small oname">{o.name}</span><input
              class="input data"
              bind:value={s.orthoTexts[o.id]}
              oninput={touch}
            />
          </div>
        {/each}
      </div>
    {/if}
    <div class="row two">
      <div class="field grow">
        <label for="st-src">{t('corpus.source')}</label><input
          id="st-src"
          class="input"
          bind:value={s.source}
          oninput={touch}
        />
      </div>
    </div>
    <div class="field">
      <span class="small muted">{t('common.tags')}</span>
      <TagInput bind:tags={s.tags} suggestions={allTags} onchange={touch} />
    </div>
    <div class="field">
      <div class="row">
        <span class="small muted">{t('corpus.extraLines')}</span><HelpDot key="extraLines" /><span
          class="grow"
        ></span><button
          class="btn ghost sm"
          onclick={() => {
            s.extraLines.push({ label: '', text: '' })
            touch()
          }}><Plus size={14} />{t('corpus.addLine')}</button
        >
      </div>
      {#each s.extraLines as line, i (i)}
        <div class="row kv">
          <input
            class="input lbl"
            placeholder={t('corpus.lineLabel')}
            bind:value={line.label}
            oninput={touch}
          />
          <input class="input grow" bind:value={line.text} oninput={touch} />
          <button
            class="btn ghost icon sm"
            onclick={() => {
              s.extraLines.splice(i, 1)
              touch()
            }}><X size={14} /></button
          >
        </div>
      {/each}
    </div>
    <div class="field">
      <label for="st-notes">{t('common.notes')}</label>
      <textarea id="st-notes" class="textarea" bind:value={s.notes} oninput={touch}></textarea>
    </div>

    <div class="field export">
      <div class="row">
        <span class="small muted">{t('corpus.export')}</span><HelpDot key="corpusExport" /><span
          class="grow"
        ></span>
        <select class="select fmt" bind:value={exportFormat}>
          {#each ['leipzig', 'markdown', 'html', 'latex', 'template'] as f (f)}<option value={f}
              >{t(`corpus.formats.${f}`)}</option
            >{/each}
        </select>
        <button class="btn ghost icon sm" title={t('corpus.copy')} onclick={copyExport}
          ><Copy size={14} /></button
        >
      </div>
      {#if exportFormat === 'template'}
        <div class="row kv">
          <select
            class="select"
            value={templateId}
            onchange={(e) => loadTemplate((e.currentTarget as HTMLSelectElement).value)}
          >
            <option value="">{t('corpus.templateNew')}</option>
            {#each templates as tp (tp.id)}<option value={tp.id}>{tp.name}</option>{/each}
          </select>
          {#if templateId}<button class="btn ghost icon sm danger" onclick={deleteTemplate}
              ><Trash2 size={14} /></button
            >{/if}
        </div>
        <input
          class="input"
          placeholder={t('corpus.templateName')}
          bind:value={templateDraft.name}
        />
        <textarea
          class="textarea mono"
          rows="4"
          placeholder={t('corpus.templateHint')}
          bind:value={templateDraft.template}
        ></textarea>
        <button class="btn sm self-start" onclick={saveTemplate}
          ><Check size={14} />{t('corpus.saveTemplate')}</button
        >
      {/if}
      <pre class="out" style={mixedFontCss(language?.scripts ?? [])}>{exportText}</pre>
    </div>
    <button class="btn sm danger" onclick={() => remove(s)}
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
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-right: 4px;
  }
  .editor {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .il {
    display: flex;
    flex-wrap: wrap;
    gap: 8px 10px;
    align-items: flex-start;
  }
  .tok {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 140px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .tok.bad {
    border-color: var(--warn);
    background: var(--warn-soft);
  }
  .tok.ok {
    border-color: var(--accent);
  }
  /* 有几个候选分不出来：警告色的波浪下划线，悬浮时会让你挑 */
  .ambiguous {
    text-decoration: underline wavy var(--warn);
    text-underline-offset: 3px;
  }
  .surface {
    font-size: 19px;
    font-weight: 600;
    font-family: var(--font-corpus-text);
  }
  .tok .m,
  .words,
  .gw .m {
    font-family: var(--font-corpus-text);
  }
  .tok .input {
    padding: 2px 6px;
    font-size: 13px;
  }
  .tok .g {
    font-family: var(--font-gloss);
    font-size: 12px;
  }
  .ctl {
    gap: 2px;
  }
  .cand {
    flex: 1;
    min-width: 0;
    padding: 2px 20px 2px 6px;
    font-size: 11px;
    background-position: right 4px center;
  }
  .btn.on {
    color: var(--accent-text);
    background: var(--accent-soft);
  }
  .new {
    font-size: 11px;
    padding: 2px 6px;
    color: var(--accent-text);
  }
  .tr,
  .item .tr-line {
    font-family: var(--font-corpus-tr);
  }
  .item .tr-line {
    font-size: 14px;
    font-weight: 500;
    color: var(--text-2);
  }
  .tr {
    color: var(--text-2);
    font-style: italic;
    font-size: 15px;
    font-weight: 500;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    font-size: 17px;
    font-weight: 600;
  }
  .scr {
    font-size: 22px;
    line-height: 1.3;
  }
  .words {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.45em;
  }
  .link {
    cursor: pointer;
    border-radius: 3px;
    transition: background-color 0.15s;
  }
  .link:hover {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .gl {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 14px;
    margin: 2px 0;
  }
  .gw {
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }
  .gw .m {
    font-size: 13px;
  }
  .gw .g {
    font-family: var(--font-gloss);
    font-size: 11px;
    color: var(--text-2);
  }
  .tbl {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
  }
  .tbl td,
  .tbl th {
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  .tbl.abbr td .input {
    padding: 3px 6px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .unres {
    margin-top: 22px;
  }
  .unres h3 {
    margin-bottom: 8px;
  }
  button.chip {
    cursor: pointer;
    font: inherit;
    background: none;
  }
  button.chip:hover {
    background: var(--bg-hover);
  }
  .chip {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    font-size: 13px;
  }
  .chip.warn {
    border-color: var(--warn);
    background: var(--warn-soft);
  }
  .mono {
    font-family: var(--font-mono);
  }
  .kv {
    gap: 6px;
    margin-bottom: 4px;
  }
  .lbl {
    width: 90px;
    flex: none;
  }
  .oname {
    width: 90px;
    flex: none;
    color: var(--text-2);
  }
  .two {
    gap: 8px;
  }
  .fmt {
    width: 150px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .out {
    margin: 6px 0 0;
    padding: 8px 10px;
    background: var(--bg-sunken);
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 220px;
    overflow: auto;
  }
  .self-start {
    align-self: flex-start;
  }
  .export {
    margin-top: 6px;
  }
  h3 {
    margin-bottom: 6px;
  }
</style>
