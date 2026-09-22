<script lang="ts">
  /**
   * 「生成到词库」：构形推出来的形式点一下弹出来的新词条表单。
   * 词源（派生 ← 原来的词条）、关系（派生 → 原来的词条）已经按构形填好，词头、词类、构形、释义、标签可以现填；
   * 也能不填这些，直接只生成形式、词源和关系（词库里会标红提醒缺释义）。
   */
  import { newLexeme } from '$lib/state/newLexeme.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { createDerivedLexeme } from '$lib/core/derivedEntry'
  import { posName } from '$lib/core/pos'
  import { deriveLexemeForms, makeContext, paradigmsFor } from '$lib/engine/morph'
  import { FilePlus2 } from '@lucide/svelte'

  const project = $derived(projectState.project)
  const req = $derived(newLexeme.req)
  const glossLangs = $derived(project?.settings.glossLanguages ?? [])
  const para = $derived(project?.paradigms.find((p) => p.id === req?.paradigmId) ?? null)
  const paraName = $derived(para ? pickText(para.name, glossLangs) || t('paradigms.untitled') : '')

  let lemma = $state('')
  let posId = $state('')
  let paradigmId = $state('')
  let defs = $state<Record<string, string>>({})
  let tags = $state('')
  // 每次打开都从这个形式重新填
  $effect(() => {
    const r = newLexeme.req
    lemma = r?.form ?? ''
    posId = ''
    paradigmId = ''
    defs = {}
    tags = ''
  })
  const existing = $derived(
    project && req
      ? project.lexemes.find((l) => l.languageId === req.languageId && l.lemma === lemma.trim())
      : undefined
  )

  function close(): void {
    newLexeme.close()
  }
  function generate(full: boolean): void {
    const p = project
    const r = req
    if (!p || !r || !lemma.trim()) return
    const l = createDerivedLexeme({
      languageId: r.languageId,
      lemma,
      base: r.base,
      paradigmName: paraName,
      slotLabel: r.slotLabel,
      posId: full ? posId || null : null,
      paradigmId: full ? paradigmId || null : null,
      definitions: full ? defs : {},
      tags: full ? tags.split(/[,，、;；]/) : []
    })
    p.lexemes.push(l)
    const lang = p.languages.find((x) => x.id === l.languageId)
    if (lang && paradigmsFor(p, l).length) deriveLexemeForms(makeContext(p, lang), l)
    projectState.touch()
    close()
    const id = l.id
    const languageId = l.languageId
    ui.toast(t('newLexeme.done', { lemma: l.lemma }), {
      action: {
        label: t('newLexeme.show'),
        run: () => ui.jump('lexicon', 'lexeme', id, languageId)
      }
    })
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }
</script>

<svelte:window onkeydown={req ? onKey : undefined} />

{#if req && project}
  <div class="backdrop" role="presentation" onclick={close}></div>
  <div class="dlg card" role="dialog" aria-modal="true" aria-label={t('newLexeme.title')}>
    <div class="row head">
      <FilePlus2 size={16} />
      <strong class="grow">{t('newLexeme.title')}</strong>
    </div>
    <label class="field">
      <span class="small muted">{t('lexicon.lemma')}</span>
      <input class="input data" bind:value={lemma} />
    </label>
    {#if existing}
      <p class="small warn">{t('newLexeme.exists', { lemma: existing.lemma })}</p>
    {/if}
    <div class="row two">
      <label class="field grow">
        <span class="small muted">{t('lexicon.colPos')}</span>
        <select class="select" bind:value={posId}>
          <option value="">—</option>
          {#each project.posList as pos (pos.id)}<option value={pos.id}
              >{posName(pos, glossLangs)}{pos.abbr ? ` (${pos.abbr})` : ''}</option
            >{/each}
        </select>
      </label>
      <label class="field grow">
        <span class="small muted">{t('newLexeme.paradigm')}</span>
        <select class="select" bind:value={paradigmId}>
          <option value="">{t('lexicon.paradigmByPos')}</option>
          {#each project.paradigms.filter((p) => !p.appliesToAll) as p (p.id)}<option value={p.id}
              >{pickText(p.name, glossLangs) || t('paradigms.untitled')}</option
            >{/each}
        </select>
      </label>
    </div>
    {#each glossLangs as g (g)}
      <label class="field">
        <span class="small muted">{t('newLexeme.definition', { lang: g })}</span>
        <input class="input" bind:value={defs[g]} />
      </label>
    {/each}
    <label class="field">
      <span class="small muted">{t('lexicon.colTags')}</span>
      <input class="input" bind:value={tags} placeholder={t('newLexeme.tagsHint')} />
    </label>
    <div class="auto small">
      <div>
        <span class="muted">{t('newLexeme.etymology')}</span>
        {t('newLexeme.etymologyValue', {
          base: req.base?.lemma ?? t('newLexeme.noBase'),
          paradigm: paraName,
          slot: req.slotLabel
        })}
      </div>
      {#if req.base}
        <div>
          <span class="muted">{t('newLexeme.relation')}</span>
          {t('newLexeme.relationValue', { base: req.base.lemma })}
        </div>
      {/if}
    </div>
    <div class="row foot">
      <button class="btn sm" title={t('newLexeme.bareHint')} onclick={() => generate(false)}
        >{t('newLexeme.bare')}</button
      >
      <span class="grow"></span>
      <button class="btn sm" onclick={close}>{t('common.cancel')}</button>
      <button class="btn sm primary" disabled={!lemma.trim()} onclick={() => generate(true)}
        >{t('newLexeme.generate')}</button
      >
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgb(0 0 0 / 25%);
    z-index: 400;
  }
  .dlg {
    position: fixed;
    z-index: 401;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, 92vw);
    max-height: 88vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 16px 18px;
    box-shadow: var(--shadow-lg);
  }
  .head {
    gap: 8px;
    color: var(--accent-text);
  }
  .head strong {
    color: var(--text);
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .two {
    gap: 10px;
  }
  .auto {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .auto .muted {
    margin-inline-end: 6px;
  }
  .warn {
    color: var(--warn);
    margin: 0;
  }
  .foot {
    gap: 6px;
    margin-top: 2px;
  }
</style>
