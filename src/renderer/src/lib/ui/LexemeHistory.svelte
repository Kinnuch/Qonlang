<script lang="ts">
  /**
   * 词条的历史形式链（词条卡里词源与屈折形之间的一块）：词源来源按音变一路推下来，每个阶段的形式连成一行。
   * 只有音变里从来源到这个词的每个阶段标记都绑了语言（或语言的阶段）时才出现。
   * 推得不对的那一步可以直接改（改动记进词源的中间态），后面几步从改过的接着推。
   */
  import type { Lexeme, Project } from '$lib/core/model'
  import { historyChain } from '$lib/core/history'
  import { newId } from '$lib/core/factory'
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { Pencil, RotateCcw } from '@lucide/svelte'

  let {
    lexeme,
    project,
    controls = false
  }: {
    lexeme: Lexeme
    project: Project
    /** 词库检视器里才给改（悬浮卡、画廊里的卡片只看） */
    controls?: boolean
  } = $props()

  const chain = $derived(historyChain(project, lexeme))
  /** 正在改哪一步 */
  let editing = $state<string | null>(null)
  let draft = $state('')

  function start(marker: string, form: string): void {
    if (!controls) return
    editing = marker
    draft = form
  }
  /** Esc 取消：失焦时别再存一遍 */
  let cancelled = false
  /**
   * 存成词源的中间态：跟推出来的一样就不记，空着就把原来记的去掉。
   * 回车走的也是失焦这一条路——存完链就重算了，再存一次「新值 = 推导值」反而会把刚存的删掉
   */
  function commit(marker: string, derived: string): void {
    if (cancelled) {
      cancelled = false
      editing = null
      return
    }
    const value = draft.trim()
    const stages = lexeme.etymology.stages
    const at = stages.findIndex((s) => s.stage === marker)
    editing = null
    if (!value || value === derived) {
      if (at >= 0) {
        stages.splice(at, 1)
        projectState.touch()
      }
      return
    }
    if (at >= 0) stages[at].form = value
    else stages.push({ id: newId(), form: value, type: 'soundChange', stage: marker, notes: '' })
    projectState.touch()
  }
  function reset(marker: string): void {
    const stages = lexeme.etymology.stages
    const at = stages.findIndex((s) => s.stage === marker)
    if (at < 0) return
    stages.splice(at, 1)
    projectState.touch()
  }
</script>

{#if chain && chain.steps.length > 1}
  <section class="history">
    <div class="row head">
      <span class="small muted">{t('lexicon.history.title')}</span>
      <button
        class="small link"
        title={t('lexicon.history.openRuleSet')}
        onclick={() => ui.jump('soundChanges', 'ruleSet', chain.ruleSetId)}
        >{chain.ruleSetName}</button
      >
      {#if !chain.matches}<span class="small warn" title={t('lexicon.history.mismatchHint')}
          >{t('lexicon.history.mismatch')}</span
        >{/if}
    </div>
    <div class="chain">
      {#each chain.steps as s, i (s.marker)}
        {#if i}<span class="arrow">→</span>{/if}
        <span class="step" title={s.title}>
          <span class="lbl">{s.label}</span>
          {#if editing === s.marker}
            <!-- svelte-ignore a11y_autofocus -->
            <input
              class="input data sm"
              autofocus
              bind:value={draft}
              onblur={() => commit(s.marker, s.form)}
              onkeydown={(e) => {
                if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                else if (e.key === 'Escape') {
                  cancelled = true
                  ;(e.currentTarget as HTMLInputElement).blur()
                }
              }}
            />
          {:else}
            <button
              class="form data"
              class:edited={s.edited}
              class:plain={!controls}
              title={controls ? t('lexicon.history.edit') : ''}
              onclick={() => start(s.marker, s.form)}
              >{s.form}{#if s.edited}<Pencil size={10} />{/if}</button
            >
            {#if s.edited && controls}<button
                class="undo"
                title={t('lexicon.history.reset')}
                onclick={() => reset(s.marker)}><RotateCcw size={11} /></button
              >{/if}
          {/if}
        </span>
      {/each}
    </div>
  </section>
{/if}

<style>
  .history {
    margin-top: 4px;
  }
  .head {
    gap: 8px;
    margin-bottom: 4px;
  }
  .link {
    border: 0;
    background: none;
    padding: 0;
    color: var(--accent-text);
    cursor: pointer;
  }
  .warn {
    color: var(--warn);
  }
  .chain {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px 6px;
  }
  .step {
    display: inline-flex;
    align-items: baseline;
    gap: 4px;
  }
  .lbl {
    font-size: 0.75em;
    color: var(--text-3);
  }
  /* 手改过的那一步标一支笔，后面几步都从它接着推 */
  .form {
    border: 0;
    background: none;
    padding: 0 2px;
    border-radius: 4px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .form.plain {
    cursor: default;
  }
  .form:not(.plain):hover {
    background: var(--bg-hover);
  }
  .form.edited {
    color: var(--accent-text);
  }
  .undo {
    border: 0;
    background: none;
    padding: 0;
    color: var(--text-3);
    cursor: pointer;
  }
  .undo:hover {
    color: var(--text);
  }
  .arrow {
    color: var(--text-3);
  }
  .input.sm {
    width: 8em;
    padding: 1px 4px;
    font-size: 0.9em;
  }
</style>
