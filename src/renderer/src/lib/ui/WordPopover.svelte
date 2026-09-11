<script lang="ts">
  /**
   * 悬浮词卡：把词库显示模式的词条卡以浮层形式显示在某个词旁，可跳到词库。
   * 复合词与词根语素列成小块，点一下就切过去看那一部分。
   * 用法：wordHover.show(lexemeId, rect) / wordHover.showMorpheme(id, rect) / wordHover.hide()
   */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { wordHover } from '$lib/state/wordHover.svelte'
  import LexemeCard from './LexemeCard.svelte'
  import { etymologyText } from '$lib/core/etymology'
  import { posText, sensePos } from '$lib/core/pos'
  import type { Id } from '$lib/core/model'
  import { BookOpen, Blocks, X, TriangleAlert, SearchX } from '@lucide/svelte'

  const project = $derived(projectState.project)
  const lexeme = $derived(
    project && wordHover.lexemeId ? project.lexemes.find((l) => l.id === wordHover.lexemeId) : null
  )
  const morpheme = $derived(
    project && wordHover.morphemeId
      ? project.morphemes.find((m) => m.id === wordHover.morphemeId)
      : null
  )
  const glossLangs = $derived(project?.settings.glossLanguages ?? [])

  interface Part {
    label: string
    gloss?: string
    lexemeId?: Id | null
    morphemeId?: Id | null
    missing?: boolean
  }
  /** 组成部分：语料里已确认的切分优先，其次才是词源里的来源 */
  const parts = $derived.by((): Part[] => {
    if (wordHover.parts.length) return wordHover.parts
    const ety = lexeme?.etymology ?? morpheme?.etymology
    if (!project || !ety) return []
    const out: Part[] = []
    for (const s of ety.sources) {
      if (s.kind === 'lexeme') {
        const x = project.lexemes.find((y) => y.id === s.id)
        if (x) out.push({ label: x.lemma, lexemeId: x.id })
      } else if (s.kind === 'morpheme') {
        const m = project.morphemes.find((y) => y.id === s.id)
        if (m) out.push({ label: (ety.type === 'root' ? '*' : '') + m.form, morphemeId: m.id })
      }
    }
    return out
  })

  const cands = $derived(
    project
      ? wordHover.candidates.map((c) => ({
          c,
          lexeme: c.lexemeId ? project.lexemes.find((l) => l.id === c.lexemeId) : null,
          morpheme: c.morphemeId ? project.morphemes.find((m) => m.id === c.morphemeId) : null
        }))
      : []
  )
  const posAbbr = (id: Id | null): string => project?.posList.find((p) => p.id === id)?.abbr ?? ''

  /** 「没有找到」时的搜索框：换了要指定的词就重新填上那个词本身（去掉两头的连字符、撇号） */
  let assignQuery = $derived((wordHover.missing?.label ?? '').replace(/^[-=·'’]+|[-=·'’]+$/g, ''))
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  interface AssignHit {
    key: string
    label: string
    kind: string
    gloss: string
    choice: { lexemeId?: Id; morphemeId?: Id }
    score: number
  }
  /** 这门语言里写法或释义对得上的词条与语素：写法完全一样的排前面，最多八个 */
  const assignHits = $derived.by((): AssignHit[] => {
    const ctx = wordHover.assign
    const q = assignQuery.trim()
    if (!project || !wordHover.missing || !ctx || !q) return []
    const fq = fold(q)
    const lq = q.toLowerCase()
    const rank = (form: string, text: string): number => {
      const f = fold(form)
      if (f === fq) return 0
      if (f.startsWith(fq)) return 1
      if (f.includes(fq)) return 2
      return text.toLowerCase().includes(lq) ? 3 : -1
    }
    const hits: AssignHit[] = []
    for (const l of project.lexemes) {
      if (l.languageId !== ctx.languageId) continue
      const defs = l.senses.map((se) => pickText(se.definition, glossLangs)).filter(Boolean)
      const score = rank(l.lemma, defs.join('；'))
      if (score >= 0)
        hits.push({
          key: `l${l.id}`,
          label: l.lemma,
          kind: posAbbr(l.posId),
          gloss: defs.slice(0, 2).join('；'),
          choice: { lexemeId: l.id },
          score
        })
    }
    for (const m of project.morphemes) {
      if (m.languageId !== ctx.languageId) continue
      const meaning = pickText(m.meaning, glossLangs)
      const score = rank(m.form.replace(/^[-=·]+|[-=·]+$/g, ''), `${m.gloss} ${meaning}`)
      if (score >= 0)
        hits.push({
          key: `m${m.id}`,
          label: m.form,
          kind: t(`morphemes.types.${m.type}`),
          gloss: [m.gloss, meaning].filter(Boolean).join(' '),
          choice: { morphemeId: m.id },
          score
        })
    }
    return hits.sort((a, b) => a.score - b.score || a.label.length - b.label.length).slice(0, 8)
  })

  const style = $derived.by(() => {
    const r = wordHover.rect
    if (!r) return ''
    // 并排候选时按个数放宽，最多三列
    const W = cands.length > 1 ? Math.min(3, cands.length) * 250 + 24 : 380
    const H = 360
    let left = r.left
    if (left + W > window.innerWidth - 12) left = Math.max(12, window.innerWidth - W - 12)
    const below = r.bottom + 8
    const top = below + H > window.innerHeight - 12 ? Math.max(12, r.top - H - 8) : below
    return `left:${left}px;top:${top}px;width:${W}px;max-height:${H}px`
  })
  let popEl = $state<HTMLElement | null>(null)
  // 钉住之后：点别处或按 Esc 收起
  $effect(() => {
    if (!wordHover.pinned) return
    const onDown = (e: PointerEvent): void => {
      if (popEl && !popEl.contains(e.target as Node)) wordHover.hide(true)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') wordHover.hide(true)
    }
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  })

  function openInLexicon(): void {
    if (lexeme) {
      const id = lexeme.id
      const langId = lexeme.languageId
      wordHover.hide(true)
      ui.jump('lexicon', 'lexeme', id, langId)
    } else if (morpheme) {
      const id = morpheme.id
      const langId = morpheme.languageId
      wordHover.hide(true)
      ui.jump('morphemes', 'morpheme', id, langId)
    }
  }
