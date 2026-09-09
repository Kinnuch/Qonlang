<script lang="ts">
  /**
   * 悬浮词卡：把词库显示模式的词条卡以浮层形式显示在某个词旁，可跳到词库。
   * 复合词与词根语素列成小块，点一下就切过去看那一部分。
   * 用法：wordHover.show(lexemeId, rect) / wordHover.showMorpheme(id, rect) / wordHover.hide()
   */
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { wordHover } from '$lib/state/wordHover.svelte'
  import LexemeCard from './LexemeCard.svelte'
  import { etymologyText } from '$lib/core/etymology'
  import type { Id } from '$lib/core/model'
  import { BookOpen, Blocks } from '@lucide/svelte'

  const project = $derived(projectState.project)
  const lexeme = $derived(
    project && wordHover.lexemeId ? project.lexemes.find((l) => l.id === wordHover.lexemeId) : null
  )
  const morpheme = $derived(
    project && wordHover.morphemeId
      ? project.morphemes.find((m) => m.id === wordHover.morphemeId)
      : null
  )
  const glossLangs = $derived(project?.settings.glossLanguages ?? [])

  interface Part {
    label: string
    lexemeId?: Id
    morphemeId?: Id
  }
  /** 词源里的组成部分：复合词的各个词、词根语素等 */
  const parts = $derived.by((): Part[] => {
    const ety = lexeme?.etymology ?? morpheme?.etymology
    if (!project || !ety) return []
    const out: Part[] = []
    for (const s of ety.sources) {
      if (s.kind === 'lexeme') {
        const x = project.lexemes.find((y) => y.id === s.id)
        if (x) out.push({ label: x.lemma, lexemeId: x.id })
      } else if (s.kind === 'morpheme') {
        const m = project.morphemes.find((y) => y.id === s.id)
        if (m) out.push({ label: (ety.type === 'root' ? '*' : '') + m.form, morphemeId: m.id })
      }
    }
    return out
  })

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
    if (lexeme) {
      ui.pendingLexemeId = lexeme.id
      projectState.currentLanguageId = lexeme.languageId
      wordHover.hide(true)
      ui.go('lexicon')
    } else if (morpheme) {
      wordHover.hide(true)
      ui.jump('morphemes', 'morpheme', morpheme.id)
    }
  }
</script>

{#if (lexeme || morpheme) && wordHover.rect}
  <div
    class="pop card"
    {style}
    role="dialog"
    tabindex="-1"
    onmouseenter={() => wordHover.keep()}
    onmouseleave={() => wordHover.hide()}
  >
    <div class="body">
      {#if lexeme}
        <LexemeCard {lexeme} project={project!} />
      {:else if morpheme}
        <div class="mor">
          <div class="row">
            <strong class="data big">{morpheme.form}</strong>
            <span class="badge">{t(`morphemes.types.${morpheme.type}`)}</span>
            {#if morpheme.gloss}<span class="badge mono">{morpheme.gloss}</span>{/if}
          </div>
          <p>{pickText(morpheme.meaning, glossLangs)}</p>
          {#if morpheme.etymology.sources.length}
            <p class="small muted data">
              {etymologyText(project!, morpheme.etymology, morpheme.form)}
            </p>
          {/if}
          {#if morpheme.notes}<p class="small muted">{morpheme.notes}</p>{/if}
        </div>
      {/if}
    </div>
    {#if parts.length}
      <div class="parts">
        <Blocks size={12} />
        {#each parts as p (p.label + (p.lexemeId ?? p.morphemeId))}
          <button
            class="chip"
            onmouseenter={() => wordHover.swap(p)}
            onclick={() => wordHover.swap(p)}>{p.label}</button
          >
        {/each}
      </div>
    {/if}
    <div class="foot">
      <button class="btn sm" onclick={openInLexicon}
        ><BookOpen size={14} />{t('corpus.openInLexicon')}</button
      >
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
  .mor .big {
    font-size: 20px;
  }
  .mor p {
    margin: 4px 0 0;
  }
  .parts {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    padding: 6px 12px;
    border-top: 1px solid var(--border);
    color: var(--text-3);
  }
  .parts .chip {
    cursor: pointer;
    font-family: var(--font-data);
  }
  .parts .chip:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .foot {
    padding: 8px 12px;
    border-top: 1px solid var(--border);
    background: var(--bg);
  }
</style>
