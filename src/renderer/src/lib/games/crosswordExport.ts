/**
 * 填字导出：
 * - 单文件 HTML：别人用浏览器打开就能填、能对答案，不用装千语集
 * - PNG：空白盘面 + 提示，适合打印或发图（HTML 里也有打印样式，可以另存为 PDF）
 */
import type { Crossword } from './crossword'

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export interface ExportInfo {
  title: string
  /** 语言名，写在标题下面 */
  language: string
  /** 出处：项目名 */
  project: string
}

/** 每个格子的题号（起点格才有） */
export function numberMap(cw: Crossword): Map<string, number> {
  const out = new Map<string, number>()
  for (const p of cw.placed) out.set(`${p.row},${p.col}`, p.num)
  return out
}

export function crosswordHtml(cw: Crossword, info: ExportInfo): string {
  const nums = numberMap(cw)
  const answer = cw.grid.map((row) => row.map((c) => c ?? ''))
  const clue = (dir: 'across' | 'down'): string =>
    cw.placed
      .filter((p) => p.dir === dir)
      .sort((a, b) => a.num - b.num)
      .map(
        (p) =>
          `<li><b>${p.num}.</b> ${esc(p.gloss)} <span class="len">(${p.letters.length})</span></li>`
      )
      .join('\n')
  const cells = cw.grid
    .map((row, r) =>
      row
        .map((cell, c) => {
          if (!cell) return '<td class="blank"></td>'
          const n = nums.get(`${r},${c}`)
          return `<td>${n ? `<span class="n">${n}</span>` : ''}<input maxlength="2" data-r="${r}" data-c="${c}" autocomplete="off"></td>`
        })
        .join('')
    )
    .map((row) => `<tr>${row}</tr>`)
    .join('\n')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(info.title)}</title>
