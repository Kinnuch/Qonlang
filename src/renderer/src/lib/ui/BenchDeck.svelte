<script lang="ts" module>
  /**
   * 每一组一个颜色（跟着主题的主色转）：按这门语言里各组的先后（维度表的顺序在前），
   * 每组隔一个黄金角（137.5°），挨着的组颜色不会撞；同一组在词块、条带、药丸上颜色一样，
   * 一眼看得出这一截是哪一类
   */
  export function hueTable(ids: string[]): (id: string) => number {
    const table = new Map<string, number>()
    for (const id of ids)
      if (!table.has(id)) table.set(id, Math.round(((table.size + 1) * 137.508) % 360))
    return (id) => (id === 'core' ? 0 : (table.get(id) ?? 0))
  }

  export interface DeckActions {
    pickOwn: (lpKey: string, dimId: string, valueId: string) => void
    clearOwn: () => void
    pickCompanion: (key: string, dimId: string, valueId: string) => void
    companionWord: (key: string, lexemeId: string) => void
    clearCompanion: (key: string) => void
    toggle: (markerKey: string, mode: import('$lib/engine/attach').AttachMode) => void
    mutation: (paradigmId: string, slotKey: string | null) => void
    removePiece: (pieceId: string) => void
    reorder: (pieceId: string, targetId: string) => void
    attachPrev: () => void
    /** 手打的词算作哪个词类（空是不知道） */
    setPos: (posId: string | null) => void
  }
</script>

<script lang="ts">
  /**
   * 译文工作台的「附着台」：给选中的词挑构形、加词缀和小品词。
   * 只管摆和点：该列什么、怎么拼，都在 lib/engine/attach.ts 里算好（deckModel）
   */
  import { isWordMode, type DeckDim, type DeckGroup, type DeckModel } from '$lib/engine/attach'
  import { t } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  import { X } from '@lucide/svelte'

  let {
    model,
    title,
    gloss,
    posLabel,
    kind,
    posId = null,
    posOptions = [],
    caret = 32,
    hue,
    act
  }: {
    model: DeckModel
    title: string
    gloss: string
    posLabel: string
    /** 挂着词条的词 / 单独拖上来的语素 / 手打的词 */
    kind: 'lexeme' | 'morpheme' | 'free'
    /** 手打的词挑的词类 */
    posId?: string | null
    /** 手打的词能挑的词类 */
    posOptions?: { id: string; name: string }[]
    /** 小三角指着上面哪个词（离卡片左边多远） */
    caret?: number
    /** 每一组的色相（见 hueTable） */
    hue: (groupId: string) => number
    act: DeckActions
  } = $props()

  const groupLabel = (g: DeckGroup): string =>
    g.kind === 'universal'
      ? t(`bench.cat.${g.label}`)
      : g.kind === 'type'
        ? t(`morphemes.types.${g.label}`)
        : g.label || t('bench.funcWords')
  /** 展开了「+N」的组（换一个词还记着：同一组多半还要找同一类） */
  let opened = $state(new Set<string>())
  const toggleOpen = (id: string): void => {
    const next = new Set(opened)
    if (!next.delete(id)) next.add(id)
    opened = next
  }
  const othersCount = $derived(model.others.reduce((n, g) => n + g.markers.length, 0))
  const modeLabel = (m: string): string => t(`bench.mode.${m}`)

  // 条带里的附加成分拖着换先后
  let dragging = $state<string | null>(null)
  const pieceId = (id: string): string => id.replace(/:2$/, '')
</script>

