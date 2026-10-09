<script lang="ts">
  /**
   * 导出学习包（给 Qonsona 的）：设置课程、不给学习者看的内容、个别词的级别、默认显示、作者录音，
   * 再把项目连同这些设置导出成 `.qstudy.json`。设置不写进项目文件，按项目存在本机（studyExport）。
   */
  import { onDestroy, onMount } from 'svelte'
  import {
    ArrowLeft,
    Download,
    Upload,
    Plus,
    Trash2,
    FileText,
    Mic,
    Square,
    Play,
    FolderOpen,
    GripVertical,
    ListChecks
  } from '@lucide/svelte'
  import { projectState } from '$lib/state/project.svelte'
  import { ui } from '$lib/state/ui.svelte'
  import { t, pickText } from '$lib/i18n/index.svelte'
  import { platform } from '$lib/platform'
  import { studyExport } from '$lib/state/studyExport.svelte'
  import {
    STUDY_MAX_LEVEL,
    isPlaceholderLexeme,
    lessonsFromDocs,
    newLesson,
    studyAudioKey,
    type StudyLanguage
  } from '$lib/core/studyPack'
  import type { Lexeme } from '$lib/core/model'
  import { moveItem } from '$lib/core/move'
  import { mdToHtml } from '$lib/core/markdown'
  import { sortable } from '$lib/ui/sortable.svelte'
  import GuideLink from '$lib/ui/GuideLink.svelte'
  import HelpDot from '$lib/ui/HelpDot.svelte'
  import StudyPicker from '$lib/ui/StudyPicker.svelte'

  type Tab = 'cover' | 'lessons' | 'hidden' | 'levels' | 'display' | 'audio'
  type AudioKind = 'lexeme' | 'phrase' | 'sentence'
  const TABS: Tab[] = ['cover', 'lessons', 'hidden', 'levels', 'display', 'audio']
  const AUDIO_EXT: Record<string, string> = {
    webm: 'audio/webm',
    ogg: 'audio/ogg',
    opus: 'audio/ogg',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    flac: 'audio/flac'
  }
  /** 「隐藏」里一类最多先列这么多条，再多请筛选 */
  const HIDDEN_LIMIT = 400

  let { inspectorTitle = $bindable('') }: { inspectorTitle?: string } = $props()
  $effect(() => {
    inspectorTitle = t('studyExport.title')
  })

  const memo = ui.memo<{ languageId: string; tab: Tab; audioKind: AudioKind }>('studyExport')
  let languageId = $state(memo.languageId ?? '')
  let tab = $state<Tab>(memo.tab ?? 'cover')
  let audioKind = $state<AudioKind>(memo.audioKind ?? 'lexeme')
  $effect(() => {
    memo.languageId = languageId
    memo.tab = tab
    memo.audioKind = audioKind
  })

  const project = $derived(projectState.project)
  onMount(() => {
    if (project) void studyExport.open(project)
  })
  onDestroy(() => studyExport.flush())

  const settings = $derived(studyExport.settings)
  // 没记过（或换了项目）就用顶栏的当前语言，它不导出时挑第一门要导出的
  $effect(() => {
    if (!settings || settings.languages.some((l) => l.languageId === languageId)) return
    const cur = settings.languages.find(
      (l) => l.include && l.languageId === projectState.currentLanguageId
    )
    languageId =
      (cur ?? settings.languages.find((l) => l.include) ?? settings.languages[0])?.languageId ?? ''
  })
  const current = $derived(settings?.languages.find((l) => l.languageId === languageId) ?? null)
  const lang = $derived(project?.languages.find((l) => l.id === languageId) ?? null)
  const order = $derived(project?.settings.glossLanguages ?? [])
  const firstDef = (l: Lexeme): string =>
    l.senses.map((s) => pickText(s.definition, order)).find(Boolean) ?? ''

  const lexemes = $derived(project?.lexemes.filter((l) => l.languageId === languageId) ?? [])
  const sentences = $derived(project?.sentences.filter((s) => s.languageId === languageId) ?? [])
  const phrases = $derived(project?.phrasebook.filter((p) => p.languageId === languageId) ?? [])
  const docs = $derived(
    project?.docs.filter((d) => d.languageId === languageId || d.languageId === null) ?? []
  )
  const lexItems = $derived(lexemes.map((l) => ({ id: l.id, label: l.lemma, sub: firstDef(l) })))
  const sentItems = $derived(
    sentences.map((s) => ({ id: s.id, label: s.text, sub: pickText(s.translation, order) }))
  )
  const phraseItems = $derived(
    phrases.map((p) => ({ id: p.id, label: p.text, sub: pickText(p.translation, order) }))
  )

  /** 改当前语言的设置：改完记一笔，过一会儿自动存 */
  function edit(fn: (l: StudyLanguage) => void): void {
    if (!current) return
    fn(current)
    studyExport.touch()
  }
  const anyIncluded = $derived(!!settings?.languages.some((l) => l.include))

  // ── 课程 ──
  function addFromDocs(): void {
    if (!project || !current) return
    const add = lessonsFromDocs(project, current)
    if (!add.length) return void ui.toast(t('studyExport.lessons.fromDocsNone'))
    edit((l) => l.lessons.push(...add))
    ui.toast(t('studyExport.lessons.fromDocsDone', { n: add.length }))
  }

  // ── 隐藏 ──
  let hiddenQuery = $state('')
  const matchHidden = (text: string): boolean =>
    !hiddenQuery.trim() || text.toLowerCase().includes(hiddenQuery.trim().toLowerCase())
  function toggleHidden(kind: keyof StudyLanguage['hidden'], id: string, on: boolean): void {
    edit((l) => {
      const list = l.hidden[kind]
      if (on && !list.includes(id)) list.push(id)
      if (!on) l.hidden[kind] = list.filter((x) => x !== id)
    })
  }
  function hidePlaceholders(): void {
    edit((l) => {
      for (const x of lexemes)
        if (isPlaceholderLexeme(x.lemma) && !l.hidden.lexemeIds.includes(x.id))
          l.hidden.lexemeIds.push(x.id)
    })
  }

  // ── 级别 ──
  const pinned = $derived(current ? Object.keys(current.levels) : [])
  function setPinned(ids: string[]): void {
    edit((l) => {
      const next: Record<string, number> = {}
      for (const id of ids) next[id] = l.levels[id] ?? 1
      l.levels = next
    })
  }

  // ── 录音 ──
  let audioQuery = $state('')
  let onlyRecorded = $state(false)
  let recordingKey = $state<string | null>(null)
  let recorder: MediaRecorder | null = null
  const audioRows = $derived.by(() => {
    const rows =
      audioKind === 'lexeme' ? lexItems : audioKind === 'phrase' ? phraseItems : sentItems
    const q = audioQuery.trim().toLowerCase()
    return rows
      .map((r) => ({ ...r, key: studyAudioKey(audioKind, r.id) }))
      .filter(
        (r) =>
          (!onlyRecorded || current?.audio[r.key]) &&
          (!q || r.label.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q))
      )
  })
  const recordedCount = $derived(current ? Object.keys(current.audio).length : 0)

  function play(key: string): void {
    const a = current?.audio[key]
    if (a) void new Audio(a.dataUrl).play()
  }
  const setAudio = (key: string, dataUrl: string, name: string): void =>
    edit((l) => {
      l.audio[key] = { dataUrl, name }
    })

  async function startRecording(key: string): Promise<void> {
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      return void ui.error(t('studyExport.audio.noMic'))
    }
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream)
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      stream.getTracks().forEach((tr) => tr.stop())
      recordingKey = null
      recorder = null
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' })
      if (!blob.size) return
      const reader = new FileReader()
      reader.onload = () => setAudio(key, String(reader.result), `${key}.webm`)
      reader.readAsDataURL(blob)
    }
    recorder = rec
    recordingKey = key
    rec.start()
  }
  function stopRecording(): void {
    if (recorder?.state === 'recording') recorder.stop()
  }

  const dataUrlOf = (name: string, base64: string): string | null => {
    const mime = AUDIO_EXT[name.split('.').pop()?.toLowerCase() ?? '']
    return mime ? `data:${mime};base64,${base64}` : null
  }
  async function pickFile(key: string): Promise<void> {
    const [f] = await platform.readBinaryFiles({
      multiple: false,
      extensions: Object.keys(AUDIO_EXT)
    })
    const url = f && dataUrlOf(f.name, f.base64)
    if (url) setAudio(key, url, f.name)
  }
  /** 一次挑很多文件：文件名（去掉扩展名）跟词头、短语原文或例句原文一样就对上 */
  async function batchImport(): Promise<void> {
    const files = await platform.readBinaryFiles({
      multiple: true,
      extensions: Object.keys(AUDIO_EXT)
    })
    if (!files.length) return
    const norm = (s: string): string => s.normalize('NFC').trim().toLowerCase()
    const byText = new Map<string, string>()
    for (const x of phrases) byText.set(norm(x.text), studyAudioKey('phrase', x.id))
    for (const x of sentences) byText.set(norm(x.text), studyAudioKey('sentence', x.id))
    for (const x of lexemes) byText.set(norm(x.lemma), studyAudioKey('lexeme', x.id))
    let hit = 0
    edit((l) => {
      for (const f of files) {
        const key = byText.get(norm(f.name.replace(/\.[^.]+$/, '')))
        const url = dataUrlOf(f.name, f.base64)
        if (!key || !url) continue
        l.audio[key] = { dataUrl: url, name: f.name }
        hit++
      }
    })
    ui.toast(t('studyExport.audio.batchDone', { n: hit, m: files.length - hit }))
  }
