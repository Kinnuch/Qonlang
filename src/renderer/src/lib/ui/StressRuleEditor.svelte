<script lang="ts">
  /**
   * 重音规则的可视化编辑：一条一行（音节数、第几个音节、音节核、环境、排除），另有按符号分段。
   * 文本仍是真值，改动都换算成 = 后面那一截交给 onchange。音变、正字法里的重音规则行和音系页的自定义重音共用。
   */
  import { untrack } from 'svelte'
  import { t } from '$lib/i18n/index.svelte'
  import {
    formatStressText,
    parseStressText,
    type StressClauseDraft,
    type StressRuleDraft
  } from '$lib/engine/sca'
  import { ChevronDown, ChevronUp, Plus, X } from '@lucide/svelte'

  let {
    value,
    onchange,
    onfocusfield
  }: {
    value: string
    onchange: (text: string) => void
    /** 某个输入框拿到焦点（外面的「点击插入音类」往这里插） */
    onfocusfield?: (el: HTMLInputElement) => void
  } = $props()

  const blank = (): StressClauseDraft => ({
    pos: '',
    count: null,
    orMore: false,
    position: '-2',
    target: '',
    left: '',
    right: '',
    exceptLeft: '',
    exceptRight: ''
  })
  const toDraft = (text: string): StressRuleDraft => {
    const d = parseStressText(text)
    return {
      special: d.special,
      clauses: d.clauses.length ? d.clauses : [blank()],
      split: d.split,
      head: d.head
    }
  }

  // 本地草稿：打字时不回头重新解析（空着的一条也留着）；外面换了文本才重来
  let draft = $state<StressRuleDraft>(toDraft(untrack(() => value)))
  let emitted = untrack(() => value)
  $effect(() => {
    const v = value
    untrack(() => {
      if (v !== emitted) {
        draft = toDraft(v)
        emitted = v
      }
    })
  })
  const errors = $derived(parseStressText(value).errors)

  function emit(): void {
    const text = formatStressText($state.snapshot(draft) as StressRuleDraft)
    emitted = text
    onchange(text)
  }

  type PosMode = 'front' | 'back' | 'first' | 'last' | 'none'
  const posMode = (c: StressClauseDraft): PosMode =>
    c.position === '*'
      ? 'first'
      : c.position === '-*'
        ? 'last'
        : c.position === '0'
          ? 'none'
          : c.position.startsWith('-')
            ? 'back'
            : 'front'
  const posNumber = (c: StressClauseDraft): number => Math.abs(Number(c.position)) || 1
  function setPos(c: StressClauseDraft, mode: PosMode, n = posNumber(c)): void {
    c.position =
      mode === 'first'
        ? '*'
        : mode === 'last'
          ? '-*'
          : mode === 'none'
            ? '0'
            : mode === 'back'
              ? `-${n}`
              : `${n}`
    emit()
  }
  type CountMode = 'any' | 'exact' | 'more'
  const countMode = (c: StressClauseDraft): CountMode =>
    c.count === null ? 'any' : c.orMore ? 'more' : 'exact'
  function setCount(c: StressClauseDraft, mode: CountMode, n = c.count ?? 2): void {
    c.count = mode === 'any' ? null : Math.max(1, n)
    c.orMore = mode === 'more'
    emit()
  }
  function move(i: number, d: -1 | 1): void {
    const j = i + d
    if (j < 0 || j >= draft.clauses.length) return
    ;[draft.clauses[i], draft.clauses[j]] = [draft.clauses[j], draft.clauses[i]]
    emit()
  }
  const focus = (e: FocusEvent): void => onfocusfield?.(e.currentTarget as HTMLInputElement)
  /** 排除那一截：写过的直接显示，没写过的点了才出来 */
  let exceptOpen = $state<Record<number, boolean>>({})
</script>

