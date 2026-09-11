<script lang="ts">
  /**
   * 图文引导的浮层：把目标元素圈出来（四周压暗），旁边一个说明气泡加箭头，底部「1 / N」。
   * 讲完弹框：去网站看完整教程，下面一个「以后每次都先看引导」的勾选。
   */
  import { tour } from '$lib/state/tour.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t } from '$lib/i18n/index.svelte'
  import { X, ExternalLink } from '@lucide/svelte'

  let rect = $state<DOMRect | null>(null)
  let vw = $state(typeof window !== 'undefined' ? window.innerWidth : 1200)
  let vh = $state(typeof window !== 'undefined' ? window.innerHeight : 800)
  const step = $derived(tour.active ? tour.steps[tour.index] : null)
  // 换了页面（返回、跳转）就结束讲解，免得指着别的页面的按钮讲
  let lastSection = ui.section
  $effect(() => {
    const s = ui.section
    if (s === lastSection) return
    lastSection = s
    if (tour.active || tour.ending) tour.close()
  })

  $effect(() => {
    if (!step) {
      rect = null
      return
    }
    const sel = step.selector
    const measure = (): void => {
      vw = window.innerWidth
      vh = window.innerHeight
      const el = [...document.querySelectorAll<HTMLElement>(sel)].find(
        (e) => e.getClientRects().length > 0
      )
      if (!el) {
        rect = null
        return
      }
      el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      rect = el.getBoundingClientRect()
    }
    measure()
    const raf = requestAnimationFrame(measure)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measure)
    }
  })

  $effect(() => {
    if (!tour.active && !tour.ending) return
    const onKey = (e: KeyboardEvent): void => {
      // Alt+← 是「返回」，不当成上一步
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (tour.active) tour.finish()
        else tour.close()
      } else if (tour.active && (e.key === 'ArrowRight' || e.key === 'Enter')) {
        e.preventDefault()
        tour.next()
      } else if (tour.active && e.key === 'ArrowLeft') {
        e.preventDefault()
        tour.prev()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const PAD = 6
  const BW = 320
  const BH = 150
  /** 气泡放目标下面，放不下就上面；都放不下就放右边；没有目标就居中 */
  const bubble = $derived.by(() => {
    if (!rect) return { left: (vw - BW) / 2, top: vh / 2 - BH / 2, side: 'none' as const }
    const left = Math.max(12, Math.min(vw - BW - 12, rect.left + rect.width / 2 - BW / 2))
    if (rect.bottom + 18 + BH < vh) return { left, top: rect.bottom + 18, side: 'below' as const }
    if (rect.top - 18 - BH > 0) return { left, top: rect.top - 18 - BH, side: 'above' as const }
    return {
      left: Math.max(12, Math.min(vw - BW - 12, rect.left - BW - 24)),
      top: Math.max(12, Math.min(vh - BH - 12, rect.top)),
      side: 'side' as const
    }
  })
  /** 箭头：从气泡边缘指向目标 */
  const arrow = $derived.by(() => {
    if (!rect || bubble.side === 'none') return null
    const tx = Math.max(rect.left + 8, Math.min(rect.right - 8, bubble.left + BW / 2))
    if (bubble.side === 'below')
      return { x1: bubble.left + BW / 2, y1: bubble.top, x2: tx, y2: rect.bottom + PAD + 2 }
    if (bubble.side === 'above')
      return { x1: bubble.left + BW / 2, y1: bubble.top + BH, x2: tx, y2: rect.top - PAD - 2 }
    return {
      x1: bubble.left + BW,
      y1: bubble.top + 30,
      x2: rect.left - PAD - 2,
      y2: rect.top + Math.min(rect.height / 2, 30)
    }
  })
  const text = $derived(tour.section && step ? t(`tour.steps.${tour.section}.${tour.index}`) : '')
</script>

{#if tour.active && step}
  <div class="tour" role="dialog" aria-modal="true" aria-label={t('tour.title')}>
    {#if rect}
      <div
        class="hole"
        style:left="{rect.left - PAD}px"
        style:top="{rect.top - PAD}px"
        style:width="{rect.width + PAD * 2}px"
        style:height="{rect.height + PAD * 2}px"
      ></div>
    {:else}
      <div class="dim"></div>
    {/if}
    {#if arrow}
      <svg class="arrow" width={vw} height={vh} aria-hidden="true">
        <defs>
          <marker id="tour-head" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" />
          </marker>
        </defs>
        <line
          x1={arrow.x1}
          y1={arrow.y1}
          x2={arrow.x2}
          y2={arrow.y2}
          marker-end="url(#tour-head)"
        />
      </svg>
    {/if}
    <div class="bubble card" style:left="{bubble.left}px" style:top="{bubble.top}px">
      <div class="row head">
        <strong class="grow">{t(`nav.${tour.section}`)}</strong>
        <span class="small muted">{tour.index + 1} / {tour.steps.length}</span>
        <button class="btn ghost icon sm" title={t('tour.skip')} onclick={() => tour.finish()}
          ><X size={14} /></button
        >
      </div>
      <p class="text">{text}</p>
      <div class="row foot">
        <button class="btn ghost sm" onclick={() => tour.finish()}>{t('tour.skip')}</button>
        <span class="grow"></span>
        {#if tour.index > 0}
          <button class="btn sm" onclick={() => tour.prev()}>{t('tour.prev')}</button>
        {/if}
        <button class="btn primary sm" onclick={() => tour.next()}
          >{tour.index < tour.steps.length - 1 ? t('tour.next') : t('tour.done')}</button
        >
      </div>
    </div>
  </div>
{/if}

{#if tour.ending}
  <div class="backdrop" role="presentation" onclick={() => tour.close()}></div>
  <div class="end card" role="dialog" aria-modal="true" aria-label={t('tour.endTitle')}>
    <strong>{t('tour.endTitle')}</strong>
    <p class="small muted">{t('tour.endBody')}</p>
    <label class="row check">
      <input
        type="checkbox"
        bind:checked={ui.prefs.guideTourAlways}
        onchange={() => ui.savePrefs()}
      />
      {t('tour.always')}
    </label>
    <div class="row foot">
      <button class="btn sm" onclick={() => tour.close()}>{t('common.close')}</button>
      <span class="grow"></span>
      <button class="btn primary sm" onclick={() => tour.openSite()}
        ><ExternalLink size={14} />{t('tour.openSite')}</button
      >
    </div>
  </div>
{/if}

<style>
  .tour {
    position: fixed;
    inset: 0;
    z-index: 200;
  }
  .dim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
  }
  /* 圈出目标：大阴影把四周压暗，中间留一个透明的洞 */
  .hole {
    position: fixed;
    border-radius: 10px;
    box-shadow:
      0 0 0 3px var(--accent),
      0 0 0 9999px rgba(0, 0, 0, 0.45);
    pointer-events: none;
    transition:
      left 0.2s,
      top 0.2s,
      width 0.2s,
      height 0.2s;
  }
  .arrow {
    position: fixed;
    inset: 0;
    pointer-events: none;
  }
  .arrow line {
    stroke: var(--accent);
    stroke-width: 2.5;
  }
  .arrow path {
    fill: var(--accent);
  }
  .bubble {
    position: fixed;
    width: 320px;
    min-height: 120px;
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    box-shadow: var(--shadow-lg);
    border-color: var(--accent);
  }
  .head {
    gap: 8px;
  }
  .text {
    margin: 0;
    font-size: 14px;
    line-height: 1.6;
    flex: 1;
  }
  .foot {
    gap: 6px;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(0, 0, 0, 0.3);
  }
  .end {
    position: fixed;
    z-index: 201;
    left: 50%;
    top: 30vh;
    transform: translateX(-50%);
    width: min(420px, 90vw);
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: var(--shadow-lg);
  }
  .end p {
    margin: 0;
  }
  .check {
    gap: 6px;
    font-size: 13px;
  }
</style>
