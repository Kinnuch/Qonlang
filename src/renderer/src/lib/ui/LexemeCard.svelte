<script lang="ts">
  /** 显示模式下的词条卡：只读、简约，把录入模式记录的信息排版出来 */
  import type { Id, Lexeme, Project } from '$lib/core/model'
  import { t, pickText } from '$lib/i18n/index.svelte'

  let { lexeme, project, onselect }: { lexeme: Lexeme; project: Project; onselect?: (id: Id) => void } = $props()

  const l = $derived(lexeme)
  const glossLangs = $derived(project.settings.glossLanguages)
  const lang = $derived(project.languages.find((x) => x.id === l.languageId))
  const pos = $derived(project.posList.find((p) => p.id === l.posId))
  const features = $derived(
    Object.entries(l.features)
      .map(([cid, vid]) => {
        const c = project.categories.find((x) => x.id === cid)
        const v = c?.values.find((x) => x.id === vid)
        return c && v ? { cat: pickText(c.name, glossLangs), val: pickText(v.name, glossLangs), abbr: v.abbr } : null
      })
      .filter((x): x is { cat: string; val: string; abbr: string } => !!x)
  )
  const derivedWords = $derived(project.lexemes.filter((x) => x.etymology.sources.some((s) => s.kind === 'lexeme' && s.id === l.id)))
  const pron = $derived(lang ? lang.orthographies.map((o) => ({ name: o.name, p: l.pronunciations[o.id] })).filter((x) => x.p?.ipa) : [])
  const dialects = $derived(lang ? lang.dialects.filter((d) => l.dialectIds.includes(d.id)) : [])

  function sourceText(s: Lexeme['etymology']['sources'][number]): { text: string; id?: Id } {
    if (s.kind === 'morpheme') {
      const m = project.morphemes.find((x) => x.id === s.id)
      return { text: m ? `${m.form}${m.gloss ? ` ‘${m.gloss}’` : ''}` : '?' }
    }
    if (s.kind === 'lexeme') {
      const x = project.lexemes.find((y) => y.id === s.id)
      return { text: x?.lemma ?? '?', id: x?.id }
    }
    return { text: `${s.language ? s.language + ' ' : ''}${s.form}${s.meaning ? ` ‘${s.meaning}’` : ''}` }
  }
  function lemmaOf(id: Id): string {
    return project.lexemes.find((x) => x.id === id)?.lemma ?? '?'
  }
</script>

<article class="entry">
  <header>
    <h2 class="lemma data">{l.lemma || '—'}</h2>
    <div class="row meta">
      {#if pos}<span class="pos">{pos.abbr || pickText(pos.name, glossLangs)}</span>{/if}
      {#each pron as p (p.name)}<span class="ipa data">/{p.p.ipa}/{#if pron.length > 1}<span class="tiny">{p.name}</span>{/if}</span>{/each}
    </div>
    {#if features.length || dialects.length}
      <div class="chips">
        {#each features as f (f.cat)}<span class="chip" title={f.cat}>{f.val}{#if f.abbr}<span class="tiny">{f.abbr}</span>{/if}</span>{/each}
        {#each dialects as d (d.id)}<span class="chip dia">{d.name}</span>{/each}
      </div>
    {/if}
  </header>

  <ol class="senses">
    {#each l.senses as s (s.id)}
      <li>
        {#each glossLangs as g (g)}
          {#if s.definition[g]}<p class="def" lang={g}>{s.definition[g]}</p>{/if}
        {/each}
        {#if s.register || s.tags.length}
          <p class="tiny muted">{[s.register, ...s.tags].filter(Boolean).join(' · ')}</p>
        {/if}
      </li>
    {/each}
  </ol>

  {#if l.tags.length}
    <div class="chips">{#each l.tags as tg (tg)}<span class="chip tag">{tg}</span>{/each}</div>
  {/if}

  {#if l.etymology.protoForm || l.etymology.sources.length || l.etymology.notes}
    <section>
      <h4>{t('lexicon.etymology')}</h4>
      <p class="ety">
        {#if l.etymology.type !== 'unknown'}<span class="muted">{t(`lexicon.etyTypes.${l.etymology.type}`)}</span>{/if}
        {#if l.etymology.protoForm}<span class="data">*{l.etymology.protoForm}</span>{/if}
        {#each l.etymology.sources as s, i (i)}
          {@const st = sourceText(s)}
          <span class="muted">{i === 0 ? '←' : '+'}</span>
          {#if st.id}<button class="link data" onclick={() => onselect?.(st.id!)}>{st.text}</button>{:else}<span class="data">{st.text}</span>{/if}
        {/each}
      </p>
      {#if l.etymology.notes}<p class="small muted">{l.etymology.notes}</p>{/if}
    </section>
  {/if}

  {#if Object.keys(l.stems).length || Object.keys(l.forms).length}
    <section>
      <h4>{t('lexicon.forms')}</h4>
      <table class="forms">
        <tbody>
          {#each Object.entries(l.stems) as [k, v] (k)}
            <tr><th>{k}</th><td class="data">{v}</td></tr>
          {/each}
          {#each Object.entries(l.forms) as [k, f] (k)}
            <tr><th>{k}</th><td class="data">{f.surface}{#if f.derived}<span class="tiny muted"> ⚙</span>{/if}</td></tr>
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
          <li><span class="muted">{t(`lexicon.relKinds.${r.kind}`) === `lexicon.relKinds.${r.kind}` ? r.kind : t(`lexicon.relKinds.${r.kind}`)}</span> <button class="link data" onclick={() => onselect?.(r.lexemeId)}>{lemmaOf(r.lexemeId)}</button></li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if derivedWords.length}
    <section>
      <h4>{t('lexicon.derivedWordsWords')}</h4>
      <p class="derivedWords">
        {#each derivedWords as d (d.id)}<button class="link data" onclick={() => onselect?.(d.id)}>{d.lemma}</button>{/each}
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
    gap: 16px;
  }
  header {
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    gap: 6px;
  }
  .senses li::marker {
    color: var(--text-3);
    font-size: 12px;
  }
  .def {
    font-size: 15px;
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
  }
  .forms th {
    text-align: left;
    font-weight: 500;
    color: var(--text-2);
    padding: 2px 12px 2px 0;
    white-space: nowrap;
  }
  .forms td {
    padding: 2px 0;
  }
  .forms tr:nth-child(even) {
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
