<script lang="ts">
  /** 单词卡：正面词头、背面释义（可以反过来）；不认识的会再来一轮 */
  import type { Language, Project } from '$lib/core/model'
  import { t } from '$lib/i18n/index.svelte'
  import { gameWords, makeRandom, shuffle, type GameWord } from './words'
  import { splitLetters } from './letters'
  import { RotateCcw, Check, X, Shuffle } from '@lucide/svelte'

  let { project, language, units }: { project: Project; language: Language; units: string[] } =
    $props()

  let flipped = $state(false)
  let back = $state(false)
  let at = $state(0)
  let seed = $state(Date.now() >>> 0)
  let again = $state<GameWord[]>([])
  let known = $state(0)

  const all = $derived(gameWords(project, language.id, {}, (w) => splitLetters(w, units)))
  const deck = $derived(shuffle(all, makeRandom(seed)))
  const card = $derived<GameWord | null>(deck[at] ?? again[at - deck.length] ?? null)
  const total = $derived(deck.length + again.length)

  function answer(ok: boolean): void {
    if (!card) return
    if (ok) known++
    else if (!again.includes(card)) again = [...again, card]
    flipped = false
    at++
  }
  function restart(): void {
    seed = (seed * 16807 + 1) >>> 0
    at = 0
    again = []
    known = 0
    flipped = false
  }
</script>

{#if !all.length}
  <p class="muted">{t('games.noWords')}</p>
{:else if !card}
  <div class="done card">
    <strong>{t('games.flashcard.done', { known, total: known + again.length })}</strong>
    <button class="btn primary" onclick={restart}><RotateCcw size={14} />{t('games.again')}</button>
  </div>
{:else}
  <div class="row bar">
    <span class="small muted">{at + 1} / {total}</span>
    <span class="grow"></span>
    <label class="row small check"
      ><input type="checkbox" bind:checked={back} />{t('games.flashcard.reverse')}</label
    >
    <button class="btn ghost sm" onclick={restart}
      ><Shuffle size={13} />{t('games.reshuffle')}</button
    >
  </div>

  <!-- 点卡片翻面 -->
  <button class="fc card" class:flipped onclick={() => (flipped = !flipped)}>
    {#if flipped !== back}
      <span class="small muted">{t('games.flashcard.meaning')}</span>
      <strong class="meaning">{card.gloss}</strong>
    {:else}
      <span class="small muted">{t('games.flashcard.word')}</span>
      <strong class="word data">{card.word}</strong>
    {/if}
    <span class="tiny muted hint">{t('games.flashcard.flip')}</span>
  </button>

  <div class="row acts">
    <button class="btn" onclick={() => answer(false)}
      ><X size={14} />{t('games.flashcard.no')}</button
    >
    <button class="btn primary" onclick={() => answer(true)}
      ><Check size={14} />{t('games.flashcard.yes')}</button
    >
  </div>
{/if}

<style>
  .bar {
    gap: 10px;
  }
  .fc {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 220px;
    cursor: pointer;
    border: 1px solid var(--border);
    background: var(--bg-elev);
    transition: border-color 0.12s;
  }
  .fc:hover {
    border-color: var(--accent);
  }
  .word {
    font-size: 34px;
  }
  .meaning {
    font-size: 24px;
    text-align: center;
  }
  .hint {
    opacity: 0.6;
  }
  .acts {
    justify-content: center;
    gap: 12px;
  }
  .done {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 28px;
  }
</style>