<section class="deck" style="--caret:{caret}px" aria-label={t('bench.deckTitle')}>
  <div class="row wrap head">
    {#if kind === 'free' && posOptions.length}
      <!-- 手打的词：挑它算作哪个词类，就按那个词类的构形推、按它找能搭的 -->
      <select
        class="select xs pos"
        value={posId ?? ''}
        title={t('bench.posPick')}
        aria-label={t('bench.posPick')}
        onchange={(e) => act.setPos((e.currentTarget as HTMLSelectElement).value || null)}
      >
        <option value="">{t('bench.posUnknown')}</option>
        {#each posOptions as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
      </select>
    {:else}
      <span class="badge pos">{posLabel || t(`bench.kind.${kind}`)}</span>
    {/if}
    <span class="data lemma">{title}</span>
    {#if gloss}<span class="small muted">{gloss}</span>{/if}
    <HelpDot tip={t('bench.deckHelp')} />
  </div>

  <!-- 拼出来的样子：各段按组上色、下面写 gloss；附加的几段可以拖着换先后，点 × 去掉 -->
  <div class="strip" role="list" title={t('bench.stripHint')}>
    {#each model.built.parts as p (p.id)}
      {@const piece = p.id !== 'core'}
      <span
        class="seg"
        class:core={!piece}
        class:dragging={dragging === pieceId(p.id)}
        style="--h:{hue(p.groupId)}"
        role="listitem"
        draggable={piece}
        ondragstart={(e) => {
          if (!piece) return
          dragging = pieceId(p.id)
          e.dataTransfer?.setData('text/x-qonlang-piece', pieceId(p.id))
        }}
        ondragend={() => (dragging = null)}
        ondragover={(e) => {
          if (piece && dragging && dragging !== pieceId(p.id)) e.preventDefault()
        }}
        ondrop={(e) => {
          e.preventDefault()
          if (dragging && piece) act.reorder(dragging, pieceId(p.id))
          dragging = null
        }}
      >
        <span class="data f">{p.form}</span>
        <span class="g">{p.gloss || ' '}</span>
        {#if piece}
          <button
            class="x"
            title={t('bench.removePiece')}
            onclick={() => act.removePiece(pieceId(p.id))}><X size={10} /></button
          >
        {/if}
      </span>
    {/each}
    {#if model.built.missing}<span class="small warn">{t('bench.missing')}</span>{/if}
  </div>

  {#if kind === 'morpheme'}
    <p class="small muted">{t('bench.morphemeHint')}</p>
    <button class="btn sm" onclick={act.attachPrev}>{t('bench.attachPrev')}</button>
  {:else if kind === 'free'}
    <p class="small muted">{t('bench.freeHint')}</p>
  {/if}

  {#snippet lane(d: DeckDim, pick: (dimId: string, valueId: string) => void)}
    <div class="lane">
      <span class="lane-name" style="--h:{hue(d.groupId)}">{d.name}</span>
      <div class="pills">
        {#each d.values as v (v.id)}
          <button
            class="pill"
            class:on={v.selected}
            style="--h:{hue(d.groupId)}"
            disabled={!v.form}
            aria-pressed={v.selected}
            title={v.form ? `${v.name} → ${v.form}` : `${v.name}：${t('bench.missing')}`}
            onclick={() => pick(d.id, v.id)}
          >
            <span class="abbr">{v.abbr || v.name}</span>
            <span class="data fm">{v.form ?? '—'}</span>
          </button>
        {/each}
      </div>
    </div>
  {/snippet}

  {#each model.own as o (o.key)}
    <div class="sec">
      <div class="row sec-head">
        <span class="sec-title">{t('bench.own', { name: o.name })}</span>
        {#if o.active}<button class="btn ghost xs" onclick={act.clearOwn}
            >{t('bench.useBase')}</button
          >{/if}
      </div>
      {#each o.dims as d (d.id)}
        {@render lane(d, (dimId, valueId) => act.pickOwn(o.key, dimId, valueId))}
      {/each}
    </div>
  {/each}

  {#each model.companions as c (c.key)}
    <div class="sec">
      <div class="row wrap sec-head">
        <span class="sec-title"
          >{c.name === c.posName
            ? t('bench.companionPos', { pos: c.posName })
            : t('bench.companion', { pos: c.posName, name: c.name })}</span
        >
        {#if c.lexemes.length > 1}
          <select
            class="select xs"
            value={c.lexemeId}
            title={t('bench.companionWord')}
            onchange={(e) => act.companionWord(c.key, (e.currentTarget as HTMLSelectElement).value)}
          >
            {#each c.lexemes as l (l.id)}<option value={l.id}>{l.lemma}</option>{/each}
          </select>
        {/if}
        {#if c.active}<button class="btn ghost xs" onclick={() => act.clearCompanion(c.key)}
            >{t('bench.companionOff')}</button
          >{/if}
      </div>
      {#each c.dims as d (d.id)}
        {@render lane(d, (dimId, valueId) => act.pickCompanion(c.key, dimId, valueId))}
      {/each}
    </div>
  {/each}

  <!-- 一组一行：先摆出 shown 个（有根据的；全是猜的就摆几个），其余点「+N」展开；挑中的总摆着 -->
  {#snippet markerLane(g: DeckGroup)}
    {@const open = opened.has(g.id) || g.shown >= g.markers.length}
    {@const hidden = g.markers.length - g.shown}
    <div class="lane">
      <span class="lane-name" style="--h:{hue(g.id)}">{groupLabel(g)}</span>
      <div class="pills">
        {#each g.markers as m, i (m.key)}
          {#if open || i < g.shown || m.selected}
            <button
              class="pill mk"
              class:on={m.selected}
              class:word={isWordMode(m.mode)}
              class:weak={m.weak}
              style="--h:{hue(g.id)}"
              aria-pressed={m.selected}
              title={`${modeLabel(m.mode)} · ${t('bench.becomes', { form: m.preview })}${m.weak ? ' · ' + t('bench.guess') : ''}`}
              onclick={() => act.toggle(m.key, m.mode)}
            >
              <span class="data fm">{m.form}</span>
              <span class="gl">{m.gloss}</span>
            </button>
          {/if}
        {/each}
        {#if hidden > 0}
          <button
            class="more"
            aria-expanded={opened.has(g.id)}
            title={opened.has(g.id) ? t('bench.less') : t('bench.moreTitle', { n: hidden })}
            onclick={() => toggleOpen(g.id)}
            >{opened.has(g.id) ? t('bench.less') : t('bench.more', { n: hidden })}</button
          >
        {/if}
      </div>
    </div>
  {/snippet}

  {#if model.groups.length}
    <div class="sec">
      <div class="sec-head"><span class="sec-title">{t('bench.attach')}</span></div>
      {#each model.groups as g (g.id)}{@render markerLane(g)}{/each}
    </div>
  {/if}
  {#if othersCount}
    <details class="sec others">
      <summary class="small muted">{t('bench.others', { n: othersCount })}</summary>
      {#each model.others as g (g.id)}{@render markerLane(g)}{/each}
    </details>
  {/if}

  {#each model.mutations as mu (mu.paradigmId)}
    <div class="sec">
      <div class="lane">
        <span class="lane-name">{t('bench.mutation', { name: mu.name })}</span>
        <div class="pills">
          <button
            class="pill"
            class:on={!mu.slots.some((s) => s.selected)}
            onclick={() => act.mutation(mu.paradigmId, null)}
          >
            <span class="abbr">{t('bench.none')}</span>
            <span class="data fm">{mu.base}</span>
          </button>
          {#each mu.slots as s (s.key)}
            <button
              class="pill"
              class:on={s.selected}
              aria-pressed={s.selected}
              title={`${s.name} → ${s.form}`}
              onclick={() => act.mutation(mu.paradigmId, s.selected ? null : s.key)}
            >
              <span class="abbr">{s.abbr || s.name}</span>
              <span class="data fm">{s.form}</span>
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/each}
</section>

<style>
  /* 附着台：挂在选中的词下面，左上角一个小三角指着那个词 */
  .deck {
    position: relative;
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sunken);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .deck::before {
    content: '';
    position: absolute;
    top: -7px;
    left: calc(var(--caret) - 7px);
    width: 12px;
    height: 12px;
    background: var(--bg-sunken);
    border-left: 1px solid var(--border);
    border-top: 1px solid var(--border);
    transform: rotate(45deg);
  }
  .head {
    gap: 8px;
    align-items: baseline;
  }
  .pos {
    align-self: center;
  }
  .lemma {
    font-size: 17px;
  }
  /* 条带：拼出来的词一段段排开，上面是写法、下面是 gloss，按组上色 */
  .strip {
    display: flex;
    flex-wrap: wrap;
    align-items: stretch;
    gap: 2px;
  }
  .seg {
    position: relative;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    padding: 3px 8px 2px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, hsl(from var(--accent) calc(h + var(--h)) s l) 15%, transparent);
    border-bottom: 2px solid hsl(from var(--accent) calc(h + var(--h)) s l);
    cursor: grab;
  }
  .seg.core {
    background: var(--bg-elev);
    border-bottom-color: var(--border-strong);
    cursor: default;
  }
  .seg.dragging {
    opacity: 0.4;
  }
  .seg .f {
    font-size: 18px;
    line-height: 1.3;
  }
  .seg .g {
    font-size: 11px;
    color: var(--text-2);
    font-family: var(--font-gloss);
    white-space: nowrap;
  }
  .seg .x {
    position: absolute;
    top: -6px;
    inset-inline-end: -6px;
    display: none;
    padding: 1px;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--bg-elev);
    cursor: pointer;
  }
  .seg:hover .x {
    display: inline-flex;
  }
  .sec {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
  }
  .sec-head {
    gap: 8px;
  }
  .sec-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-2);
  }
  .lane {
    display: grid;
    grid-template-columns: minmax(64px, max-content) 1fr;
    gap: 8px;
    align-items: start;
  }
  .lane-name {
    font-size: 12.5px;
    padding-top: 5px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    white-space: nowrap;
  }
  .lane-name::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: hsl(from var(--accent) calc(h + var(--h, 0)) s l);
  }
  .pills {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  /* 药丸：上一行是取值（或语素的写法），下一行是挑了之后的样子（或 gloss） */
  .pill {
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    min-width: 44px;
    padding: 3px 9px 2px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--bg-elev);
    cursor: pointer;
    transition:
      border-color 0.12s,
      background 0.12s;
  }
  .pill:hover:not(:disabled) {
    border-color: hsl(from var(--accent) calc(h + var(--h, 0)) s l);
  }
  .pill.on {
    border-color: hsl(from var(--accent) calc(h + var(--h, 0)) s l);
    background: color-mix(
      in srgb,
      hsl(from var(--accent) calc(h + var(--h, 0)) s l) 22%,
      var(--bg-elev)
    );
    box-shadow: 0 0 0 2px
      color-mix(in srgb, hsl(from var(--accent) calc(h + var(--h, 0)) s l) 25%, transparent);
  }
  .pill:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  /* 单独成词的（小品词）虚线框，跟泡泡里的语素一个样子 */
  .pill.word {
    border-style: dashed;
  }
  /* 猜的（语料里没见过）：淡一点，挑中了就跟别的一样 */
  .pill.weak:not(.on) {
    opacity: 0.72;
  }
  .pill.weak:not(.on):hover {
    opacity: 1;
  }
  /* 「+N」：展开这一组其余的 */
  .more {
    align-self: center;
    padding: 2px 8px;
    border: 1px dashed var(--border-strong);
    border-radius: 10px;
    background: none;
    color: var(--text-2);
    font-size: 12px;
    cursor: pointer;
  }
  .more:hover {
    border-color: var(--accent);
    color: var(--text);
  }
  .pill .abbr {
    font-family: var(--font-gloss);
    font-size: 11.5px;
    letter-spacing: 0.02em;
  }
  .pill .fm {
    font-size: 13px;
  }
  .pill.mk .fm {
    font-size: 14px;
  }
  .pill .gl {
    font-size: 10.5px;
    color: var(--text-2);
    max-width: 10em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .others summary {
    cursor: pointer;
    padding: 2px 0;
  }
  .others[open] summary {
    margin-bottom: 6px;
  }
  .warn {
    color: var(--warn);
    align-self: center;
  }
  .btn.xs {
    padding: 1px 8px;
    font-size: 12px;
  }
  .select.xs {
    width: auto;
    padding: 1px 22px 1px 6px;
    font-size: 11.5px;
    background-position: right 6px center;
  }
</style>