</script>

{#if cands.length > 1 && wordHover.rect}
  <div
    class="pop card multi"
    bind:this={popEl}
    {style}
    role="dialog"
    tabindex="-1"
    onmouseenter={() => wordHover.keep()}
    onmouseleave={() => wordHover.hide()}
  >
    <div class="cands-head">
      <TriangleAlert size={14} />{t('corpus.pickCandidate', { n: cands.length })}
    </div>
    <div class="cands">
      {#each cands as x, i (i)}
        <div class="cand">
          {#if x.lexeme}
            <div class="row">
              <strong class="data cand-lemma">{x.lexeme.lemma}</strong>
              {#if posAbbr(x.lexeme.posId)}<span class="badge">{posAbbr(x.lexeme.posId)}</span>{/if}
            </div>
            <ol class="cand-senses">
              {#each x.lexeme.senses.slice(0, 4) as se (se.id)}
                {@const sp = project ? sensePos(project, x.lexeme, se) : undefined}
                <li>
                  {#if sp}<span class="spos">{posText(sp, glossLangs)}</span>{/if}{pickText(
                    se.definition,
                    glossLangs
                  )}
                </li>
              {/each}
            </ol>
          {:else if x.morpheme}
            <strong class="data cand-lemma">{x.morpheme.form}</strong>
            <p class="small">{x.morpheme.gloss} {pickText(x.morpheme.meaning, glossLangs)}</p>
          {/if}
          <button class="btn sm pick" onclick={() => wordHover.pick(x.c)}
            >{t('corpus.pickThis')}</button
          >
        </div>
      {/each}
    </div>
  </div>
{:else if (lexeme || morpheme || wordHover.missing) && wordHover.rect}
  <div
    class="pop card"
    class:miss={!!wordHover.missing}
    bind:this={popEl}
    {style}
    role="dialog"
    tabindex="-1"
    onmouseenter={() => wordHover.keep()}
    onmouseleave={() => wordHover.hide()}
  >
    {#if wordHover.pinned}
      <button class="pin-close btn ghost icon sm" onclick={() => wordHover.hide(true)}
        ><X size={14} /></button
      >
    {/if}
    {#if parts.length}
      <div class="parts">
        <Blocks size={12} />
        {#each parts as p, i (p.label + i)}
          <button
            class="chip"
            class:plain={!p.lexemeId && !p.morphemeId && !p.missing}
            class:missing={p.missing}
            class:on={wordHover.missing?.index === i}
            title={p.missing ? t('corpus.partMissing') : (p.gloss ?? '')}
            onmouseenter={() => (p.lexemeId || p.morphemeId) && wordHover.swap(p)}
            onclick={() =>
              p.missing
                ? wordHover.openMissing(i)
                : (p.lexemeId || p.morphemeId) && wordHover.swap(p)}
            >{p.label}{#if p.gloss && p.gloss !== '?'}<span class="pgloss">{p.gloss}</span
              >{:else if p.missing}<span class="pgloss">?</span>{/if}</button
          >
        {/each}
      </div>
    {/if}
    <div class="body">
      {#if wordHover.missing}
        {@const miss = wordHover.missing}
        <div class="missing">
          <div class="miss-head">
            <SearchX size={15} />{t('corpus.notFound', { w: miss.label })}
          </div>
          {#if wordHover.assign}
            <p class="small muted">{t('corpus.notFoundHint')}</p>
            <input
              class="input"
              placeholder={t('corpus.assignSearch')}
              bind:value={assignQuery}
              onfocus={() => (wordHover.pinned = true)}
            />
            <div class="assign-list">
              {#each assignHits as h (h.key)}
                <button class="assign-item" onclick={() => wordHover.choose(h.choice)}>
                  <strong class="data">{h.label}</strong>
                  {#if h.kind}<span class="badge">{h.kind}</span>{/if}
                  <span class="small muted ellipsis">{h.gloss}</span>
                </button>
              {:else}
                <p class="small muted">{t('corpus.assignNone')}</p>
              {/each}
            </div>
          {/if}
        </div>
      {:else if lexeme}
        <LexemeCard {lexeme} project={project!} />
      {:else if morpheme}
        <div class="mor">
          <div class="row">
            <strong class="data big">{morpheme.form}</strong>
            <span class="badge">{t(`morphemes.types.${morpheme.type}`)}</span>
            {#if morpheme.gloss}<span class="badge mono">{morpheme.gloss}</span>{/if}
          </div>
          <p>{pickText(morpheme.meaning, glossLangs)}</p>
          {#if morpheme.etymology.sources.length}
            <p class="small muted data">
              {etymologyText(project!, morpheme.etymology, morpheme.form)}
            </p>
          {/if}
          {#if morpheme.notes}<p class="small muted">{morpheme.notes}</p>{/if}
        </div>
      {/if}
    </div>
    {#if !wordHover.missing}
      <div class="foot">
        <button class="btn sm" onclick={openInLexicon}
          ><BookOpen size={14} />{morpheme
            ? t('corpus.openInMorphemes')
            : t('corpus.openInLexicon')}</button
        >
      </div>
    {/if}
  </div>
{/if}

<style>
  .pop.multi {
    border-color: var(--warn);
    min-height: 0;
  }
  .cands-head {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--warn-soft);
    color: var(--warn);
    font-size: 13px;
    font-weight: 600;
    border-bottom: 1px solid var(--warn);
  }
  .cands {
    display: flex;
    gap: 10px;
    padding: 10px 12px 12px;
    overflow: auto;
  }
  .cand {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 8px 10px;
    border: 1px dashed var(--warn);
    border-radius: var(--radius-sm);
    background: var(--bg);
  }
  .cand-lemma {
    font-size: 18px;
  }
  .cand-senses {
    margin: 0;
    padding-left: 18px;
    font-size: 13px;
    flex: 1;
  }
  .spos {
    margin-right: 4px;
    font-style: italic;
    font-size: 0.9em;
    color: var(--text-3);
  }
  .cand .pick {
    align-self: flex-start;
    border-color: var(--warn);
    color: var(--warn);
  }
  .pop {
    position: fixed;
    z-index: 70;
    /* 切换成分时高度会变，给个下限，免得卡片突然缩到鼠标外面 */
    min-height: 180px;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    animation: rise 0.14s ease-out;
    overflow: hidden;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .body {
    padding: 14px 16px 8px;
    overflow: auto;
    flex: 1;
    min-height: 0;
    font-size: 13px;
  }
  .body :global(.lemma) {
    font-size: 22px;
  }
  .mor .big {
    font-size: 20px;
  }
  .mor p {
    margin: 4px 0 0;
  }
  .parts {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    padding: 8px 12px 6px;
    padding-right: 36px;
    border-bottom: 1px solid var(--border);
    background: var(--bg-sunken);
    color: var(--text-3);
  }
  .parts .chip {
    cursor: pointer;
    font-family: var(--font-data);
  }
  .parts .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .parts .chip.plain {
    cursor: default;
    color: var(--text-3);
  }
  .parts .chip.plain:hover {
    border-color: var(--border);
    color: var(--text-3);
  }
  .pgloss {
    margin-left: 4px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--text-3);
  }
  .pin-close {
    position: absolute;
    top: 6px;
    right: 6px;
    z-index: 2;
  }
  .pop.miss {
    border-color: var(--warn);
  }
  .parts .chip.missing {
    border-style: dashed;
    border-color: var(--warn);
    color: var(--warn);
  }
  .parts .chip.on {
    background: var(--warn-soft);
  }
  .missing {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .miss-head {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--warn);
    font-size: 14px;
    font-weight: 600;
  }
  .missing p {
    margin: 0;
  }
  .assign-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 190px;
    overflow: auto;
  }
  .assign-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    min-width: 0;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--bg);
    color: inherit;
    text-align: left;
    cursor: pointer;
  }
  .assign-item:hover {
    border-color: var(--accent);
  }
  .ellipsis {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .foot {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
</style>
