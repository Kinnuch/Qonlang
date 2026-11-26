<script lang="ts" module>
  import type { WordSpec } from '$lib/engine/attach'
  import type { Analysis, Token } from '$lib/core/model'
  import type { ComposeWordMetadata } from '$lib/engine/composeInput'
  import type { ComposeLayout, ComposeFormatOptions } from '$lib/engine/composeFormat'
  import type { ComposeTrayState } from '$lib/engine/composeTray'

  /**
   * 工作台拼好的一个词：挂着哪个词条 / 语素，挑了哪一格构形，加了哪些词缀、动词头，过了哪个词首音变。
   * 单独成词挂在别的词上的小品词记着挂在谁身上（hostId）、是哪个标记（markerKey）
   */
  export interface BenchWord extends WordSpec, ComposeWordMetadata {
    id: string
    hostId?: string
    markerKey?: string
  }
  /** 交出去的一个词：写进原文的形式、这一格、拼好的各段（钉分析用，见 compose.ts 的 pinChoices） */
  export interface BenchPinned {
    lexemeId?: string
    morphemeId?: string
    form: string
    slotKey: string | null
    morphs?: Analysis['morphs']
    analysis?: Analysis
  }
  export interface BenchResult {
    text: string
    translation: string
    words: BenchPinned[]
  }
  /** 工作台眼下的样子：离开这一页（跳去词库新建词条）再回来时照原样摆回去 */
  export interface BenchSaved {
    translation: string
    words: BenchWord[]
    free: string
    selectedId: string | null
    /** 附着台收起了没有 */
    deckOpen?: boolean
    sourceLayout?: ComposeLayout | null
    layout?: ComposeLayout | null
    format?: ComposeFormatOptions
    punctuationSource?: 'original' | 'translation' | 'none'
    outputDraft?: string | null
    draftAligned?: boolean
    formatOpen?: boolean
    tray?: ComposeTrayState
  }
</script>

