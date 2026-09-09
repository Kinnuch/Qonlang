<script lang="ts">
  /** 语素的只读卡片：显示模式与悬浮词卡共用 */
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { etymologyText } from '$lib/core/etymology'
  import type { Id, Morpheme, Project } from '$lib/core/model'

  let {
    morpheme,
    project,
    onselect
  }: { morpheme: Morpheme; project: Project; onselect?: (id: Id) => void } = $props()

  const glossLangs = $derived(project.settings.glossLanguages)
  const features = $derived(
    Object.entries(morpheme.features)
      .map(([cid, vid]) => {
        const c = project.categories.find((x) => x.id === cid)
        const v = c?.values.find((x) => x.id === vid)
        return v ? { key: cid, label: pickText(v.name, glossLangs) || v.abbr } : null
      })
      .filter((x): x is { key: string; label: string } => !!x)
  )
  const usedBy = $derived(
    project.lexemes.filter((l) =>
      l.etymology.sources.some((s) => s.kind === 'morpheme' && s.id === morpheme.id)
    )
  )
  const hasEtymology = $derived(
    morpheme.etymology.sources.length > 0 ||
      morpheme.etymology.stages.length > 0 ||
      !!morpheme.etymology.notes
  )
</script>

<article class="mcard">
  <header>
    <div class="row head">
      <strong class="form data">{morpheme.form}</strong>
      {#if morpheme.type === 'circumfix' && morpheme.form2}
        <span class="form data">…{morpheme.form2}</span>
      {/if}
      <span class="badge">{t(`morphemes.types.${morpheme.type}`)}</span>
      {#if morpheme.gloss}<span class="badge mono">{morpheme.gloss}</span>{/if}
    </div>
    <p class="meaning">{pickText(morpheme.meaning, glossLangs) || '—'}</p>
    {#if features.length || morpheme.tags.length}
      <div class="chips">
        {#each features as f (f.key)}<span class="chip">{f.label}</span>{/each}
        {#each morpheme.tags as tg (tg)}<span class="chip tag">{tg}</span>{/each}
      </div>
    {/if}
  </header>

  {#if morpheme.allomorphs.length}
    <section>
      <h4>{t('morphemes.allomorphs')}</h4>
      <table class="pairs">
        <tbody>
          {#each morpheme.allomorphs as a, i (i)}
            <tr><th class="data">{a.form}</th><td class="mono small">{a.environment}</td></tr>
          {/each}
        </tbody>
      </table>
    </section>
  {/if}

  {#if hasEtymology}
    <section>
      <h4>{t('lexicon.etymology')}</h4>
      <p class="ety data">
        <span class="muted">{t(`lexicon.etyTypes.${morpheme.etymology.type}`)}</span>
        {etymologyText(project, morpheme.etymology, morpheme.form)}
      </p>
      {#if morpheme.etymology.notes}<p class="small muted">{morpheme.etymology.notes}</p>{/if}
    </section>
  {/if}

  {#if morpheme.notes}
    <section>
      <h4>{t('common.notes')}</h4>
      <p class="small">{morpheme.notes}</p>
    </section>
  {/if}

  {#if usedBy.length}
    <section>
      <h4>{t('morphemes.usedBy')}</h4>
      <div class="chips">
        {#each usedBy.slice(0, 40) as l (l.id)}
          <button class="chip data" onclick={() => onselect?.(l.id)}>{l.lemma}</button>
        {/each}
        {#if usedBy.length > 40}<span class="small muted">…{usedBy.length}</span>{/if}
      </div>
    </section>
  {/if}
</article>

<style>
  .mcard {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    gap: 6px;
    flex-wrap: wrap;
  }
  .form {
    font-size: 22px;
    font-weight: 600;
  }
  .meaning {
    margin: 4px 0 0;
  }
  h4 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-3);
  }
  section {
    border-top: 1px solid var(--border);
    padding-top: 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 4px;
  }
  .chip {
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    background: var(--bg-elev);
    color: inherit;
  }
  button.chip {
    cursor: pointer;
  }
  button.chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .pairs {
    border-collapse: collapse;
  }
  .pairs th {
    text-align: left;
    padding: 1px 10px 1px 0;
    font-weight: 600;
  }
  .ety {
    margin: 0;
  }
  .mono {
    font-family: var(--font-mono);
  }
  p {
    margin: 0;
  }
</style>
