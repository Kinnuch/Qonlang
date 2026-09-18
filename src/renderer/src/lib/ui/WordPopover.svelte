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
  import { etymologyText, morphemeLabel } from '$lib/core/etymology'
  import { posText, sensePos } from '$lib/core/pos'
  import type { Id } from '$lib/core/model'
  import type { HoverChoice } from '$lib/state/wordHover.svelte'
  import { analyzeToken, glossIndexFor } from '$lib/engine/gloss'
  import { BookOpen, Blocks, X, TriangleAlert, SearchX, Pencil } from '@lucide/svelte'

  // 开始页的画廊没打开项目：用悬浮时带来的那个项目查词
  const project = $derived(wordHover.project ?? projectState.project)
  const lexeme = $derived(
    project && wordHover.lexemeId ? project.lexemes.find((l) => l.id === wordHover.lexemeId) : null
  )
  const morpheme = $derived(
    project && wordHover.morphemeId
      ? project.morphemes.find((m) => m.id === wordHover.morphemeId)
      : null
  )
  const glossLangs = $derived(project?.settings.glossLanguages ?? [])
  /** 卡片最初打开的那个（切分那一行按它算，悬浮到其中一块时不跟着换） */
  const baseItem = $derived.by(() => {
    if (!project) return null
    const b = wordHover.base
    return (
      (b.lexemeId ? project.lexemes.find((l) => l.id === b.lexemeId) : null) ??
      (b.morphemeId ? project.morphemes.find((m) => m.id === b.morphemeId) : null) ??
      lexeme ??
      morpheme ??
      null
    )
  })

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
    const ety = baseItem?.etymology
    if (!project || !ety) return []
    const out: Part[] = []
    for (const s of ety.sources) {
      if (s.kind === 'lexeme') {
        const x = project.lexemes.find((y) => y.id === s.id)
        if (x) out.push({ label: x.lemma, lexemeId: x.id })
      } else if (s.kind === 'morpheme') {
        const m = project.morphemes.find((y) => y.id === s.id)
        if (m)
          out.push({ label: (ety.type === 'root' ? '*' : '') + morphemeLabel(m), morphemeId: m.id })
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

  /** 「没有找到」时的搜索框：换了要指定的词就重新填上那个词本身（去掉两头的连字符、撇号、叹号这些符号） */
  let assignQuery = $derived(
    (wordHover.missing?.label ?? '').replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '')
  )
  const fold = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  interface AssignHit {
    key: string
    label: string
    kind: string
    gloss: string
    choice: HoverChoice
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
    // 写法能切开（几个词、词根加一串词缀连写）：先列出切法，挑一个就整个换成这几段
    const segs = analyzeToken(
      glossIndexFor(project, ctx.languageId),
      q,
      project.settings.morphemeBoundaries
    )
      .filter((a) => a.morphs.length > 1)
      .slice(0, 3)
    segs.forEach((a, i) =>
      hits.push({
        key: `s${i}`,
        label: a.morphs.map((m) => m.form).join('-'),
        kind: t('corpus.assignSplit'),
        gloss: a.morphs.map((m) => m.gloss).join('-'),
        choice: { analysis: a },
        score: -1
      })
    )
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

  /** 卡片放在词的下面还是上面，顺带算好定位样式 */
  const place = $derived.by(() => {
    const r = wordHover.rect
    if (!r) return { style: '', below: true }
    // 并排候选时按个数放宽，最多三列
    const W = cands.length > 1 ? Math.min(3, cands.length) * 250 + 24 : 380
    const H = 360
    let left = r.left
    if (left + W > window.innerWidth - 12) left = Math.max(12, window.innerWidth - W - 12)
    const below = r.bottom + 8
    // 放得下就贴着词的下面；放不下翻到上面时用 bottom 定位——卡片比上限矮时才不会离词老远
    if (below + H <= window.innerHeight - 12)
      return { style: `left:${left}px;top:${below}px;width:${W}px;max-height:${H}px`, below: true }
    const room = Math.max(140, r.top - 20)
    const gap = Math.max(12, window.innerHeight - r.top + 8)
    return {
      style: `left:${left}px;top:auto;bottom:${gap}px;width:${W}px;max-height:${Math.min(H, room)}px`,
      below: false
    }
  })
  const style = $derived(place.style)
  /** 词在上面（卡片画在下面）时切分条与「在词库中查看」都靠上，反过来都靠下——离鼠标近 */
  const chromeTop = $derived(place.below)
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

  /** 铅笔能不能点：语料页里能就地改（assign），开始页画廊能跳过去改（editAt） */
  const canEdit = $derived(!!wordHover.assign || !!wordHover.editAt)
  /**
   * 点了铅笔：卡片上正显示的这个词认错了——切分里正好是它的那一段（词条或语素对得上）就只改那一段，
   * 对不上任何一段（整词、没有切分）就改整个词。语料页里就地换成搜索框；开始页画廊先打开项目跳到那一句再改。
   */
  function editWord(): void {
    const i = wordHover.parts.findIndex(
      (p) =>
        (!!p.lexemeId && p.lexemeId === wordHover.lexemeId) ||
        (!!p.morphemeId && p.morphemeId === wordHover.morphemeId)
    )
    const index = i >= 0 ? i : null
    if (wordHover.assign) {
      const label =
        index !== null
          ? wordHover.parts[index].label
          : (wordHover.assign.surface ?? lexeme?.lemma ?? morphemeLabel(morpheme))
      wordHover.startEdit(index, label)
      return
    }
    const go = wordHover.editAt
    wordHover.hide(true)
    go?.(index)
  }
  /** 几个候选都不对：换成搜索框自己找 */
  function noneOfThese(): void {
    const surface = wordHover.assign?.surface
    if (surface) wordHover.startEdit(null, surface)
  }

  function openInLexicon(): void {
    const target = lexeme
      ? { lexemeId: lexeme.id, morphemeId: null, languageId: lexeme.languageId }
      : morpheme
        ? { lexemeId: null, morphemeId: morpheme.id, languageId: morpheme.languageId }
        : null
    if (!target) return
    // 收起卡片会清掉 opener，先拿到手
    const opener = wordHover.opener
    wordHover.hide(true)
    if (opener) opener(target)
    else if (target.lexemeId) ui.jump('lexicon', 'lexeme', target.lexemeId, target.languageId)
    else if (target.morphemeId)
      ui.jump('morphemes', 'morpheme', target.morphemeId, target.languageId)
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
      <TriangleAlert size={14} /><span class="grow"
        >{t('corpus.pickCandidate', { n: cands.length })}</span
      >
      {#if wordHover.assign?.surface}
        <button class="btn ghost sm" onclick={noneOfThese}
          ><Pencil size={13} />{t('corpus.noneOfThese')}</button
        >
      {/if}
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
            <strong class="data cand-lemma">{morphemeLabel(x.morpheme)}</strong>
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
    class:chrome-top={chromeTop}
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
            class:on={wordHover.missing?.index === i ||
              (!!p.lexemeId && p.lexemeId === wordHover.lexemeId) ||
              (!!p.morphemeId && p.morphemeId === wordHover.morphemeId)}
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
          <div class="miss-head" class:edit={miss.edit}>
            {#if miss.edit}<Pencil size={15} />{t('corpus.editWordHead', {
                w: miss.label
              })}{:else}<SearchX size={15} />{t('corpus.notFound', { w: miss.label })}{/if}
          </div>
          {#if wordHover.assign}
            <p class="small muted">
              {miss.edit ? t('corpus.editWordHint') : t('corpus.notFoundHint')}
            </p>
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
            <!-- 整个词才好换：切分里的一段换了写法，整句的词就对不上了 -->
            {#if miss.index === null}
              <label class="rewrite small" title={t('corpus.rewriteTextTitle')}>
                <input type="checkbox" bind:checked={wordHover.rewriteText} />
                {t('corpus.rewriteText')}
              </label>
            {/if}
          {/if}
        </div>
      {:else if lexeme}
        <LexemeCard {lexeme} project={project!} />
      {:else if morpheme}
        <div class="mor">
          <div class="row">
            <strong class="data big">{morphemeLabel(morpheme)}</strong>
            <span class="badge">{t(`morphemes.types.${morpheme.type}`)}</span>
            {#if morpheme.gloss}<span class="badge mono">{morpheme.gloss}</span>{/if}
          </div>
          <p>{pickText(morpheme.meaning, glossLangs)}</p>
          {#if morpheme.etymology.sources.length}
            <p class="small muted data">
              {etymologyText(project!, morpheme.etymology, morphemeLabel(morpheme))}
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
        {#if canEdit}
          <button class="btn sm" title={t('corpus.editWordTitle')} onclick={editWord}
            ><Pencil size={14} />{t('corpus.editWord')}</button
          >
        {/if}
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
  /* 拆解框不用按钮自带的样子：那个底色在深色下是暗灰，没选中的字看不清 */
  .parts .chip {
    cursor: pointer;
    font-family: var(--font-data);
    padding: 1px 8px;
    border: 1px solid var(--border-strong);
    border-radius: 999px;
    background: var(--bg-elev);
    color: var(--text);
    line-height: 1.5;
  }
  .parts .chip:hover {
    border-color: var(--accent);
    color: var(--accent-text);
  }
  .parts .chip.plain {
    cursor: default;
    color: var(--text-2);
  }
  .parts .chip.plain:hover {
    border-color: var(--border);
    color: var(--text-3);
  }
  .pgloss {
    margin-left: 4px;
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--text-2);
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
  .miss-head.edit {
    color: var(--accent-text);
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
  .rewrite {
    display: flex;
    align-items: center;
    gap: 6px;
    cursor: pointer;
    color: var(--text-2);
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
  /* 切分条与「在词库中查看」跟着词走：词在上面就都挤到卡片顶上，词在下面就都放到卡片底下 */
  .pop.chrome-top .parts {
    order: 1;
  }
  .pop.chrome-top .foot {
    order: 2;
    border-top: 0;
    border-bottom: 1px solid var(--border);
  }
  .pop.chrome-top .body {
    order: 3;
  }
  .pop:not(.chrome-top) .body {
    order: 1;
  }
  .pop:not(.chrome-top) .parts {
    order: 2;
    border-bottom: 0;
    border-top: 1px solid var(--border);
  }
  .pop:not(.chrome-top) .foot {
    order: 3;
  }
</style>
