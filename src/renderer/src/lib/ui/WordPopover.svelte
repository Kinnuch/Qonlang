<script lang="ts">
  /**
   * 悬浮词卡：把词库显示模式的词条卡以浮层形式显示在某个词旁，可跳到词库。
   * 用法：wordHover.show(lexemeId, anchorRect) / wordHover.hide()
   */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { wordHover } from '$lib/state/wordHover.svelte'
  import LexemeCard from './LexemeCard.svelte'
  import { BookOpen } from '@lucide/svelte'

  const project = $derived(projectState.project)
  const lexeme = $derived(project && wordHover.lexemeId ? project.lexemes.find((l) => l.id === wordHover.lexemeId) : null)
  const style = $derived.by(() => {
    const r = wordHover.rect
    if (!r) return ''
    const W = 380
    const H = 360
    let left = r.left
    if (left + W > window.innerWidth - 12) left = Math.max(12, window.innerWidth - W - 12)
    const below = r.bottom + 8
    const top = below + H > window.innerHeight - 12 ? Math.max(12, r.top - H - 8) : below
    return `left:${left}px;top:${top}px;width:${W}px;max-height:${H}px`
  })
  function openInLexicon(): void {
    if (!lexeme) return
    ui.pendingLexemeId = lexeme.id
    projectState.currentLanguageId = lexeme.languageId
    wordHover.hide(true)
    ui.go('lexicon')
  }
</script>

{#if lexeme && wordHover.rect}
  <div class="pop card" {style} role="dialog" onmouseenter={() => wordHover.keep()} onmouseleave={() => wordHover.hide()}>
    <div class="body">
      <LexemeCard {lexeme} project={project!} />
    </div>
    <div class="foot">
      <button class="btn sm" onclick={openInLexicon}><BookOpen size={14} />{t('corpus.openInLexicon')}</button>
    </div>
  </div>
{/if}

<style>
  .pop {
    position: fixed;
    z-index: 70;
    display: flex;
    flex-direction: column;
    box-shadow: var(--shadow-lg);
    animation: rise 0.14s ease-out;
    overflow: hidden;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }
  .body {
    padding: 14px 16px 8px;
    overflow: auto;
    flex: 1;
    min-height: 0;
    font-size: 13px;
  }
  .body :global(.lemma) {
    font-size: 22px;
  }
  .foot {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
</style>
