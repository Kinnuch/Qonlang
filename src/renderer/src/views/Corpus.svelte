<script lang="ts">
  import { onDestroy } from 'svelte'
  import { deletable } from '$lib/ui/deletable'
  import RecordClipboardTools from '$lib/ui/RecordClipboardTools.svelte'
  import { copyProjectRecords, pasteProjectRecords } from '$lib/state/recordClipboard.svelte'
  import { navScroll } from '$lib/ui/navScroll'
  import { morphJoiner } from '$lib/engine/gloss'
  import { lazy } from '$lib/ui/lazy.svelte'
  import RecordBrowser from '$lib/ui/RecordBrowser.svelte'
  import RecordViewSwitcher from '$lib/ui/RecordViewSwitcher.svelte'
  import ExpandableRecord from '$lib/ui/ExpandableRecord.svelte'
  import { recordViewMode, type RecordViewMode } from '$lib/ui/recordViews'
  import { scrollToItem } from '$lib/ui/reveal'
  import type { PageView } from '$lib/state/ui.svelte'
  import { tick, untrack } from 'svelte'
  import { platform } from '$lib/platform'
  import TableImportDialog from '$lib/ui/TableImportDialog.svelte'
  import { guideUrl } from '$lib/core/guide'
  import { toCsv } from '$lib/core/csv'
  import { normalizeSentence } from '$lib/core/sentenceDedup'
  import { splitTextLines } from '$lib/core/textLines'
  import { parseTableText, looksLikeJson, type TableTextChoice } from '$lib/importers/tableText'
  import {
    importSentenceRecords,
    importSentencesJson,
    previewSentencesJson,
    guessColumns,
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
  import { displayTextRows } from '$lib/core/displayLanguages'
  import { createScriptScopeResolver, setSentenceScriptVisible } from '$lib/core/scriptScope'
  import { createSentence, createLexeme, newId } from '$lib/core/factory'
  import { buildSentenceDocReferences } from '$lib/core/docReferences'
  import type { Analysis, Id, Sentence, Token, Project } from '$lib/core/model'
  import { collectEvidence, type SurfaceEvidence } from '$lib/engine/gloss/candidates'
  import { WordResolver } from '$lib/engine/gloss/resolve'
  import {
    analyzeSentence,
    analyzeToken,
    buildIndex,
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
  import { rewriteWordInText, tokenizeOptionsFor, writeChoice } from '$lib/engine/gloss/assign'
  import { spanTokens, tokensMatchText } from '$lib/engine/gloss/tokens'
  import Portal from '$lib/ui/Portal.svelte'
  import TagInput from '$lib/ui/TagInput.svelte'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import Workbench, { type BenchResult, type BenchSaved } from '$lib/ui/Workbench.svelte'
  import { pinChoices } from '$lib/engine/compose'
  import { uiGlossCode } from '$lib/core/glossInputs'
  import Hint from '$lib/ui/Hint.svelte'
  import { flashOn } from '$lib/ui/flash'
  import {
    wordHover,
    type HoverAssign,
    type HoverChoice,
    type HoverPart
  } from '$lib/state/wordHover.svelte'
  import { sentenceScriptText, textScript } from '$lib/script/lexiconScript'
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
    PencilRuler
  } from '@lucide/svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import { sortable } from '$lib/ui/sortable.svelte'
  import { moveById } from '$lib/core/move'
  import { fiveRows } from '$lib/ui/fiveRows'
  import { corpusTextSize } from '$lib/ui/corpusTextSize'
  import { CORPUS_SENTENCE_DRAG, type CorpusExportKind } from '$lib/ui/CorpusFolders.svelte'
  import ProjectDirectory from '$lib/ui/ProjectDirectory.svelte'
  import {
    corpusFolderOf,
    corpusFoldersFor,
    corpusFolderSentences,
    moveCorpusSentences,
    validCorpusFolder
  } from '$lib/core/corpusFolders'
  import {
    selectCorpusSentence,
    removeCorpusSentences,
    restoreCorpusSentences
  } from '$lib/core/corpusSelection'

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)
  const translationOrder = $derived([i18n.locale, i18n.custom?.base ?? '', ...glossLangs])
  const langId = $derived(
    projectState.currentLanguageId ??
      project.settings.defaultLanguageId ??
      project.languages[0]?.id ??
      null
  )
  const language = $derived(project.languages.find((l) => l.id === langId) ?? null)
  const scriptScope = $derived(createScriptScopeResolver(project, language))
  function setScriptShown(sentence: Sentence, id: Id, visible: boolean): void {
    if (
      projectState.project !== project ||
      projectState.readOnly ||
      !project.sentences.includes(sentence)
    )
      return
    if (setSentenceScriptVisible(sentence, id, visible, scriptScope)) touch()
  }

  /** 回到这一页时接着用上次的子页、选中的句子、导出格式；换了语言就不恢复选中与滚动 */
  const memo = ui.memo<{
    lang: Id | null
    mode: 'entries' | 'stats' | 'abbr'
    selectedId: Id | null
    collapsedId: Id | null
    folderId: Id
    folderView: boolean
    directoryRoot: boolean
    sidebarOpen: boolean
    exportFormat: 'leipzig' | 'markdown' | 'html' | 'latex' | 'template'
    templateId: string
    /** 开着的工作台：填回哪一句、拼到哪儿了（跳去词库新建词条再回来，照原样摆回去） */
    bench: { targetId: Id | null; initial: string; saved?: BenchSaved } | null
  }>('corpus')
  const sameLang = memo.lang === projectState.currentLanguageId
  let mode = $state<'entries' | 'stats' | 'abbr'>(memo.mode ?? 'entries')
  let selectedId = $state<Id | null>(sameLang ? (memo.selectedId ?? null) : null)
  let multiIds = $state<Id[]>([]),
    selectionAnchor = $state<Id | null>(null)
  let folderId = $state<Id>(sameLang ? (memo.folderId ?? '') : '')
  let folderView = $state(sameLang && memo.folderView === true)
  let directoryRoot = $state(memo.directoryRoot ?? false)
  let sidebarOpen = $state(memo.sidebarOpen ?? false)
  let movingSentence = $state(false)
  const folders = $derived(langId ? corpusFoldersFor(project, langId) : [])
  const knownFolderIds = $derived(new Set(folders.map((folder) => folder.id)))
  $effect(() => {
    if (langId && !validCorpusFolder(project, langId, folderId)) folderId = ''
  })
  let importTarget = $state<{ projectId: Id; languageId: Id; folderId: Id } | null>(null)
  let importOwner = $state.raw<Project | null>(null)
  let importText = $state('')
  let importSplit = $state<TableTextChoice>('auto')
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
  /** 导入面板一打开先去选 JSON（菜单里点的是「从 JSON 导入」）；每点一次菜单都重开一次面板 */
  let importJson = $state(false)
  let importNonce = $state(0)
  $effect(() => {
    if (
      importOpen &&
      (!importTarget ||
        importOwner !== projectState.project ||
        projectState.readOnly ||
        langId !== importTarget.languageId ||
        !validCorpusFolder(project, importTarget.languageId, importTarget.folderId))
    ) {
      importOpen = false
      importTarget = null
      importOwner = null
      ui.toast(t('corpusTextImport.scopeChanged'))
    }
  })
  const textSize = $derived(corpusTextSize(ui.prefs.corpusTextScale))
  const browseMode = $derived(recordViewMode(ui.prefs.recordViews?.corpus))
  function setBrowseMode(value: RecordViewMode): void {
    ui.prefs.recordViews = { ...ui.prefs.recordViews, corpus: value }
    ui.savePrefsSoon()
  }
  function gallerySelect(id: string): void {
    selectedId = id
    collapsedId = id
    multiIds = []
    selectionAnchor = null
  }

  const list = $derived.by(() => {
    const pq = parseQuery(query, SEARCH_FIELDS.corpus)
    return project.sentences.filter(
      (s) =>
        (!langId || s.languageId === langId) &&
        (s.folderId && knownFolderIds.has(s.folderId) ? s.folderId : '') === folderId &&
        (!pq.terms.length || matchQuery(pq, (f) => sentenceFieldValues(s, f)))
    )
  })
  const visibleIds = $derived(list.map((sentence) => sentence.id))
  onDestroy(() => {
    if (multiIds.length > 1) ui.clearViewSelection('corpus')
  })
  const selectedIds = $derived(new Set(multiIds))
  const selectedVisibleIds = $derived(visibleIds.filter((id) => selectedIds.has(id)))
  const selectedVisibleSet = $derived(new Set(selectedVisibleIds))
  const clipboardSentenceIds = $derived(
    selectedVisibleIds.length ? selectedVisibleIds : visibleIds.filter((id) => id === selectedId)
  )
  async function pasteSentences(): Promise<void> {
    const owner = project,
      at = folderId
    const result = await pasteProjectRecords(
      owner,
      at,
      undefined,
      () => projectState.project === owner && folderId === at && mode === 'entries' && !folderView,
      { allowFolders: !!at }
    )
    if (result?.ok) {
      const ids = result.refs.filter((r) => r.kind === 'sentence').map((r) => r.id)
      multiIds = ids
      selectedId = ids[0] ?? null
    }
  }
  function confirmBatch(ids: readonly Id[]): void {
    if (projectState.readOnly) return
    const wanted = new Set(ids.filter((id) => visibleIds.includes(id)))
    for (const sentence of project.sentences)
      if (wanted.has(sentence.id)) {
        if (!sentence.tokens.length && sentence.text.trim()) analyzeSentence(project, sentence)
        for (const token of sentence.tokens)
          if (token.analyses[token.chosen]) token.confirmed = true
      }
    if (wanted.size) touch()
  }
  const sentenceClipboardActions = $derived([
    {
      label: t('clipboard.copy'),
      disabled: projectState.readOnly,
      run: () =>
        void copyProjectRecords(
          project,
          clipboardSentenceIds.map((id) => ({ kind: 'sentence' as const, id })),
          'copy'
        )
    },
    {
      label: t('clipboard.cut'),
      disabled: projectState.readOnly,
      run: () =>
        void copyProjectRecords(
          project,
          clipboardSentenceIds.map((id) => ({ kind: 'sentence' as const, id })),
          'cut'
        )
    },
    {
      label: t('clipboard.paste'),
      disabled: projectState.readOnly,
      run: () => void pasteSentences()
    },
    {
      label: t('clipboard.confirmSelected'),
      disabled: projectState.readOnly,
      run: () => confirmBatch(clipboardSentenceIds)
    }
  ])
  const selectionScope = $derived(JSON.stringify([langId, folderId, query, folderView]))
  let previousSelectionScope = ''
  $effect(() => {
    const scope = selectionScope,
      allowed = new Set(visibleIds)
    if (scope !== previousSelectionScope) {
      previousSelectionScope = scope
      multiIds = []
      selectionAnchor = null
    } else if (multiIds.some((id) => !allowed.has(id)))
      multiIds = multiIds.filter((id) => allowed.has(id))
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
  const lexemeHeadwords = $derived(
    new Map(
      project.lexemes
        .filter((lexeme) => lexeme.languageId === langId)
        .map((lexeme) => [lexeme.id, lexeme.lemma])
    )
  )
  const documentReferences = $derived(buildSentenceDocReferences(project))
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
    folderView = false
    directoryRoot = false
  }
  const templates = $derived(project.settings.exportTemplates.filter((x) => x.kind === 'gloss'))

  $effect(() => {
    inspectorTitle = importOpen
      ? t('importPreview.title')
      : mode === 'abbr'
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
      folder: folderId,
      folders: folderView ? '1' : '',
      root: directoryRoot ? '1' : '',
      bench: bench ? '1' : '',
      collapsed: collapsedId && collapsedId === selectedId ? '1' : ''
    })
  })
  $effect(() => {
    const r = ui.takeRestore('corpus')
    if (!r) return
    const v: PageView = r.view ?? {}
    selectedId = v.id ?? null
    collapsedId = v.collapsed === '1' ? selectedId : null
    folderId = v.folder ?? ''
    folderView = v.folders === '1'
    directoryRoot = v.root === '1'
    mode = v.mode === 'stats' || v.mode === 'abbr' ? v.mode : 'entries'
    bench =
      v.bench === '1' && memo.bench
        ? { targetId: memo.bench.targetId, initial: memo.bench.initial }
        : null
    ui.restoreScroll('corpus', r.scroll)
  })
  $effect(() => {
    Object.assign(memo, {
      lang: projectState.currentLanguageId,
      mode,
      selectedId,
      collapsedId,
      folderId,
      folderView,
      directoryRoot,
      sidebarOpen,
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
    folderId = corpusFolderOf(project, s)
    folderView = false
    directoryRoot = false
    // 定位例句时暂收工作台和导入页；工作台草稿仍留在memo，返回原位置时可继续。
    bench = null
    importOpen = false
    mode = 'entries'
    collapsedId = null
    selectedId = id
    void scrollToItem('corpus', `.item[data-id="${id}"]`, () => {
      const i = list.findIndex((x) => x.id === id)
      if (i >= 0) lz.ensure(i + 1)
    }).then(() => {
      flash(id)
      const edit = ui.pendingWordEdit
      if (edit?.sentenceId === id) {
        ui.pendingWordEdit = null
        void openWordEdit(s, edit.at, edit.index)
      }
    })
  }
  /** 开始页画廊的悬浮卡上点了铅笔：跳到这一句之后，把编辑器里那个词滚进来，直接打开「应该是哪个词」 */
  async function openWordEdit(s: Sentence, at: number, index: number | null): Promise<void> {
    await tick()
    const tk = s.tokens[at]
    const el = document.querySelectorAll('.card.editor .tok')[at]?.querySelector('.surface')
    if (!tk || !el) return
    el.scrollIntoView({ block: 'center' })
    await new Promise<void>((r) => requestAnimationFrame(() => r()))
    const parts = hoverParts(tk)
    const label = index !== null ? (parts[index]?.label ?? tk.surface) : tk.surface
    wordHover.showEdit(label, index, el.getBoundingClientRect(), parts, assignOf(tk, s))
  }
  /** 滚到了再闪：高亮从头到尾都看得见 */
  function flash(id: Id): void {
    flashId = id
    setTimeout(() => {
      if (flashId === id) flashId = null
    }, 1800)
  }
  // 选中尚未分析的句子时自动分析
  $effect(() => {
    if (
      !projectState.readOnly &&
      selected &&
      selected.tokens.length === 0 &&
      selected.text.trim()
    ) {
      analyzeSentence(project, selected)
      projectState.touch()
    }
  })

  function touch(): void {
    projectState.touch()
  }
  function openFolder(id: Id): void {
    if (!langId || !validCorpusFolder(project, langId, id)) return
    wordHover.hide(true)
    folderId = id
    folderView = false
    directoryRoot = false
    selectedId = null
    collapsedId = null
    bench = null
    importOpen = false
    mode = 'entries'
  }
  function browseFolder(id: Id): void {
    openFolder(id)
    folderView = true
  }
  function browseRoot(): void {
    openFolder('')
    folderView = true
    directoryRoot = true
  }

  function moveSentences(ids: Id[], target: Id): void {
    if (projectState.readOnly || !langId) return
    if (moveCorpusSentences(project, ids, langId, target)) {
      if (selectedId && ids.includes(selectedId)) {
        selectedId = null
        collapsedId = null
      }
      touch()
      ui.toast(t('corpus.folders.moved'))
    }
    movingSentence = false
  }
  async function chooseFolder(sentence: Sentence): Promise<void> {
    if (projectState.readOnly) return
    const owner = project,
      lid = sentence.languageId
    const ids = selectedVisibleSet.has(sentence.id) ? [...selectedVisibleIds] : [sentence.id]
    const choices = corpusFoldersFor(project, lid).map((folder) => ({
      value: folder.id,
      label: folder.path
    }))
    const target = await ui.choose(t('corpus.folders.move'), '', choices)
    if (
      target === null ||
      projectState.project !== owner ||
      projectState.readOnly ||
      langId !== lid
    )
      return
    moveSentences(ids, target)
  }
  function sentenceDrag(sentence: Sentence, index: number): ReturnType<typeof sortable> {
    const props = sortable('sentences', index, (from, to) => {
      if (
        !projectState.readOnly &&
        list[from] &&
        list[to] &&
        moveById(project.sentences, list[from].id, list[to].id)
      )
        touch()
    })
    return {
      ...props,
      ondragstart: (e) => {
        if (projectState.readOnly) {
          e.preventDefault()
          return
        }
        props.ondragstart(e)
        e.dataTransfer?.setData(
          CORPUS_SENTENCE_DRAG,
          JSON.stringify({
            projectId: project.meta.id,
            languageId: sentence.languageId,
            id: sentence.id,
            ids: selectedVisibleSet.has(sentence.id) ? selectedVisibleIds : [sentence.id]
          })
        )
        movingSentence = true
      },
      ondragend: () => {
        props.ondragend()
        movingSentence = false
      }
    }
  }
  // ───── 译文工作台 ─────
  /** 开着工作台：填回哪一句（原文还空着的那句；原文已经写了就另加一句） */
  let bench = $state<{ targetId: Id | null; initial: string } | null>(
    sameLang && memo.bench ? { targetId: memo.bench.targetId, initial: memo.bench.initial } : null
  )
  const benchSource = $derived.by(() => {
    const id = bench?.targetId
    return id ? project.sentences.find((s) => s.id === id) : undefined
  })
  function closeBench(): void {
    bench = null
    memo.bench = null
  }
  /** 工作台里的译文按界面语言写（跟释义输入框默认给的那种一致） */
  const benchGloss = $derived(uiGlossCode(i18n.locale, i18n.custom?.base))
  function openBench(s: Sentence): void {
    folderId = corpusFolderOf(project, s)
    folderView = false
    directoryRoot = false
    if (memo.bench?.targetId === s.id) bench = { targetId: s.id, initial: memo.bench.initial }
    else {
      bench = { targetId: s.id, initial: s.translation[benchGloss] ?? '' }
      memo.bench = { ...bench }
    }
    mode = 'entries'
  }
  function benchDone(r: BenchResult): void {
    if (
      !langId ||
      !bench ||
      !r.text.trim() ||
      projectState.readOnly ||
      (benchSource && benchSource.languageId !== langId)
    )
      return
    let s = bench?.targetId ? project.sentences.find((x) => x.id === bench!.targetId) : undefined
    if (!s || s.text.trim()) {
      project.sentences.unshift(createSentence(langId))
      s = project.sentences[0]
      if (folderId) s.folderId = folderId
    }
    s.text = r.text
    if (r.translation) s.translation[benchGloss] = r.translation
    s.tokens = []
    analyzeSentence(project, s)
    pinChoices(s.tokens, r.words, (w) => {
      const l = w.lexemeId ? project.lexemes.find((x) => x.id === w.lexemeId) : undefined
      return l ? lexemeGloss(l, glossLangs) : ''
    })
    closeBench()
    collapsedId = null
    selectedId = s.id
    touch()
    ui.toast(t('bench.added'))
  }
  function add(): void {
    if (!langId) return
    const s = createSentence(langId)
    if (folderId) s.folderId = folderId
    project.sentences.unshift(s)
    collapsedId = null
    selectedId = s.id
    mode = 'entries'
    folderView = false
    directoryRoot = false
    touch()
    queueMicrotask(() => document.getElementById('st-text')?.focus())
  }
  function removeBatch(ids: readonly Id[]): void {
    if (projectState.readOnly) return
    const owner = project,
      visible = [...visibleIds],
      visibleSet = new Set(visible),
      allowed = new Set(ids.filter((id) => visibleSet.has(id)))
    const { removed, remaining } = removeCorpusSentences(project.sentences, [...allowed], visible)
    if (!removed.length) return
    const saved = removed.map((row) => ({
      ...row,
      sentence: $state.snapshot(row.sentence) as Sentence
    }))
    project.sentences = remaining
    if (selectedId && allowed.has(selectedId)) selectedId = null
    multiIds = []
    selectionAnchor = null
    touch()
    ui.toast(
      removed.length === 1
        ? t('corpus.deleted')
        : t('corpus.selectedDeleted', { n: removed.length }),
      {
        action: {
          label: t('common.undo'),
          run: () => {
            if (projectState.project !== owner || projectState.readOnly) return
            project.sentences = restoreCorpusSentences(project.sentences, saved)
            selectedId = saved[0]?.sentence.id ?? null
            touch()
          }
        }
      }
    )
  }
  function remove(s: Sentence): void {
    removeBatch(
      selectedVisibleSet.has(s.id) && selectedVisibleIds.length > 1 ? selectedVisibleIds : [s.id]
    )
  }
  function analyze(force = false): void {
    if (!selected) return
    analyzeSentence(project, selected, { force })
    touch()
  }
  async function runDedup(): Promise<void> {
    if (projectState.readOnly) return
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
  function closeAnalysis(id: Id): void {
    collapsedId = id
    wordHover.hide(true)
    void tick().then(() => {
      document
        .querySelector<HTMLElement>(`.item[data-id="${CSS.escape(id)}"]`)
        ?.focus({ preventScroll: true })
    })
  }
  function pick(id: Id, e?: MouseEvent | KeyboardEvent): void {
    if (e && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      window.getSelection()?.removeAllRanges()
    }
    const next = selectCorpusSentence(
      visibleIds,
      multiIds.length ? multiIds : selectedId ? [selectedId] : [],
      selectionAnchor,
      id,
      { shift: !!e?.shiftKey, toggle: !!(e?.ctrlKey || e?.metaKey) }
    )
    multiIds = next.ids
    selectionAnchor = next.anchor
    collapsedId = null
    selectedId = next.ids.includes(id) ? id : (next.ids.at(-1) ?? null)
  }
  /** 导出当前列表里的例句（跟着当前语言与搜索走） */
  async function exportSentences(
    kind: CorpusExportKind,
    target: Id | null = folderId,
    recursive = false
  ): Promise<void> {
    if (projectState.readOnly || !langId) return
    const entries =
      target === null
        ? project.sentences.filter((s) => s.languageId === langId)
        : corpusFolderSentences(project, langId, target, recursive)
    const name =
      target === null
        ? 'corpus'
        : (folders.find((folder) => folder.id === target)?.name ?? 'Default')
    const base = `${language?.name ?? project.meta.name}-${name}`
    if (kind === 'csv')
      await platform.saveTextFile(
        `${base}.csv`,
        '\ufeff' + toCsv(sentencesToRows(project, entries, glossLangs))
      )
    else if (kind === 'json') await platform.saveTextFile(`${base}.json`, sentencesToJson(entries))
    else {
      const ext = { leipzig: 'txt', markdown: 'md', html: 'html', latex: 'tex' }[kind]
      await platform.saveTextFile(
        `${base}.${ext}`,
        sentencesToText(project, entries, kind, i18n.locale)
      )
    }
  }
  function openImport(
    jsonFirst: boolean,
    target: Id = folderId,
    initialText = '',
    initialSplit: TableTextChoice = 'auto'
  ): void {
    if (projectState.readOnly || !langId || !validCorpusFolder(project, langId, target)) return
    importTarget = { projectId: project.meta.id, languageId: langId, folderId: target }
    importOwner = project
    importText = initialText
    importSplit = initialSplit
    folderId = target
    folderView = false
    directoryRoot = false
    importJson = jsonFirst
    importNonce++
    importOpen = true
  }
  /** 多行粘贴先选用途，不把一批新句子直接写进已分析的当前条目。 */
  async function pasteSentenceText(event: ClipboardEvent, sentence: Sentence): Promise<void> {
    if (projectState.readOnly) {
      event.preventDefault()
      return
    }
    const text = event.clipboardData?.getData('text/plain') ?? '',
      lines = splitTextLines(text)
    if (lines.length < 2 || !langId || sentence.languageId !== langId) return
    const input = event.currentTarget
    if (!(input instanceof HTMLTextAreaElement)) return
    event.preventDefault()
    const owner = project,
      languageId = langId,
      target = corpusFolderOf(owner, sentence),
      original = sentence.text,
      start = input.selectionStart,
      end = input.selectionEnd,
      jsonRecords = previewSentencesJson(owner, languageId, text),
      automatic = parseTableText(text),
      fields = sentenceFields(glossLangs, language ?? undefined),
      tableHeader = automatic.rows[0],
      hasTableHeader =
        !!tableHeader && guessColumns(tableHeader, fields, tableHeader.length).includes('text'),
      initialSplit: TableTextChoice =
        jsonRecords !== null || looksLikeJson(text)
          ? 'auto'
          : hasTableHeader
            ? automatic.split === 'line'
              ? ','
              : 'auto'
            : 'line',
      count =
        jsonRecords?.length ??
        (hasTableHeader
          ? Math.max(0, parseTableText(text, initialSplit).rows.length - 1)
          : lines.length),
      folder =
        corpusFoldersFor(owner, languageId).find((item) => item.id === target)?.path ?? 'Default',
      languageName = owner.languages.find((item) => item.id === languageId)?.name ?? ''
    const choice = await ui.choose(
      t('corpusTextImport.promptTitle'),
      t('corpusTextImport.promptBody', { n: count }) +
        '\n' +
        t('corpusTextImport.destination', { folder, language: languageName }),
      [
        { value: 'import', label: t('corpusTextImport.preview'), primary: true },
        { value: 'paste', label: t('corpusTextImport.pasteHere') },
        { value: 'cancel', label: t('common.cancel') }
      ]
    )
    if (
      owner !== projectState.project ||
      projectState.readOnly ||
      langId !== languageId ||
      !owner.sentences.includes(sentence) ||
      sentence.text !== original ||
      !validCorpusFolder(owner, languageId, target)
    )
      return
    if (choice === 'import') {
      wordHover.hide(true)
      openImport(false, target, text, initialSplit)
    } else if (choice === 'paste' && input.isConnected && input.value === original) {
      input.focus()
      input.setRangeText(text, start, end, 'end')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
  }
  /** 导入面板里选了千语集导出的 JSON */
  function runSentencesJson(content: string): void {
    const target = importTarget
    if (
      !target ||
      importOwner !== project ||
      projectState.readOnly ||
      project.meta.id !== target.projectId ||
      langId !== target.languageId ||
      !validCorpusFolder(project, target.languageId, target.folderId)
    )
      return
    const lid = target.languageId
    const r = importSentencesJson(project, lid, content)
    if (!r) {
      ui.error(t('io.badJson'))
      return
    }
    importOpen = false
    moveCorpusSentences(project, r.ids, lid, target.folderId)
    folderId = target.folderId
    afterImport(lid, r)
  }
  /** 这门语言里已经有的原文（规范化后）：导入样例拿它标「会跳过」 */
  const existingTexts = $derived(
    new Set(
      project.sentences.filter((s) => s.languageId === langId).map((s) => normalizeSentence(s.text))
    )
  )
  function importSentenceTable(records: Record<string, string>[]): void {
    const target = importTarget
    if (
      !target ||
      importOwner !== project ||
      projectState.readOnly ||
      project.meta.id !== target.projectId ||
      langId !== target.languageId ||
      !validCorpusFolder(project, target.languageId, target.folderId)
    )
      return
    importOpen = false
    const result = importSentenceRecords(project, target.languageId, records)
    moveCorpusSentences(project, result.ids, target.languageId, target.folderId)
    folderId = target.folderId
    afterImport(target.languageId, result)
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
  /** 悬浮认词：跟开始页的画廊共用一套判断（engine/gloss/resolve.ts）；项目一改就换一个新的 */
  let resolverCache: { key: string; r: WordResolver } | null = null
  function resolver(): WordResolver {
    const key = (langId ?? '') + '|' + project.meta.updatedAt
    if (resolverCache?.key !== key)
      resolverCache = { key, r: new WordResolver(project, langId, () => surfaceEvidence) }
    return resolverCache.r
  }
  const resolveWord = (tk: Token): { lexemeId?: Id; morphemeId?: Id } | null =>
    resolver().resolveWord(tk)
  const hoverParts = (tk: Token): HoverPart[] => resolver().hoverParts(tk)
  /** 逐词写文字（转写来源是检视器模块的文字）时，没分析出词条的词也按悬浮卡那套认词找 */
  const lookupWord = (tk: Token): Id | null => resolver().resolveWord(tk)?.lexemeId ?? null
  /** 便宜的可点判断：重的反推留到真正悬浮时再做 */
  const linkable = (tk: Token): boolean => resolver().linkable(tk)
  /**
   * 原文切成段，词那几段指着第几个分析：列表里按原文画，标点、空格原样留着。
   * 分析跟原文对不上（原文刚改、还没重新分析）就给 null，退回只画一个个词
   */
  function textSpans(s: Sentence): { text: string; at: number }[] | null {
    if (!s.tokens.length || !s.text.trim()) return null
    const opts = tokenizeOptionsFor(project, s.languageId)
    const surfaces = s.tokens.map((tk) => tk.surface)
    if (!tokensMatchText(s.text, surfaces, opts)) return null
    return spanTokens(s.text, surfaces, opts)
  }
  /** 这个词可能是哪个词条：确认过的就是它；几个同形词条时按意思线索挑，挑不出来就都给 */
  const candidatesOf = (tk: Token, s: Sentence): { lexemeId?: Id; morphemeId?: Id }[] =>
    resolver().candidatesOf(tk, s)
  /** 几个候选分不出来：这个词在列表里用警告色标出来（与悬浮时并排给候选是同一个判断） */
  const ambiguous = (tk: Token, s: Sentence): boolean => resolver().ambiguous(tk, s)
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
    const s = project.sentences.find((x) => x.id === sid)
    const tk = s?.tokens[at]
    if (!s || !tk || tk.surface !== surface) return
    if (!writeChoice(project, tk, index, c)) return
    // 勾了「同时改原文」：整个词改成别的词条时，原文里这一处也换成它的写法
    if (wordHover.rewriteText && index === null) rewriteWordInText(project, s, at)
    touch()
  }
  function assignOf(tk: Token, s: Sentence): HoverAssign {
    const sid = s.id
    const at = s.tokens.indexOf(tk)
    const surface = tk.surface
    return {
      languageId: s.languageId,
      surface,
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
      wordHover.showCandidates(
        cands,
        rect,
        (c) => pickCandidate(sid, at, surface, c),
        assignOf(tk, s)
      )
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
  // 分批渲染：先画一屏，滚到快见底了再画下一批（例句一多，整份重画会卡一下）
  const lz = lazy(30)
  let lastCount = -1
  $effect(() => {
    const n = list.length
    if (n === lastCount) return
    lastCount = n
    lz.reset()
  })

  /** 切分、gloss 拼成一行：分隔符按用户写的（附着词默认 =） */
  function joinMorphs(a: Analysis, pick: (m: Analysis['morphs'][number]) => string): string {
    return a.morphs.map((m, i) => (i ? morphJoiner(project, a, i) : '') + pick(m)).join('')
  }
  function analysisLabel(a: Analysis): string {
    const surface = joinMorphs(a, (m) => m.form),
      gloss = joinMorphs(a, (m) => m.gloss),
      headword = a.lexemeId ? lexemeHeadwords.get(a.lexemeId) : ''
    return headword && headword.normalize('NFC') !== surface.normalize('NFC')
      ? `${surface} → ${headword} · ${gloss}`
      : `${surface} → ${gloss}`
  }
  /** 手工修改语素切分 / gloss：写成自定义分析放到首位并选中 */
  function customize(tk: Token, morphsText: string, glossText: string): void {
    // 连分隔符一起拆出来：写 = 的地方就记成 =，显示时不会变成 -
    const cut = (s: string): { parts: string[]; seps: ('-' | '=')[] } => {
      const bits = s.split(/([-=])/)
      return {
        parts: bits.filter((_, i) => i % 2 === 0).map((x) => x.trim()),
        seps: bits.filter((_, i) => i % 2 === 1) as ('-' | '=')[]
      }
    }
    const f = cut(morphsText)
    const g = cut(glossText)
    const forms = f.parts
    const glosses = g.parts
    const seps = f.seps.length ? f.seps : g.seps
    const n = Math.max(forms.length, glosses.length, 1)
    const cur = tk.analyses[tk.chosen]
    const morphs = Array.from({ length: n }, (_, i) => ({
      form: forms[i] ?? '',
      gloss: glosses[i] ?? '',
      morphemeId: cur?.morphs[i]?.morphemeId ?? null,
      ...(i > 0 && seps[i - 1] ? { sep: seps[i - 1] } : {})
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
    return a ? joinMorphs(a, (m) => m.form) : tk.surface
  }
  function glossOf(tk: Token): string {
    const a = tk.analyses[tk.chosen]
    return a ? joinMorphs(a, (m) => m.gloss) : ''
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
    const il = interlinear(project, selected, i18n.locale, scriptScope)
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
    if (projectState.readOnly) return void ui.toast(t('readonly.exportBlocked'))
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

{#snippet folderPanel(compact: boolean)}
  <ProjectDirectory
    kind="sentence"
    currentId={folderId}
    {compact}
    hideNavigation={!compact}
    rootView={directoryRoot}
    onroot={browseRoot}
    onopen={openFolder}
    onbrowse={browseFolder}
    onimport={(target, json) => openImport(json, target)}
    onexport={(target, kind, recursive) =>
      exportSentences(kind as CorpusExportKind, target, recursive)}
  />
{/snippet}
<div class="page" style:--corpus-text-scale={textSize / 100}>
  <div class="page-head row">
    <h1>{t('corpus.title')}</h1>
    <GuideLink section="corpus" />
    <div class="seg" data-tour="corpus-tabs">
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
    {#if mode === 'entries' && !folderView}
      {#if !bench && !importOpen}<RecordViewSwitcher
          value={browseMode}
          onchange={setBrowseMode}
        />{/if}
      <button class="btn ghost" title={t('corpus.dedup.hintBtn')} onclick={runDedup}
        ><Merge size={16} />{t('corpus.dedup.button')}</button
      >
      <button class="btn primary" data-tour="corpus-add" onclick={add}
        ><Plus size={16} />{t('corpus.add')}</button
      >
    {/if}
  </div>

  {#if mode === 'entries'}<ProjectDirectory
      kind="sentence"
      navigationOnly
      currentId={folderId}
      rootView={directoryRoot}
      {sidebarOpen}
      ontoggleSidebar={() => (sidebarOpen = !sidebarOpen)}
      tour="corpus-io"
      onroot={browseRoot}
      onbrowse={browseFolder}
      onopen={openFolder}
      onimport={(target, json) => openImport(json, target)}
      onexport={(target, format, recursive) =>
        exportSentences(format as CorpusExportKind, target, recursive)}
    />{/if}
  <div class="corpus-layout">
    {#if mode === 'entries' && sidebarOpen}<aside
        class="folder-sidebar"
        id="corpus-sidebar"
        data-page-sidebar="corpus"
      >
        {@render folderPanel(true)}
      </aside>{/if}
    <div class="corpus-main">
      {#if mode === 'entries' && !folderView}<RecordClipboardTools
          controls={false}
          {project}
          kind="sentence"
          ids={clipboardSentenceIds}
          {folderId}
          enabled={!bench && !importOpen}
          onconfirm={() => confirmBatch(clipboardSentenceIds)}
          onpasted={(ids) => {
            multiIds = ids
            selectedId = ids[0] ?? null
          }}
        />{/if}
      {#if mode === 'entries' && !folderView && selectedVisibleIds.length > 1}<div
          class="row corpus-bulk"
          data-corpus-bulk
        >
          <span class="small">{t('corpus.selectedN', { n: selectedVisibleIds.length })}</span>
          <RecordClipboardTools
            {project}
            kind="sentence"
            ids={clipboardSentenceIds}
            {folderId}
            listen={false}
            onpasted={(ids) => {
              multiIds = ids
              selectedId = ids[0] ?? null
            }}
          />
          <button
            class="btn ghost sm"
            data-corpus-confirm-selected
            title="Ctrl/⌘+Enter"
            disabled={projectState.readOnly}
            onclick={() => confirmBatch(selectedVisibleIds)}
            >{t('clipboard.confirmSelected')}</button
          >
          <button
            class="btn ghost sm"
            data-corpus-clear-selection
            onclick={() => {
              multiIds = []
              selectionAnchor = null
              selectedId = null
            }}>{t('corpus.clearSelection')}</button
          >

          <button
            class="btn ghost danger sm"
            data-corpus-bulk-delete
            disabled={projectState.readOnly}
            onclick={() => removeBatch(selectedVisibleIds)}
            ><Trash2 size={14} />{t('common.delete')}</button
          >
        </div>{/if}

      {#if importOpen && language}
        <div class="scroll">
          {#key importNonce}
            <TableImportDialog
              title={t('io.importSentences')}
              fields={sentenceFields(glossLangs, language)}
              guide={guideUrl('corpus', 'table-format')}
              exists={(text) => existingTexts.has(normalizeSentence(text))}
              json={{
                preview: (content) =>
                  langId ? previewSentencesJson(project, langId, content) : null,
                run: runSentencesJson
              }}
              startWithJson={importJson}
              initialText={importText}
              initialSplit={importSplit}
              sentenceLines
              onimport={importSentenceTable}
              onclose={() => (importOpen = false)}
            />
          {/key}
        </div>
      {:else if bench && language && (!benchSource || benchSource.languageId === language.id)}
        <!-- 译文工作台：先写译文、挑词拼原文，完成后填进这一句（或者新加一句） -->
        {#key `${language.id}:${bench.targetId ?? ''}`}<Workbench
            languageId={language.id}
            initial={bench.initial}
            sourceText={benchSource?.text ?? ''}
            sourceTokens={benchSource?.tokens ?? []}
            glossLang={benchGloss}
            kind="sentence"
            saved={memo.bench?.saved ?? null}
            onsave={(s) => memo.bench && (memo.bench.saved = s)}
            ondone={benchDone}
            oncancel={closeBench}
          />{/key}
      {:else if !language}
        <p class="muted">{t('lexicon.noLanguage')}</p>
      {:else if folderView && mode === 'entries'}
        <div class="scroll">{@render folderPanel(false)}</div>
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
              <div class="chips" use:fiveRows>
                {#each st.unresolved as w (w)}<button
                    class="chip data warn"
                    onclick={() => filterFromStats(w)}>{w}</button
                  >{/each}
              </div>
            </section>
          {/if}
        </div>
      {:else if mode === 'abbr'}
        <div class="scroll" data-tour="corpus-abbr">
          <div class="row">
            <span class="grow"></span>
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
          {#if movingSentence}<div class="corpus-drop-targets">
              {@render folderPanel(true)}
            </div>{/if}
          <Hint id="corpus" text={t('corpus.hint')} />
          {#snippet editorPanel(s: Sentence)}
            <div class="card editor" class:fading>
              <div class="row toolbar" data-tour="corpus-analyze">
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
                <button
                  type="button"
                  class="btn ghost icon sm"
                  data-close-analysis
                  title={t('common.close')}
                  aria-label={t('common.close')}
                  onclick={() => closeAnalysis(s.id)}><X size={15} /></button
                >
              </div>

              {#each scriptScope.visible(s) as sc (sc.id)}
                {@const st = sentenceScriptText(project, language, sc, s, lookupWord, scriptScope)}
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
                {#each displayTextRows(s.translation, project.settings.translationDisplay, translationOrder) as row (row.language)}<p
                    class="tr"
                    lang={row.language}
                  >
                    {row.text}
                  </p>{/each}
              {/if}
            </div>
          {/snippet}

          {#if selected && collapsedId !== selected.id && !list.some((x) => x.id === selected.id)}
            {@render editorPanel(selected)}
          {/if}

          {#if list.length === 0}
            <p class="muted">{t('corpus.empty')}</p>
          {:else}
            <RecordBrowser
              items={list}
              mode={browseMode}
              activeId={selectedId}
              onactive={gallerySelect}
              lazy={lz}
            >
              {#snippet children(s: Sentence, si: number)}
                {#if selectedId === s.id && collapsedId !== s.id}{@render editorPanel(s)}{/if}
                {@const c = coverage(s)}
                {@const done = fullyConfirmed(s)}
                {@const spans = textSpans(s)}
                <div
                  class="card item"
                  data-id={s.id}
                  use:deletable={{
                    identity: JSON.stringify([project.meta.id, langId, folderId, s.id]),
                    selected: selectedId === s.id || selectedVisibleSet.has(s.id),
                    actions: [
                      ...sentenceClipboardActions,
                      {
                        label: t('corpus.folders.move'),
                        disabled: projectState.readOnly,
                        run: () => chooseFolder(s)
                      }
                    ],
                    select: () => {
                      if (!selectedVisibleSet.has(s.id)) {
                        multiIds = [s.id]
                        selectionAnchor = s.id
                      }
                      selectedId = s.id
                    },
                    remove: () => remove(s)
                  }}
                  class:sel={selectedId === s.id || selectedVisibleSet.has(s.id)}
                  aria-pressed={selectedVisibleSet.has(s.id)}
                  data-corpus-selected={selectedVisibleSet.has(s.id)}
                  class:flash={flashId === s.id}
                  use:flashOn={justConfirmed === s.id}
                  role="button"
                  tabindex="0"
                  {...sentenceDrag(s, si)}
                  onclickcapture={(e) => {
                    if (e.shiftKey || e.ctrlKey || e.metaKey) {
                      e.stopPropagation()
                      pick(s.id, e)
                    }
                  }}
                  onclick={(e) => pick(s.id, e)}
                  onkeydown={(e) => e.key === 'Enter' && pick(s.id, e)}
                >
                  <ExpandableRecord>
                    {#each scriptScope.visible(s) as sc (sc.id)}
                      {@const st = sentenceScriptText(
                        project,
                        language,
                        sc,
                        s,
                        lookupWord,
                        scriptScope
                      )}
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
                      {#if spans}
                        <!-- 按原文画：词之间的空格、逗号句号这些标点原样留着，词才能悬浮 -->
                        <span class="data text grow"
                          >{#each spans as sp, k (k)}{#if sp.at >= 0}{@const tk =
                                s.tokens[sp.at]}<span
                                class="w"
                                class:link={linkable(tk)}
                                class:ambiguous={ambiguous(tk, s)}
                                role="link"
                                tabindex="-1"
                                onmouseenter={(e) => hoverWord(e, tk, s)}
                                onmouseleave={() => wordHover.hide()}
                                onclick={(e) => clickWord(e, tk, s)}
                                onkeydown={() => {}}>{sp.text}</span
                              >{:else}{sp.text}{/if}{/each}</span
                        >
                      {:else if s.tokens.length}
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
                      {@const il = interlinear(project, s, i18n.locale, scriptScope)}
                      <div class="gl" class:slide-in={justConfirmed === s.id}>
                        {#each il.words as w, i (i)}<span class="gw"
                            ><span class="data m">{w.morphs}</span><span class="g">{w.gloss}</span
                            ></span
                          >{/each}
                      </div>
                    {/if}
                    {#each displayTextRows(s.translation, project.settings.translationDisplay, translationOrder) as row (row.language)}<div
                        class="tr-line"
                        lang={row.language}
                        data-corpus-translation={row.language}
                      >
                        {row.text}
                      </div>{/each}
                    {#if s.tags.length || s.source}<div class="small muted">
                        {[s.source, ...s.tags].filter(Boolean).join(' · ')}
                      </div>{/if}
                  </ExpandableRecord>
                </div>
              {/snippet}
            </RecordBrowser>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

{#if selected && mode === 'entries' && !importOpen}
  {@const s = selected}
  <Portal>
    {@const references = documentReferences.get(s.id) ?? []}
    {#if references.length}
      <div class="field" data-sentence-document-references>
        <span class="small muted"
          >{t('docs.references')}<HelpDot tip={t('docs.referencesHint')} /></span
        >
        {#each references as ref (ref.docId)}
          <button
            class="btn sm"
            data-sentence-document-reference={ref.docId}
            onclick={() =>
              ui.jump('docs', 'doc', ref.docId, ref.languageId ?? undefined, `${ref.kind}:${s.id}`)}
          >
            <span class="grow">{ref.title || t('docs.untitled')}</span>
            <span class="small muted"
              >{ref.languageId
                ? project.languages.find((l) => l.id === ref.languageId)?.abbr
                : t('docs.projectWide')} · {t(
                ref.kind === 'link' ? 'docs.linkReference' : 'docs.textReference'
              )}</span
            >
          </button>
        {/each}
      </div>
    {/if}
    <div class="field">
      <div class="row">
        <label class="grow" for="st-text">{t('corpus.text')}</label><button
          type="button"
          class="btn ghost sm"
          data-corpus-import-lines
          disabled={projectState.readOnly}
          title={t('corpusTextImport.linesHint')}
          onclick={() => openImport(false, corpusFolderOf(project, s), '', 'line')}
          >{t('corpusTextImport.open')}</button
        >
      </div>
      <textarea
        id="st-text"
        class="textarea data"
        rows="2"
        readonly={projectState.readOnly}
        bind:value={s.text}
        onpaste={(event) => void pasteSentenceText(event, s)}
        onchange={() => {
          analyzeSentence(project, s)
          touch()
        }}
      ></textarea>
    </div>
    <div class="field">
      <div class="row tr-head">
        <span class="small muted grow">{t('corpus.translation')}</span>
        <button
          class="btn ghost sm"
          class:active={bench?.targetId === s.id}
          title={t('bench.openHint')}
          onclick={() => openBench(s)}><PencilRuler size={13} />{t('bench.open')}</button
        >
      </div>
      <LocalizedInput bind:value={s.translation} onchange={touch} />
    </div>
    {#if language && language.scripts.length}
      {@const applicable = scriptScope.applicable(s)}
      <div class="field" data-script-overrides>
        <span class="small muted">{t('script.override')}</span>
        {#each language.scripts as sc (sc.id)}
          <div class="row kv">
            {#if applicable.length > 1 && applicable.some((script) => script.id === sc.id)}
              <label class="small oname script-check"
                ><input
                  type="checkbox"
                  data-sentence-script={sc.id}
                  checked={!s.hiddenScriptIds?.includes(sc.id)}
                  disabled={projectState.readOnly}
                  onchange={(e) => setScriptShown(s, sc.id, e.currentTarget.checked)}
                /><span>{sc.name}</span></label
              >
            {:else}<span class="small oname">{sc.name}</span>{/if}
            <input
              class="input scr"
              style={fontCss(sc)}
              dir={sc.direction === 'rtl' ? 'rtl' : 'ltr'}
              value={s.scriptForms?.[sc.id] ?? ''}
              placeholder={textScript(project, language, sc, s.text, s.tokens, lookupWord)}
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
  .page {
    position: relative;
  }
  .corpus-drop-targets {
    position: absolute;
    inset-inline: 8px;
    inset-block-end: 8px;
    max-height: 40%;
    overflow: auto;
    z-index: 50;
    box-shadow: var(--shadow-lg);
    background: var(--bg-elev);
    border-radius: var(--radius);
  }
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
  .corpus-layout {
    display: flex;
    flex: 1;
    min-height: 0;
    gap: 12px;
  }
  .corpus-main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }
  .folder-sidebar {
    flex: 0 0 230px;
    overflow: auto;
    border-inline-end: 1px solid var(--border);
  }
  @media (max-width: 900px) {
    .folder-sidebar {
      flex-basis: 180px;
    }
  }
  .page-head {
    flex-wrap: wrap;
    gap: 10px;
  }
  .scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-inline-end: 4px;
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
    font-size: calc(19px * var(--corpus-text-scale, 1));
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
    font-size: calc(13px * var(--corpus-text-scale, 1));
  }
  .tok .g {
    font-family: var(--font-gloss);
    font-size: calc(12px * var(--corpus-text-scale, 1));
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
    font-size: calc(14px * var(--corpus-text-scale, 1));
    font-weight: 500;
    color: var(--text-2);
  }
  .tr {
    color: var(--text-2);
    font-style: italic;
    font-size: calc(15px * var(--corpus-text-scale, 1));
    font-weight: 500;
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
    font-family: var(--font-corpus-text);
    font-size: calc(17px * var(--corpus-text-scale, 1));
    font-weight: 600;
  }
  .scr {
    font-size: calc(22px * var(--corpus-text-scale, 1));
    line-height: 1.3;
    max-width: 100%;
    overflow-wrap: anywhere;
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
    font-size: calc(13px * var(--corpus-text-scale, 1));
  }
  .gw .g {
    font-family: var(--font-gloss);
    font-size: calc(11px * var(--corpus-text-scale, 1));
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
    text-align: start;
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
  .script-check {
    display: flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .script-check input {
    flex: none;
    margin: 0;
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