<script lang="ts">
  /**
   * 译文工作台：先写译文，软件照着译文反查词库给出候选词（泡泡），
   * 把要用的拖到上面固定下来；点上面的一个词，下面的附着台里给它挑构形、加词缀和小品词，
   * 拼出这句话的原文，一键加进语料或短语。
   * 候选怎么来的见 lib/engine/compose.ts；能加什么、怎么拼见 lib/engine/attach.ts；这里只管摆、拖、点。
   */
  import { onDestroy, untrack } from 'svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import {
    composeSuggestionsFrom,
    prepareComposeIndex,
    type ComposeCandidate
  } from '$lib/engine/compose'
  import {
    buildWord,
    companionPiece,
    companionsFor,
    deckModel,
    defaultPicks,
    innerToOuter,
    isWordMode,
    lpKeyOf,
    markerCatalog,
    modeOf,
    morphsOf,
    particleWords,
    pieceFor,
    recognize,
    bare,
    specLexeme,
    wordHost,
    type AttachMode,
    type BuiltWord,
    type Companion,
    type DeckEnv
  } from '$lib/engine/attach'
  import type { Lexeme, Morpheme } from '$lib/core/model'
  import { makeContext, paradigmsFor } from '$lib/engine/morph'
  import { findPos, isCompoundPos, posName } from '$lib/core/pos'
  import { newId } from '$lib/core/factory'
  import { Check, X, Plus, GripVertical, CircleAlert, BookPlus } from '@lucide/svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import BenchDeck, { hueTable, type DeckActions } from '$lib/ui/BenchDeck.svelte'
  import { loadComposeInput } from '$lib/engine/composeInput'
  import {
    emptyLayout,
    formatComposedText,
    layoutFromTranslation,
    parseComposedText,
    unplacedPunctuationMissing,
    type FormatWord
  } from '$lib/engine/composeFormat'
  import { tokenize, wordCharsFor } from '$lib/engine/gloss'
  import { canonicalG } from '$lib/ipa/equivalence'
  import {
    expandComposeCandidateView,
    loadComposeTray,
    claimComposeCandidate,
    reconcileComposeTray,
    seedComposeTrayOwners,
    restoreComposeCandidate,
    partitionComposeTray,
    planComposeAddAll,
    type ComposeTrayCandidate,
    type ComposeTrayOwner
  } from '$lib/engine/composeTray'
  import CandidateTrash, {
    CANDIDATE_TRAY_DRAG,
    type CandidateFlight,
    type CandidateFlightRequest
  } from '$lib/ui/CandidateTrash.svelte'

  let {
    languageId,
    initial = '',
    glossLang,
    kind,
    sourceText = '',
    sourceTokens = [],
    saved = null,
    onsave,
    ondone,
    oncancel
  }: {
    languageId: string
    /** 进来时译文框里已经有的（检视器里写了一半的译文） */
    initial?: string
    /** 译文按哪种释义语言写（反查时它排最前） */
    glossLang: string
    kind: 'sentence' | 'phrase'
    sourceText?: string
    sourceTokens?: readonly Token[]
    /** 上回离开时的样子（从词库回来）：有就照它摆回去 */
    saved?: BenchSaved | null
    /** 每改一下都报上来，页面记住（见 ui.memo） */
    onsave?: (s: BenchSaved) => void
    ondone: (r: BenchResult) => void
    oncancel: () => void
  } = $props()

  const project = $derived(projectState.project!)
  // 进来时的译文只取一次：之后在工作台里改，不跟着检视器变；从词库回来的接着上回的
  const start = untrack(() => saved)
  const owner = untrack(() => projectState.project!)
  const ownerLanguage = untrack(() => languageId)
  let active = true
  onDestroy(() => {
    active = false
  })
  const loaded = untrack(() =>
    start ? null : loadComposeInput(owner, languageId, sourceText, sourceTokens)
  )
  const sourceLayout = untrack(() => start?.sourceLayout ?? loaded?.layout ?? null)
  const initialKind = untrack(() => kind)
  let translation = $state(start?.translation ?? untrack(() => initial))
  let words = $state<BenchWord[]>(start?.words ?? loaded?.words ?? [])
  let free = $state(start?.free ?? '')
  /** 正在编辑的词（附着台给它摆） */
  let selectedId = $state<string | null>(start?.selectedId ?? null)
  /** 附着台展开着（收起后换词、离开再回来都还收着） */
  let deckOpen = $state(start?.deckOpen ?? true)
  let manualLayout = $state<ComposeLayout | null>(start?.layout ?? null)
  let formatting = $state<ComposeFormatOptions>(
    start?.format ?? {
      capitalize: initialKind === 'sentence',
      punctuation: sourceLayout ? 'preserve' : 'auto',
      defaultPeriod: initialKind === 'sentence'
    }
  )
  let punctuationSource = $state<'original' | 'translation' | 'none'>(
    start?.punctuationSource ?? (sourceLayout ? 'original' : 'translation')
  )
  let outputDraft = $state<string | null>(start?.outputDraft ?? null)
  let draftAligned = $state(start?.draftAligned ?? false)
  let formatOpen = $state(start?.formatOpen ?? false)
  let tray = $state<ComposeTrayState>(
    loadComposeTray(
      start?.tray,
      untrack(() => translation)
    )
  )
  $effect(() => {
    const s: BenchSaved = {
      translation,
      words: $state.snapshot(words),
      free,
      selectedId,
      deckOpen,
      sourceLayout,
      layout: manualLayout,
      format: formatting,
      punctuationSource,
      outputDraft,
      draftAligned,
      formatOpen,
      tray: $state.snapshot(tray)
    }
    untrack(() => onsave?.(s))
  })

  /** 反查放在输入停一下之后再做，打字时不卡 */
  let query = $state(untrack(() => translation))
  $effect(() => {
    const v = translation
    const timer = setTimeout(() => (query = v), 250)
    return () => clearTimeout(timer)
  })
  const langs = $derived([
    glossLang,
    ...project.settings.glossLanguages.filter((l) => l !== glossLang)
  ])
  const glossIndex = $derived(prepareComposeIndex(project, languageId, langs))
  const suggestions = $derived(composeSuggestionsFrom(glossIndex, query))
  const candidateView = $derived(expandComposeCandidateView(suggestions.candidates, query))
  const candidates = $derived(query === translation ? candidateView.candidates : [])
  const approximateCount = $derived(candidates.filter((candidate) => candidate.approximate).length)
  const canAddAll = $derived(planComposeAddAll(candidates, tray).length > 0)
  /** 译文里在词库、语素表里都没对上的部分 */
  const gaps = $derived(query === translation ? suggestions.gaps : [])
  /** 没对上的那一段：跳到词库新建一个词条，释义先填好；工作台的样子页面记着，「返回上一页」回来接着拼 */
  function createFor(text: string): void {
    ui.lexemeDraft = { definition: { [glossLang]: text } }
    ui.jump('lexicon', 'new', 'lexeme', languageId)
    ui.toast(t('bench.gapCreated', { text }), {
      action: { label: t('bench.backToBench'), run: () => ui.back() }
    })
  }
  const partition = $derived(partitionComposeTray(candidates, tray))
  const floating = $derived(partition.floating)
  const stashed = $derived(partition.stashed)
  function activeOwners(): string[] {
    const owners: string[] = []
    for (const word of words) {
      owners.push('w:' + word.id)
      if (word.hostId && word.markerKey) owners.push(`piece:${word.hostId}:${word.markerKey}`)
      for (const piece of word.pieces)
        if (piece.morphemeId) owners.push(`piece:${word.id}:m:${piece.morphemeId}`)
    }
    return owners
  }
  function existingOwners(): ComposeTrayOwner[] {
    const owners = new Map<string, ComposeTrayOwner>()
    for (const word of words) {
      if (word.hostId && word.markerKey) {
        const owner = `piece:${word.hostId}:${word.markerKey}`
        owners.set(owner, { owner, lexemeId: word.lexemeId, morphemeId: word.morphemeId })
      } else {
        const owner = 'w:' + word.id
        owners.set(owner, {
          owner,
          lexemeId: word.lexemeId,
          morphemeId: word.morphemeId,
          sourceAt: word.sourceAt,
          sourceEnd: word.sourceEnd,
          sourceTranslation: word.sourceTranslation
        })
      }
      for (const piece of word.pieces)
        if (piece.morphemeId) {
          const owner = `piece:${word.id}:m:${piece.morphemeId}`
          owners.set(owner, { owner, morphemeId: piece.morphemeId })
        }
    }
    return [...owners.values()]
  }
  $effect(() => {
    let next = reconcileComposeTray(tray, translation, activeOwners())
    if (query === translation) next = seedComposeTrayOwners(next, candidates, existingOwners())
    if (next !== tray) tray = next
  })
  let trashButton = $state<HTMLButtonElement | null>(null)
  let flightRequest = $state<CandidateFlightRequest | null>(null)
  let flightSerial = 0,
    flightItemSerial = 0
  let collectedFlights: CandidateFlight[] | null = null
  let dragRects: Map<string, DOMRect> | null = null
  let candidateDragging = false,
    dragEndedAt = 0
  function candidateRects(): Map<string, DOMRect> {
    return new Map(
      [...document.querySelectorAll<HTMLElement>('[data-candidate-key]')].map((node) => [
        node.dataset.candidateKey!,
        node.getBoundingClientRect()
      ])
    )
  }
  function claim(c: ComposeTrayCandidate, owner: string): void {
    if (c.translation !== translation || query !== translation) return
    const before = new Set(floating.map((item) => item.id)),
      next = claimComposeCandidate(tray, c, owner)
    const retiring = partitionComposeTray(candidates, next).stashed.filter((item) =>
      before.has(item.id)
    )
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && retiring.length) {
      const rects = dragRects ?? candidateRects()
      const items: CandidateFlight[] = retiring.flatMap((item) => {
        const r = rects.get(item.id)
        return r &&
          r.width > 0 &&
          r.height > 0 &&
          r.bottom > 0 &&
          r.top < innerHeight &&
          r.right > 0 &&
          r.left < innerWidth
          ? [
              {
                id: `${++flightItemSerial}:${item.id}`,
                surface: item.surface,
                matched: item.matched,
                morph: !!item.morphemeId,
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height
              }
            ]
          : []
      })
      if (collectedFlights) collectedFlights.push(...items)
      else if (items.length) flightRequest = { id: ++flightSerial, items }
    }
    tray = next
  }
  function restoreCandidate(id: string, snapshot: string): void {
    if (
      snapshot !== translation ||
      query !== translation ||
      !stashed.some((item) => item.id === id)
    )
      return
    tray = restoreComposeCandidate(tray, id)
  }
  function candidateDragStart(e: DragEvent, c: ComposeTrayCandidate): void {
    if (!e.dataTransfer) return
    candidateDragging = true
    dragRects = candidateRects()
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setData(
      'text/x-qonlang-cand',
      JSON.stringify({ id: c.id, translation: c.translation })
    )
  }
  function candidateDragEnd(): void {
    candidateDragging = false
    dragEndedAt = performance.now()
    dragRects = null
  }
  function addAll(): void {
    const plan = planComposeAddAll(candidates, tray)
    collectedFlights = []
    for (const item of plan) if (floating.some((candidate) => candidate.id === item.id)) add(item)
    const items = collectedFlights
    collectedFlights = null
    if (items.length) flightRequest = { id: ++flightSerial, items }
  }
  let restoreHover = $state(false)
  function poolDragOver(e: DragEvent): void {
    if (!e.dataTransfer?.types.includes(CANDIDATE_TRAY_DRAG)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    restoreHover = true
  }
  function poolDrop(e: DragEvent): void {
    const raw = e.dataTransfer?.getData(CANDIDATE_TRAY_DRAG)
    if (!raw) return
    e.preventDefault()
    restoreHover = false
    try {
      const value = JSON.parse(raw) as { id?: unknown; translation?: unknown }
      if (typeof value.id === 'string' && typeof value.translation === 'string')
        restoreCandidate(value.id, value.translation)
    } catch {
      /* 外部或过期的拖动不改变收纳。 */
    }
  }

  // ───── 拼词：这门语言能加的东西（语料里的证据）只算一次 ─────
  const language = $derived(project.languages.find((l) => l.id === languageId))
  const env = $derived.by((): DeckEnv | null =>
    language
      ? {
          project,
          ctx: makeContext(project, language),
          glossLangs: langs,
          languageId,
          catalog: markerCatalog(project, languageId, langs)
        }
      : null
  )
  const built = $derived(
    new Map(
      words.map((w): [string, BuiltWord] => [
        w.id,
        env
          ? buildWord(env, w)
          : { form: w.base, parts: [], slotKey: null, slotAbbr: '', missing: false }
      ])
    )
  )
  const formOf = (w: BenchWord): string => built.get(w.id)?.form ?? w.base
  /** 每一组一个颜色：维度按维度表的顺序在前，其余按这门语言里能加的东西 */
  const hue = $derived(
    hueTable([
      ...project.categories.map((c) => 'dim:' + c.id),
      ...(env?.catalog.markers.map((m) => m.group.id) ?? [])
    ])
  )
  const tokenOptions = $derived({
    mode: project.settings.tokenizer,
    pattern: project.settings.tokenizerPattern,
    letters: wordCharsFor(project, languageId) + (project.settings.tokenizerLetters ?? '')
  })
  const formattingWords = $derived(
    words.map((word): FormatWord => ({
      id: word.id,
      form: formOf(word),
      hostId: word.hostId,
      ...(word.sourceTranslation === translation
        ? { sourceAt: word.sourceAt, sourceEnd: word.sourceEnd }
        : {})
    }))
  )
  const baseLayout = $derived(
    punctuationSource === 'original'
      ? (sourceLayout ?? emptyLayout())
      : punctuationSource === 'translation'
        ? layoutFromTranslation(translation, formattingWords, project.settings.tokenizer)
        : emptyLayout()
  )
  const layout = $derived(manualLayout ?? baseLayout)
  const formatted = $derived(
    formatComposedText(formattingWords, layout, formatting, project.settings.tokenizer)
  )
  const parsedDraft = $derived(
    outputDraft === null
      ? null
      : parseComposedText(outputDraft, formatted.words, tokenOptions.letters)
  )
  const text = $derived(outputDraft ?? formatted.text)
  const meaningfulWords = $derived(
    formatted.words.some((word) => tokenize(word.form, tokenOptions).length > 0)
  )
  const validOutput = $derived(meaningfulWords && (outputDraft === null || !!parsedDraft?.valid))
  let previousStructure = ''
  $effect(() => {
    const structure = JSON.stringify(
      formattingWords.map((word) => [word.id, word.form, word.hostId])
    )
    const first = !previousStructure
    if (structure === previousStructure) return
    previousStructure = structure
    if (!first)
      untrack(() => {
        if (draftAligned) outputDraft = null
      })
  })
  function editOutput(value: string): void {
    outputDraft = value
    const parsed = parseComposedText(value, formatted.words, tokenOptions.letters)
    draftAligned = parsed.valid
    if (!parsed.valid) return
    const changedCase = parsed.words.some(
      (word, index) =>
        word.form.replace(/\s+/gu, ' ') !== formatted.words[index]?.form.replace(/\s+/gu, ' ')
    )
    manualLayout = parsed.layout
    if (changedCase) formatting.capitalize = false
    formatting.punctuation = 'preserve'
    formatting.defaultPeriod = false
  }
  function refreshFormat(): void {
    outputDraft = null
    draftAligned = false
    manualLayout = null
  }
  function applyFormat(): void {
    if (outputDraft !== null && draftAligned) outputDraft = null
  }

  const selected = $derived(words.find((w) => w.id === selectedId) ?? null)
  /** 单独成词挂在这个词上的小品词 */
  const attachedTo = (hostId: string): Set<string> =>
    new Set(words.filter((w) => w.hostId === hostId && w.markerKey).map((w) => w.markerKey!))
  const deck = $derived(selected && env ? deckModel(env, selected, attachedTo(selected.id)) : null)

  const lexemeOf = (w: BenchWord | null | undefined): Lexeme | undefined =>
    w?.lexemeId ? project.lexemes.find((x) => x.id === w.lexemeId) : undefined
  const morphemeOf = (w: BenchWord | null | undefined): Morpheme | undefined =>
    w?.morphemeId ? project.morphemes.find((x) => x.id === w.morphemeId) : undefined
  const deckTitle = $derived(
    lexemeOf(selected)?.lemma ?? morphemeOf(selected)?.form ?? selected?.base ?? ''
  )
  const deckGloss = $derived.by(() => {
    const l = lexemeOf(selected)
    if (l) return pickText(l.senses[0]?.definition, langs)
    return morphemeOf(selected)?.gloss ?? ''
  })
  const deckPos = $derived(
    (deck?.posIds ?? [])
      .map((id) => posName(findPos(project, id), langs))
      .filter(Boolean)
      .join(' · ')
  )
  const deckKind = $derived<'lexeme' | 'morpheme' | 'free'>(
    selected?.lexemeId ? 'lexeme' : selected?.morphemeId ? 'morpheme' : 'free'
  )
  /** 手打的词可以挑算作哪个词类（复合词类不列，挑组成它的那几个） */
  const posOptions = $derived(
    project.posList
      .filter((p) => !isCompoundPos(p))
      .map((p) => ({ id: p.id, name: posName(p, langs) || p.abbr }))
  )
  /** 这个词的词类（挂着的词条、手打时挑的、加了派生词缀后算作的） */
  const hostPos = (w: BenchWord): string[] => (env ? wordHost(env, w).posIds : [])

  // ───── 摆词、删词、选词 ─────
  const blank = (over: Partial<BenchWord>): BenchWord => ({
    id: newId(),
    base: '',
    own: null,
    pieces: [],
    mutation: null,
    ...over
  })
  function toWord(c: ComposeTrayCandidate): BenchWord {
    return blank({
      lexemeId: c.lexemeId,
      morphemeId: c.morphemeId,
      base: bare(c.surface),
      sourceAt: c.at,
      sourceEnd: c.end,
      sourceTranslation: c.translation
    })
  }
  /** 贴进词里的语素（前缀、后缀……）拖上来时，接到哪个词上：选中的那个，没有就前面最近的一个词 */
  function hostFor(at: number): BenchWord | null {
    if (selected && !selected.hostId && (selected.lexemeId || !selected.morphemeId)) return selected
    for (let i = Math.min(at, words.length) - 1; i >= 0; i--)
      if (!words[i].hostId && !words[i].morphemeId) return words[i]
    return null
  }
  function add(c: ComposeTrayCandidate, at = words.length, onto?: BenchWord | null): void {
    if (
      c.translation !== translation ||
      query !== translation ||
      !floating.some((item) => item.id === c.id)
    )
      return
    // 语素：贴得进词里的直接接到词上，单独成词的挂在词旁边
    if (c.morphemeId && env) {
      const marker = env.catalog.markers.find((x) => x.key === 'm:' + c.morphemeId)
      const host = onto ?? hostFor(at)
      if (marker && host) {
        const mode = modeOf(env.catalog, marker, hostPos(host))
        selectedId = host.id
        toggleOn(host, marker.key, mode)
        const owner = `piece:${host.id}:${marker.key}`
        if (activeOwners().includes(owner)) claim(c, owner)
        return
      }
    }
    const w = toWord(c)
    words = [...words.slice(0, at), w, ...words.slice(at)]
    selectedId = w.id
    claim(c, 'w:' + w.id)
  }
  function addFree(): void {
    const f = free.trim()
    if (!f) return
    // 打的正好是词库里的词（词头或存下来的屈折形）就挂上那个词条，连挑的那一格一起
    const hit = recognize(project, languageId, f, langs)
    const w = hit ? blank({ lexemeId: hit.lexemeId, base: f, own: hit.own }) : blank({ base: f })
    words = [...words, w]
    selectedId = w.id
    free = ''
  }
  function remove(id: string): void {
    words = words.filter((w) => w.id !== id && w.hostId !== id)
    if (selectedId === id) selectedId = null
  }
  /** 点小品词选中的是它挂着的那个词（小品词在那个词的附着台里加减） */
  function select(w: BenchWord): void {
    selectedId = w.hostId ?? w.id
  }

  // ───── 附着台的操作 ─────
  function update(id: string, fn: (w: BenchWord) => BenchWord): void {
    words = words.map((w) => {
      if (w.id !== id) return w
      const next = fn(w)
      return next === w ? w : { ...next, loadedAnalysis: undefined, loadedForm: undefined }
    })
  }
  const nextSeq = (w: BenchWord): number =>
    w.pieces.length ? Math.max(...w.pieces.map((p) => p.seq)) + 1 : 0

  /**
   * 加一个标记：贴进词里的加一截，单独成词的在旁边放一个小品词；
   * 隔开写的（`ma…gò`）前一段放在词前、后一段放在词后，两段一起加、一起去掉
   */
  function toggleOn(host: BenchWord, key: string, mode: AttachMode): void {
    if (!env) return
    const marker = env.catalog.markers.find((x) => x.key === key)
    if (!marker) return
    if (isWordMode(mode)) {
      if (words.some((w) => w.hostId === host.id && w.markerKey === key)) {
        words = words.filter((w) => !(w.hostId === host.id && w.markerKey === key))
        return
      }
      const parts = particleWords(marker.form, mode)
      const particle = (base: string): BenchWord =>
        blank({
          lexemeId: marker.lexemeId,
          morphemeId: marker.morphemeId,
          base,
          surface: base,
          hostId: host.id,
          markerKey: key
        })
      const put = (w: BenchWord, after: boolean): void => {
        const i = words.findIndex((x) => x.id === host.id)
        let at = i
        if (after) {
          at = i + 1
          while (at < words.length && words[at].hostId === host.id) at++
        } else while (at > 0 && words[at - 1].hostId === host.id) at--
        words = [...words.slice(0, at), w, ...words.slice(at)]
      }
      if (mode === 'around' && parts.length > 1) {
        put(particle(parts[0]), false)
        put(particle(parts[1]), true)
      } else put(particle(parts[0]), mode === 'after')
      return
    }
    const has = marker.morphemeId && host.pieces.some((p) => p.morphemeId === marker.morphemeId)
    update(host.id, (w) => ({
      ...w,
      pieces: has
        ? w.pieces.filter((p) => p.morphemeId !== marker.morphemeId)
        : [...w.pieces, pieceFor(env, marker, mode, nextSeq(w))]
    }))
  }
  /** 这个词能搭的构形（换算作的词类之后按新词类） */
  function companionOf(w: BenchWord, key: string): Companion | undefined {
    if (!env) return undefined
    return companionsFor(project, languageId, env.catalog, wordHost(env, w)).find(
      (c) => c.key === key
    )
  }
  const act: DeckActions = {
    pickOwn: (lpKey, dimId, valueId) => {
      if (!selected) return
      update(selected.id, (w) => {
        const l = specLexeme(project, w)
        const lp = l ? paradigmsFor(project, l).find((x) => lpKeyOf(x) === lpKey) : undefined
        const base =
          w.own?.lpKey === lpKey ? w.own.picks : lp ? defaultPicks(project, lp.paradigm) : {}
        return { ...w, own: { lpKey, picks: { ...base, [dimId]: valueId } } }
      })
    },
    clearOwn: () =>
      selected && update(selected.id, (w) => ({ ...w, own: null, surface: undefined })),
    pickCompanion: (key, dimId, valueId) => {
      if (!selected) return
      const c = companionOf(selected, key)
      if (!c) return
      update(selected.id, (w) => {
        const on = w.pieces.find((p) => p.companion?.paradigmId === key)
        if (on?.companion)
          return {
            ...w,
            pieces: w.pieces.map((p) =>
              p === on
                ? {
                    ...p,
                    companion: {
                      ...on.companion!,
                      picks: { ...on.companion!.picks, [dimId]: valueId }
                    }
                  }
                : p
            )
          }
        const picks = { ...defaultPicks(project, c.paradigm), [dimId]: valueId }
        return {
          ...w,
          pieces: [...w.pieces, companionPiece(c, c.lexemes[0].id, picks, nextSeq(w))]
        }
      })
    },
    companionWord: (key, lexemeId) =>
      selected &&
      update(selected.id, (w) => ({
        ...w,
        pieces: w.pieces.map((p) =>
          p.companion?.paradigmId === key ? { ...p, companion: { ...p.companion, lexemeId } } : p
        )
      })),
    clearCompanion: (key) =>
      selected &&
      update(selected.id, (w) => ({
        ...w,
        pieces: w.pieces.filter((p) => p.companion?.paradigmId !== key)
      })),
    toggle: (key, mode) => selected && toggleOn(selected, key, mode),
    mutation: (paradigmId, slotKey) =>
      selected &&
      update(selected.id, (w) => ({ ...w, mutation: slotKey ? { paradigmId, slotKey } : null })),
    removePiece: (id) =>
      selected &&
      update(selected.id, (w) => ({ ...w, pieces: w.pieces.filter((p) => p.id !== id) })),
    // 拖到哪一截上就排在那一截的位置（同一边才换）；拖过之后这一边都按手排的顺序
    reorder: (dragId, targetId) => {
      if (!selected) return
      update(selected.id, (w) => {
        const drag = w.pieces.find((p) => p.id === dragId)
        const target = w.pieces.find((p) => p.id === targetId)
        if (!drag || !target || drag.side !== target.side) return w
        const side = innerToOuter(w.pieces.filter((p) => p.side === drag.side)).filter(
          (p) => p !== drag
        )
        side.splice(side.indexOf(target), 0, drag)
        const order = new Map(side.map((p, i) => [p.id, i]))
        return {
          ...w,
          pieces: w.pieces.map((p) => (order.has(p.id) ? { ...p, order: order.get(p.id) } : p))
        }
      })
    },
    // 手打的词算作哪个词类：换了词类，原来挑的构形不作数
    setPos: (posId) =>
      selected && update(selected.id, (w) => ({ ...w, posId: posId || null, own: null })),
    // 单独拖上来的语素接到前一个词上
    attachPrev: () => {
      if (!selected || !env) return
      const i = words.findIndex((w) => w.id === selected.id)
      const host = [...words.slice(0, i)].reverse().find((w) => !w.hostId && !w.morphemeId)
      const marker = env.catalog.markers.find((x) => x.key === 'm:' + selected.morphemeId)
      if (!host || !marker) return
      const mode = modeOf(env.catalog, marker, hostPos(host))
      const gone = selected.id
      const previousClaim = tray.claims.find((claim) => claim.owner === 'w:' + gone)
      words = words.filter((w) => w.id !== gone)
      selectedId = host.id
      toggleOn(host, marker.key, mode)
      const owner = `piece:${host.id}:${marker.key}`
      const candidate = previousClaim
        ? candidates.find((item) => item.id === previousClaim.candidateId)
        : undefined
      if (candidate && activeOwners().includes(owner)) claim(candidate, owner)
    }
  }

  // ───── 拖：泡泡拖到上面那一行（落在哪两个词之间就插在哪；语素落在词上就贴到那个词上），上面的词也能拖着换位置 ─────
  let row = $state<HTMLElement | null>(null)
  let card = $state<HTMLElement | null>(null)
  let dropAt = $state<number | null>(null)
  /** 指针在第几个词前面：按每个词的中线算 */
  function indexAt(x: number): number {
    if (!row) return words.length
    const chips = [...row.querySelectorAll<HTMLElement>('.chip')]
    for (let i = 0; i < chips.length; i++) {
      const r = chips[i].getBoundingClientRect()
      if (x < r.left + r.width / 2) return i
    }
    return chips.length
  }
  function onDragOver(e: DragEvent): void {
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('text/x-qonlang-cand') && !types.includes('text/x-qonlang-chip')) return
    e.preventDefault()
    dropAt = indexAt(e.clientX)
  }
  function onDrop(e: DragEvent): void {
    const types = e.dataTransfer?.types ?? []
    if (!types.includes('text/x-qonlang-cand') && !types.includes('text/x-qonlang-chip')) return
    e.preventDefault()
    const at = indexAt(e.clientX)
    dropAt = null
    const cand = types.includes('text/x-qonlang-cand')
      ? e.dataTransfer?.getData('text/x-qonlang-cand')
      : ''
    if (types.includes('text/x-qonlang-cand')) {
      if (!cand) return
      let payload: { id?: unknown; translation?: unknown }
      try {
        const parsed: unknown = JSON.parse(cand)
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          !('id' in parsed) ||
          typeof parsed.id !== 'string' ||
          !('translation' in parsed) ||
          typeof parsed.translation !== 'string'
        )
          return
        payload = parsed
      } catch {
        return
      }
      if (payload.translation !== translation) return
      const c = floating.find((x) => x.id === payload.id)
      if (!c) return
      // 语素正好落在某个词上：贴到那个词上
      const chipEl = (e.target as Element | null)?.closest<HTMLElement>('.chip')
      const onto = chipEl ? words.find((w) => w.id === chipEl.dataset.id) : null
      add(c, at, onto && !onto.hostId && !onto.morphemeId ? onto : null)
      return
    }
    const chip = types.includes('text/x-qonlang-chip')
      ? e.dataTransfer?.getData('text/x-qonlang-chip')
      : ''
    if (!chip || !/^\d+$/.test(chip)) return
    const from = Number(chip)
    if (Number.isInteger(from) && from >= 0 && from < words.length) {
      const next = [...words]
      const [w] = next.splice(from, 1)
      next.splice(at > from ? at - 1 : at, 0, w)
      words = next
    }
  }

  /** 附着台上的小三角指着选中的那个词 */
  let caret = $state(32)
  $effect(() => {
    void selectedId
    void words.length
    void built
    const el = row?.querySelector<HTMLElement>('.chip.sel')
    if (!el || !card) return
    const r = el.getBoundingClientRect()
    const c = card.getBoundingClientRect()
    caret = Math.max(16, r.left - c.left + r.width / 2 - 14)
  })

  /** 泡泡的漂法：按候选的键散开一点，看着不整齐划一 */
  function drift(key: string): string {
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
    const dy = 3 + (h % 5)
    const dur = 3.2 + ((h >> 3) % 20) / 10
    const delay = -((h >> 5) % 30) / 10
    return `--dy:${dy}px;--dur:${dur}s;--delay:${delay}s`
  }

  async function done(): Promise<void> {
    if (
      !text.trim() ||
      !words.length ||
      !validOutput ||
      projectState.readOnly ||
      projectState.project !== owner ||
      !active ||
      projectState.currentLanguageId !== ownerLanguage
    )
      return
    const surfaces = new Map(
      (parsedDraft?.valid ? parsedDraft.words : formatted.words).map((word) => [word.id, word.form])
    )
    const result: BenchResult = {
      text,
      translation: translation.trim(),
      words: words
        .map((w) => {
          const b = built.get(w.id)
          const form = tokenize(surfaces.get(w.id) ?? formOf(w), tokenOptions).join(' ')
          const unchanged =
            w.loadedAnalysis &&
            canonicalG(formOf(w)).normalize('NFC').toUpperCase() ===
              canonicalG(w.loadedForm ?? '')
                .normalize('NFC')
                .toUpperCase()
          return {
            lexemeId: w.lexemeId,
            morphemeId: w.morphemeId,
            form,
            slotKey: unchanged ? w.loadedAnalysis!.slot : (b?.slotKey ?? null),
            morphs: unchanged ? w.loadedAnalysis!.morphs : b ? morphsOf(b) : undefined,
            analysis: unchanged ? w.loadedAnalysis : undefined
          }
        })
        .filter((word) => word.form)
    }
    const pending = unplacedPunctuationMissing(
      formatComposedText(formattingWords, baseLayout, formatting, project.settings.tokenizer).text,
      baseLayout.unplaced ?? '',
      result.text
    )
    if (pending) {
      const snapshot = JSON.stringify($state.snapshot(words))
      if (
        !(await ui.confirm(
          t('bench.unplacedConfirmTitle'),
          t('bench.unplacedConfirmBody', { marks: pending }),
          t('bench.saveCurrentText')
        ))
      )
        return
      if (
        projectState.project !== owner ||
        !active ||
        projectState.currentLanguageId !== ownerLanguage ||
        projectState.readOnly ||
        text !== result.text ||
        translation.trim() !== result.translation ||
        JSON.stringify($state.snapshot(words)) !== snapshot
      )
        return
    }
    ondone(result)
  }
  const glossOf = (c: ComposeCandidate): string => c.matched
