<script lang="ts">
  /**
   * 表格导入（语料、短语共用），放在页面主区里：选文件或直接粘贴 → 挑分隔符、勾表头 → 每列挑字段 → 导入；
   * 也能选千语集导出的 JSON，整条连分析一起导入。检视器里实时显示导入样例。
   * 分隔符默认自动：不是每行都有同一个分隔符时，当成一行一条、不分列（句子里的逗号不会把句子切开）。
   * 记录怎么变成条目由调用方的 onimport（JSON 是 json.run）决定。
   */
  import { onMount } from 'svelte'
  import { platform } from '$lib/platform'
  import { t } from '$lib/i18n/index.svelte'
  import { detectDelimiter, parseCsv, type Delimiter } from '$lib/core/csv'
  import { guessColumns, rowsToRecords, type ImportField } from '$lib/importers/corpusIO'
  import { normalizeSentence } from '$lib/core/sentenceDedup'
  import { PREVIEW_LIMIT } from '$lib/importers/preview'
  import { ioFieldLabel } from '$lib/ui/ioLabels'
  import Portal from './Portal.svelte'
  import ImportPreview from './ImportPreview.svelte'
  import { FileUp, X, BookOpenText } from '@lucide/svelte'

  let {
    title,
    fields,
    guide = '',
    exists = () => false,
    json = undefined,
    startWithJson = false,
    onimport,
    onclose
  }: {
    title: string
    fields: ImportField[]
    /** 格式说明的网址（使用指南里讲表格列名的那一节） */
    guide?: string
    /** 这门语言里是不是已经有这句原文了（样例里标「会跳过」） */
    exists?: (text: string) => boolean
    /** 能导入千语集导出的 JSON 时给：preview 只读成记录，run 真正导入 */
    json?: {
      preview: (content: string) => Record<string, string>[] | null
      run: (content: string) => void
    }
    /** 一打开就去选 JSON 文件（菜单里点的是「从 JSON 导入」） */
    startWithJson?: boolean
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
  /** 选的是 JSON 文件时它的内容（这时不分列、不挑字段） */
  let jsonText = $state('')
  const jsonRecords = $derived(jsonText && json ? json.preview(jsonText) : null)

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

  const total = $derived(jsonText ? (jsonRecords?.length ?? 0) : records.length)
  /** 样例：前几条，标出会跳过的（原文为空、已经有了、跟前面重复） */
  const sample = $derived.by(() => {
    const seen = new Set<string>()
    return (jsonText ? (jsonRecords ?? []) : records).slice(0, PREVIEW_LIMIT).map((rec) => {
      const text = rec.text ?? ''
      const k = normalizeSentence(text)
      const skip = !k
        ? t('importPreview.skipEmpty')
        : exists(text)
          ? t('importPreview.skipExisting')
          : seen.has(k)
            ? t('importPreview.skipRepeat')
            : undefined
      seen.add(k)
      return { rec, skip }
    })
  })

  async function pickFile(onlyJson = false): Promise<void> {
    const [f] = await platform.readTextFiles({
      multiple: false,
      extensions: onlyJson ? ['json'] : json ? ['csv', 'tsv', 'txt', 'json'] : ['csv', 'tsv', 'txt']
    })
    if (!f) return
    fileName = f.name
    const isJson = !!json && /\.json$/i.test(f.name)
    jsonText = isJson ? f.content : ''
    raw = isJson ? '' : f.content
  }
  onMount(() => {
    if (startWithJson) void pickFile(true)
  })
  function run(): void {
    if (jsonText) {
      if (json && jsonRecords?.length) json.run(jsonText)
      return
    }
    if (!records.some((r) => r.text)) return
    onimport($state.snapshot(records) as Record<string, string>[])
  }
</script>

<div class="panel card">
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
    <button class="btn ghost icon sm" title={t('common.close')} onclick={onclose}
      ><X size={16} /></button
    >
  </div>
  <div class="row opts">
    <button class="btn sm" onclick={() => pickFile()}><FileUp size={14} />{t('io.pickFile')}</button
    >
    <span class="small muted grow">{fileName || t('io.orPaste')}</span>
    {#if !jsonText}
      <label class="row small"
        >{t('io.split')}
        <select class="select" bind:value={split}>
          {#each SPLITS as s (s.key)}<option value={s.value}>{t(`io.splits.${s.key}`)}</option
            >{/each}
        </select></label
      >
      <label class="row check small"
        ><input
          type="checkbox"
          checked={hasHeader}
          onchange={(e) => (hasHeader = (e.currentTarget as HTMLInputElement).checked)}
        />{t('io.hasHeader')}</label
      >
    {/if}
  </div>
  {#if jsonText}
    <p class="small" class:warn={!jsonRecords}>
      {jsonRecords ? t('io.jsonFile') : t('io.badJson')}
    </p>
  {:else}
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
  {/if}
  <div class="row">
    <span class="small muted grow">{t('io.rowsReady', { n: total })}</span>
    <button class="btn" onclick={onclose}>{t('common.cancel')}</button>
    <button
      class="btn primary"
      disabled={jsonText ? !jsonRecords?.length : !records.some((r) => r.text)}
      onclick={run}>{t('io.import')}</button
    >
  </div>
</div>

<Portal>
  <ImportPreview
    kind={total ? 'records' : 'empty'}
    {total}
    records={sample}
    fieldLabel={ioFieldLabel}
    source={fileName}
  />
</Portal>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
    max-width: 980px;
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
  /* 主区窄的时候这一排折行，提示文字不被挤成竖排 */
  .opts {
    flex-wrap: wrap;
    gap: 8px 12px;
  }
  .opts .grow {
    flex: 1 1 140px;
    min-width: 0;
  }
  .opts label {
    white-space: nowrap;
  }
  .off {
    opacity: 0.45;
  }
  .warn {
    color: var(--warn);
  }
</style>
