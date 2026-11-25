<script lang="ts">
  import type { GlyphDrawing } from '$lib/core/model'
  import { contourSvg } from '$lib/script/glyphGeometry'
  let { drawing, label }: { drawing: GlyphDrawing; label: string } = $props()
</script>

<svg
  viewBox={`-100 -900 ${Math.max(1200, drawing.advance + 200)} 1200`}
  role="img"
  aria-label={label}
>
  <path d={(drawing.contours ?? []).map(contourSvg).join('')} fill="currentColor" />
  {#each drawing.strokes as stroke, i (i)}<polyline
      points={stroke.points.map((p) => `${p[0]},${-p[1]}`).join(' ')}
      fill="none"
      stroke="currentColor"
      stroke-width={stroke.width}
      stroke-linecap="round"
      stroke-linejoin="round"
    />{/each}
</svg>

<style>
  svg {
    width: 100%;
    height: 72px;
    display: block;
  }
</style>
