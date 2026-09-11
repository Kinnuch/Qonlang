<script lang="ts">
  /** 整库演化：选源 / 目标语言与阶段，预览全部词条的推导结果，再写入目标语言并建词源链接。 */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import HelpDot from './HelpDot.svelte'
  import type { Id, Lexeme, Morpheme, RuleSet } from '$lib/core/model'
  import type { RuleProgram } from '$lib/engine/sca'
  import { planEvolution, applyEvolution, type EvolveRow } from '$lib/engine/evolve'
  import { flashOn } from '$lib/ui/flash'
  import { Play, Check, X } from '@lucide/svelte'

  let {
    ruleSet,
    program,
    onclose
  }: { ruleSet: RuleSet; program: RuleProgram | null; onclose: () => void } = $props()

  const project = $derived(projectState.project!)
  const markers = $derived(program?.markers ?? [])
  const boundOf = (m: string): Id | null => ruleSet.stageLanguages[m] ?? null

  let sourceLang = $state<Id | ''>('')
  let targetLang = $state<Id | ''>('')
  let startAt = $state('')
  let stopAt = $state('')
  let inputKind = $state<'lemma' | string>('lemma')
  let posFilter = $state<Id | ''>('')
  let copySenses = $state(true)
  let updateExisting = $state(true)
  let createOnCollision = $state(false)
  let rows = $state<EvolveRow[] | null>(null)
  let doneFlash = $state(0)

  // 默认：第一个绑定语言的阶段是源，最后一个是目标
  $effect(() => {
    if (sourceLang || targetLang) return
    const bound = markers.filter((m) => boundOf(m))
    if (bound.length) {
      sourceLang = boundOf(bound[0])!
      startAt = bound[0]
      const last = bound[bound.length - 1]
      if (last !== bound[0]) {
        targetLang = boundOf(last)!
        stopAt = last
      }
    } else sourceLang = projectState.currentLanguageId ?? project.languages[0]?.id ?? ''
    if (!targetLang) targetLang = project.languages.find((l) => l.id !== sourceLang)?.id ?? ''
  })
  const stemNames = $derived.by(() => {
    const s = new Set<string>()
    for (const l of project.lexemes)
      if (l.languageId === sourceLang) for (const k of Object.keys(l.stems)) s.add(k)
    return [...s].sort()
  })
  const sourceCount = $derived(
    inputKind === 'morpheme'
      ? project.morphemes.filter((m) => m.languageId === sourceLang).length
      : project.lexemes.filter((l) => l.languageId === sourceLang).length
  )

  function preview(): void {
    if (!program || !sourceLang || !targetLang) return
    rows = planEvolution(project, {
      ruleSet,
      program,
      sourceLanguageId: sourceLang,
      targetLanguageId: targetLang,
      startAt: startAt || undefined,
      stopAt: stopAt || undefined,
      inputField:
        inputKind === 'lemma'
          ? { kind: 'lemma' }
          : inputKind === 'morpheme'
            ? { kind: 'morpheme' }
            : { kind: 'stem', name: inputKind },
      posIds: posFilter ? [posFilter] : undefined
    })
  }
  function apply(): void {
    if (!rows || !program) return
    const r = applyEvolution(
      project,
      rows,
      { ruleSet, program, sourceLanguageId: sourceLang as Id, targetLanguageId: targetLang as Id },
      { copySenses, updateExisting, createOnCollision }
    )
    projectState.touch()
    doneFlash++
    ui.toast(t('evolve.done', r))
    preview()
  }
  const summary = $derived.by(() => {
    if (!rows) return null
    const n = (a: EvolveRow['action']): number => rows!.filter((r) => r.action === a).length
    return { create: n('create'), update: n('update'), same: n('same'), skip: n('skip') }
  })
  const langName = (id: string): string => project.languages.find((l) => l.id === id)?.name ?? ''
</script>