<div class="stress-editor">
  <label class="row special" title={t('stressRule.specialTip')}
    ><input
      type="checkbox"
      checked={draft.special}
      onchange={(e) => {
        draft.special = (e.currentTarget as HTMLInputElement).checked
        emit()
      }}
    />{t('stressRule.special')}</label
  >
  <ol class="clauses">
    {#each draft.clauses as c, i (i)}
      <li class="clause">
        <span class="no"
          >{i === 0 && !draft.special ? t('stressRule.first') : t('stressRule.otherwise')}</span
        >
        <label class="grp" title={t('stressRule.posTip')}>
          <span class="muted">{t('stressRule.pos')}</span>
          <input
            class="input data env pos-in"
            placeholder={t('stressRule.posAny')}
            bind:value={c.pos}
            oninput={emit}
          />
        </label>
        <label class="grp">
          <select
            class="select tiny"
            value={countMode(c)}
            onchange={(e) => setCount(c, (e.currentTarget as HTMLSelectElement).value as CountMode)}
          >
            <option value="any">{t('stressRule.countAny')}</option>
            <option value="exact">{t('stressRule.countExact')}</option>
            <option value="more">{t('stressRule.countMore')}</option>
          </select>
          {#if c.count !== null}
            <input
              class="input num"
              type="number"
              min="1"
              value={c.count}
              oninput={(e) =>
                setCount(c, countMode(c), Number((e.currentTarget as HTMLInputElement).value))}
            /><span class="muted">{t('stressRule.syllables')}</span>
          {/if}
        </label>
        <label class="grp">
          <select
            class="select tiny"
            value={posMode(c)}
            onchange={(e) => setPos(c, (e.currentTarget as HTMLSelectElement).value as PosMode)}
          >
            <option value="front">{t('stressRule.posFront')}</option>
            <option value="back">{t('stressRule.posBack')}</option>
            <option value="first">{t('stressRule.posFirst')}</option>
            <option value="last">{t('stressRule.posLast')}</option>
            <option value="none">{t('stressRule.posNone')}</option>
          </select>
          {#if posMode(c) === 'front' || posMode(c) === 'back'}
            <input
              class="input num"
              type="number"
              min="1"
              value={posNumber(c)}
              oninput={(e) =>
                setPos(
                  c,
                  posMode(c),
                  Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1)
                )}
            /><span class="muted">{t('stressRule.syllable')}</span>
          {/if}
        </label>
        <label class="grp">
          <span class="muted">{t('stressRule.nucleus')}</span>
          <input
            class="input data pat"
            placeholder={t('stressRule.nucleusAny')}
            title={t('stressRule.nucleusTip')}
            bind:value={c.target}
            oninput={emit}
            onfocus={focus}
          />
        </label>
        <span class="grp">
          <span class="muted">{t('stressRule.env')}</span>
          <input class="input data env" bind:value={c.left} oninput={emit} onfocus={focus} /><b
            class="mono">_</b
          ><input class="input data env" bind:value={c.right} oninput={emit} onfocus={focus} />
        </span>
        {#if c.exceptLeft || c.exceptRight || exceptOpen[i]}
          <span class="grp">
            <span class="muted">{t('stressRule.except')}</span>
            <input
              class="input data env"
              bind:value={c.exceptLeft}
              oninput={emit}
              onfocus={focus}
            /><b class="mono">_</b><input
              class="input data env"
              bind:value={c.exceptRight}
              oninput={emit}
              onfocus={focus}
            />
          </span>
        {:else}
          <button class="btn ghost sm" onclick={() => (exceptOpen[i] = true)}
            ><Plus size={12} />{t('stressRule.except')}</button
          >
        {/if}
        <span class="acts">
          <button
            class="btn ghost icon sm"
            title={t('soundChanges.moveUp')}
            disabled={i === 0}
            onclick={() => move(i, -1)}><ChevronUp size={13} /></button
          >
          <button
            class="btn ghost icon sm"
            title={t('soundChanges.moveDown')}
            disabled={i === draft.clauses.length - 1}
            onclick={() => move(i, 1)}><ChevronDown size={13} /></button
          >
          <button
            class="btn ghost icon sm"
            title={t('common.delete')}
            disabled={draft.clauses.length === 1}
            onclick={() => {
              draft.clauses.splice(i, 1)
              emit()
            }}><X size={13} /></button
          >
        </span>
      </li>
    {/each}
  </ol>
  <div class="row foot">
    <button
      class="btn ghost sm"
      onclick={() => {
        draft.clauses.push(blank())
        emit()
      }}><Plus size={14} />{t('stressRule.addClause')}</button
    >
    <span class="grow"></span>
    <label class="grp">
      <span class="muted">{t('stressRule.split')}</span>
      <input class="input data env" placeholder="·" bind:value={draft.split} oninput={emit} />
    </label>
    {#if draft.split.trim()}
      <label class="grp">
        <span class="muted">{t('stressRule.head')}</span>
        <select
          class="select tiny"
          value={draft.head > 0 ? 'first' : 'last'}
          onchange={(e) => {
            draft.head = (e.currentTarget as HTMLSelectElement).value === 'first' ? 1 : -1
            emit()
          }}
        >
          <option value="last">{t('stressRule.headLast')}</option>
          <option value="first">{t('stressRule.headFirst')}</option>
        </select>
      </label>
    {/if}
  </div>
  <code class="preview">{formatStressText(draft) || ' '}</code>
  {#each errors as e (e)}<p class="small err">{e}</p>{/each}
</div>

<style>
  .stress-editor {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .special {
    gap: 6px;
    font-size: 13px;
  }
  .clauses {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .clause {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: var(--bg-sunken);
  }
  .no {
    min-width: 2.5em;
    font-size: 12px;
    color: var(--text-2);
  }
  .grp {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }
  .select.tiny {
    width: auto;
    field-sizing: content;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .num {
    width: 54px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .pat {
    width: 100px;
  }
  .env {
    width: 60px;
    padding-top: 2px;
    padding-bottom: 2px;
  }
  .pos-in {
    width: auto;
    field-sizing: content;
    min-width: 60px;
    max-width: 200px;
  }
  .mono {
    font-family: var(--font-mono);
  }
  .acts {
    margin-inline-start: auto;
    display: inline-flex;
  }
  .acts .btn {
    padding: 2px;
  }
  .foot {
    gap: 10px;
    flex-wrap: wrap;
  }
  .preview {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-2);
    white-space: pre-wrap;
    word-break: break-all;
  }
  .err {
    color: var(--danger);
    margin: 0;
  }
</style>
