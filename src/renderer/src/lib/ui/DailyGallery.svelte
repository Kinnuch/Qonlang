<script lang="ts">
  /**
   * 开始页的画廊：从最近打开的项目里抽语料例句、短语和带配图的词，一张一张换着看。
   * 顺序按当天的日期打乱，同一天打开第一张不变；左右两侧的箭头悬停才出现。几个项目里都抽不到就整块不显示。
   * 例句、短语里的词可以悬浮看词卡（用读进来的那个项目查），卡片底部的按钮先打开那个项目再跳过去。
   */
  import { onDestroy } from 'svelte'
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { ChevronLeft, ChevronRight } from '@lucide/svelte'
  import { platform, type RecentEntry } from '$lib/platform'
  import { parseProject } from '$lib/core/serialize'
  import type { Id, Project, Sentence, Token } from '$lib/core/model'
  import { analyzeToken, buildIndex, tokenize, type GlossIndex } from '$lib/engine/gloss'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { wordHover, type HoverPart } from '$lib/state/wordHover.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'

  let { recent }: { recent: RecentEntry[] } = $props()

  interface Source {
    entry: RecentEntry
    project: Project
    /** 语言 id → 分词索引（悬浮短语里的词时才建） */
    indexes: Map<Id, GlossIndex>
  }
  type Slide =
    | { kind: 'sentence'; key: string; source: number; sentence: Sentence; translation: string }
    | {
        kind: 'phrase'
        key: string
        source: number
        languageId: Id
        text: string
        translation: string
      }
    | {
        kind: 'image'
        key: string
        source: number
        lexemeId: Id
        languageId: Id
        lemma: string
        gloss: string
        image: string
      }

  /** 最多读几个最近打开的项目 */
  const MAX_SOURCES = 3
  /** 例句的词之间补一个空格（块两头的空白会被模板吃掉，用变量写进去） */
  const SPACE = ' '
  let sources = $state.raw<Source[]>([])
  let slides = $state.raw<Slide[]>([])
  let at = $state(0)
  let dir = $state(1)
  const slide = $derived(slides.length ? slides[at % slides.length] : null)
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

  // 最近打开的列表变了才重读；先让开始页画出来，再读文件
  let loadedFor = ''
  $effect(() => {
    const entries = recent.filter((r) => r.path).slice(0, MAX_SOURCES)
    const key = entries.map((r) => r.path).join('\n')
    if (key === loadedFor) return
    loadedFor = key
    const timer = setTimeout(() => void load(entries, key), 150)
    return () => clearTimeout(timer)
  })

  async function load(entries: RecentEntry[], key: string): Promise<void> {
    const got: Source[] = []
    for (const entry of entries) {
      try {
        const r = await platform.openRecent(entry)
        if (r) got.push({ entry, project: parseProject(r.content), indexes: new Map() })
      } catch {
        // 文件不在了、不是合法的项目：跳过这一个
      }
      if (key !== loadedFor) return
    }
    sources = got
    slides = shuffled(collect(got), daySeed())
    at = 0
  }

  function collect(list: Source[]): Slide[] {
    const out: Slide[] = []
    list.forEach((s, source) => {
      const p = s.project
      const langs = p.settings.glossLanguages
      // 同一个项目里原文一样的只留一张（短语常常就是从例句里摘的，例句那张能悬浮看词）
      const seen = new Set<string>()
      const fresh = (text: string): boolean => {
        const k = text.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase()
        if (!k || seen.has(k)) return false
        seen.add(k)
        return true
      }
      for (const x of p.sentences)
        if (fresh(x.text))
          out.push({
            kind: 'sentence',
            key: `${source}:s:${x.id}`,
            source,
            sentence: x,
            translation: pickText(x.translation, langs)
          })
      for (const x of p.phrasebook)
        if (fresh(x.text))
          out.push({
            kind: 'phrase',
            key: `${source}:p:${x.id}`,
            source,
            languageId: x.languageId,
            text: x.text,
            translation: pickText(x.translation, langs)
          })
      for (const l of p.lexemes) {
        const image = l.images.find((im) => im.dataUrl)?.dataUrl
        if (image)
          out.push({
            kind: 'image',
            key: `${source}:i:${l.id}`,
            source,
            lexemeId: l.id,
            languageId: l.languageId,
            lemma: l.lemma,
            gloss: pickText(l.senses[0]?.definition, langs),
            image
          })
      }
    })
    return out
  }

  /** 当天的种子：同一天打开，第一张是同一句 */
  function daySeed(): number {
    const d = new Date()
    const s = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
    let h = 2166136261
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
    return h >>> 0 || 1
  }
  function shuffled<T>(items: T[], seed: number): T[] {
    const a = [...items]
    let x = seed
    const rand = (): number => {
      x ^= x << 13
      x ^= x >>> 17
      x ^= x << 5
      return (x >>> 0) / 4294967296
    }
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

  function go(step: number): void {
    if (slides.length < 2) return
    wordHover.hide(true)
    dir = step
    at = (at + step + slides.length) % slides.length
  }

  /** 每张一种渐变：按这张的 key 挑，跟着主题的面板底色调深浅 */
  const GRADIENTS: [string, string][] = [
    ['var(--accent)', '#7c6cf2'],
    ['#f59e0b', '#ec4899'],
    ['#0ea5e9', 'var(--accent)'],
    ['#84cc16', '#0ea5e9'],
    ['#f43f5e', '#8b5cf6'],
    ['#14b8a6', '#f59e0b']
  ]
  function gradientOf(key: string): string {
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
    const [a, b] = GRADIENTS[h % GRADIENTS.length]
    return `background: linear-gradient(115deg, color-mix(in srgb, ${a} 30%, var(--bg-elev)), color-mix(in srgb, ${b} 26%, var(--bg-elev)))`
  }

  // ───── 悬浮词卡：用读进来的项目查，底部按钮先打开那个项目 ─────
  function useSource(src: Source): void {
    wordHover.project = src.project
    wordHover.opener = (target) => void openTarget(src, target)
  }
  async function openTarget(
    src: Source,
    target: { lexemeId: Id | null; morphemeId: Id | null; languageId: Id }
  ): Promise<void> {
    if (!(await projectState.openRecent(src.entry))) return
    if (target.lexemeId) ui.jump('lexicon', 'lexeme', target.lexemeId, target.languageId)
    else if (target.morphemeId)
      ui.jump('morphemes', 'morpheme', target.morphemeId, target.languageId)
  }
  const tokenLinked = (tk: Token): boolean => {
    const a = tk.analyses[tk.chosen]
    return !!a && (!!a.lexemeId || a.morphs.some((m) => m.morphemeId || m.lexemeId))
  }
  function hoverToken(e: MouseEvent, src: Source, tk: Token): void {
    const a = tk.analyses[tk.chosen]
    if (!a) return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const parts: HoverPart[] =
      a.morphs.length > 1
        ? a.morphs.map((m) => ({
            label: m.form,
            gloss: m.gloss,
            lexemeId: m.lexemeId ?? null,
            morphemeId: m.morphemeId
          }))
        : []
    const m = a.morphs.find((x) => x.lexemeId || x.morphemeId)
    const lexemeId = a.lexemeId ?? m?.lexemeId ?? null
    if (!lexemeId && !m?.morphemeId) return
    useSource(src)
    if (lexemeId) wordHover.show(lexemeId, rect, parts)
    else if (m?.morphemeId) wordHover.showMorpheme(m.morphemeId, rect, parts)
  }
  function phraseLexeme(src: Source, languageId: Id, word: string): Id | null {
    const w = tokenize(word)[0]
    if (!w) return null
    let idx = src.indexes.get(languageId)
    if (!idx) {
      idx = buildIndex(src.project, languageId)
      src.indexes.set(languageId, idx)
    }
    return (
      analyzeToken(idx, w, src.project.settings.morphemeBoundaries).find((a) => a.lexemeId)
        ?.lexemeId ?? null
    )
  }
  function hoverLexeme(e: MouseEvent, src: Source, id: Id | null): void {
    if (!id) return
    useSource(src)
    wordHover.show(id, (e.currentTarget as HTMLElement).getBoundingClientRect())
  }

  onDestroy(() => wordHover.hide(true))
</script>

{#if slide}
  {@const src = sources[slide.source]}
  <div class="gallery" role="region" aria-label={t('welcome.galleryLabel')}>
    {#key slide.key}
      <div
        class="slide"
        class:photo={slide.kind === 'image'}
        style={slide.kind === 'image' ? '' : gradientOf(slide.key)}
        in:fly={{ x: 56 * dir, duration: reduced ? 0 : 420, easing: cubicOut }}
        out:fly={{ x: -56 * dir, duration: reduced ? 0 : 420, easing: cubicOut }}
      >
        {#if slide.kind === 'image'}
          <div class="blur" style={`background-image: url("${slide.image}")`}></div>
          <div class="shade"></div>
        {/if}
        <div class="content">
          {#if slide.kind === 'sentence'}
            <span class="main data"
              >{#if slide.sentence.tokens.length}{#each slide.sentence.tokens as tk, i (i)}{#if i}{SPACE}{/if}<span
                    class="w"
                    class:link={tokenLinked(tk)}
                    role="link"
                    tabindex="-1"
                    onmouseenter={(e) => hoverToken(e, src, tk)}
                    onmouseleave={() => wordHover.hide()}>{tk.surface}</span
                  >{/each}{:else}{slide.sentence.text}{/if}</span
            >
          {:else if slide.kind === 'phrase'}
            {@const phrase = slide}
            <span class="main data"
              >{#each phrase.text.split(/(\s+)/) as w, i (i)}{#if w.trim()}{@const id =
                    phraseLexeme(src, phrase.languageId, w)}<span
                    class="w"
                    class:link={!!id}
                    role="link"
                    tabindex="-1"
                    onmouseenter={(e) => hoverLexeme(e, src, id)}
                    onmouseleave={() => wordHover.hide()}>{w}</span
                  >{:else}{w}{/if}{/each}</span
            >
          {:else}
            {@const pic = slide}
            <span
              class="main data w link"
              role="link"
              tabindex="-1"
              onmouseenter={(e) => hoverLexeme(e, src, pic.lexemeId)}
              onmouseleave={() => wordHover.hide()}>{pic.lemma}</span
            >
          {/if}
          {#if slide.kind === 'image' ? slide.gloss : slide.translation}
            <span class="sub">{slide.kind === 'image' ? slide.gloss : slide.translation}</span>
          {/if}
        </div>
        <span class="from">{src.project.meta.name}</span>
      </div>
    {/key}
    {#if slides.length > 1}
      <button
        class="nav prev"
        title={t('welcome.galleryPrev')}
        aria-label={t('welcome.galleryPrev')}
        onclick={() => go(-1)}><ChevronLeft size={18} /></button
      >
      <button
        class="nav next"
        title={t('welcome.galleryNext')}
        aria-label={t('welcome.galleryNext')}
        onclick={() => go(1)}><ChevronRight size={18} /></button
      >
    {/if}
  </div>
{/if}

<style>
  .gallery {
    position: relative;
    width: 100%;
    height: 84px;
    margin-bottom: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
    background: var(--bg-elev);
  }
  .slide {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    padding: 0 56px;
  }
  .content {
    position: relative;
    z-index: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
    flex: 1;
  }
  .main {
    font-size: 18px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .sub {
    font-size: 13px;
    color: var(--text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .from {
    position: absolute;
    z-index: 1;
    right: 56px;
    bottom: 6px;
    font-size: 11px;
    color: var(--text-3);
  }
  .w.link {
    cursor: pointer;
  }
  .w.link:hover {
    text-decoration: underline dotted;
    text-underline-offset: 3px;
  }
  /* 带配图的词：图片裁满横条再模糊，压一层暗色，字用白色 */
  .blur {
    position: absolute;
    inset: -24px;
    background-size: cover;
    background-position: center;
    filter: blur(14px);
    transform: scale(1.08);
  }
  .shade {
    position: absolute;
    inset: 0;
    background: linear-gradient(90deg, rgba(0, 0, 0, 0.55), rgba(0, 0, 0, 0.18));
  }
  .photo .main,
  .photo .sub,
  .photo .from {
    color: #fff;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
  }
  .photo .sub,
  .photo .from {
    color: rgba(255, 255, 255, 0.85);
  }
  .nav {
    position: absolute;
    z-index: 2;
    top: 50%;
    transform: translateY(-50%);
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: var(--text);
    background: color-mix(in srgb, var(--bg-elev) 55%, transparent);
    opacity: 0;
    cursor: pointer;
    transition:
      opacity 0.2s,
      background 0.2s;
  }
  .nav.prev {
    left: 12px;
  }
  .nav.next {
    right: 12px;
  }
  .gallery:hover .nav,
  .nav:focus-visible {
    opacity: 1;
  }
  .nav:hover {
    background: color-mix(in srgb, var(--bg-elev) 88%, transparent);
  }
</style>
