<script lang="ts">
  /** 显示模式下的词条卡：只读、简约，把录入模式记录的信息排版出来 */
  import type { CustomFieldPosition, Id, Lexeme, Project, Sense } from '$lib/core/model'
  import type { FormsLayout } from '$lib/platform/types'
  import { ChevronDown, ChevronRight, List, ListTree, Table } from '@lucide/svelte'
  import { lexemeSlotGroups, paradigmDims, type LexemeSlot } from '$lib/engine/morph'
  import { sectionCollapsed, toggleSection } from '$lib/ui/section.svelte'
  import FormsView from '$lib/ui/FormsView.svelte'
  import { etymologyTypeLabel, orthoIpaLabel, pronText, relationLabel } from '$lib/ui/labels'
  import { blockSize, cardBlocks } from '$lib/ui/cardBlocks'
  import { customFieldScript, customFieldsFor, customItems } from '$lib/core/customFields'
  import { morphemeLabel } from '$lib/core/etymology'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { lexemeScript } from '$lib/script/render'
  import { ensureScriptFont, fontCss } from '$lib/script/fonts'
  import { registerShort } from '$lib/core/register'
  import { posStemSlotList, posText, sensePos } from '$lib/core/pos'

  /** 显示模式下屈折形那一块收没收起（录入模式那边另记，见 Lexicon 的 FORMS_FOLD_EDIT） */
  const FORMS_FOLD_ID = 'lex.forms:show'

  let {
    lexeme,
    project,
    onselect,
    highlight = '',
    controls = false
  }: {
    lexeme: Lexeme
    project: Project
    onselect?: (id: Id) => void
    /** 皮肤页预览：描边标出正在调的那一块（header 或 cardBlocks 里的键） */
    highlight?: string
    /** 词库的显示模式：屈折形那一块能收起、能换成表格或树形图（预览、悬浮卡里不给） */
    controls?: boolean
  } = $props()

  const l = $derived(lexeme)
  const glossLangs = $derived(project.settings.glossLanguages)
  /** 屈折形：列表、表格、树形图三选一（跟录入模式共用一个选择，记在本机） */
  const layout = $derived(controls ? (ui.prefs.formsLayout ?? 'list') : 'list')
  const setLayout = (v: FormsLayout): void => {
    ui.prefs.formsLayout = v
    void ui.savePrefs()
  }
  const formsFolded = $derived(controls && sectionCollapsed(FORMS_FOLD_ID))
  /** 按「这一套」（构形 + 变体）分组，表格 / 树形图按各自构形的维度排 */
  const groups = $derived(
    layout === 'list' || !controls ? [] : lexemeSlotGroups(project, l, glossLangs)
  )
  /** 不在任何槽位里的屈折形（自己加的）：表格、树形图下面照旧列出来 */
  const looseForms = $derived.by(() => {
    const keys = new Set(groups.flatMap((g) => g.slots.map((s) => s.key)))
    return filledForms.filter(([k]) => !keys.has(k))
  })
  // 留空的词干与屈折形不占位置
  const filledStems = $derived.by(() => {
    const slotNames = posStemSlotList(project, l.posId).map((st) => st.name.trim())
    const rank = (k: string): number => {
      const i = slotNames.indexOf(k)
      return i < 0 ? slotNames.length : i
    }
    return Object.entries(l.stems)
      .filter(([, v]) => v.trim())
      .map((e, i) => ({ e, i }))
      .sort((a, b) => rank(a.e[0]) - rank(b.e[0]) || a.i - b.i)
      .map((x) => x.e)
  })
  const filledForms = $derived(Object.entries(l.forms).filter(([, f]) => f.surface.trim()))
  /** 词干与屈折形排在一张表里：名字、写法、是不是推导出来的 */
  const formRows = $derived([
    ...filledStems.map(([k, v]) => ({
      k,
      v,
      derived: false,
      ipa: undefined as string | undefined
    })),
    ...filledForms.map(([k, f]) => ({ k, v: f.surface, derived: f.derived, ipa: f.ipa }))
  ])
  /** 表格、树形图下面照旧列出来的：词干和不属于任何槽位的屈折形 */
  const looseRows = $derived([
    ...filledStems.map(([k, v]) => ({ k, v, derived: false, ipa: undefined })),
    ...looseForms.map(([k, f]) => ({ k, v: f.surface, derived: f.derived, ipa: f.ipa }))
  ])
  const lang = $derived(project.languages.find((x) => x.id === l.languageId))
  const pos = $derived(project.posList.find((p) => p.id === l.posId))
  /** 各块的顺序：皮肤页里拖着排，没排过就用默认顺序 */
  const blocks = $derived(cardBlocks(ui.prefs.cardOrder))
  /** 每一块的字号（皮肤页里逐块调，px）；块里的字号都按 em 跟着走，比例不变 */
  const px = (key: string): string => `${blockSize(ui.prefs.cardBlockSize, key)}px`
  const features = $derived(
    Object.entries(l.features)
      .map(([cid, vid]) => {
        const c = project.categories.find((x) => x.id === cid)
        const v = c?.values.find((x) => x.id === vid)
        return c && v
          ? { cat: pickText(c.name, glossLangs), val: pickText(v.name, glossLangs), abbr: v.abbr }
          : null
      })
      .filter((x): x is { cat: string; val: string; abbr: string } => !!x)
  )
  const derivedWords = $derived(
    project.lexemes.filter((x) =>
      x.etymology.sources.some((s) => s.kind === 'lexeme' && s.id === l.id)
    )
  )
  const pron = $derived(
    lang
      ? lang.orthographies
          .map((o) => ({ name: o.name, p: l.pronunciations[o.id] }))
          .filter((x) => x.p?.ipa)
      : []
  )
  const dialects = $derived(lang ? lang.dialects.filter((d) => l.dialectIds.includes(d.id)) : [])
  const scripts = $derived(
    lang
      ? lang.scripts.map((sc) => ({ sc, text: lexemeScript(lang!, sc, l) })).filter((x) => x.text)
      : []
  )

  // 文字行、检视器模块用到的内嵌字体自己注册：开始页画廊悬浮时那个项目没打开，没人替它注册，文字行就是方框
  $effect(() => {
    for (const x of scripts) ensureScriptFont(x.sc)
    for (const f of customFieldsFor(project, l.languageId)) {
      const sc = customFieldScript(project, f)
      if (sc) ensureScriptFont(sc)
    }
  })

  /** 检视器模块：这门语言用得上、又填了内容的，带上字体 */
  const customs = $derived(
    customFieldsFor(project, l.languageId)
      .map((f) => {
        const sc = customFieldScript(project, f)
        return { f, value: (l.custom?.[f.id] ?? '').trim(), font: sc ? fontCss(sc) : undefined }
      })
      .filter((x) => x.value)
  )

  function sourceText(s: Lexeme['etymology']['sources'][number]): { text: string; id?: Id } {
    if (s.kind === 'morpheme') {
      const m = project.morphemes.find((x) => x.id === s.id)
      return { text: m ? `${morphemeLabel(m)}${m.gloss ? ` ‘${m.gloss}’` : ''}` : '?' }
    }
    if (s.kind === 'lexeme') {
      const x = project.lexemes.find((y) => y.id === s.id)
      return { text: x?.lemma ?? '?', id: x?.id }
    }
    return {
      text: `${s.language ? s.language + ' ' : ''}${s.form}${s.meaning ? ` ‘${s.meaning}’` : ''}`
    }
  }
  /** 语域方框里写什么：设置里选单字就取简写，选全称就整个写 */
  /** 这个义项的几个语域（去掉空的和重复的） */
  const regsOf = (s: Sense): string[] => [
    ...new Set((s.registers ?? []).map((r) => r.trim()).filter(Boolean))
  ]
  const regLabel = (r: string): string =>
    ui.prefs.registerDisplay === 'full' ? r.trim() : registerShort(r)
  function lemmaOf(id: Id): string {
    return project.lexemes.find((x) => x.id === id)?.lemma ?? '?'
  }
