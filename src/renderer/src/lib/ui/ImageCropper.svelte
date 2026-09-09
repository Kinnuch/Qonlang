<script lang="ts">
  /** 裁剪对话框：固定比例的裁剪框，拖动移动、滚轮 / 滑块缩放，输出项目设置的尺寸。 */
  import { t } from '$lib/i18n/index.svelte'
  import { cropToDataUrl, type ImageSize } from '$lib/core/images'
  import { Check, X } from '@lucide/svelte'

  let {
    img,
    mime,
    size,
    onresult,
    oncancel
  }: {
    img: HTMLImageElement
    mime: string
    size: ImageSize
    onresult: (dataUrl: string) => void
    oncancel: () => void
  } = $props()

  const MAXW = 560
  const MAXH = 420
  const scale = $derived(Math.min(MAXW / img.naturalWidth, MAXH / img.naturalHeight, 1))
  const dispW = $derived(img.naturalWidth * scale)
  const dispH = $derived(img.naturalHeight * scale)
  const aspect = $derived(size.width / size.height)

  // 裁剪框（显示坐标系）：只有 zoom 与拖动偏移是状态，尺寸与位置全部由它们推出，
  // 避免两个 $effect 互相写入造成无限更新（effect_update_depth_exceeded）
  let zoom = $state(1) // 1 = 最大可能的裁剪框
  let panX = $state<number | null>(null) // null = 尚未拖动过，居中
  let panY = $state<number | null>(null)
  const maxW = $derived(Math.min(dispW, dispH * aspect))
  const cw = $derived(maxW * zoom)
  const ch = $derived(cw / aspect)
  const clamp = (v: number, max: number): number => Math.min(Math.max(0, v), Math.max(0, max))
  const cx = $derived(panX === null ? (dispW - cw) / 2 : clamp(panX, dispW - cw))
  const cy = $derived(panY === null ? (dispH - ch) / 2 : clamp(panY, dispH - ch))

  let dragging = false
  let sx = 0
  let sy = 0
  let ox = 0
  let oy = 0
  function down(e: PointerEvent): void {
    dragging = true
    sx = e.clientX
    sy = e.clientY
    ox = cx
    oy = cy
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  function move(e: PointerEvent): void {
    if (!dragging) return
    panX = clamp(ox + e.clientX - sx, dispW - cw)
    panY = clamp(oy + e.clientY - sy, dispH - ch)
  }
  function up(): void {
    dragging = false
  }
  function wheel(e: WheelEvent): void {
    e.preventDefault()
    zoom = Math.min(1, Math.max(0.1, zoom - Math.sign(e.deltaY) * 0.05))
  }
  function done(): void {
    onresult(cropToDataUrl(img, cx / scale, cy / scale, cw / scale, ch / scale, size, mime))
  }
</script>

<div class="backdrop" role="presentation" onclick={oncancel}></div>
<div class="dlg card" role="dialog" aria-modal="true">
  <p class="small muted">
    {t('images.cropHint', {
      w: size.width,
      h: size.height,
      iw: img.naturalWidth,
      ih: img.naturalHeight
    })}
  </p>
  <div
    class="stage"
    style:width={`${dispW}px`}
    style:height={`${dispH}px`}
    style:background-image={`url(${img.src})`}
    onwheel={wheel}
    role="presentation"
  >
    <div
      class="crop"
      style:left={`${cx}px`}
      style:top={`${cy}px`}
      style:width={`${cw}px`}
      style:height={`${ch}px`}
      onpointerdown={down}
      onpointermove={move}
      onpointerup={up}
      role="presentation"
    ></div>
  </div>
  <div class="row ctl">
    <span class="small muted">{t('images.zoom')}</span>
    <input type="range" min="0.1" max="1" step="0.01" bind:value={zoom} />
    <span class="grow"></span>
    <button class="btn sm" onclick={oncancel}><X size={14} />{t('common.cancel')}</button>
    <button class="btn primary sm" onclick={done}><Check size={14} />{t('images.crop')}</button>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    background: rgba(0, 0, 0, 0.35);
  }
  .dlg {
    position: fixed;
    z-index: 91;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    padding: 14px 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    box-shadow: var(--shadow-lg);
    max-width: calc(100vw - 40px);
  }
  .stage {
    position: relative;
    background-size: 100% 100%;
    background-repeat: no-repeat;
    overflow: hidden;
    border-radius: var(--radius-sm);
    outline: 1px solid var(--border);
    align-self: center;
    user-select: none;
  }
  .crop {
    position: absolute;
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.45);
    border: 2px solid #fff;
    cursor: move;
    touch-action: none;
  }
  .ctl {
    gap: 8px;
  }
  .ctl input[type='range'] {
    width: 160px;
  }
</style>
