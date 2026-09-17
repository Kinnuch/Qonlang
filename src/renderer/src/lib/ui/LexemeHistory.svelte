<script lang="ts">
  /**
   * 词条的历史形式链（显示模式里例句上方）：词源来源按音变一路推下来，每个阶段的形式连成一行。
   * 只有音变里从来源到这个词的每个阶段标记都绑了语言（或语言的阶段）时才出现。
   */
  import type { Lexeme, Project } from '$lib/core/model'
  import { historyChain } from '$lib/core/history'
  import { t } from '$lib/i18n/index.svelte'
  import { ui } from '$lib/state/ui.svelte'

  let { lexeme, project }: { lexeme: Lexeme; project: Project } = $props()

  const chain = $derived(historyChain(project, lexeme))
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
      {#each chain.steps as s, i (i)}
        {#if i}<span class="arrow">→</span>{/if}
        <span class="step" title={s.title}
          ><span class="lbl">{s.label}</span><span class="data form">{s.form}</span></span
        >
      {/each}
    </div>
  </section>
{/if}

<style>
  .history {
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
  }
  .head {
    gap: 8px;
    margin-bottom: 6px;
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
    font-size: 11px;
    color: var(--text-3);
  }
  .arrow {
    color: var(--text-3);
  }
</style>
