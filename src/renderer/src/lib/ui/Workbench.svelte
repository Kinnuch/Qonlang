<script lang="ts" module>
  /** 工作台拼好的一个词：挂着哪个词条 / 语素，用哪个形式（原形或某一格的屈折形） */
  export interface BenchWord {
    id: string
    lexemeId?: string
    morphemeId?: string
    /** 写进原文的形式 */
    form: string
    /** 用的是哪一格（词条 forms 里的键，跟分析里的 slot 一个口径）；原形是 null */
    slotKey: string | null
  }
  export interface BenchResult {
    text: string
    translation: string
    words: BenchWord[]
  }
</script>

<script lang="ts">
  /**
   * 译文工作台：先写译文，软件照着译文反查词库给出候选词（泡泡），
   * 把要用的拖到上面固定下来、挑好屈折形，拼出这句话的原文，一键加进语料或短语。
   * 候选怎么来的见 lib/engine/compose.ts；这里只管摆、拖、挑形式。
   */
  import { untrack } from 'svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { composeCandidates, joinForms, type ComposeCandidate } from '$lib/engine/compose'
  import { lexemeSlots } from '$lib/engine/morph'
  import { newId } from '$lib/core/factory'
  import { Check, X, Plus, GripVertical } from '@lucide/svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'

  let {
    languageId,
    initial = '',
    glossLang,
    kind,
    ondone,
    oncancel
  }: {
    languageId: string
    /** 进来时译文框里已经有的（检视器里写了一半的译文） */
    initial?: string
    /** 译文按哪种释义语言写（反查时它排最前） */
    glossLang: string
    kind: 'sentence' | 'phrase'
    ondone: (r: BenchResult) => void
    oncancel: () => void
  } = $props()

  const project = $derived(projectState.project!)
  // 进来时的译文只取一次：之后在工作台里改，不跟着检视器变
  let translation = $state(untrack(() => initial))
  let words = $state<BenchWord[]>([])
  let free = $state('')

  /** 反查放在输入停一下之后再做，打字时不卡 */
  let query = $state(untrack(() => initial))
  $effect(() => {
    const v = translation
    const timer = setTimeout(() => (query = v), 250)
    return () => clearTimeout(timer)
  })
  const langs = $derived([
    glossLang,
    ...project.settings.glossLanguages.filter((l) => l !== glossLang)
  ])
  const candidates = $derived(composeCandidates(project, languageId, query, langs))
  /** 已经拖上去的就不再漂着 */
  const floating = $derived(
    candidates.filter(
      (c) =>
        !words.some(
          (w) =>
            (c.lexemeId && w.lexemeId === c.lexemeId) ||
            (c.morphemeId && w.morphemeId === c.morphemeId)
        )
    )
  )
  const text = $derived(
    joinForms(
      words.map((w) => w.form),
      project.settings.tokenizer
    )
  )

  /** 词头写成 `bil-` 这种（词干、词缀的标记）的，放进句子时去掉两头的连字符 */
  const bare = (s: string): string => s.replace(/^[-=]+|[-=]+$/g, '')

  /** 一个词能用的形式：原形，加上这个词条已经推出来 / 填过的每一格屈折形 */
  function formsOf(w: BenchWord): { slotKey: string | null; label: string; form: string }[] {
    if (w.morphemeId) {
      const m = project.morphemes.find((x) => x.id === w.morphemeId)
      return m ? [{ slotKey: null, label: t('bench.base'), form: bare(m.form) }] : []
    }
    const l = project.lexemes.find((x) => x.id === w.lexemeId)
    if (!l) return [{ slotKey: null, label: t('bench.base'), form: w.form }]
    const out = [{ slotKey: null as string | null, label: t('bench.base'), form: bare(l.lemma) }]
    for (const s of lexemeSlots(project, l)) {
      const f = l.forms[s.key]?.surface?.trim()
      if (f) out.push({ slotKey: s.key, label: s.slot.abbr || s.slot.label, form: f })
    }
    return out
  }

  function toWord(c: ComposeCandidate): BenchWord {
    return {
      id: newId(),
      lexemeId: c.lexemeId,
      morphemeId: c.morphemeId,
      form: bare(c.surface),
      slotKey: null
    }
  }
  function add(c: ComposeCandidate, at = words.length): void {
    words = [...words.slice(0, at), toWord(c), ...words.slice(at)]
  }
  function addFree(): void {
    const f = free.trim()
    if (!f) return
    words = [...words, { id: newId(), form: f, slotKey: null }]
    free = ''
  }
  function remove(i: number): void {
    words = words.filter((_, k) => k !== i)
  }
  function setForm(i: number, value: string): void {
    const opts = formsOf(words[i])
    const o = opts.find((x) => (x.slotKey ?? '') === value)
    if (!o) return
    words[i] = { ...words[i], form: o.form, slotKey: o.slotKey }
  }

  // ───── 拖：泡泡拖到上面那一行（落在哪两个词之间就插在哪），上面的词也能拖着换位置 ─────
  let row = $state<HTMLElement | null>(null)
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
    e.preventDefault()
    const at = indexAt(e.clientX)
    dropAt = null
    const cand = e.dataTransfer?.getData('text/x-qonlang-cand')
    if (cand) {
      const c = candidates.find((x) => x.key === cand)
      if (c) add(c, at)
      return
    }
    const from = Number(e.dataTransfer?.getData('text/x-qonlang-chip'))
    if (Number.isInteger(from) && from >= 0 && from < words.length) {
      const next = [...words]
      const [w] = next.splice(from, 1)
      next.splice(at > from ? at - 1 : at, 0, w)
      words = next
    }
  }

  /** 泡泡的漂法：按候选的键散开一点，看着不整齐划一 */
  function drift(key: string): string {
    let h = 0
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
    const dy = 3 + (h % 5)
    const dur = 3.2 + ((h >> 3) % 20) / 10
    const delay = -((h >> 5) % 30) / 10
    return `--dy:${dy}px;--dur:${dur}s;--delay:${delay}s`
  }

  function done(): void {
    if (!text.trim()) return
    ondone({ text, translation: translation.trim(), words: $state.snapshot(words) })
  }
  const glossOf = (c: ComposeCandidate): string => c.matched
  const lexGloss = (w: BenchWord): string => {
    if (w.lexemeId) {
      const l = project.lexemes.find((x) => x.id === w.lexemeId)
      return l ? pickText(l.senses[0]?.definition, langs) : ''
    }
    if (w.morphemeId) return project.morphemes.find((x) => x.id === w.morphemeId)?.gloss ?? ''
    return ''
  }
