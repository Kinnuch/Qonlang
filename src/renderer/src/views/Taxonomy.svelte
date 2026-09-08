<script lang="ts">
  /** 词类与语法维度：全部是项目数据，软件不预设任何一个 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { newId } from '$lib/core/factory'
  import type { GrammaticalCategory, PartOfSpeech } from '$lib/core/model'
  import LocalizedInput from '$lib/ui/LocalizedInput.svelte'
  import { Plus, Trash2, X } from '@lucide/svelte'

  const project = $derived(projectState.project!)
  const glossLangs = $derived(project.settings.glossLanguages)

  function posUse(p: PartOfSpeech): number {
    return project.lexemes.filter((l) => l.posId === p.id).length
  }
  function catUse(c: GrammaticalCategory): number {
    return (
      project.lexemes.filter((l) => c.id in l.features).length +
      project.morphemes.filter((m) => c.id in m.features).length
    )
  }

  function addPos(): void {
    project.posList.push({ id: newId(), name: {}, abbr: '', paradigmId: null })
    projectState.touch()
  }
  function removePos(p: PartOfSpeech): void {
    const idx = project.posList.indexOf(p)
    const snap = $state.snapshot(p) as PartOfSpeech
    project.posList.splice(idx, 1)
    projectState.touch()
    ui.toast(t('taxonomy.deletedPos', { name: pickText(snap.name, glossLangs) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.posList.splice(Math.min(idx, project.posList.length), 0, snap)
          projectState.touch()
        }
      }
    })
  }
  function addCategory(): void {
    project.categories.push({ id: newId(), name: {}, values: [] })
    projectState.touch()
  }
  function removeCategory(c: GrammaticalCategory): void {
    const idx = project.categories.indexOf(c)
    const snap = $state.snapshot(c) as GrammaticalCategory
    project.categories.splice(idx, 1)
    projectState.touch()
    ui.toast(t('taxonomy.deletedCategory', { name: pickText(snap.name, glossLangs) }), {
      action: {
        label: t('common.undo'),
        run: () => {
          project.categories.splice(Math.min(idx, project.categories.length), 0, snap)
          projectState.touch()
        }
      }
    })
  }
</script>

<div class="tax">
  <section>
    <div class="row head">
      <h3 class="grow">{t('taxonomy.pos')}</h3>
      <button class="btn sm" onclick={addPos}><Plus size={14} />{t('taxonomy.addPos')}</button>
    </div>
    {#each project.posList as p (p.id)}
      <div class="card item">
        <div class="grow">
          <LocalizedInput
            bind:value={p.name}
            languages={glossLangs}
            placeholder={t('taxonomy.posName')}
            onchange={() => projectState.touch()}
          />
        </div>
        <div class="field abbr">
          <label for={`pos-abbr-${p.id}`}>{t('taxonomy.abbr')}</label>
          <input
            id={`pos-abbr-${p.id}`}
            class="input mono"
            bind:value={p.abbr}
            oninput={() => projectState.touch()}
          />
        </div>
        <span class="small muted use">{t('taxonomy.inUse', { n: posUse(p) })}</span>
        <button
          class="btn ghost icon sm danger"
          title={t('common.delete')}
          onclick={() => removePos(p)}><Trash2 size={14} /></button
        >
      </div>
    {/each}
  </section>

  <section>
    <div class="row head">
      <h3 class="grow">{t('taxonomy.categories')}</h3>
      <button class="btn sm" onclick={addCategory}
        ><Plus size={14} />{t('taxonomy.addCategory')}</button
      >
    </div>
    <p class="small muted">{t('taxonomy.categoriesHint')}</p>
    {#each project.categories as c (c.id)}
      <div class="card cat">
        <div class="row">
          <div class="grow">
            <LocalizedInput
              bind:value={c.name}
              languages={glossLangs}
              placeholder={t('taxonomy.categoryName')}
              onchange={() => projectState.touch()}
            />
          </div>
          <span class="small muted use">{t('taxonomy.inUse', { n: catUse(c) })}</span>
          <button
            class="btn ghost icon sm danger"
            title={t('common.delete')}
            onclick={() => removeCategory(c)}><Trash2 size={14} /></button
          >
        </div>
        <div class="values">
          <span class="small muted">{t('taxonomy.values')}</span>
          {#each c.values as v, i (v.id)}
            <div class="row val">
              {#each glossLangs as lg (lg)}
                <input
                  class="input"
                  placeholder={`${t('taxonomy.valueName')} (${lg})`}
                  bind:value={v.name[lg]}
                  oninput={() => projectState.touch()}
                />
              {/each}
              <input
                class="input mono abbr-in"
                placeholder={t('taxonomy.valueAbbr')}
                bind:value={v.abbr}
                oninput={() => projectState.touch()}
              />
              <button
                class="btn ghost icon sm"
                onclick={() => {
                  c.values.splice(i, 1)
                  projectState.touch()
                }}><X size={14} /></button
              >
            </div>
          {/each}
          <button
            class="btn ghost sm self-start"
            onclick={() => {
              c.values.push({ id: newId(), name: {}, abbr: '' })
              projectState.touch()
            }}><Plus size={14} />{t('taxonomy.addValue')}</button
          >
        </div>
      </div>
    {/each}
  </section>
</div>

<style>
  .tax {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 900px;
  }
  .head {
    margin-bottom: 8px;
  }
  .item {
    display: flex;
    gap: 12px;
    align-items: flex-start;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .abbr {
    width: 120px;
    margin: 0;
  }
  .use {
    white-space: nowrap;
    padding-top: 8px;
  }
  .cat {
    padding: 10px 12px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .values {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-left: 12px;
    border-left: 2px solid var(--border);
  }
  .val {
    gap: 6px;
  }
  .abbr-in {
    width: 110px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .self-start {
    align-self: flex-start;
  }
</style>
