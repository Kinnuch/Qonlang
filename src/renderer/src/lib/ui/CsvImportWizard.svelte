<script lang="ts">
  /** CSV 导入向导：选文件 → 列映射（可存预设）→ 选项 → 导入报告 */
  import { platform, type CsvPreset } from '$lib/platform'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { parseCsv, type Delimiter } from '$lib/core/csv'
  import { MORPHEME_TYPES } from '$lib/core/factory'
  import {
    applyCsvImport,
    defaultMapping,
    guessMapping,
    FIELD_KINDS,
    type CsvMapping,
    type FieldSpec,
    type ImportReport
  } from '$lib/importers/csvImport'
  import { FileUp, Check, X, Save, Trash2 } from '@lucide/svelte'

  let {
    onclose,
    initialTarget = 'lexemes'
  }: { onclose: () => void; initialTarget?: 'lexemes' | 'morphemes' } = $props()

  const project = $derived(projectState.project!)
  let fileName = $state('')
  let rawText = $state('')
  let delimiter = $state<Delimiter | 'auto'>('auto')
  let rows = $state<string[][]>([])
  let mapping = $state<CsvMapping | null>(null)
  let report = $state<ImportReport | null>(null)
  let presetName = $state('')
  let chosenPreset = $state('')

  const header = $derived(rows[0] ?? [])
  const colCount = $derived(Math.max(0, ...rows.map((r) => r.length)))
  const sampleRow = $derived(mapping?.hasHeader ? (rows[1] ?? []) : (rows[0] ?? []))
  const presets = $derived(
    ui.prefs.csvPresets.filter((p) => !mapping || p.target === mapping.target)
  )

  async function pick(): Promise<void> {
    const [f] = await platform.readTextFiles({ multiple: false, extensions: ['csv', 'tsv', 'txt'] })
    if (!f) return
    fileName = f.name
    rawText = f.content
    reparse()
  }
  function reparse(): void {
    const parsed = parseCsv(rawText, delimiter === 'auto' ? undefined : delimiter)
    rows = parsed.rows
    if (delimiter === 'auto') delimiter = parsed.delimiter
    const lid =
      projectState.currentLanguageId ??
      project.settings.defaultLanguageId ??
      project.languages[0]?.id ??
      ''
    const cols = Math.max(0, ...rows.map((r) => r.length))
    const base = defaultMapping(lid, cols)
    base.target = initialTarget
    mapping = guessMapping(rows[0] ?? [], base)
    report = null
  }

  function setKind(i: number, kind: FieldSpec['kind']): void {
    if (!mapping) return
    const lang = project.settings.glossLanguages[0] ?? 'en'
    const spec: FieldSpec =
      kind === 'definition'
        ? { kind, lang }
        : kind === 'stem'
          ? { kind, name: header[i] ?? '' }
          : kind === 'form'
            ? { kind, slot: header[i] ?? '' }
            : kind === 'feature'
              ? { kind, category: header[i] ?? '' }
              : ({ kind } as FieldSpec)
    mapping.columns[i] = spec
  }

  const lemmaMapped = $derived(!!mapping?.columns.some((c) => c.kind === 'lemma'))

  function run(): void {
    if (!mapping || !lemmaMapped) return
    report = applyCsvImport(
      project,
      $state.snapshot(rows) as string[][],
      $state.snapshot(mapping) as CsvMapping
    )
    projectState.touch()
  }

  function keyFor(i: number): string {
    return mapping?.hasHeader ? (header[i] ?? String(i)) : String(i)
  }
  function savePreset(): void {
    if (!mapping || !presetName.trim()) return
    const columns: Record<string, unknown> = {}
    mapping.columns.forEach((c, i) => {
      if (c.kind !== 'ignore') columns[keyFor(i)] = $state.snapshot(c)
    })
    const preset: CsvPreset = {
      name: presetName.trim(),
      target: mapping.target,
      columns,
      tagSeparator: mapping.tagSeparator,
      splitProtoArrow: mapping.splitProtoArrow,
      splitSenses: mapping.splitSenses
    }
    ui.prefs.csvPresets = [...ui.prefs.csvPresets.filter((p) => p.name !== preset.name), preset]
    void ui.savePrefs()
    chosenPreset = preset.name
  }
  function applyPreset(): void {
    const p = ui.prefs.csvPresets.find((x) => x.name === chosenPreset)
    if (!p || !mapping) return
    mapping.target = p.target
    mapping.tagSeparator = p.tagSeparator
    mapping.splitProtoArrow = p.splitProtoArrow
    if (p.splitSenses !== undefined) mapping.splitSenses = p.splitSenses
    mapping.columns = mapping.columns.map(
      (_, i) => (p.columns[keyFor(i)] as FieldSpec | undefined) ?? { kind: 'ignore' }
    )
  }
  function deletePreset(): void {
    ui.prefs.csvPresets = ui.prefs.csvPresets.filter((p) => p.name !== chosenPreset)
    chosenPreset = ''
    void ui.savePrefs()
  }