</script>

<div class="page">
  <div class="row page-head">
    <button class="btn sm ghost" onclick={() => ui.go('settings')} title={t('studyExport.back')}
      ><ArrowLeft size={15} /></button
    >
    <h1>{t('studyExport.title')}</h1>
    <GuideLink section="studyExport" anchor="study-pack" />
    <div class="grow"></div>
    {#if project && !projectState.readOnly}
      <button class="btn sm" onclick={() => project && studyExport.loadFromPack(project)}
        ><Upload size={14} />{t('studyExport.loadFromPack')}</button
      >
      <button
        class="btn primary"
        data-study-export
        disabled={!anyIncluded}
        onclick={() => project && studyExport.export(project)}
        ><Download size={15} />{t('studyExport.export')}</button
      >
    {/if}
  </div>
  <p class="small muted">{t('studyExport.hint')}</p>

  {#if !project}
    <!-- 没开项目时进不来这一页 -->
  {:else if projectState.readOnly}
    <p class="card">{t('studyExport.readOnly')}</p>
  {:else if settings}
    <section class="card block">
      <div class="grid2">
        <div class="field">
          <label for="se-author">{t('studyExport.author')}</label>
          <input
            id="se-author"
            class="input"
            value={settings.author}
            oninput={(e) => {
              settings.author = e.currentTarget.value
              studyExport.touch()
            }}
          />
        </div>
      </div>
      <h3>{t('studyExport.languages')}<HelpDot tip={t('studyExport.languagesHint')} /></h3>
      <div class="langs">
        {#each settings.languages as sl (sl.languageId)}
          {@const l = project.languages.find((x) => x.id === sl.languageId)}
          {#if l}
            <div class="lang card" class:sel={sl.languageId === languageId} data-study-lang={l.id}>
              <label class="row check">
                <input
                  type="checkbox"
                  checked={sl.include}
                  onchange={(e) => {
                    sl.include = e.currentTarget.checked
                    studyExport.touch()
                  }}
                />
                <span class="dot" style:background-color={l.color}></span>
                <strong>{l.name}</strong>
              </label>
              <span class="small muted">
                {t('studyExport.counts', {
                  lexemes: project.lexemes.filter((x) => x.languageId === l.id).length,
                  sentences: project.sentences.filter((x) => x.languageId === l.id).length,
                  phrases: project.phrasebook.filter((x) => x.languageId === l.id).length
                })}
              </span>
              <button
                class="btn sm"
                class:active={sl.languageId === languageId}
                onclick={() => (languageId = sl.languageId)}>{t('studyExport.editLanguage')}</button
              >
            </div>
          {/if}
        {/each}
      </div>
    </section>

    {#if current && lang}
      <div class="row tabs">
        <h2 class="lang-title">{lang.name}</h2>
        <div class="seg">
          {#each TABS as x (x)}
            <button class:active={tab === x} data-study-tab={x} onclick={() => (tab = x)}
              >{t(`studyExport.tabs.${x}`)}</button
            >
          {/each}
        </div>
      </div>

      {#if tab === 'cover'}
        <section class="card block">
          <div class="field">
            <label for="se-title">{t('studyExport.cover.title')}</label>
            <input
              id="se-title"
              class="input"
              placeholder={lang.name}
              value={current.title}
              oninput={(e) => edit((l) => (l.title = e.currentTarget.value))}
            />
          </div>
          <div class="field">
            <label for="se-intro"
              >{t('studyExport.cover.intro')}<HelpDot
                tip={t('studyExport.cover.introHint')}
              /></label
            >
            <textarea
              id="se-intro"
              class="textarea"
              rows="8"
              value={current.intro}
              oninput={(e) => edit((l) => (l.intro = e.currentTarget.value))}
            ></textarea>
          </div>
          {#if current.intro.trim()}
            <div class="md preview">{@html mdToHtml(current.intro)}</div>
          {/if}
        </section>
      {:else if tab === 'lessons'}
        <div class="row tools">
          <button class="btn sm primary" onclick={() => edit((l) => l.lessons.push(newLesson()))}
            ><Plus size={14} />{t('studyExport.lessons.add')}</button
          >
          <button class="btn sm" onclick={addFromDocs}
            ><FileText size={14} />{t('studyExport.lessons.fromDocs')}</button
          >
          <HelpDot tip={t('studyExport.lessons.hint')} />
        </div>
        {#each current.lessons as lesson, i (lesson.id)}
          <section
            class="card block lesson"
            data-study-lesson={lesson.id}
            {...sortable('study-lessons', i, (from, to) =>
              edit((l) => void moveItem(l.lessons, from, to))
            )}
          >
            <div class="row">
              <GripVertical size={15} class="grip" />
              <span class="badge">{t('studyExport.lessons.lessonN', { n: i + 1 })}</span>
              <input
                class="input grow"
                placeholder={t('studyExport.lessons.title')}
                value={lesson.title}
                oninput={(e) => edit(() => (lesson.title = e.currentTarget.value))}
              />
              <button
                class="btn sm ghost danger"
                title={t('studyExport.lessons.remove')}
                onclick={() =>
                  edit((l) => (l.lessons = l.lessons.filter((x) => x.id !== lesson.id)))}
                ><Trash2 size={14} /></button
              >
            </div>
            <div class="field">
              <label for="se-doc-{lesson.id}">{t('studyExport.lessons.doc')}</label>
              <select
                id="se-doc-{lesson.id}"
                class="select"
                value={lesson.docId ?? ''}
                onchange={(e) => edit(() => (lesson.docId = e.currentTarget.value || null))}
              >
                <option value="">{t('studyExport.lessons.noDoc')}</option>
                {#each docs as d (d.id)}<option value={d.id}>{d.title}</option>{/each}
              </select>
            </div>
            <div class="grid3">
              <div class="field">
                <span class="label">{t('studyExport.lessons.words')}</span>
                <StudyPicker
                  items={lexItems}
                  selected={lesson.lexemeIds}
                  dataFont
                  onchange={(ids) => edit(() => (lesson.lexemeIds = ids))}
                />
              </div>
              <div class="field">
                <span class="label">{t('studyExport.lessons.sentences')}</span>
                <StudyPicker
                  items={sentItems}
                  selected={lesson.sentenceIds}
                  dataFont
                  onchange={(ids) => edit(() => (lesson.sentenceIds = ids))}
                />
              </div>
              <div class="field">
                <span class="label">{t('studyExport.lessons.phrases')}</span>
                <StudyPicker
                  items={phraseItems}
                  selected={lesson.phraseIds}
                  dataFont
                  onchange={(ids) => edit(() => (lesson.phraseIds = ids))}
                />
              </div>
            </div>
          </section>
        {:else}
          <p class="card empty small muted">{t('studyExport.lessons.empty')}</p>
        {/each}
      {:else if tab === 'hidden'}
        <div class="row tools">
          <input
            class="input filter"
            placeholder={t('studyExport.filter')}
            bind:value={hiddenQuery}
          />
          <button class="btn sm" onclick={hidePlaceholders}
            ><ListChecks size={14} />{t('studyExport.hidden.placeholders')}</button
          >
          <HelpDot tip={t('studyExport.hidden.hint')} />
        </div>
        <div class="hidden-grid">
          {#snippet hiddenList(
            kind: keyof StudyLanguage['hidden'],
            title: string,
            items: { id: string; label: string; sub?: string }[],
            data: boolean
          )}
            {@const shown = items.filter((x) => matchHidden(x.label + ' ' + (x.sub ?? '')))}
            <section class="card block">
              <h3>
                {title}
                <span class="small muted"
                  >{t('studyExport.hidden.count', { n: current!.hidden[kind].length })}</span
                >
              </h3>
              <ul class="checks">
                {#each shown.slice(0, HIDDEN_LIMIT) as x (x.id)}
                  <li>
                    <label class="row check">
                      <input
                        type="checkbox"
                        data-hide={x.id}
                        checked={current!.hidden[kind].includes(x.id)}
                        onchange={(e) => toggleHidden(kind, x.id, e.currentTarget.checked)}
                      />
                      <span class:data>{x.label}</span>
                      {#if x.sub}<span class="small muted sub">{x.sub}</span>{/if}
                    </label>
                  </li>
                {/each}
                {#if shown.length > HIDDEN_LIMIT}
                  <li class="small muted">
                    {t('studyExport.picker.more', { n: shown.length - HIDDEN_LIMIT })}
                  </li>
                {/if}
              </ul>
            </section>
          {/snippet}
          {@render hiddenList('lexemeIds', t('studyExport.kinds.lexeme'), lexItems, true)}
          {@render hiddenList('sentenceIds', t('studyExport.kinds.sentence'), sentItems, true)}
          {@render hiddenList('phraseIds', t('studyExport.kinds.phrase'), phraseItems, true)}
          {@render hiddenList(
            'docIds',
            t('studyExport.kinds.doc'),
            docs.map((d) => ({ id: d.id, label: d.title })),
            false
          )}
        </div>
      {:else if tab === 'levels'}
        <section class="card block">
          <p class="small muted">{t('studyExport.levels.hint')}</p>
          <div class="field">
            <span class="label">{t('studyExport.levels.add')}</span>
            <StudyPicker items={lexItems} selected={pinned} dataFont onchange={setPinned} />
          </div>
          {#if pinned.length}
            <table class="tbl levels">
              <tbody>
                {#each pinned as id (id)}
                  {@const x = lexemes.find((l) => l.id === id)}
                  {#if x}
                    <tr data-level-row={id}>
                      <td class="data">{x.lemma}</td>
                      <td class="small muted">{firstDef(x)}</td>
                      <td>
                        <select
                          class="select"
                          value={String(current.levels[id])}
                          onchange={(e) =>
                            edit((l) => (l.levels[id] = Number(e.currentTarget.value)))}
                        >
                          {#each Array.from({ length: STUDY_MAX_LEVEL }, (_, n) => n + 1) as n (n)}
                            <option value={String(n)}>{t('studyExport.levels.level', { n })}</option
                            >
                          {/each}
                        </select>
                      </td>
                    </tr>
                  {/if}
                {/each}
              </tbody>
            </table>
          {/if}
        </section>
      {:else if tab === 'display'}
        <section class="card block">
          <p class="small muted">{t('studyExport.display.hint')}</p>
          <div class="grid2">
            <div class="field">
              <label for="se-ortho">{t('studyExport.display.ortho')}</label>
              <select
                id="se-ortho"
                class="select"
                value={current.display.orthographyId ?? ''}
                onchange={(e) =>
                  edit((l) => (l.display.orthographyId = e.currentTarget.value || null))}
              >
                {#each lang.orthographies as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
              </select>
            </div>
            <div class="field">
              <label for="se-script">{t('studyExport.display.script')}</label>
              <select
                id="se-script"
                class="select"
                value={current.display.scriptId ?? ''}
                onchange={(e) => edit((l) => (l.display.scriptId = e.currentTarget.value || null))}
              >
                <option value="">{t('studyExport.display.scriptNone')}</option>
                {#each lang.scripts as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
              </select>
            </div>
          </div>
          <label class="row check">
            <input
              type="checkbox"
              checked={current.display.showIpa}
              onchange={(e) => edit((l) => (l.display.showIpa = e.currentTarget.checked))}
            />
            {t('studyExport.display.ipa')}
          </label>
        </section>
      {:else if tab === 'audio'}
        <div class="row tools">
          <div class="seg">
            {#each ['lexeme', 'phrase', 'sentence'] as const as k (k)}
              <button class:active={audioKind === k} onclick={() => (audioKind = k)}
                >{t(`studyExport.kinds.${k}`)}</button
              >
            {/each}
          </div>
          <input
            class="input filter"
            placeholder={t('studyExport.filter')}
            bind:value={audioQuery}
          />
          <label class="row check">
            <input type="checkbox" bind:checked={onlyRecorded} />
            {t('studyExport.audio.onlyRecorded')}
          </label>
          <div class="grow"></div>
          <span class="small muted">{t('studyExport.audio.count', { n: recordedCount })}</span>
          <button class="btn sm" onclick={batchImport}
            ><FolderOpen size={14} />{t('studyExport.audio.batch')}</button
          >
          <HelpDot tip={t('studyExport.audio.hint')} />
        </div>
        <section class="card block">
          <table class="tbl audio">
            <tbody>
              {#each audioRows as r (r.key)}
                {@const has = !!current.audio[r.key]}
                <tr data-audio-row={r.key}>
                  <td class="data">{r.label}</td>
                  <td class="small muted">{r.sub}</td>
                  <td class="acts">
                    {#if has}
                      <button
                        class="btn sm ghost"
                        title={t('studyExport.audio.play')}
                        onclick={() => play(r.key)}><Play size={14} /></button
                      >
                    {/if}
                    {#if recordingKey === r.key}
                      <button class="btn sm danger" data-rec-stop onclick={stopRecording}
                        ><Square size={14} />{t('studyExport.audio.stop')}</button
                      >
                    {:else}
                      <button
                        class="btn sm ghost"
                        data-rec={r.key}
                        disabled={!!recordingKey}
                        title={t('studyExport.audio.record')}
                        onclick={() => startRecording(r.key)}><Mic size={14} /></button
                      >
                    {/if}
                    <button
                      class="btn sm ghost"
                      title={t('studyExport.audio.file')}
                      onclick={() => pickFile(r.key)}><FolderOpen size={14} /></button
                    >
                    {#if has}
                      <button
                        class="btn sm ghost danger"
                        title={t('studyExport.audio.remove')}
                        onclick={() => edit((l) => delete l.audio[r.key])}
                        ><Trash2 size={14} /></button
                      >
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      {/if}
    {/if}
  {/if}
</div>

<style>
  .page {
    padding: 24px 28px;
    max-width: var(--page-max, 1000px);
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    height: 100%;
  }
  .page-head {
    gap: 8px;
    align-items: center;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 14px 16px;
  }
  .block h3 {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .grid2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  .grid3 {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .field .label {
    font-size: 12px;
    color: var(--text-2);
  }
  .langs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 8px;
  }
  .lang {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    box-shadow: none;
  }
  .lang .check {
    gap: 6px;
    align-items: center;
  }
  .lang .btn {
    align-self: flex-start;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .tabs {
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }
  .lang-title {
    font-size: 16px;
  }
  .tools {
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .tools .check {
    white-space: nowrap;
    flex-shrink: 0;
  }
  .filter {
    width: 200px;
  }
  .lesson :global(.grip) {
    color: var(--text-3);
    cursor: grab;
    flex-shrink: 0;
  }
  .lesson .row {
    align-items: center;
    gap: 8px;
  }
  .empty {
    padding: 14px 16px;
  }
  .hidden-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 10px;
  }
  .checks {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 320px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .checks .check {
    gap: 6px;
    align-items: baseline;
  }
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tbl {
    border-collapse: collapse;
    width: 100%;
  }
  .tbl td {
    padding: 4px 8px 4px 0;
    border-top: 1px solid var(--border);
  }
  .tbl tr:first-child td {
    border-top: none;
  }
  .acts {
    text-align: end;
    white-space: nowrap;
  }
  .md.preview {
    padding: 10px 12px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm);
  }
</style>
