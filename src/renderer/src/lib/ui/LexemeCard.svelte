<script lang="ts">
  /** 显示模式下的词条卡：只读、简约，把录入模式记录的信息排版出来 */
  import type { Id, Lexeme, Project, Sense } from '$lib/core/model'
  import { relationLabel } from '$lib/ui/labels'
  import { morphemeLabel } from '$lib/core/etymology'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { lexemeScript } from '$lib/script/render'
  import { fontCss } from '$lib/script/fonts'
  import { registerShort } from '$lib/core/register'

  let {
    lexeme,
    project,
    onselect
  }: { lexeme: Lexeme; project: Project; onselect?: (id: Id) => void } = $props()

  const l = $derived(lexeme)
  const glossLangs = $derived(project.settings.glossLanguages)
  // 留空的词干与屈折形不占位置
  const filledStems = $derived(Object.entries(l.stems).filter(([, v]) => v.trim()))
  const filledForms = $derived(Object.entries(l.forms).filter(([, f]) => f.surface.trim()))
  const lang = $derived(project.languages.find((x) => x.id === l.languageId))
  const pos = $derived(project.posList.find((p) => p.id === l.posId))
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

<article class="entry" class:has-img={!!l.images?.length}>
  {#if l.images?.[0]}
    <img
      class="hero"
      src={l.images[0].dataUrl}
      alt={l.images[0].caption}
      title={l.images[0].caption}
    />
  {/if}
  <header>
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
      {#each pron as p (p.name)}<span class="ipa data"
          >/{p.p.ipa}/{#if pron.length > 1}<span class="tiny">{p.name}</span>{/if}</span
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

  <ol class="senses">
    {#each l.senses as s (s.id)}
      {@const firstLang = glossLangs.find((g) => s.definition[g])}
      <li>
        {#each glossLangs as g (g)}
          {#if s.definition[g]}<p class="def" lang={g}>
              {#if g === firstLang}{#each regsOf(s) as r (r)}<span class="reg" title={r}
                    >{regLabel(r)}</span
                  >{/each}{/if}{s.definition[g]}
            </p>{/if}
        {/each}
        {#if !firstLang && regsOf(s).length}
          <p class="def">
            {#each regsOf(s) as r (r)}<span class="reg" title={r}>{regLabel(r)}</span>{/each}
          </p>
        {/if}
        {#if s.tags.length}
          <p class="tiny muted tags">{s.tags.join(' · ')}</p>
        {/if}
      </li>
    {/each}
  </ol>

  {#if l.tags.length}
    <div class="chips">
      {#each l.tags as tg (tg)}<span class="chip tag">{tg}</span>{/each}
    </div>
  {/if}

  {#if l.etymology.sources.length || l.etymology.stages.length || l.etymology.notes}
    <section>
      <h4>{t('lexicon.etymology')}</h4>
      <p class="ety">
        {#if l.etymology.type !== 'unknown'}<span class="muted"
            >{t(`lexicon.etyTypes.${l.etymology.type}`)}</span
          >{/if}
        {#each l.etymology.sources as s, i (i)}
          {@const st = sourceText(s)}
          {#if i > 0}<span class="muted">+</span>{/if}
          {#if st.id}<button class="link data" onclick={() => onselect?.(st.id!)}>{st.text}</button
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

  {#if filledStems.length || filledForms.length}
    <section>
      <h4>{t('lexicon.forms')}</h4>
      <table class="forms">
        <tbody>
          {#each filledStems as [k, v] (k)}
            <tr><th>{k}</th><td class="data">{v}</td></tr>
          {/each}
          {#each filledForms as [k, f] (k)}
            <tr
              ><th>{k}</th><td class="data"
                >{f.surface}{#if f.derived && ui.prefs.showDerivedMark}<span class="tiny muted">
                    ⚙</span
                  >{/if}</td
              ></tr
            >
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

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

  {#if l.notes}
    <section>
      <h4>{t('common.notes')}</h4>
      <p class="small notes">{l.notes}</p>
    </section>
  {/if}
</article>

<style>
  .entry {
    display: flex;
    flex-direction: column;
    gap: 20px;
    position: relative;
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
    font-size: 24px;
    line-height: 1.3;
    margin: 2px 0 4px;
  }
  .lemma {
    font-size: 30px;
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
  .ipa {
    color: var(--text-2);
  }
  .tiny {
    font-size: 10px;
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
    font-size: 12px;
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
    font-size: 12px;
  }
  .def {
    font-size: 15px;
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
  .tags {
    margin: 2px 0 0;
  }
  .def[lang='en'] {
    color: var(--text-2);
  }
  h4 {
    font-size: 11px;
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
  .forms {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
    table-layout: fixed;
  }
  .forms th {
    text-align: left;
    font-weight: 500;
    color: var(--text-2);
    padding: 4px 10px 4px 8px;
    white-space: nowrap;
    width: 40%;
    border-radius: var(--radius-sm) 0 0 var(--radius-sm);
  }
  .forms td {
    padding: 4px 8px 4px 0;
    border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
    word-break: break-word;
  }
  .forms tr:nth-child(even) th,
  .forms tr:nth-child(even) td {
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
</style>