</script>

<div class="bench">
  <div class="row head">
    <h2>{t('bench.title')}<HelpDot tip={t('bench.hint')} /></h2>
    <span class="badge">{kind === 'sentence' ? t('bench.forSentence') : t('bench.forPhrase')}</span>
    <div class="grow"></div>
    <button class="btn sm" onclick={oncancel}><X size={13} />{t('common.cancel')}</button>
    <button class="btn sm primary" disabled={!text.trim()} onclick={done}
      ><Check size={13} />{kind === 'sentence'
        ? t('bench.addSentence')
        : t('bench.addPhrase')}</button
    >
  </div>

  <!-- 上：拼出来的原文 -->
  <section class="card compose">
    <div class="label small muted">{t('bench.textLabel')}</div>
    <div
      class="row wrap words"
      class:empty={!words.length}
      bind:this={row}
      role="list"
      ondragover={onDragOver}
      ondragleave={() => (dropAt = null)}
      ondrop={onDrop}
    >
      {#each words as w, i (w.id)}
        {#if dropAt === i}<span class="caret"></span>{/if}
        {@const opts = formsOf(w)}
        <span
          class="chip"
          role="listitem"
          draggable="true"
          ondragstart={(e) => e.dataTransfer?.setData('text/x-qonlang-chip', String(i))}
          title={lexGloss(w)}
        >
          <GripVertical size={12} />
          <span class="data form">{w.form}</span>
          {#if opts.length > 1}
            <select
              class="select xs"
              value={w.slotKey ?? ''}
              title={t('bench.pickForm')}
              onchange={(e) => setForm(i, (e.currentTarget as HTMLSelectElement).value)}
            >
              {#each opts as o (o.slotKey ?? '')}<option value={o.slotKey ?? ''}
                  >{o.label} · {o.form}</option
                >{/each}
            </select>
          {/if}
          <button class="x" title={t('common.delete')} onclick={() => remove(i)}
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
    <div class="preview data" class:muted={!text}>{text || '—'}</div>
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
  </section>

  <!-- 下：候选词泡泡 -->
  <section class="bubbles-wrap">
    <div class="label small muted">
      {t('bench.candidates')}{#if query.trim()}
        · {t('bench.candidateCount', {
          n: floating.length
        })}{/if}
    </div>
    <div class="bubbles">
      {#each floating as c (c.key)}
        <button
          class="bubble"
          class:morph={!!c.morphemeId}
          style={drift(c.key)}
          draggable="true"
          ondragstart={(e) => e.dataTransfer?.setData('text/x-qonlang-cand', c.key)}
          onclick={() => add(c)}
          title={t('bench.bubbleTitle')}
        >
          <span class="data">{c.surface}</span>
          <span class="tiny muted">{glossOf(c)}</span>
        </button>
      {:else}
        <p class="small muted">
          {query.trim() ? t('bench.noCandidates') : t('bench.typeFirst')}
        </p>
      {/each}
    </div>
    <button
      class="btn sm add-all"
      disabled={!floating.length}
      onclick={() => floating.forEach((c) => add(c))}><Plus size={13} />{t('bench.addAll')}</button
    >
  </section>
</div>

<style>
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
    gap: 6px;
    min-height: 44px;
    padding: 6px;
    border: 1px dashed var(--border-strong);
    border-radius: var(--radius-sm);
    align-items: center;
  }
  .words.empty {
    background: var(--bg-sunken);
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px 3px 6px;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent-soft);
    cursor: grab;
  }
  .chip .form {
    font-size: 16px;
  }
  .chip :global(svg) {
    color: var(--text-3);
  }
  .select.xs {
    width: auto;
    padding: 1px 22px 1px 6px;
    font-size: 11.5px;
    background-position: right 6px center;
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
  .textarea.tr {
    font-size: 16px;
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