</script>

<div class="bench">
  <div class="row head">
    <h2>{t('bench.title')}<HelpDot tip={t('bench.hint')} /></h2>
    <span class="badge">{kind === 'sentence' ? t('bench.forSentence') : t('bench.forPhrase')}</span>
    <div class="grow"></div>
    <button class="btn sm" onclick={oncancel}><X size={13} />{t('common.cancel')}</button>
    <button
      class="btn sm primary"
      disabled={!text.trim() || !words.length || !validOutput || projectState.readOnly}
      onclick={done}
      ><Check size={13} />{kind === 'sentence'
        ? t('bench.addSentence')
        : t('bench.addPhrase')}</button
    >
  </div>

  <!-- 上：拼出来的原文；每个词一块，上面写法、下面 gloss，附加的几段按组上色 -->
  <section class="card compose" bind:this={card}>
    <div class="label small muted">{t('bench.textLabel')}</div>
    <div
      class="words"
      class:empty={!words.length}
      bind:this={row}
      role="list"
      ondragover={onDragOver}
      ondragleave={() => (dropAt = null)}
      ondrop={onDrop}
    >
      {#each words as w, i (w.id)}
        {#if dropAt === i}<span class="caret"></span>{/if}
        {@const b = built.get(w.id)}
        <span
          class="chip"
          class:sel={w.id === selectedId}
          class:particle={!!w.hostId}
          data-id={w.id}
          role="listitem"
          draggable="true"
          ondragstart={(e) => e.dataTransfer?.setData('text/x-qonlang-chip', String(i))}
        >
          <GripVertical size={12} />
          <button class="chip-main" onclick={() => select(w)} title={t('bench.chipHint')}>
            {#each b?.parts ?? [] as p (p.id)}
              <span class="seg" class:core={p.groupId === 'core'} style="--h:{hue(p.groupId)}">
                <span class="data f">{p.form}</span>
                <span class="g">{p.gloss || ' '}</span>
              </span>
            {:else}
              <span class="seg core"><span class="data f">{formOf(w)}</span></span>
            {/each}
          </button>
          <button class="x" title={t('common.delete')} onclick={() => remove(w.id)}
            ><X size={11} /></button
          >
        </span>
      {/each}
      {#if dropAt === words.length}<span class="caret"></span>{/if}
      {#if !words.length}<span class="small muted">{t('bench.dropHere')}</span>{/if}
      <input
        class="input free"
        bind:value={free}
        placeholder={t('bench.freeWord')}
        onkeydown={(e) => e.key === 'Enter' && addFree()}
      />
    </div>
    <details class="format-options" bind:open={formatOpen}>
      <summary>{t('bench.formatOptions')}</summary>
      <div class="row format-controls">
        <label class="small"
          ><input type="checkbox" bind:checked={formatting.capitalize} onchange={applyFormat} />{t(
            'bench.capitalize'
          )}</label
        >
        <select
          class="select sm"
          aria-label={t('bench.punctuationSource')}
          bind:value={punctuationSource}
          onchange={refreshFormat}
        >
          {#if sourceLayout}<option value="original">{t('bench.punctuationOriginal')}</option
            >{/if}<option value="translation">{t('bench.punctuationTranslation')}</option><option
            value="none">{t('bench.punctuationNone')}</option
          >
        </select>
        <select
          class="select sm"
          aria-label={t('bench.punctuationStyle')}
          bind:value={formatting.punctuation}
          onchange={applyFormat}
        >
          <option value="auto">{t('bench.styleAuto')}</option><option value="preserve"
            >{t('bench.styleKeep')}</option
          ><option value="latin">{t('bench.styleLatin')}</option><option value="fullwidth"
            >{t('bench.styleFull')}</option
          >
        </select>
        <label class="small"
          ><input
            type="checkbox"
            bind:checked={formatting.defaultPeriod}
            onchange={applyFormat}
          />{t('bench.endPeriod')}</label
        >
      </div>
    </details>
    <label class="small muted" for="bench-final"
      >{t('bench.finalText')}<HelpDot tip={t('bench.finalHint')} /></label
    >
    <textarea
      id="bench-final"
      class="preview textarea data"
      data-bench-output
      rows="2"
      value={text}
      oninput={(e) => editOutput(e.currentTarget.value)}
    ></textarea>
    <div class="row">
      <button class="btn ghost sm" onclick={refreshFormat}>{t('bench.resetFormat')}</button
      >{#if !validOutput && text.trim()}<span class="small bad" role="alert"
          >{t('bench.finalMismatch')}</span
        >{:else if layout.unplaced}<span class="small muted"
          >{t('bench.unplacedPunctuation', { marks: layout.unplaced })}</span
        >{:else if formatted.review && text.trim()}<span class="small muted"
          >{t('bench.reviewPunctuation')}</span
        >{/if}
    </div>
    {#if deck && selected}
      <BenchDeck
        model={deck}
        title={deckTitle}
        gloss={deckGloss}
        posLabel={deckPos}
        kind={deckKind}
        posId={selected.posId ?? null}
        {posOptions}
        bind:expanded={deckOpen}
        {caret}
        {hue}
        {act}
      />
    {:else if words.length}
      <p class="small muted deck-hint">{t('bench.deckHint')}</p>
    {/if}
  </section>

  <!-- 中：译文 -->
  <section class="card">
    <label class="label small muted" for="bench-tr"
      >{t('bench.translationLabel')} · {glossLang}</label
    >
    <textarea
      id="bench-tr"
      class="textarea tr"
      rows="3"
      bind:value={translation}
      placeholder={t('bench.translationPlaceholder')}
    ></textarea>
    <!-- 译文里没对上任何词的部分：点一下跳到词库新建，释义先填好 -->
    {#if gaps.length}
      <div class="gaps" role="status">
        <span class="small gaps-label"><CircleAlert size={13} />{t('bench.gaps')}</span>
        {#each gaps as g (g.text)}
          <button
            class="btn sm gap"
            title={t('bench.gapCreate', { text: g.text })}
            onclick={() => createFor(g.text)}><BookPlus size={13} />{g.text}</button
          >
        {/each}
        <HelpDot tip={t('bench.gapsHelp')} />
      </div>
    {/if}
  </section>

  <!-- 下：候选词泡泡 -->
  <section class="bubbles-wrap">
    <div class="candidate-head row">
      <div
        class="label small muted grow"
        title={candidateView.truncated ? t('bench.candidateLimited') : undefined}
      >
        {t('bench.candidates')}{#if query.trim()}
          · {t('bench.candidateCount', {
            n: floating.length
          })}{/if}
        {#if candidateView.truncated}<HelpDot tip={t('bench.candidateLimited')} />{/if}
        {#if approximateCount || suggestions.approximateLimited}<HelpDot
            tip={t('bench.approximateHint')}
          />{/if}
      </div>
      <CandidateTrash
        items={stashed}
        {translation}
        onrestore={restoreCandidate}
        motion={flightRequest}
        bind:button={trashButton}
      />
    </div>
    <div
      class="bubbles"
      class:restore-hover={restoreHover}
      data-candidate-pool
      role="region"
      aria-label={t('bench.candidates')}
      ondragover={poolDragOver}
      ondragleave={() => (restoreHover = false)}
      ondrop={poolDrop}
    >
      {#if restoreHover}<span class="restore-drop small" role="status"
          >{t('bench.restoreDrop')}</span
        >{/if}
      {#each floating as c (c.id)}
        <button
          class="bubble"
          class:morph={!!c.morphemeId}
          class:approximate={!!c.approximate}
          data-candidate-approximate={c.approximate?.kind}
          style={drift(c.id)}
          data-candidate-key={c.id}
          draggable="true"
          ondragstart={(e) => candidateDragStart(e, c)}
          ondragend={candidateDragEnd}
          onclick={() => {
            if (!candidateDragging && performance.now() - dragEndedAt > 100) add(c)
          }}
          title={`${t('bench.bubbleTitle')} · ${t('bench.candidateLocation', { n: [...c.translation.slice(0, c.at)].length + 1 })}${c.approximate ? ' · ' + t('bench.approximateSource', { source: c.approximate.source, matched: c.matched }) : ''}`}
        >
          <span class="data">{c.surface}</span>
          <span class="tiny muted">{glossOf(c)}</span>
          {#if c.approximate}<span class="tiny approximation"
              >{t(`bench.approximateKinds.${c.approximate.kind}`)}</span
            >{/if}
        </button>
      {:else}
        <p class="small muted">
          {query.trim() ? t('bench.noCandidates') : t('bench.typeFirst')}
        </p>
      {/each}
    </div>
    <button
      class="btn sm add-all"
      disabled={!canAddAll}
      title={t('bench.approximateHint')}
      onclick={addAll}><Plus size={13} />{t('bench.addAll')}</button
    >
  </section>
</div>

<style>
  .bubble.approximate {
    border-style: dashed;
  }
  .approximation {
    font-size: 10px;
    opacity: 0.85;
  }
  .bench {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px;
    height: 100%;
    overflow: auto;
  }
  .head {
    gap: 8px;
  }
  .head h2 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .card {
    padding: 12px 14px;
  }
  .label {
    display: block;
    margin-bottom: 6px;
  }
  .words {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-height: 52px;
    padding: 6px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    align-items: center;
  }
  .words.empty {
    background: var(--bg-sunken);
  }
  /* 一个词一块：上面写法、下面 gloss（像逐词对照），选中的描边 */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 3px 2px 4px;
    border: 1px solid var(--border-strong);
    border-radius: 12px;
    background: var(--bg-elev);
    cursor: grab;
  }
  .chip.sel {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }
  /* 挂在别的词上的小品词：虚线，跟泡泡里的语素一个样子 */
  .chip.particle {
    border-style: dashed;
  }
  .chip :global(svg) {
    color: var(--text-3);
  }
  .chip-main {
    display: inline-flex;
    align-items: stretch;
    gap: 1px;
    padding: 0;
    border: 0;
    background: none;
    cursor: pointer;
    font: inherit;
    color: inherit;
  }
  .seg {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 1px 5px 0;
    border-radius: 6px;
    background: color-mix(in srgb, hsl(from var(--accent) calc(h + var(--h)) s l) 15%, transparent);
    border-bottom: 2px solid hsl(from var(--accent) calc(h + var(--h)) s l);
  }
  .seg.core {
    background: none;
    border-bottom-color: transparent;
  }
  .seg .f {
    font-size: 16px;
    line-height: 1.3;
  }
  .seg .g {
    font-size: 10.5px;
    color: var(--text-2);
    font-family: var(--font-gloss);
    white-space: nowrap;
    max-width: 12em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .x {
    border: 0;
    background: none;
    padding: 2px;
    cursor: pointer;
    border-radius: 50%;
    display: inline-flex;
  }
  .x:hover {
    background: var(--bg-hover);
  }
  .caret {
    width: 2px;
    align-self: stretch;
    background: var(--accent);
    border-radius: 1px;
  }
  .input.free {
    width: 140px;
    padding: 3px 8px;
    font-size: 13px;
  }
  .preview {
    margin-top: 8px;
    font-size: 20px;
  }
  .deck-hint {
    margin: 8px 0 0;
  }
  .textarea.tr {
    font-size: 16px;
  }
  /* 没找到对应词的那几段：一行提示，每段一个按钮 */
  .gaps {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }
  .gaps-label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--warn);
  }
  .gap {
    gap: 4px;
  }
  .bubbles-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .bubbles {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 12px;
    padding: 8px 2px 14px;
    min-height: 62px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    position: relative;
  }
  .candidate-head {
    min-height: 30px;
    gap: 8px;
  }
  .bubbles.restore-hover {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .restore-drop {
    width: 100%;
    color: var(--accent-text);
  }
  /* 泡泡：圆滚滚的，轻轻上下漂；拖到上面那一行固定下来，或者点一下接在末尾 */
  .bubble {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
    padding: 8px 14px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--accent-soft) 60%, var(--bg-elev));
    box-shadow: var(--shadow);
    cursor: grab;
    animation: drift var(--dur, 3.6s) ease-in-out var(--delay, 0s) infinite alternate;
    transition:
      border-color 0.12s,
      transform 0.12s;
  }
  .bubble:hover {
    border-color: var(--accent);
    animation-play-state: paused;
  }
  .bubble.morph {
    border-style: dashed;
  }
  .bubble .data {
    font-size: 16px;
  }
  @keyframes drift {
    from {
      transform: translateY(calc(var(--dy, 4px) * -1));
    }
    to {
      transform: translateY(var(--dy, 4px));
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bubble {
      animation: none;
    }
  }
  .add-all {
    align-self: flex-start;
  }
</style>