<div class="evolve card" use:flashOn={doneFlash}>
  <div class="row head">
    <strong>{t('evolve.title')}</strong>
    <HelpDot tip={t('evolve.hint')} />
    <span class="grow"></span>
    <button class="btn ghost icon sm" onclick={onclose}><X size={14} /></button>
  </div>
  <div class="grid">
    <label class="f"
      ><span>{t('evolve.source')}</span>
      <select class="select" bind:value={sourceLang} onchange={() => (rows = null)}
        >{#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select
      >
      <span class="tiny muted">{t('evolve.sourceCount', { n: sourceCount })}</span></label
    >
    <label class="f"
      ><span>{t('evolve.startAt')}</span>
      <select class="select" bind:value={startAt} onchange={() => (rows = null)}
        ><option value="">{t('evolve.fromStart')}</option>{#each markers as m (m)}<option value={m}
            >{m}{boundOf(m) ? ` · ${langName(boundOf(m)!)}` : ''}</option
          >{/each}</select
      ></label
    >
    <label class="f"
      ><span>{t('evolve.stopAt')}</span>
      <select class="select" bind:value={stopAt} onchange={() => (rows = null)}
        ><option value="">{t('evolve.toEnd')}</option>{#each markers as m (m)}<option value={m}
            >{m}{boundOf(m) ? ` · ${langName(boundOf(m)!)}` : ''}</option
          >{/each}</select
      ></label
    >
    <label class="f"
      ><span>{t('evolve.target')}</span>
      <select class="select" bind:value={targetLang} onchange={() => (rows = null)}
        >{#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}</select
      ></label
    >
    <label class="f"
      ><span>{t('evolve.input')}</span>
      <select class="select" bind:value={inputKind} onchange={() => (rows = null)}
        ><option value="lemma">{t('lexicon.lemma')}</option><option value="morpheme"
          >{t('evolve.morphemes')}</option
        >{#each stemNames as s (s)}<option value={s}>{t('lexicon.colStem')}: {s}</option
          >{/each}</select
      ></label
    >
    <label class="f"
      ><span>{t('evolve.pos')}</span>
      <select class="select" bind:value={posFilter} onchange={() => (rows = null)}
        ><option value="">{t('lexicon.allPos')}</option>{#each project.posList as p (p.id)}<option
            value={p.id}>{p.abbr || p.id}</option
          >{/each}</select
      ></label
    >
  </div>
  <div class="row wrap opts">
    <label class="row small"
      ><input type="checkbox" bind:checked={copySenses} />{t('evolve.copySenses')}</label
    >
    <label class="row small"
      ><input type="checkbox" bind:checked={updateExisting} />{t('evolve.updateExisting')}</label
    >
    <label class="row small"
      ><input type="checkbox" bind:checked={createOnCollision} />{t(
        'evolve.createOnCollision'
      )}</label
    >
    <span class="grow"></span>
    <button
      class="btn sm"
      disabled={!program || !sourceLang || !targetLang || sourceLang === targetLang}
      onclick={preview}><Play size={14} />{t('evolve.preview')}</button
    >
    <button
      class="btn primary sm"
      disabled={!rows || !summary || summary.create + summary.update === 0}
      onclick={apply}><Check size={14} />{t('evolve.apply')}</button
    >
  </div>
  {#if rows && summary}
    <p class="small muted">{t('evolve.summary', summary)}</p>
    <div class="tbl-wrap">
      <table class="tbl">
        <thead
          ><tr
            ><th>{t('evolve.colInput')}</th><th>{t('evolve.colOutput')}</th><th
              >{t('evolve.colExisting')}</th
            ><th>{t('evolve.colAction')}</th></tr
          ></thead
        >
        <tbody>
          {#each rows as r (r.sourceKind + r.source.id)}
            <tr class={r.action}>
              <td class="data"
                >{r.input}<span class="tiny muted">
                  · {r.sourceKind === 'morpheme'
                    ? pickText((r.source as Morpheme).meaning, project.settings.glossLanguages)
                    : (r.source as Lexeme).senses
                        .map((s) => pickText(s.definition, project.settings.glossLanguages))
                        .filter(Boolean)
                        .join('; ')}</span
                ></td
              >
              <td class="data">{r.output || '—'}</td>
              <td class="data muted">{r.existing?.lemma ?? r.collision?.lemma ?? ''}</td>
              <td
                ><span class="badge" class:accent={r.action === 'create' || r.action === 'update'}
                  >{t(`evolve.actions.${r.action}`)}</span
                ></td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .evolve {
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .head {
    gap: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px 14px;
  }
  .f {
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-size: 12px;
    color: var(--text-2);
  }
  .opts {
    gap: 12px;
  }
  .tbl-wrap {
    max-height: 360px;
    overflow: auto;
  }
  .tbl {
    border-collapse: collapse;
    font-size: 13px;
    width: 100%;
  }
  .tbl th,
  .tbl td {
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
    text-align: left;
  }
  tr.skip td {
    opacity: 0.55;
  }
  .tiny {
    font-size: 11px;
  }
</style>