<style>
  :root { color-scheme: light dark; --line:#888; --bg:#fff; --fg:#111; --ok:#1a7f5a; --bad:#b3261e; }
  @media (prefers-color-scheme: dark) { :root { --bg:#16181c; --fg:#e8e8e8; --line:#666; } }
  body { margin:0; padding:24px; font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; background:var(--bg); color:var(--fg); }
  h1 { font-size:20px; margin:0 0 2px; } .sub { color:#888; font-size:13px; margin:0 0 16px; }
  .wrap { display:flex; flex-wrap:wrap; gap:28px; align-items:flex-start; }
  table { border-collapse:collapse; }
  td { width:34px; height:34px; border:1px solid var(--line); position:relative; padding:0; }
  td.blank { background:transparent; border:0; }
  .n { position:absolute; top:1px; left:2px; font-size:9px; color:#888; }
  input { width:100%; height:100%; border:0; background:transparent; text-align:center; font-size:17px; color:inherit; text-transform:lowercase; }
  input:focus { outline:2px solid #4a9; outline-offset:-2px; }
  input.ok { color:var(--ok); } input.bad { color:var(--bad); }
  .clues { display:flex; gap:28px; flex-wrap:wrap; }
  .clues h2 { font-size:14px; text-transform:uppercase; letter-spacing:.06em; color:#888; margin:0 0 6px; }
  ol { margin:0; padding-left:0; max-width:320px; list-style:none; } li { margin:3px 0; }
  .len { color:#999; font-size:12px; }
  .bar { margin-top:18px; display:flex; gap:8px; }
  button { font:inherit; padding:6px 12px; border:1px solid var(--line); border-radius:6px; background:transparent; color:inherit; cursor:pointer; }
  .msg { margin-left:8px; align-self:center; font-size:14px; }
  footer { margin-top:24px; color:#999; font-size:12px; }
  @media print { .bar, footer { display:none; } input { color:transparent; } }
</style></head>
<body>
<h1>${esc(info.title)}</h1>
<p class="sub">${esc(info.language)}${info.project ? ' · ' + esc(info.project) : ''}</p>
<div class="wrap">
  <table>${cells}</table>
  <div class="clues">
    <div><h2>Across</h2><ol>${clue('across')}</ol></div>
    <div><h2>Down</h2><ol>${clue('down')}</ol></div>
  </div>
</div>
<div class="bar">
  <button id="check">Check</button>
  <button id="reveal">Reveal</button>
  <button id="clear">Clear</button>
  <span class="msg" id="msg"></span>
</div>
<footer>Made with Qonlang · 千语集</footer>
<script>
  const answer = ${JSON.stringify(answer)};
  const inputs = [...document.querySelectorAll('input')];
  const same = (a, b) => (a || '').toLowerCase() === (b || '').toLowerCase();
  const at = (i) => answer[+i.dataset.r][+i.dataset.c];
  document.getElementById('check').onclick = () => {
    let bad = 0, empty = 0;
    for (const i of inputs) {
      i.classList.remove('ok', 'bad');
      if (!i.value.trim()) { empty++; continue; }
      if (same(i.value.trim(), at(i))) i.classList.add('ok'); else { i.classList.add('bad'); bad++; }
    }
    document.getElementById('msg').textContent =
      bad === 0 && empty === 0 ? 'All correct!' : bad + ' wrong, ' + empty + ' blank';
  };
  document.getElementById('reveal').onclick = () => {
    for (const i of inputs) { i.value = at(i); i.classList.remove('bad'); i.classList.add('ok'); }
    document.getElementById('msg').textContent = '';
  };
  document.getElementById('clear').onclick = () => {
    for (const i of inputs) { i.value = ''; i.classList.remove('ok', 'bad'); }
    document.getElementById('msg').textContent = '';
  };
  // 打字自动跳到下一格
  for (let k = 0; k < inputs.length; k++) inputs[k].addEventListener('input', () => {
    if (inputs[k].value) (inputs[k + 1] || inputs[k]).focus();
  });
</script>
</body></html>`
}

/** 空白盘面 + 提示画成 PNG（打印或发图用） */
export function crosswordPng(
  cw: Crossword,
  info: ExportInfo,
  opts: { cell?: number; scale?: number } = {}
): Promise<Blob> {
  const cell = opts.cell ?? 40
  const scale = opts.scale ?? 2
  const pad = 24
  const nums = numberMap(cw)
  const across = cw.placed.filter((p) => p.dir === 'across').sort((a, b) => a.num - b.num)
  const down = cw.placed.filter((p) => p.dir === 'down').sort((a, b) => a.num - b.num)
  const lineH = 20
  const clueRows = Math.max(across.length, down.length) + 2
  const gridW = cw.cols * cell
  const gridH = cw.rows * cell
  const clueW = 560
  const width = pad * 2 + Math.max(gridW, clueW)
  const height = pad * 2 + 54 + gridH + 24 + clueRows * lineH
  const canvas = document.createElement('canvas')
  canvas.width = width * scale
  canvas.height = height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#111'
  ctx.font = '600 20px system-ui, sans-serif'
  ctx.fillText(info.title, pad, pad + 18)
  ctx.font = '13px system-ui, sans-serif'
  ctx.fillStyle = '#777'
  ctx.fillText(`${info.language}${info.project ? ' · ' + info.project : ''}`, pad, pad + 38)

  const top = pad + 54
  ctx.strokeStyle = '#444'
  ctx.lineWidth = 1
  for (let r = 0; r < cw.rows; r++)
    for (let c = 0; c < cw.cols; c++) {
      if (!cw.grid[r][c]) continue
      const x = pad + c * cell
      const y = top + r * cell
      ctx.fillStyle = '#fff'
      ctx.fillRect(x, y, cell, cell)
      ctx.strokeRect(x + 0.5, y + 0.5, cell, cell)
      const n = nums.get(`${r},${c}`)
      if (n) {
        ctx.fillStyle = '#888'
        ctx.font = '10px system-ui, sans-serif'
        ctx.fillText(String(n), x + 3, y + 12)
      }
    }

  const y = top + gridH + 28
  ctx.font = '600 13px system-ui, sans-serif'
  ctx.fillStyle = '#111'
  ctx.fillText('横', pad, y)
  ctx.fillText('竖', pad + clueW / 2, y)
  ctx.font = '13px system-ui, sans-serif'
  const draw = (list: typeof across, x: number): void => {
    let yy = y + lineH
    for (const p of list) {
      ctx.fillStyle = '#111'
      ctx.fillText(`${p.num}. ${p.gloss} (${p.letters.length})`, x, yy)
      yy += lineH
    }
  }
  draw(across, pad)
  draw(down, pad + clueW / 2)
  ctx.fillStyle = '#999'
  ctx.font = '11px system-ui, sans-serif'
  ctx.fillText('Made with Qonlang · 千语集', pad, height - pad / 2)

  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
  )
}