</script>

<div class="wizard">
  <div class="row head">
    <h2 class="grow">{t('csv.title')}</h2>
    <button class="btn ghost icon" onclick={onclose}><X size={16} /></button>
  </div>

  <div class="row">
    <button class="btn" onclick={pick}><FileUp size={16} />{t('csv.pickFile')}</button>
    {#if fileName}
      <span class="small">{fileName}</span>
      <span class="badge">{t('csv.rows', { n: rows.length, cols: colCount })}</span>
    {/if}
  </div>
  {#if !mapping}
    <div class="field paste">
      <label for="csv-paste">{t('csv.paste')}</label>
      <textarea
        id="csv-paste"
        class="textarea mono"
        rows="4"
        placeholder={t('csv.pastePlaceholder')}
        onpaste={(e) => {
          const txt = e.clipboardData?.getData('text') ?? ''
          if (txt.trim()) {
            e.preventDefault()
            fileName = t('csv.pasted')
            rawText = txt
            delimiter = 'auto'
            reparse()
          }
        }}
        onchange={(e) => {
          const txt = (e.currentTarget as HTMLTextAreaElement).value
          if (txt.trim()) {
            fileName = t('csv.pasted')
            rawText = txt
            delimiter = 'auto'
            reparse()
          }
        }}
      ></textarea>
    </div>
  {/if}

  {#if mapping}
    <div class="grid2">
      <label class="field"
        ><span>{t('csv.delimiter')}</span>
        <select class="select" bind:value={delimiter} onchange={reparse}>
          <option value=",">,</option><option value=";">;</option><option value="&#9;">Tab</option
          ><option value="|">|</option>
        </select></label
      >
      <label class="field"
        ><span>{t('csv.target')}</span>
        <select class="select" bind:value={mapping.target}>
          <option value="lexemes">{t('csv.targetLexemes')}</option><option value="morphemes"
            >{t('csv.targetMorphemes')}</option
          >
        </select></label
      >
      <label class="field"
        ><span>{t('csv.language')}</span>
        <select class="select" bind:value={mapping.languageId}>
          {#each project.languages as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
        </select></label
      >
      <label class="row check"
        ><input type="checkbox" bind:checked={mapping.hasHeader} />{t('csv.hasHeader')}</label
      >
    </div>

    <div class="row preset">
      <span class="small muted">{t('csv.preset')}</span>
      <select class="select" bind:value={chosenPreset}>
        <option value="">{t('csv.noPreset')}</option>
        {#each presets as p (p.name)}<option value={p.name}>{p.name}</option>{/each}
      </select>
      <button class="btn sm" disabled={!chosenPreset} onclick={applyPreset}
        >{t('csv.applyPreset')}</button
      >
      <button
        class="btn ghost icon sm danger"
        disabled={!chosenPreset}
        title={t('csv.deletePreset')}
        onclick={deletePreset}><Trash2 size={14} /></button
      >
      <span class="grow"></span>
      <input class="input pname" placeholder={t('csv.presetName')} bind:value={presetName} />
      <button class="btn sm" disabled={!presetName.trim()} onclick={savePreset}
        ><Save size={14} />{t('csv.savePreset')}</button
      >
    </div>

    <h3>{t('csv.mapping')}</h3>
    <div class="table-wrap">
      <table class="map">
        <thead
          ><tr
            ><th>#</th><th>{t('csv.column')}</th><th>{t('csv.sample')}</th><th>{t('csv.field')}</th
            ><th></th></tr
          ></thead
        >
        <tbody>
          {#each mapping.columns as spec, i (i)}
            <tr class:mapped={spec.kind !== 'ignore'}>
              <td class="muted">{i + 1}</td>
              <td class="hdr">{mapping.hasHeader ? header[i] : ''}</td>
              <td class="sample data">{sampleRow[i] ?? ''}</td>
              <td>
                <select
                  class="select"
                  value={spec.kind}
                  onchange={(e) =>
                    setKind(i, (e.currentTarget as HTMLSelectElement).value as FieldSpec['kind'])}
                >
                  {#each FIELD_KINDS as k (k)}<option value={k}>{t(`csv.fieldKinds.${k}`)}</option
                    >{/each}
                </select>
              </td>
              <td>
                {#if spec.kind === 'definition'}
                  <input
                    class="input extra"
                    bind:value={spec.lang}
                    placeholder={t('csv.lang')}
                    list="gloss-langs"
                  />
                {:else if spec.kind === 'stem'}
                  <input
                    class="input extra"
                    bind:value={spec.name}
                    placeholder={t('csv.stemName')}
                  />
                {:else if spec.kind === 'form'}
                  <input
                    class="input extra"
                    bind:value={spec.slot}
                    placeholder={t('csv.slotName')}
                  />
                {:else if spec.kind === 'feature'}
                  <input
                    class="input extra"
                    bind:value={spec.category}
                    placeholder={t('csv.categoryName')}
                  />
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      <datalist id="gloss-langs"
        >{#each project.settings.glossLanguages as g (g)}<option value={g}
          ></option>{/each}</datalist
      >
    </div>

    <h3>{t('csv.options')}</h3>
    <div class="grid2">
      <label class="field"
        ><span>{t('csv.tagSeparator')}</span><input
          class="input"
          bind:value={mapping.tagSeparator}
        /></label
      >
      {#if mapping.target === 'morphemes'}
        <label class="field"
          ><span>{t('csv.morphemeType')}</span>
          <select class="select" bind:value={mapping.defaultMorphemeType}
            >{#each MORPHEME_TYPES as mt (mt)}<option value={mt}
                >{t(`morphemes.types.${mt}`)}</option
              >{/each}</select
          ></label
        >
      {/if}
      <label class="row check"
        ><input type="checkbox" bind:checked={mapping.skipEmptyKey} />{t('csv.skipEmpty')}</label
      >
      <label class="row check"
        ><input type="checkbox" bind:checked={mapping.splitProtoArrow} />{t(
          'csv.splitArrow'
        )}</label
      >
      <label class="row check"
        ><input type="checkbox" bind:checked={mapping.splitSenses} />{t('csv.splitSenses')}</label
      >
    </div>

    {#if !lemmaMapped}<p class="small warn">{t('csv.needLemma')}</p>{/if}

    {#if report}
      <div class="card report">
        <strong>{t('csv.reportTitle')}</strong>
        <div>{t('csv.reportCreated', { n: report.created })}</div>
        {#if report.skipped}<div>{t('csv.reportSkipped', { n: report.skipped })}</div>{/if}
        {#if report.duplicates.length}<div>
            {t('csv.reportDuplicates', {
              list:
                report.duplicates.slice(0, 20).join(', ') +
                (report.duplicates.length > 20 ? '…' : '')
            })}
          </div>{/if}
        {#if report.newPos.length}<div>
            {t('csv.reportNewPos', { list: report.newPos.join(', ') })}
          </div>{/if}
        {#if report.newCategories.length}<div>
            {t('csv.reportNewCategories', { list: report.newCategories.join(', ') })}
          </div>{/if}
        {#each report.warnings as w (w)}<div class="warn">{w}</div>{/each}
      </div>
    {/if}

    <div class="row">
      {#if report}
        <button class="btn primary" onclick={onclose}><Check size={16} />{t('common.ok')}</button>
      {:else}
        <button class="btn primary" disabled={!lemmaMapped || !rows.length} onclick={run}
          ><Check size={16} />{t('csv.run')}</button
        >
        <button class="btn ghost" onclick={onclose}>{t('csv.cancel')}</button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wizard {
    display: flex;
    flex-direction: column;
    gap: 12px;
    max-width: 980px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 8px 16px;
    align-items: end;
  }
  .field {
    margin: 0;
  }
  .field > span {
    font-size: 12px;
    color: var(--text-2);
  }
  .check {
    gap: 8px;
    padding-bottom: 6px;
  }
  .preset {
    gap: 8px;
  }
  .preset .select {
    width: 200px;
  }
  .pname {
    width: 180px;
  }
  .table-wrap {
    overflow: auto;
    max-height: 420px;
  }
  .map {
    border-collapse: collapse;
    width: 100%;
    font-size: 13px;
  }
  .map th {
    position: sticky;
    top: 0;
    background: var(--bg);
    text-align: left;
    padding: 4px 8px;
    border-bottom: 1px solid var(--border);
    color: var(--text-2);
  }
  .map td {
    padding: 3px 8px;
    border-bottom: 1px solid var(--border);
  }
  .map tr.mapped .hdr {
    font-weight: 600;
  }
  .sample {
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-2);
  }
  .map .select {
    width: 200px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .extra {
    width: 150px;
    padding-top: 3px;
    padding-bottom: 3px;
  }
  .warn {
    color: var(--warn);
  }
  .paste {
    max-width: 640px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .report {
    padding: 10px 14px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
</style>