</script>

{#snippet customBlocks(where: CustomFieldPosition)}
  {#each customs.filter((x) => x.f.position === where) as x (x.f.id)}
    <section>
      <h4>{pickText(x.f.name, glossLangs)}</h4>
      {#if x.f.kind === 'list'}
        <div class="cf-items">
          {#each customItems(x.value) as it, i (i)}<span class="cf-item" style={x.font}>{it}</span
            >{/each}
        </div>
      {:else}
        <p class="cf-text" style={x.font}>{x.value}</p>
      {/if}
    </section>
  {/each}
{/snippet}

<article class="entry" class:has-img={!!l.images?.length}>
  {#if l.images?.[0]}
    <img
      class="hero"
      src={l.images[0].dataUrl}
      alt={l.images[0].caption}
      title={l.images[0].caption}
    />
  {/if}
  <header style:font-size={px('header')} data-block="header" class:hl={highlight === 'header'}>
    <h2 class="lemma data">{l.lemma || '—'}</h2>
    {#each scripts as x (x.sc.id)}<div
        class="scr"
        style={fontCss(x.sc)}
        dir={x.sc.direction === 'rtl' ? 'rtl' : 'ltr'}
        title={x.sc.name}
      >
        {x.text}
      </div>{/each}
    <div class="row meta">
      {#if pos}<span class="pos">{pos.abbr || pickText(pos.name, glossLangs)}</span>{/if}
      {#each pron as p, pi (pi)}<span class="ipa data" title={orthoIpaLabel(p.name, pron.length)}
          >{pronText(p.p.ipa)}{#if pron.length > 1}<span class="tiny">{p.name}</span>{/if}</span
        >{/each}
    </div>
    {#if features.length || dialects.length}
      <div class="chips">
        {#each features as f (f.cat)}<span class="chip" title={f.cat}
            >{f.val}{#if f.abbr && f.abbr !== f.val}<span class="tiny">{f.abbr}</span>{/if}</span
          >{/each}
        {#each dialects as d (d.id)}<span class="chip dia">{d.name}</span>{/each}
      </div>
    {/if}
  </header>

  {#if (l.images?.length ?? 0) > 1}
    <div class="thumbs">
      {#each l.images.slice(1) as im (im.id)}<img
          src={im.dataUrl}
          alt={im.caption}
          title={im.caption}
        />{/each}
    </div>
  {/if}

  {#snippet blockSenses()}
    {@render customBlocks('beforeSenses')}

    <ol class="senses">
      {#each l.senses as s (s.id)}
        {@const firstLang = glossLangs.find((g) => s.definition[g])}
        {@const sp = sensePos(project, l, s)}
        <li>
          {#each glossLangs as g (g)}
            {#if s.definition[g]}<p class="def" lang={g}>
                {#if g === firstLang}{#if sp}<span
                      class="spos"
                      title={pickText(sp.name, glossLangs)}>{posText(sp, glossLangs)}</span
                    >{/if}{#each regsOf(s) as r (r)}<span class="reg" title={r}>{regLabel(r)}</span
                    >{/each}{/if}{s.definition[g]}
              </p>{/if}
          {/each}
          {#if !firstLang && (regsOf(s).length || sp)}
            <p class="def">
              {#if sp}<span class="spos">{posText(sp, glossLangs)}</span
                >{/if}{#each regsOf(s) as r (r)}<span class="reg" title={r}>{regLabel(r)}</span
                >{/each}
            </p>
          {/if}
          {#if s.tags.length}
            <p class="tiny muted tags">{s.tags.join(' · ')}</p>
          {/if}
        </li>
      {/each}
    </ol>
    {@render customBlocks('afterSenses')}
  {/snippet}

  {#snippet blockTags()}
    {#if l.tags.length}
      <div class="chips">
        {#each l.tags as tg (tg)}<span class="chip tag">{tg}</span>{/each}
      </div>
    {/if}
  {/snippet}

  {#snippet blockEtymology()}
    {#if l.etymology.sources.length || l.etymology.stages.length || l.etymology.notes}
      <section>
        <h4>{t('lexicon.etymology')}</h4>
        <p class="ety">
          {#if l.etymology.type !== 'unknown'}<span class="muted"
              >{etymologyTypeLabel(l.etymology.type)}</span
            >{/if}
          {#each l.etymology.sources as s, i (i)}
            {@const st = sourceText(s)}
            {#if i > 0}<span class="muted">+</span>{/if}
            {#if st.id}<button class="link data" onclick={() => onselect?.(st.id!)}
                >{st.text}</button
              >{:else}<span class="data">{st.text}</span>{/if}
          {/each}
          {#each l.etymology.stages as st (st.id)}
            {#if st.form}<span class="muted">&gt;</span><span class="data">{st.form}</span>{/if}
          {/each}
          {#if l.etymology.sources.length || l.etymology.stages.length}
            <span class="muted">&gt;</span><span class="data">{l.lemma}</span>
          {/if}
        </p>
        {#if l.etymology.notes}<p class="small muted">{l.etymology.notes}</p>{/if}
      </section>
    {/if}
    {@render customBlocks('afterEtymology')}
  {/snippet}

  {#snippet formCell(s: LexemeSlot | null)}
    {@const f = s ? l.forms[s.key] : undefined}
    {#if f?.surface.trim()}
      <span class="data cellform"
        >{f.surface}{#if f.derived && ui.prefs.showDerivedMark}<span class="tiny muted">
            ⚙</span
          >{/if}{#if f.ipa}<span class="form-ipa">{pronText(f.ipa)}</span>{/if}</span
      >
    {:else}
      <span class="muted">—</span>
    {/if}
  {/snippet}

  {#snippet blockForms()}
    {#if filledStems.length || filledForms.length || (controls && groups.length)}
      <section>
        <h4>
          {t('lexicon.forms')}{#if controls}<button
              class="fold"
              class:on={formsFolded}
              title={formsFolded ? t('common.expand') : t('common.collapse')}
              aria-expanded={!formsFolded}
              onclick={() => toggleSection(FORMS_FOLD_ID)}
              >{#if formsFolded}<ChevronRight size={13} />{:else}<ChevronDown
                  size={13}
                />{/if}</button
            ><span class="seg forms-seg">
              <button
                class:active={layout === 'list'}
                title={t('lexicon.layoutList')}
                onclick={() => setLayout('list')}><List size={13} /></button
              ><button
                class:active={layout === 'table'}
                title={t('lexicon.layoutTable')}
                onclick={() => setLayout('table')}><Table size={13} /></button
              ><button
                class:active={layout === 'tree'}
                title={t('lexicon.layoutTree')}
                onclick={() => setLayout('tree')}><ListTree size={13} /></button
              ></span
            >{/if}
        </h4>
        {#if !formsFolded}
          {#if layout !== 'list' && groups.length}
            {#each groups as grp (grp.id)}
              {@const dims = paradigmDims(grp.lp.paradigm, project.categories, glossLangs)}
              {#if dims.length}
                {#if groups.length > 1}<div class="small para-head">{grp.name}</div>{/if}
                <FormsView {dims} slots={grp.slots} {layout} cell={formCell} />
              {/if}
            {/each}
          {/if}
          <!-- 名字一栏按最长的名字定宽、最多占 55%，更长的在 . 后面折行，不会压到右边的形式上 -->
          {#if layout === 'list' ? formRows.length : filledStems.length + looseForms.length}
            <div class="forms">
              {#each layout === 'list' ? formRows : looseRows as row, i (i)}
                <span class="fk" class:alt={i % 2 === 1}
                  >{#each row.k.split('.') as part, pi (pi)}{#if pi}.<wbr />{/if}{part}{/each}</span
                ><span class="fv data" class:alt={i % 2 === 1}
                  >{row.v}{#if row.derived && ui.prefs.showDerivedMark}<span class="tiny muted">
                      ⚙</span
                    >{/if}{#if row.ipa}<span class="form-ipa">{pronText(row.ipa)}</span>{/if}</span
                >
              {/each}
            </div>
          {/if}
        {/if}
      </section>
    {/if}
  {/snippet}

  {#snippet blockRelations()}
    {#if l.relations.length}
      <section>
        <h4>{t('lexicon.relations')}</h4>
        <ul class="rel">
          {#each l.relations as r, i (i)}
            <li>
              <span class="muted">{relationLabel(r.kind)}</span>
              <button class="link data" onclick={() => onselect?.(r.lexemeId)}
                >{lemmaOf(r.lexemeId)}</button
              >
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/snippet}

  {#snippet blockDerived()}
    {#if derivedWords.length}
      <section>
        <h4>{t('lexicon.derivedWords')}</h4>
        <p class="derivedWords">
          {#each derivedWords as d (d.id)}<button class="link data" onclick={() => onselect?.(d.id)}
              >{d.lemma}</button
            >{/each}
        </p>
      </section>
    {/if}
  {/snippet}

  {#snippet blockNotes()}
    {#if l.notes}
      <section>
        <h4>{t('common.notes')}</h4>
        <p class="small notes">{l.notes}</p>
      </section>
    {/if}
  {/snippet}

  <!-- 各块按皮肤页里排好的顺序画 -->
  {#each blocks as b (b)}
    <!-- display:contents：不占布局，只把这一块的字号传给里面 -->
    <div class="blk-scale" style:font-size={px(b)} data-block={b} class:hl={highlight === b}>
      {#if b === 'senses'}{@render blockSenses()}{:else if b === 'tags'}{@render blockTags()}{:else if b === 'etymology'}{@render blockEtymology()}{:else if b === 'forms'}{@render blockForms()}{:else if b === 'relations'}{@render blockRelations()}{:else if b === 'derived'}{@render blockDerived()}{:else}{@render blockNotes()}{/if}
    </div>
  {/each}
  {@render customBlocks('end')}
</article>

<style>
  .entry {
    display: flex;
    flex-direction: column;
    gap: 20px;
    position: relative;
    /* 默认字号（cardBlocks.ts 的 CARD_BASE_PX）；各块在皮肤页里单独调，里面的字号都按 em 跟着走 */
    font-size: 15px;
  }
  .blk-scale {
    display: contents;
  }
  /* 皮肤页里正在调的那一块 */
  header.hl,
  .blk-scale.hl > :global(*) {
    outline: 2px dashed var(--accent);
    outline-offset: 3px;
    border-radius: 4px;
  }
  .hero {
    position: absolute;
    top: 0;
    right: 0;
    width: 160px;
    max-height: 160px;
    object-fit: cover;
    border-radius: var(--radius-sm);
    border: 1px solid var(--border);
    box-shadow: var(--shadow);
  }
  .entry.has-img header {
    padding-right: 172px;
    min-height: 120px;
  }
  .thumbs {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .thumbs img {
    width: 96px;
    height: 72px;
    object-fit: cover;
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .scr {
    font-size: 1.6em;
    line-height: 1.3;
    margin: 2px 0 4px;
  }
  .lemma {
    font-size: 2em;
    font-weight: 500;
    line-height: 1.2;
  }
  .meta {
    gap: 10px;
    flex-wrap: wrap;
  }
  .pos {
    font-style: italic;
    color: var(--accent-text);
  }
  /* 勾了「影响发音」的槽位推出来的发音，跟在形式后面 */
  .form-ipa {
    margin-left: 0.5em;
    font-size: 0.85em;
    color: var(--text-2);
  }
  .ipa {
    color: var(--text-2);
  }
  .tiny {
    font-size: 0.67em;
    color: var(--text-3);
    margin-left: 4px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chip {
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--bg-sunken);
    font-size: 0.8em;
  }
  .chip.dia {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .chip.tag {
    border: 1px solid var(--border);
    background: transparent;
  }
  .senses {
    margin: 0;
    padding-left: 22px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .senses li::marker {
    color: var(--text-3);
    font-size: 0.8em;
  }
  .def {
    font-size: 1em;
    line-height: 1.6;
  }
  /* 语域：方框里一个字（或全称），像纸质词典的标签 */
  .reg {
    display: inline-block;
    min-width: 1.4em;
    padding: 0 3px;
    margin-right: 6px;
    border: 1px solid var(--text-3);
    border-radius: 3px;
    color: var(--text-2);
    font-size: 0.78em;
    line-height: 1.35;
    text-align: center;
    vertical-align: 0.1em;
    white-space: nowrap;
  }
  /* 义项自己的词类（跟词条不一样时）：淡淡地写在释义前面，不抢眼 */
  .spos {
    margin-right: 6px;
    font-style: italic;
    font-size: 0.86em;
    color: var(--text-3);
  }
  .tags {
    margin: 2px 0 0;
  }
  .def[lang='en'] {
    color: var(--text-2);
  }
  h4 {
    font-size: 0.73em;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-3);
    margin-bottom: 4px;
  }
  .ety {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: baseline;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
    font-size: inherit;
  }
  /* 屈折形块标题右边：收起的三角、列表 / 表格 / 树形图；平时淡，鼠标放到这一块上才显出来 */
  .fold,
  .forms-seg {
    vertical-align: middle;
    margin-left: 6px;
    opacity: 0;
    transition: opacity 0.12s;
  }
  .fold {
    border: 0;
    background: none;
    padding: 0 2px;
    color: var(--text-3);
    cursor: pointer;
  }
  .forms-seg button {
    padding: 2px 6px;
  }
  section:hover .fold,
  section:hover .forms-seg,
  .fold.on,
  .fold:focus-visible,
  .forms-seg:focus-within {
    opacity: 1;
  }
  .para-head {
    font-weight: 600;
    margin: 6px 0 2px;
  }
  .cellform {
    font-size: 0.95em;
  }
  .forms {
    display: grid;
    grid-template-columns: fit-content(55%) minmax(0, 1fr);
    font-size: 0.87em;
    margin-top: 4px;
  }
  .forms .fk {
    font-weight: 500;
    color: var(--text-2);
    padding: 4px 10px 4px 8px;
    overflow-wrap: anywhere;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }
  .forms .fv {
    padding: 4px 8px 4px 0;
    overflow-wrap: anywhere;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
  }
  .forms .alt {
    background: var(--bg-sunken);
  }
  .rel {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .derivedWords {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .notes {
    white-space: pre-wrap;
  }
  /* 检视器模块：列表一项一个框，文字照原样换行 */
  .cf-items {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .cf-item {
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    font-size: 1em;
  }
  .cf-text {
    font-size: 0.93em;
    line-height: 1.6;
    white-space: pre-wrap;
  }
</style>
