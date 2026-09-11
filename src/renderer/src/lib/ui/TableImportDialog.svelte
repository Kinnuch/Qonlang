<script lang="ts">
  /**
   * 表格导入（语料、短语共用）：选文件或直接粘贴 → 挑分隔符、勾表头 → 每列挑字段 → 看前几行 → 导入。
   * 分隔符默认自动：不是每行都有同一个分隔符时，当成一行一条、不分列（句子里的逗号不会把句子切开）。
   * 记录怎么变成条目由调用方的 onimport 决定。
   */
  import { platform } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { detectDelimiter, parseCsv, type Delimiter } from '$lib/core/csv'
  import { guessColumns, rowsToRecords, type ImportField } from '$lib/importers/corpusIO'
  import { ioFieldLabel } from '$lib/ui/ioLabels'
  import { FileUp, X, BookOpenText } from '@lucide/svelte'

  let {
    title,
    fields,
    guide = '',
    onimport,
    onclose
  }: {
    title: string
    fields: ImportField[]
    /** 格式说明的网址（使用指南里讲表格列名的那一节） */
    guide?: string
    onimport: (records: Record<string, string>[]) => void
    onclose: () => void
  } = $props()

  type Split = Delimiter | 'line'
  const SPLITS: { value: Split | 'auto'; key: string }[] = [
    { value: 'auto', key: 'auto' },
    { value: 'line', key: 'line' },
    { value: ',', key: 'comma' },
    { value: '\t', key: 'tab' },
    { value: ';', key: 'semicolon' },
    { value: '|', key: 'pipe' }
  ]

  let raw = $state('')
  let fileName = $state('')
  let split = $state<Split | 'auto'>('auto')

  const lines = $derived(raw.split(/\r?\n/).filter((l) => l.trim()))
  /** 自动：大多数行都有同一个分隔符才分列 */
  const resolved = $derived.by((): Split => {
    if (split !== 'auto') return split
    if (!lines.length) return 'line'
    const d = detectDelimiter(raw)
    return lines.filter((l) => l.includes(d)).length / lines.length >= 0.8 ? d : 'line'
  })
  const table = $derived(
    !raw.trim()
      ? []
      : resolved === 'line'
        ? lines.map((l) => [l.trim()])
        : parseCsv(raw, resolved).rows
  )
  const colCount = $derived(table.reduce((n, r) => Math.max(n, r.length), 0))
  // 分了列才默认有表头；手动勾过的在换分隔符之前一直算数
  let hasHeader = $derived(resolved !== 'line')
  const header = $derived(hasHeader ? (table[0] ?? null) : null)
  const body = $derived(hasHeader ? table.slice(1) : table)
  // 换了表格或表头设置就重新猜一遍列；手动挑过的列在那之前一直算数
  let columns = $derived(guessColumns(header, fields, colCount))
  const records = $derived(rowsToRecords(body, columns))
  function setColumn(i: number, key: string): void {
    columns = columns.map((c, j) => (j === i ? key : c))
  }

  async function pickFile(): Promise<void> {
    const [f] = await platform.readTextFiles({
      multiple: false,
      extensions: ['csv', 'tsv', 'txt']
    })
    if (!f) return
    fileName = f.name
    raw = f.content
  }
  function run(): void {
    if (!records.some((r) => r.text)) return
    onimport($state.snapshot(records) as Record<string, string>[])
  }
  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      onclose()
    }
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="backdrop" role="presentation" onclick={onclose}></div>
<div class="dlg card" role="dialog" aria-modal="true" aria-label={title}>
  <div class="row">
    <strong class="grow">{title}</strong>
    {#if guide}
      <button
        class="btn ghost sm"
        title={t('csv.formatGuideHint')}
        onclick={() => platform.openExternal(guide)}
        ><BookOpenText size={14} />{t('csv.formatGuide')}</button
      >
    {/if}
    <button class="btn ghost icon sm" onclick={onclose}><X size={16} /></button>
  </div>
  <div class="row">
    <button class="btn sm" onclick={pickFile}><FileUp size={14} />{t('io.pickFile')}</button>
    <span class="small muted grow">{fileName || t('io.orPaste')}</span>
    <label class="row small"
      >{t('io.split')}
      <select class="select" bind:value={split}>
        {#each SPLITS as s (s.key)}<option value={s.value}>{t(`io.splits.${s.key}`)}</option>{/each}
      </select></label
    >
    <label class="row check small"
      ><input
        type="checkbox"
        checked={hasHeader}
        onchange={(e) => (hasHeader = (e.currentTarget as HTMLInputElement).checked)}
      />{t('io.hasHeader')}</label
    >
  </div>
  <textarea class="textarea data" rows="4" placeholder={t('io.pastePlaceholder')} bind:value={raw}
  ></textarea>
  {#if colCount}
    <div class="map">
      <table class="table">
        <thead>
          <tr>
            {#each columns as col, i (i)}
              <th class:off={!col}>
                <select
                  class="select"
                  value={col}
                  onchange={(e) => setColumn(i, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value="">{t('io.ignore')}</option>
                  {#each fields as f (f.key)}<option value={f.key}>{ioFieldLabel(f.key)}</option
                    >{/each}
                </select>
                {#if header}<div class="small muted">{header[i] ?? ''}</div>{/if}
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each body.slice(0, 5) as row, r (r)}
            <tr>
              {#each columns as col, i (i)}<td class="data" class:off={!col}>{row[i] ?? ''}</td
                >{/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
  <div class="row">
    <span class="small muted grow">{t('io.rowsReady', { n: records.length })}</span>
    <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
    <button class="btn primary" disabled={!records.some((r) => r.text)} onclick={run}
      >{t('io.import')}</button
    >
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.18);
  }
  .dlg {
    position: fixed;
    z-index: 91;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    width: min(880px, 92vw);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    overflow: hidden;
  }
  .map {
    overflow: auto;
    max-height: 40vh;
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .map th {
    vertical-align: top;
    min-width: 130px;
  }
  .off {
    opacity: 0.45;
  }
</style>
