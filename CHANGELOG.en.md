# Changelog

## 1.0.0-beta.2 · unreleased

- **Optional shared accounts**: register, sign in, sign out and change your nickname from application settings on the start page or in Settings, using the same account as Qonsona. Local projects remain editable offline; project and language content are not uploaded. The main process encrypts saved credentials with system secure storage, and clearly indicates a temporary session when secure storage is unavailable. All nine interface languages are included.

- The companion language-learning app named on the “Export study pack” page is now called Qonsona (formerly Qonlang Study); the study pack format is unchanged, and .qstudy.json files exported earlier can still be imported

## 1.0.0-beta.1 · 2026-10-09

The first test build of the 1.0 release. Test builds are marked as **pre-releases** on GitHub: installs of a regular release such as 0.12.4 are not offered them — download one from the release page if you want to try it. Once you have a test build, later test builds and the final release are offered as usual.

- **All nine interface languages are complete**: rule errors (sound changes, orthographies, scripts, the paradigm “tweak” step), the explanation of each derivation step (the lines shown when you hover a slot or an inflected form), the “Save before closing?” dialog, the right-click menu and the menu bar (standard items such as Undo, Copy, Zoom and Minimize included), the hint in the affix boxes of paradigms, exported crossword pages and images, the descriptions of interface errors, plugin loading errors and the blurbs of the friends’ links on the start page used to be in Chinese only (or Chinese and English only); they now follow the interface language. In the Japanese, Korean, French, Spanish, Russian and Arabic interfaces, the Chinese names that had crept into rule examples (`{双元音}`, `@语素`, `[[词头]]`, `性=阴` and so on) were replaced with names in each language, and the line breaks lost from the sound-change examples of some languages are back; the character panel in the Traditional Chinese interface showed English names for phonetic symbols and now shows Chinese
- **First launch follows the system language**: if the system language is one of the nine interface languages it is used, otherwise English; an interface language you already picked stays as it is
- **An English changelog**: when the interface is not Chinese, “Changelog” on the start page is shown in English; the GitHub release page and the update notice in the app show this version’s notes in the interface language (there used to be nothing there but a “Full Changelog” link, repeated twice)
- **English versions of the example documents**: when the interface is not Chinese, the documents of the example projects (“About this example”, the grammar sketches and so on) open in English
- **Two copies of Qonlang open at once**: the one opened second first says “Qonlang is already open”; each window keeps its own crash-recovery snapshot, so they no longer overwrite each other
- **Before saving, Qonlang checks whether the file was changed elsewhere** (another Qonlang window, a cloud-sync folder…): if it was, you are asked to “Overwrite”, “Save as…” or “Don’t save yet” instead of silently overwriting those changes; “Don’t save yet” pauses autosave, and Ctrl+S lets you choose again
- **Report a problem**: About in Settings, the top of the Developer panel on the start page and Help in the menu bar all have “Report a problem”, which opens a new issue on GitHub with diagnostics already filled in (version, system, interface language, project size and recent errors — no project content); “Copy diagnostics” copies the same text so you can paste it elsewhere
- **A note before downloading an update**: the installer comes from GitHub, which can be slow or unreachable on some networks
- **New Linux builds**: AppImage and deb packages
- **The project file format is settled**: from 1.0 on, later versions can open project files saved by 1.0 (locked in by tests)
- Fixed: the first visit to the Phrasebook page of a large project froze for about half a second (projects with initial mutations, such as the Hikrin language family). The table of initial mutations, the segmentation index and the analysis of every word all had to be worked out before the page appeared; now the page appears at once and that work is done in small slices while the app is idle, and coming back to the page does not redo it (on the Hikrin family: from a 0.55-second freeze to the page in 0.03 seconds, followed by one 0.1-second step)
- Deriving inflected forms and building the segmentation index are noticeably faster: the slot list of a paradigm and a language’s spelling units are no longer recalculated for every word and every affix

## 0.12.4 · 2026-10-08

- **Export a study pack (for Qonlang Study)**: Settings → Data → Export has a new “Export study pack”, which opens a page of its own for preparing a pack for the companion learning app Qonlang Study. Tick the languages to export; each language has six tabs — Cover (course title and a Markdown introduction), Lessons (each lesson can take a document as its text, plus the new words, example sentences and phrases of the lesson, in an order you can drag; “Generate from documents” makes one lesson per document at once), Hidden (entries, examples, phrases and documents learners should not see; “Tick placeholder entries” ticks every entry without letters in one go), Levels (the learning app sorts words into levels by frequency; here you can pin individual words to a level), Display (the default orthography and script, and whether to show IPA) and Recordings (record with the microphone, pick audio files, or match files to words by file name in bulk). “Export study pack…” saves the project together with these settings as one `.qstudy.json`
- These settings **are not written into the project file**: they are kept per project in the `study-export/` folder of the app’s data folder (in the browser for the web version), so changing them does not make the project “unsaved”; on another computer, “Read settings from a study pack” recovers whatever matches the current project from a pack exported earlier. Things deleted from the project are removed from lessons, levels and recordings the next time this page opens. Read-only copies cannot export a study pack
- **A funnel in the header of the paradigm slot list**: right above the column of checkboxes in the visual view. Click it to filter slots by status (All / Enabled / Disabled) and by the values of each dimension: several values picked in one dimension match any of them, and picks in different dimensions must all match (picking “plural”, “nominative” and “accusative” leaves just the plural nominative and accusative). “Enable these n” and “Disable these n” switch the filtered batch at once. While a filter is on, the funnel is highlighted and “Slots” is followed by “4 / 8”; in the table and tree views the funnel sits on the “Slots” row, cells that don’t match are faded, and clicking one tells you so, with “Clear filter” in the message jumping straight to it. When only enabled (or only disabled) slots are showing, a row you just ticked or unticked stays where it is instead of vanishing; each paradigm remembers its own filter, also when you switch to another module and back
- **Traditional Chinese, Russian and Arabic wordmarks on the start page**: with the interface in Traditional Chinese, Russian or Arabic, the top left reads “千語集”, “Конланг” or “قنلانغ”, at the same letter size as the English and Simplified Chinese wordmarks; when the Russian tagline wraps, its two lines are about the same length instead of leaving one word on the second line
- **The “New project” menu on the start page no longer closes too easily**: crossing the gap between the button and the menu no longer closes it; it closes about 0.3 seconds after the mouse leaves, stays open if the mouse comes back in time, and closes when you click elsewhere or press Esc
- Fixed: “n left after removing disabled slots” on the Paradigms page counted the disabled ones too; when the top-bar search filtered out every slot, the message said “Please choose at least one dimension”

## 0.12.3 · 2026-09-23

- **Translation workbench**: corpus examples and phrases have a new “Workbench” button next to the translation. It replaces the left pane with a workbench: write the translation in the middle, and Qonlang looks up words in the lexicon that the translation may need (by character strings for scripts like Chinese that don’t separate words, by words otherwise; words already used in the corpus and phrasebook come first) and floats them below as bubbles; drag the ones you want onto the line above (or click one to append it), and drag to reorder. When it’s in order, add it to the corpus or phrasebook in one click; the words you picked are confirmed and linked right away, with no word-by-word checking
- **The workbench can add tense, aspect, voice and mood (the attachment deck)**: click a word you put together above, and the attachment deck opens below, listing by category what can go with it — one row per dimension of its own paradigm, each value showing the form it would give; dimensions whose “applies to” includes this part of speech but which live in another part of speech’s paradigm (verb mood, aspect and tense on a “verb head”) bring that paradigm along too, with the chosen piece attached to the word; prefixes, suffixes, clitics and particles that can attach are grouped first by the project’s own dimensions (grammatical features, tags and glosses of morphemes), and those that don’t fit are sorted by Leipzig abbreviation into tense, aspect, mood, voice, negation, number, case…, with those used alongside such words in the corpus first; paradigms that apply to all words (initial mutations) come last. Which side a piece attaches to, whether a free word goes before or after, and which of several prefixes is outermost all follow the analyses in the corpus. Each word shows its gloss underneath, with pieces coloured by category; dragging a morpheme bubble onto a word attaches it there; a typed word that happens to be a headword or a stored inflected form is linked to its entry automatically; when added to the corpus, the assembled pieces are stored directly as the analysis (picking the closest when several segmentations fit). “Collapse” at the top right folds the deck into one line, which stays folded when you change words or switch modules and back; “Expand” restores it
- **Workbench: parts of the translation with no matching word are flagged**: after you write the translation, the parts with no match in the lexicon or the morpheme list are listed under the translation box, one button each (writing 我知道你的朋友在房子里 “I know your friend is in the house” in the example Aelith flags 在 and 里). Click one to create a new lexicon entry with that part already filled in as the definition; when done, “Back” returns to the workbench with everything you put together still in place — the same goes for switching back to the corpus or phrasebook from another module. Some meanings are expressed by a paradigm (Aelith uses the locative for “in”), and then there is no need to create a word. When looking words up, three-letter words also match their form with -s (see → sees)
- **The attachment deck works for any project**: it used to rely mainly on the analyses in the corpus, so projects with few analysed examples (new projects, or ones with only a lexicon and morphemes) had almost everything under “Other”. When the corpus has nothing to say, it now guesses from the project’s structure: which dimensions this part of speech’s paradigms use, the dimensions’ “applies to”, the project’s abbreviation list (your own abbreviations count once the list gives them a name) and part-of-speech names (noun, verb, pronoun and the like, including names containing “verb”, in all nine interface languages) — roughly, nominals (nouns, pronouns, numerals) get what goes with nominals and predicates get what goes with predicates; with no clue at all, everything is shown. Guesses are paler, and hovering says they are guesses. Each group shows the well-founded items first, with the rest behind “+N”; with enough analysed examples, only what has been seen is shown, as before
  - Function words in the lexicon: all words of a part of speech named particle, preposition, classifier, marker, affix and the like (or one where at least 30% of the words are defined as a grammatical marker) count as attachable; in other parts of speech, only words whose definition names the category they mark (“perfective marker”, “PST marker”, “instrumental affix”) count — “things of the past” and “emoji marker” no longer do, nor do pronouns that only state a person
  - Discontinuous function words (`ne…pas`): the first part goes before the word and the second after it, added and removed together; when only half is written (ellipsis at one end), it goes on the other side. Optional parts in brackets and alternatives separated by slashes in a headword are reduced to the simplest first form when put in a sentence
  - A typed word (not in the lexicon) can be given a part of speech in the attachment deck, and then inflects by that part of speech’s paradigms and lists what can go with it
  - Fixed: the tag “adv.” was taken as mentioning the verb abbreviated “v.”; a morpheme glossed “in” was put under a dimension with a value called “inanimate”; a particle that is both an entry and a morpheme appeared twice in the deck
- **What to do when the sentence of the day is too long, three choices in Settings** (Settings → App (this computer) → Interface → “When the sentence of the day is too long”): by default only sentences that fit on one line are picked; you can also pick long ones and cut them between words (by the word separator in the settings, never in the middle of a word), or let them wrap and the card grow taller. Whether a sentence fits is measured with the real font
- **Dimensions with gloss abbreviations use them everywhere**: when dimension values have gloss abbreviations, the inflection table in the lexicon, the entry card, the list of inflected forms on the entry page and the paradigm test bench all use them (such as `SG.NOM`); hover to see the full names. The paradigm slot list dropped its separate gloss column; the abbreviation sits under the slot name, so the table is no longer stretched
- **Definition boxes default to the interface language only**: multilingual boxes such as entry senses, example translations and names used to offer one box per language in the project’s “gloss language order” (Chinese and English for new projects); they now offer only the current interface language by default — add others in Settings → Current project → Languages & fonts → “Languages for definitions” (such as `zh, en`); languages that already have content are still shown
- **Interface translation plugin**: a new translation can replace the “千语集 / Qonlang” lettering on the start page and in About with your own text (shown in the translation’s font) or an image (under 300 KB); the QL icon on the left stays. Each translated entry remembers the source text it was translated from, entries whose source has changed since are marked “Source changed” (hover to see the old source), and you can list just those; if a translation is still right, “Translation still fine” clears the mark. The categories on the left no longer show key names like `csv` or `taxonomy`: stray blocks were merged into their modules (parts of speech and dimensions under Lexicon, the glyph pad under Script, dialogs and errors under Common), plus four categories for games, characters, import/export, and plugins & MCP; when the row of settings at the top doesn’t fit, it wraps as a whole instead of squeezing labels like “Text is written right to left” into several lines
- **The Chinese interface text was rewritten**: following the tone of the 240 entries settled in the previous release, every other entry was reviewed and 494 were rewritten: full sentences, actions written as “click / tick / type”, interface names in 「」, and hints that say where and how; none of the previously settled entries were touched
- **Punctuation and spaces in the corpus list are drawn as written**: only recognised words used to be drawn, and commas and full stops were lost
- **Arabic**: six strings starting with Latin letters, such as the game Sage, now start with Arabic, so the whole paragraph runs right to left and is right-aligned (it used to be judged left-to-right from its first letter, sending the title to the left)
- Settings → Plugins: the cards of built-in plugins lost their raised shadow and have even spacing
- **Fixed: class definitions and digraph declarations written in a paradigm’s “tweak” step had no effect**: the rules of this step were compiled one line at a time, so a definition only applied to its own line; it now applies to every rule of the step
- **Fixed: classes with repeated members were matched position by position wrongly in replacements**: class members used to be de-duplicated, so in `{前}=t d s` replaced by `{后}=r r z` (two sounds merging into one) the second `r` was dropped, d was matched with z, and everything after was off by one; members are now kept as written
- **Fixed: after you used “Fix” to change the entry of a word in a phrase, the sentence of the day on the start page still showed the old one**: phrases in the gallery were re-analysed from their text every time, ignoring the phrase’s stored analysis; when the text hasn’t changed, the stored analysis is now used, matching the Phrasebook page
- **Fixed: a long credit (project · language) at the bottom right of the sentence of the day overlapped the translation**: the text used to leave a fixed 96px for the credit; now only the last line, level with the credit, makes room, as much as the credit actually needs (the credit takes at most a third of the width, with the rest cut off). A project name and a language name that differ only by spaces or a bar (“北岸语 | Nordrin” and “北岸语 Nordrin”) are written once

## 0.12.2 · 2026-09-23

- **Built-in plugin “Interface translation”** (appears once ticked in Settings → Plugins; off by default): lists all 2,177 translatable interface strings by module for translation one by one, with categories and progress on the left and one row per string on the right — source on the left, your translation on the right; pick which language to show the source in, show only untranslated strings, and search by key, source or translation. A new translation asks for a name, a **fallback language** (shown for anything not yet translated), **Latin letters or your own script** (your own script needs an installed font, which the interface then uses) and **whether text runs right to left**. Finished translations appear directly in the language menu (in Settings and at the bottom left of the start page), can be exported as a file to share and imported from others; translations are stored on this computer only, not in project files
- **Arabic no longer mirrors the whole page**: only the text itself runs right to left (each paragraph by its first strong directional character, with embedded Latin letters and digits as they are); the navigation stays on the left and the inspector on the right
- **Fixed: opening the Phrasebook page took almost a second** (a project with 79 phrases): every phrase used to be analysed in full on entry. Now the list only judges whether each word is clickable from its spelling (each spelling once), and full analysis waits until it is really needed (hovering, changing a word) for that one phrase; the first 20 phrases are drawn first and more as you scroll; the index used to recognise words is built when the app is idle after drawing. Measured on the same project, entering the page went from 750 ms to about 10 ms, and 170 ms on the very first visit
- **Space between the start-page wordmark and the tagline below it**: the negative margin tuned for the English wordmark made Japanese, Korean, Russian and Arabic text, whose letters reach higher, touch the wordmark
- **The gradient of the sentence-of-the-day card follows the theme**: both colour stops are the current accent shifted a little in hue (the same card always gets the same pair), so switching skins changes it too, instead of six fixed palettes
- The Phrasebook module is called مكنز in Arabic

## 0.12.1 · 2026-09-22

- **Eight more interface languages**: 繁體中文, English, 日本語, 한국어, Français, Español, Русский and العربية — choose in Settings → Interface language (or “Language” at the bottom left of the start page). Traditional Chinese is converted from Simplified by machine (Taiwan usage) and follows it; the others were translated string by string; anything not yet translated falls back automatically (Traditional to Simplified, the rest to English), so key names never show
- **In Arabic the whole interface runs right to left**: navigation on the right, inspector on the left, with margins and alignment flipped everywhere (using CSS logical properties)
- “Theme” has one name now: what the bottom left of the start page called “Personalise” is now “Theme”, like the module; the setting that was also called “Theme” (follow system / light / dark) is now “**Appearance**”, so it no longer shares the module’s name
- **“Fix” in the Phrasebook hover card works properly**: in the previous release it was separate code from the corpus page; “Fix” changed the whole word instead of the piece you were looking at (the title also showed the whole word), and picking a word rewrote the text without asking. It now shares the corpus page’s code — phrases can store their own analysis, “Fix” on a piece of the segmentation fixes that piece (even when the same entry appears twice in one word), and only ticking “**Also change the text**” (off by default, offered only when changing the whole word) touches the text, pronunciation and script forms, with a single undo restoring everything; a piece that was not recognised used to be unclickable and now opens “Not found” so you can assign it
- Hover cards are no longer taken over by words the mouse passes: while moving from a word onto its card, or picking a word inside the card, a queued card no longer replaces the current one
- **The interface wording was reviewed as a whole**: 239 hints, titles and guided-tour steps were rewritten to the user’s final wording, for more consistent phrasing
- **The guided tours were rebuilt**: from 53 steps to 98, with one tour for each of the twelve modules plus “Plugins & MCP”; **the tour takes you along** — it switches to the sub-page or table it is about to explain, opening the inspector if needed, and restores the interface as you left it when you skip or finish
- **Fixed: tour highlights circled the wrong controls** (step 3 on the Morphemes page talked about “Display / Edit” but circled “Entries / Stats”). Checking turned up wrong or missing highlights on the start page and the Paradigms, Docs and Languages pages too, all fixed; every anchor is now set on the element itself (`data-tour`) instead of being guessed from button text and position

## 0.12.0 · 2026-09-20

- **The start page was rearranged**: starter templates moved to the left next to “New project”, and the middle is now for **recent projects** — one card per project, with a word written in the project’s own script at the bottom right (fading out at the end when too long, downwards for vertical scripts) and a light that follows the pointer across the card; the link banner at the top is gone
- **“Language / Personalise / Settings” at the bottom left**: change the interface language, the theme and skin preset, or app settings without opening a project (the same settings as the “App” section of the Settings page)
- **Sentence of the day**: a small icon at the top left of the card and “Sentence of the day” at the top right (“Word of the day” for a word with a picture), a credit that names the language (project · language), and long sentences no longer squeezed by the card’s height
- **The language tree no longer counts grouping nodes in comparisons**: the nearest common ancestor of two languages is looked for among languages only (family, branch and sub-branch nodes are structure), and when one language is an ancestor of the other, that ancestor is shown
- **“Fix” in Phrasebook hover cards too**: the same as on the corpus page — search an entry or morpheme and click to replace this spot in the text, with pronunciation and script forms recalculated, and undo available
- **`[[…]]` in documents links to every module**: besides entries, links can point to morphemes, languages, sound-change rule sets (down to a stage), paradigms (down to a slot), scripts, examples, phrases and other documents — written like `[[语素:-lAr]]` or `[[构形:名词#单数.位格|名词 · 单数位格]]`, with Chinese or English prefixes, and without a prefix an entry is looked for first, as before; “Insert link” on the toolbar lets you choose a type and search a name, and clicking a link jumps there and highlights the target; links that can’t be resolved are drawn dashed, saying which kind was not found
- **New preview text in the font library**: Latin fonts show `The quick brown fox…`, CJK fonts add four characters with full strokes, and scripts without Latin glyphs (runes, symbols) get no sample sentence; fonts with a Chinese name show it in grey under the English name
- **Skins can be exported and imported**: a skin is saved as one file (colours, fonts and optionally the background image); on import the whole window previews it first, and “Apply” saves it
- Games renamed: 单词卡 Flashcards, Sage 拼词, 猜词 Wordle, 交叉填字 Crosswords
- Starter templates moved inside the “New project” button and unfold on click; recent projects show four per row, two rows at most, and the games below keep room for two full rows so they don’t jump up and down with the number of projects
- **Previews of every font in the library ship with the app**: you see what a font really looks like right away, without downloading it first. Each preview is a subset of the font holding just the preview line (a few KB each, about 460 KB for all 31); “Download” still installs the full font for real use
- Font previews in the library **use the font itself** (it used to use the name from the catalogue, which showed nothing when it didn’t match the family name in the font file); scripts without Latin glyphs such as runes and Old Turkic show a transcription of the same sentence, and symbol fonts a row of symbols
- Bordered controls have three consistent states: a plain border normally, an accent-coloured border on hover, and a soft glow outside the border when opened or selected
- The module icons on the left and the logo follow the skin’s colours
- With the inspector collapsed, the content on the left fills the whole width instead of hanging in the middle; the two-column layout in Settings becomes one column when narrow
- Credits and links: kikomas is always lower case, and the friends’ link now points to “蓝地群岛 Wiki”; the skin import/export icons were swapped back
- **Fixed: the tooltips of the two “User guide” buttons for plugins and MCP in Settings showed the key name `nav.extending`**
- **Fixed: “Export as text” at the bottom right of the sound-change page was the same as the one in the export menu above**; the duplicate was removed

## 0.11.2 · 2026-09-20

- **Historical stages in the language tree hang below the language** (`PThsr › AThsr › OThsr › Thsr`; hover to see them in full): a row of little boxes on the right used to push siblings far apart, so languages on the same level were hard to read
- **Grouping nodes no longer sit side by side with proto-languages in the tree**: families, branches and sub-branches only give structure and are not real languages — the representative proto-language now sits below its grouping node, with the next branch hanging below it (as in the list view)
- **Fixed: an extra dot between the star and the word in the lexicon list**
- 见坂静安 added to testing and feedback in the credits

## 0.11.1 · 2026-09-20

- **Star words in the lexicon**: each row has a star at its far left, hidden until the mouse passes over it; click to star the word (it fills yellow), and the star button “Starred only” at the top right shows just those words; the “Word” row in edit mode has the same star
- **Marks**: tick “Mark” when editing a word and it gets a symbol in front of it in the list and the entry card (`*` by default) — handy for flagging a set of important words; the symbol is set in Settings → Current project → Basics → “Mark symbol”
- Kyiexitah added to the sponsors in the credits, first in line
- The gallery strip on the start page sits a little higher when it has a script line, so the text no longer touches the top edge; the middle column of the start page has less vertical padding, so common window heights no longer need a scroll bar
- **Every import preview has a “test bench” below it**: type an input of your own (a row of data, a few rules, a line of glyph mappings) and it is parsed right away with the current import settings and shown like the preview — no more editing files to check whether a column is read right or a marker recognised; it recalculates when settings change, starts collapsed, and keeps what you typed when you come back
- **Fixed: “Add step” on the last paradigm slot pushed its menu out of the panel**, so it disappeared as soon as the mouse moved — the menu now floats over the panel (above the button when there is no room below), and the panel no longer grows

## 0.11.0 · 2026-09-20

- **Plugins**: others can now write plugins for Qonlang. Plugins go into the folder shown in Settings → Plugins, one folder per plugin (`plugin.json` + an entry script), run with the same permissions as the app, and can extend five places:
  - **Inspector panels** (optionally only in some modules) and **whole pages in the left navigation**
  - **Commands**: shown in the Ctrl+K command palette
  - **Import / export formats**: shown in the lexicon’s import and export menus
  - **Paradigm generators**: slot generators gain a “plugin” kind whose form is worked out by the plugin
  - In Settings each plugin can be turned on or off and reloaded, with a count of what it registered; `docs/plugin-example/` is an example plugin that uses all five
- **MCP**: with Settings → MCP turned on, Qonlang runs a token-protected MCP server on this computer, and clients such as Claude and Cursor can use nine tools: project overview, lexicon search, entry lookup, running sound changes, glossing a sentence, deriving inflected forms, and adding entries, editing entries and adding examples. Writes ask for confirmation by default (this can be turned off) and go into the undo history; the server only listens on 127.0.0.1 and answers 401 without the token

## 0.10.3 · 2026-09-19

- **The start-page gallery shows script forms**: example and phrase cards get a line above the text converted by the script page’s mapping rules (in that script’s font); the text stays below and can still be hovered
- The project picker of the games has padding around it, with more room between cards; the title row of each game stays at the top
- Crossword clues no longer repeat their number (it already stands at the start of each clue), in the exported page too

## 0.10.2 · 2026-09-19

- **Games on the start page**: a row of four below the starter templates, all quizzing you on your own lexicon — pick one, then a project (read only, never opened or changed), then a language:
  - **Flashcards**: word on the front, meaning on the back, or the other way round; missed cards come round again
  - **Sage**: a few definitions and a pile of letters (exactly enough for those words); click letters to build words, click a chosen one to take it back, and peek at the answer for one clue
  - **Wordle**: six tries, judged by the language’s alphabet (multi-letter letters such as `th` take one cell), word length 3–7
  - **Crossword**: a grid laid out from the lexicon with definitions as clues; “Export page” (a single HTML file others can fill in, check and print to PDF in a browser) or “Export image” (blank grid plus clues, for printing)

- **A sound change can include a stretch of another rule set**: write a line `-@ rule set : from stage .. to stage` (nothing after the colon means the whole set), and that stretch runs right there — a proto-language stretch shared by two sister languages is maintained in one place, and changes there carry over. Included stages count here too (test bench, the sound-change step of paradigms, historical forms all see them), and the included set is parsed with its own bound language; includes can nest (up to four levels), and loops or wrong names or stages are reported on that line

- **Fixed: the lexicon’s table and tree views drew disabled slots**: these views lay cells out by dimension, and a disabled cell was drawn as an empty “—”; rows, columns and branches without any slot are no longer drawn
- **The three views use the same order**: the list was ordered by when forms were stored; it now follows the paradigm’s slot order like the table and tree, with forms outside the slots last
- **Adding a dimension no longer leaves behind old slots one dimension short** (simple mode): adding a dimension used to keep old combinations that had a setup as separate rows at the end of the list; the list is now the full set of combinations of the new dimensions, old setups serve as inheritance sources, each cell says “Inherited from X”, and “Make it its own” turns it into this cell’s own setup (complex mode still keeps them separate)

## 0.10.1 · 2026-09-18

- **Click a sense in the entry card to change the meaning**: hover a word in the corpus and click a sense on the card to switch the word to that sense; click a piece at the top of the card first (`delì` of `delì-hi`) and the sense only changes that piece — so for a word made of several morphemes you can pick the meaning of one piece
- **Fixed: later senses of words with many senses were pushed out of the candidates**: sense candidates used to come after all segmentation candidates, so homographs and words that split several ways exceeded the candidate limit (the third sense of `leka` in Cathine disappeared this way, unrelated to registers); senses now sit right next to their own entry and **are no longer cut off** — they are written by you, so all of them are shown; the candidates that can really explode are segmentations, which have their own limit

## 0.10.0 · 2026-09-18

- **Families and branches are boxed**: in the list view a grouping node is drawn as a box holding its proto-language, sub-groups and languages; the proto-language sits between the family and branch levels, aligned with the grouping node’s title row (the grouping node is only a category, and its representative proto-language is not a level below), and the next families and branches are indented one step; the arrow left of the title collapses or expands the box, showing how many languages it holds when collapsed. In the tree view, right-click a node to collapse or expand what is below it, with “+n” under the node, and the tree uses the same fonts as the rest of the interface
- **Changing a word in the corpus can change the text too**: the “Fix” panel has a new checkbox (off by default); when ticked, the chosen entry’s spelling replaces this spot in the example text, leaving the same word elsewhere in the sentence alone; text and analysis are undone together in one step
- **Every piece of a word made of several morphemes gets a script form**: words with hyphens like `naegō-moh`, and words split with “Fix” in the corpus, used to show only the stem’s character (and nothing at all when the stem had none); each piece now looks up its own character in the lexicon and morphemes, and a piece without one falls back to its transcription without affecting the others
- **Locked dimensions can filter too**: click a locked dimension to filter by it; locked ones have a darker background and a small lock, set apart from unlocked ones; while filtering, “Clear filter / Enable all filtered / Disable all filtered” go on a row of their own, in the usual button style
- **Examples under an entry highlight the word**: the word (including inflected forms and its piece inside a word written together) is marked in the examples; with “Examples also show script lines and sources” ticked in Settings, examples carry script lines and sources like on the corpus page
- **Search results are highlighted**: hits of the top-bar search are marked in yellow on the page, following page turns and scrolling
- **Historical forms can be hidden**: Settings → Display → “Show historical forms in entry cards”, on by default
- Editing a historical form takes effect on Enter (it used to need a click elsewhere)
- When a pipeline nests a paradigm, the base variant in the drop-down follows the name you gave it (it always said “Common”)
- **Discontinuous words are recognised across words**: entries whose headword is split into pieces with `…` (`ma…gò`) are recognised when written `ma something gò` in the corpus, every piece linked to the same entry with the same gloss; the script line writes only each piece’s own half
- **Fixed: the lexicon table looked blurry after scrolling far down**: row heights are now whole physical pixels (measured heights had fractions; the space above added up until the whole table sat on half a pixel and the text blurred); skins without a pattern no longer draw that layer
- **Fonts regenerated from the glyph pad keep kerning, ligatures and hinting**: when the embedded font is TrueType, only the drawn or edited glyphs are put into the original font, glyph numbers stay, new glyphs go at the end, and GPOS / GSUB / kern and the hinting of other glyphs are kept (edited glyphs lose their own hinting, which no longer fits their new outlines; digital signatures are always dropped; OTF, WOFF, TTC or no embedded font means writing a new font from scratch, which keeps none of this)
- **Brush strokes no longer break off**: the cursor turning into a no-entry sign and strokes breaking (the browser starting a drag of its own) is fixed; strokes continue even past the edge of the canvas
- **Morpheme allomorphs can be chosen by dimension value**: each allomorph can be limited to certain dimension values (say -lAn in the dative cell), and paradigm derivation picks it automatically; when several fit, the order is: more matching values, then whether an environment was written, then written order
- **Drag to arrange the Languages page**: drop onto a group to put a language in it, onto a language to make it a child, onto the top or bottom edge of a card to insert between the two; “Move to the top level” appears below while dragging; places where it can’t go are outlined in red and it snaps back on release; all of it can be undone
- **Tree view on the Languages page**: a family tree drawn from the top, with each language’s historical stages beside it; zoom with the wheel, drag to pan, fit to window
- **Compare two languages**: Ctrl-click a second language (or use the compare button on its card) to show the nearest common ancestor at the top, with both lines of descent flashing dashed, and below it a direct comparison of the two languages’ counts, phonemes (shared / only A / only B), cognate ratio and table of corresponding words
- **A new way of working out paradigm slots**: a slot is identified by which values it takes, so a slot with a setup always counts (it survives changes of dimensions, and “tense-aspect-person” coexists with “tense-aspect”, one dimension short); dimensions can be locked, after which clicking a dimension only filters (the slots fixed by the lock have a darker background), and the filtered slots can be enabled or disabled in bulk
- **Simple and complex mode** (Settings → Current project → Paradigms, simple by default): in simple mode a slot with more dimensions and no setup continues from the slot with fewer; in complex mode each counts on its own
- **“Affects pronunciation” is now one of the generator choices**: the generator drop-down has “Pipeline + affects pronunciation” instead of a separate checkbox
- **Moving a setup is easier to find**: hover a slot’s row and a small arrow appears next to the slot name (double-clicking the name still works)
- **Historical forms can be edited step by step**: click a step that came out wrong to edit it; the edit is stored as an intermediate form in the etymology, later steps continue from it, and ↺ beside it returns to the derived value; the hint now says “mismatch”
- **Hand-edited inflected forms can be re-derived from the paradigm**: hand-edited cells in the table and tree views have a ↺ at the top right, and “Re-derive all” next to it re-derives the hand-edited ones too
- **Batch tags**: select several entries and use “Batch tags” to add tags to all of them, give one entry’s tag to the rest, rename a tag, or remove it from them
- **Finer blocks in the entry card**: etymology, historical forms, stems and inflected forms are separate blocks, each ordered and sized separately on the skin page; inflected forms list only what the paradigm derived, with stems in a block of their own
- **Hover cards follow the lexicon’s view**: when the lexicon uses the table or tree view, hover cards and gallery cards show the same
- When an entry has several senses, each one can be picked in the corpus (only the first used to be)
- Variant spellings written with a slash or comma in headwords, stems and inflected forms are indexed separately, so any of them is recognised in the corpus (`Degnes/Degnant`)
- Custom relation types: take effect on Enter or when focus leaves (the box used to jump away after one letter)
- Tab group names show just one character until hovered, saving room at the top
- The example project Aelith now uses: allomorphs chosen by dimension value (the plural marker is -lAn before the dative) and, in simple mode, third-person cells continuing from the “polarity-tense” slots

- **Languages page: family / branch / sub-branch nodes**: “Add group” creates a grouping node with languages and lower nodes below it, optionally pointing to a representative proto-language; select a node to see statistics and comparisons for that branch — counts, phoneme correspondences, cognate ratios (traced to the same source through etymologies) and a table of corresponding words
- **Historical stages inside a language**: a language can have several stages (Old → Middle → Modern), each with a name and abbreviation; stage markers in sound changes can be bound to “language · stage”; entries and morphemes can be marked with their stage
- **Merge into stages**: a historical chain already split into several languages can be merged, from a language chosen in the language inspector, into stages of one language in one click — entries, morphemes, examples and phrases move over with their stage noted, sound-change bindings move to the stages, and orthographies, scripts and dialects are matched by name
- **Historical form chains on entries**: in display mode a line “PSkr … → PTsr … → Tsr …” appears above the examples when the etymology source can be derived to this word through sound changes whose stages are all bound; a derived form that differs from the lexicon’s spelling is flagged
- **A big upgrade of the glyph pad**: glyphs from the imported font open directly in the glyph pad (edited as outlines); shapes (rectangle, ellipse, regular polygon, line), selecting, moving and scaling, node editing, width and height, horizontal / vertical flip, reversing, outlining, one-click bolding, copying; stabilisation 0–10 (string-pull stabilisation, smoothed on release); undo and redo, wheel zoom
- **Export fonts**: “Export font” on the glyph table → TTF / WOFF (the original font’s glyphs plus drawn and edited ones, drawn ones replacing the originals), or “Write back to embedded font” to replace the script’s embedded font directly (without keeping the original’s kerning and ligatures)
- **Paradigm slot keys no longer depend on dimension order**: A.B and B.A are the same cell — reordering dimensions, removing a dimension and adding it back, and inheritance between paradigms with different dimension orders all keep the setups (old files are converted on opening)
- **Slot inheritance**: a pipeline can start by “inheriting” another cell of this or another paradigm, continuing with more steps from the form derived there (a hand-edited form there is used as it is)
- **Affects pronunciation**: a ticked slot gets a second pipeline for pronunciation (starting from this cell’s IPA by orthography, or the entry’s pronunciation); derivation stores the pronunciation with the form, and the entry card shows it after the form
- **Double-click a slot name to move a setup**: a setup written in the wrong cell moves to another slot, and the old cell goes back to “None”
- The paradigm test bench’s input box has a × on the right to clear it when it has text
- The pronunciation column is now called “IPA by orthography” (with the orthography’s name when there are several)
- The example project Aelith now uses these: the “Ael 语系” node and its statistics, Aelith’s classical and modern stages and its historical form chains, noun plural cases inheriting the plural nominative, and a locative that affects pronunciation
- **Skin presets were redone**: names follow “name · colour”, in two rows — 亚夜花园·青 (formerly Default), 林中幻想·绿 (formerly Bamboo), 契耶西塔·紫 (formerly Fantasy), the new 海岛诺连·靛, 蓝地渐歌·蓝 (formerly Ocean); 星月夜·黑 (formerly Ink Night, now a blue-black night sky full of tiny stars), 山海经·褐 (formerly Ancient China, accent changed to brown), the new 梅珠撒·红 (red and white), 瓦其夫·黄 (deep navy background, golden accent, red warnings) and 雪利兹·橙 (soft orange and white). A preset you already chose stays chosen
- **Switching skins spreads like ink**: clicking a preset makes the new skin bleed out from where you clicked in a few soft-edged circles (switching instantly when the system asks for reduced motion); on skins with a very bright accent, the text on primary buttons turns dark
- **Skins can have a custom background image**: cover / contain / tile / centre / stretch, with alignment, opacity, scale and blur; the image covers the whole window without blocking clicks, multiplying in light mode and screening in dark mode so text isn’t greyed out; switching presets or restoring defaults leaves it alone
- **Sound-change and paradigm tabs can be grouped**: like browser tab groups — click a group name to collapse or expand it, right-click a tab to move it to another group, right-click a group name to rename, recolour or ungroup it, and dragging onto a tab of another group joins that group. Default grouping: sound changes by synchronic (all stages in one language, run inside paradigms) / diachronic (stages across two or more languages), paradigms by bound part of speech
- **Sound-change stages can be collapsed**: a small triangle before each stage marker, showing the number of lines when collapsed; with two or more stages, “Collapse / expand all stages”
- **Copy and paste paradigm pipelines**: each slot’s setup can be copied and pasted; “Copy this set” and “Paste into this set” on the variant bar move a whole set (matching slots replaced, others skipped), also via the system clipboard, so it can be pasted into another project
- **Example projects can be edited but not saved**: change anything after opening; the top bar says “Example”, the save button becomes “Make a copy”, Ctrl+S only shows a hint, and closing doesn’t ask; example cards can also “Make a copy” directly as your own project
- **The Settings page is grouped**: App (this computer) covers Interface, Saving & startup, Updates and Display; Current project covers Basics, Languages & fonts, Segmentation & gloss; then Data and About, one card each
- **The start page opens with the changelog unfolded**
- The pronunciation bracket options are now called “Phonemic /…/” and “Phonetic […]”
- Examples and phrases in the start-page gallery keep their full stops and commas; words in phrases are recognised on hover the same way as in the corpus (split at boundaries, affixed forms recognised)
- Fixed: a word consisting of a single clitic (like `jehr`) was recognised on hover but auto-glossed as empty
- Fixed: the entry-card font-size sliders on the skin page (and the sliders of the glyph pad and image cropping) didn’t follow the theme and turned a glaring bright cyan on hover
- The icon at the top left of the navigation lines up with the top-bar search box; the language selector and version number at the bottom left of the start page line up with the row of buttons at the bottom right

## 0.9.3 · 2026-09-17

- **Update notifications that never arrived**: checking for a new version now first looks at where the “latest release” link on the GitHub release page leads, instead of spending GitHub’s anonymous API allowance every time (without signing in, each network exit gets only 60 queries an hour, which a few people sharing a proxy or campus network use up quickly — after which the check silently said “no update” forever); the API is asked only once a new version is found, for checksums and release notes, and when it is rate-limited or unreachable the installer for this computer is found directly by its naming pattern (checked against the sha512 in latest.yml on Windows), waiting for the reset time GitHub gives before asking the API again
- **Checks every 20 minutes by default** (it was 5; installations still on the old default change to 20 when upgrading)
- **Settings → About was rearranged**: the full logo is larger; the current version and the latest version on the release page are shown; a new “Check for updates now” button shows its result beside it — up to date, a new version, or why the check failed (GitHub unreachable / query allowance used up for now)
- The Q icon at the top left of the navigation is aligned with the icons below by its visual centre (the glyph leans left and used to look 2 pixels off)
- sgiofh added to “Logo design” in the credits; the logo picture lines up with the pixel art below it, names aligned too
- Fixed: when the installer was missing or failed to start, the main process showed an “A JavaScript error occurred” crash dialog; the reason is now shown in the update notice

- **A big overhaul of corpus segmentation, so agglutinative words written together are recognised**: a word can be “prefixes + one or more stems + suffixes”, with several layers of affixes and two words written together plus affixes (`yvplihemeliaxetes` → yvpli-hemelia-xete-s) all split correctly; candidate segmentations are ranked by number of pieces, single letters, allomorph environments, the sentence’s translation and confirmed examples. Each piece split at a boundary symbol is split the same way, and a piece may consist of affixes only
- **Segmentation learns from confirmed examples**: which entry or morpheme a stretch of text was confirmed as elsewhere, how a run of pieces was confirmed to split (`don` confirmed as `do-n`), and which morpheme usually follows which are all used to rank next time, so the more examples you confirm the more accurate it gets. On the Theusrin test set, first-candidate entry accuracy rose from 73% to 86% and segmentation accuracy from 74% to 78%
- **Doubtful segmentations are marked as guesses**: results joining two or more stems (unless those words were confirmed together) or using a single-letter morpheme not yet confirmed are marked yellow and not counted as recognised until confirmed
- **Inflected forms derived by paradigms are used for segmentation too**: for entries that haven’t been “derived”, slots that only add affixes or reduplicate are derived on the fly for lookup, and the gloss carries the slot abbreviation
- **The “Not found” search box can pick a segmentation**: when the typed spelling can be split, a few segmentations are listed first, and picking one replaces the word (or the piece that wasn’t found) with those pieces
- **Glosses from long definitions are shortened**: automatic glosses take the first short part of the definition, up to a colon or bracket (“动词头：式 × 体……” gives just “动词头”)
- The segmentation index is cached per project, so re-analysing everything no longer rebuilds it for each sentence
- **A new logo**: the app icon is the newly designed Q icon (yellow on green) for Windows, macOS and Linux installers and windows (with the margin macOS guidelines ask for); the top of the left navigation, the brand area of the start page and Settings → About use the new icon and wordmark, with the logo in brand yellow in the dark theme; the web version has a tab icon. The full logo set and colour values are in `docs/brand/` in the repository
- **“Logo design” in the credits**: kikomas, who designed the new logo, with the logo picture beside the name
- Fixed: the “Qonlang” wordmark on the English start page sat slightly higher than the Chinese one

## 0.9.1 · 2026-09-16

- **Large lexicons no longer lag**: the lexicon table draws only the few dozen rows in view and draws more as you scroll, still remembering the scroll position (it used to draw 150 rows on entry, and more the deeper you had scrolled); for projects with thousands of entries and a script column, switching back to the lexicon went from almost a second (over two seconds after scrolling deep) to about a hundred milliseconds; sorting by a column computes each row’s sort key once, and sorting by a script column no longer freezes
- **Script transcription is dozens of times faster**: compiled transcription rules are remembered per script and recompared only when the project changes; words already transcribed are reused; rules whose target is a fixed string are skipped for words that don’t contain it (sound changes and orthographies benefit too); “does it have drawn glyphs” is counted once per script; the tables used for syllable combining are no longer rebuilt for every word
- **No more pause after edits**: the undo history serialises the project directly instead of first cloning it value by value, and records when the main thread is idle; the crash-recovery snapshot reuses the undo history’s copy; formatting and encryption for saving and autosaving moved to a background thread
- **Logographic scripts written by sign number**: when a script’s “Transcribe from” is an inspector module (say the sign number aa01 in the entry’s “Script” field), the script lines in the corpus, phrasebook, script preview and exports look each word up in the lexicon and write that field, leaving words not found as they are; sign numbers in hand-typed script forms in the lexicon and examples become characters too; the glyph “transcription” hint now says “how it is written in the transcribe-from field”
- Fixed: the grey placeholder of the script-form box in lexicon editing transcribed the word, showing the spelling when another field was chosen as the transcription source
- Fixed: words and examples in the script page preview ignored the transcription source and hand-typed forms
- **Symbols such as apostrophes count as letters**: when words in the lexicon begin or end with an apostrophe (Arabic transliterations like `'llhi`), corpus segmentation no longer strips it as punctuation; “Settings → Project → Symbols counted as letters” lets you add a few more
- **A new paradigm variant starts as a copy of the current set**: it carries the setup of the set you are looking at, so you only change a few places (inherited setups stay inherited)
- **Two variants of the same paradigm on one entry**: “Add a paradigm” in lexicon editing can pick another variant of the same paradigm; the two sets of slots are shown separately (with the variant name in the group title) and their forms are stored separately instead of overwriting each other
- **Grey hints in the inspector can be read in full**: the hint inside a box moved into a tooltip that shows it all on hover
- **Inflected forms as a table or tree**: the inflected-forms block of the lexicon inspector has three choices at the right of its title — list (as before), table (first dimension as rows, second as columns, one table per value from the third dimension on) and tree (branching by dimension, collapsible); in edit mode the cells of the table and tree are input boxes you can fill in directly, in display mode they are read only. Both modes share the choice
- **The inflected-forms block can collapse**: both display and edit mode have a triangle next to the title, showing “n cells, n filled” when collapsed; each mode remembers its own state
- **The default window follows the screen size**: on first launch the window is sized in proportion to the screen — 1853 × 920 on a 2K screen (2560 × 1440), scaled for other screens (1482 × 736 logical pixels on a 2K screen at 125%, which takes up the same area), at least 900 × 600, filling the work area when the screen is smaller; window sizes already remembered stay as they are
- Example project Tsahun: a logographic script written by sign number, “Tsahun 刻符” (inspector module “字号”; the example `ngo21 kwe51 ta33 sip51` is written ⼰ ⼝ ta33 ⿂)

## 0.9.0 · 2026-09-15

- **Stress rules** (wherever rules are written: sound changes, orthographies and so on): a line `ˈ = item , item …` marks stress when a word reaches it, and later rules carry it along (sounds still match across a stress mark) until the next stress rule marks it again. An item gives a syllable number (`1`, `-2` for the penultimate) or looks for the first matching syllable from the front or back (`*`, `-*`), optionally with what the nucleus must contain (`{long vowel}`), an environment (`/ _CC`, where the onset of the next syllable counts too) and the number of syllables (`(2)`, `(4+)`); the first item from the left that matches applies; ending with `| · -1` splits compounds at middle dots, each part counted separately, with primary stress on the last word; `ˌ = …` marks secondary stress. Writing `ˈ` in a rule means the stressed syllable (`V > ə / σ(C)(C)_ - ˈ(C)(C)_` weakens unstressed vowels). Every stage, column and trace of the test bench shows the stress mark; “Add stress rule” in the rule list edits them one by one
- **Syllable boundary σ**: `σ` in a rule means a syllable boundary, including word edges and both sides of separators such as `·` and `-` — `d > t / _σ` devoices syllable-finally, `V > Vː / _σ` lengthens vowels in open syllables. Syllables follow the language’s syllable settings, with digraphs and multi-letter phonemes counted as one sound; write `\σ` for the Greek letter σ itself
- **Features**: a line `[+aspirated] = ph th kh` defines a feature, and from that line on rules can use `[+aspirated]` and `[-aspirated]` (`a > e / [+aspirated]_#`); several in one bracket intersect (`[+voiced -nasal]`), and when both sides list members, target and replacement match by position (`[+aspirated] > [-aspirated]`). Unlike classes, features apply line by line and can be redefined further down. “Add feature” in the rule list
- **Custom stress rules** (Phonology → Syllables & prosody): choose “custom stress rules” as the stress position and edit them one by one in the syntax above; the test and lexicon samples are stressed by it, and IPA that already carries stress marks (from orthography rules or typed by hand) follows its marks
- **Affects stress** (inspectors of the lexicon and morphemes): when ticked, two more checkboxes appear, “Passes on part of speech” and “Passes on special stress”; special stress picks a syllable from the front or the back, or unstressed, and morphemes can choose which part of speech they “count as”. Stress rules gain three forms: `<verb>` limits an item to some parts of speech (`<pronoun|particle>` for several, `<!verb>` for all but these), position `0` means unstressed, and a lone `@` item applies the special stress marked on the entry first — `ˈ = @ , <代词|小品词> 0 , 1`. Automatic transcription, lexicon evolution, sound-change steps in paradigms and phonology samples all take this into account, as do words typed into the sound-change test bench that match a ticked entry or morpheme; when paradigms add affixes, special stress moves along, and a stressed affix takes the stress itself. The “custom stress rules” form in Phonology has “Check the entry’s special stress first” and a part of speech per item; CSV import and export gain an “Affects stress” column
- **Syllables & prosody split syllables by orthography**: the test input can be “by spelling” or “by IPA”; by spelling it is first converted with the base orthography, so spellings like th count as one sound (`ce·theurian` is no longer split cet.heurian); each side of a separator is syllabified separately and the separator is shown as written; lexicon samples use the freshly converted pronunciation, so changes to orthography rules show at once; orthographies without IPA rules convert by each phoneme’s spelling
- **Paradigms count sounds by spelling**: when an infix goes after the nth sound, a pattern takes the nth consonant or reduplication copies the first few sounds, spellings such as th and eu in the main orthography count as one sound
- **Insertable classes and morphemes scroll within their block beyond five rows**: “click to insert” in the rule editor form, classes and digraphs, “entries using it” in the morpheme inspector, unrecognised words in corpus stats, and dialects in lexicon editing
- **The rule syntax document** gained sections on syllable boundaries, stress rules and features, plus about twenty more common recipes; every example in the document is covered by tests
- **Drawn glyphs** (Script → Glyphs): “Draw a glyph”, or “Draw this glyph” in the glyph inspector, opens the glyph pad. It has ascender, cap height, x-height, baseline and descender lines; draw stroke by stroke, box-select strokes and drag the box to move them or press Delete, the eraser removes the stroke it touches, and the dot under the vertical line on the right sets the advance width. On saving, the drawn glyphs are made into a font placed first in the script’s font list, shown in the glyph table, lexicon, corpus and transcriptions; glyphs with an empty character get a private-use code point automatically
- **Words derived by paradigms can be added to the lexicon**: each inflected form derived in lexicon editing and each result of the paradigm test bench has “Create entry”, opening the new-entry form with the etymology (derivation ← the original entry, with the paradigm and slot in the notes) and relations filled in, and the headword, part of speech, paradigm, definition and tags ready to fill; or just “Create only the form, etymology and relations”
- **Paradigms inside paradigms**: pipelines gain a “paradigm” step that takes the form so far as the stem and runs a slot of another paradigm (a gerund declined by the noun cases, for example), nesting up to four levels
- **Two kinds of test bench, Compare and Free**: Compare is the old one, checking a word against the lexicon; Free takes any form you type and only shows what this paradigm makes of it, and the result can become an entry or “continue with a paradigm” to run another paradigm on it
- **Several paradigms on one entry**: “Add a paradigm” below the paradigm in lexicon editing (a word that is both noun and verb); derived forms are grouped by paradigm, and slots with the same name as earlier ones get the paradigm name in front
- **Paradigm slots collapse one by one**: in the visual view each slot starts with a triangle; collapsed, it is one line (slot name and gloss, with small print on how the cell is built — click it to expand); “Collapse all / Expand all” at the right of the “Slots” title. Collapsed states are remembered on this computer, and a cell clicked in the table or tree view expands when you land on it
- **Missing definitions in red**: entries without a definition are marked red; a status bar at the bottom right of the list counts missing definitions (red) and duplicate headwords (yellow), lists them on hover, and jumps to them on click
- **Read-only copies are encrypted**: an exported read-only copy is encrypted and compressed as a whole, so a text editor shows only gibberish; with a read-only project open, saving text, exports (CSV, dictionary, folder, PDF…) and copying results are disabled, and the developer tools can’t be opened in release builds; “Save as” still saves an encrypted copy
- **A page error no longer crashes the whole page**: a red bar at the bottom says which page failed and the error message, until closed by hand; the project goes back to before the last action, the page is redrawn, and you can carry on
- **The inspector width follows the window**: the main area keeps enough width for pages like Languages and Settings, and the rest goes to the inspector (the two sides line up in the default window); after you drag the divider its width is used, and double-clicking the divider goes back to following the window; widths remembered by older versions return to following the window once on upgrade. The side panel of the start page is unchanged
- **The lexicon table fills its area**: column widths stretch to fill the table, no longer leaving a big gap on the right; a new column first takes width proportionally from the existing ones and scrolls horizontally only when there is really no room; dragging a column’s width gives or takes from the column right next to it
- **Search by dimension and dialect**: the top-bar search of the lexicon and morphemes accepts `feature=value`, or a dimension name used as the field (`性=阴`); the lexicon also accepts `dialect=…`; the lexicon has a “Dialect” column, with a funnel filter in its header
- **“Save as” in the right-click menu**
- **Updates**: before the real download starts (while an incremental update compares), or after downloading while verifying, the notice says “Verifying”, and the progress bar appears once downloading really begins; before installing, the project is saved — directly if it was saved before, otherwise via Save As, and cancelling asks “This resets the update progress. Continue?”
- Fixed: unselected segmentation boxes in hover cards were too dark to read in dark mode
- Fixed: hovering words of examples in the start-page gallery, some words weren’t recognised at all and split ones did nothing when clicked (the same word recognition as the corpus page is now used)
- Fixed: examples in the lexicon inspector included unrelated sentences (when a stem slot held a single letter, every sentence and document line containing that letter alone counted)
- Fixed: after swapping the names of two stems added one after the other in lexicon editing, the order in display mode didn’t follow
- Fixed: switching to another paradigm tab while editing a variant made every generator on the page “None” with all pipelines empty
- Fixed: using an undefined class several times in one line of a sound-change rule crashed the page; similar crashes with duplicate names of orthographies, stages, presets and tags were handled too
- Fixed: glyphs in “Auto map” on the script page didn’t use the script’s font and showed as boxes
- Fixed: selecting text in the source view covered the text with the selection colour
- Fixed: the per-stage table of the orthography test in the Phonology inspector now centres its header and cells
- Fixed: when converting an orthography to IPA, internal symbols of digraphs that were already IPA were converted back to spelling (th → θ came out as th again), throwing off syllables & prosody, phonotactics checks and glyph categories
- Fixed: rules using digraphs were displayed and edited in the rule list with internal symbols (`th > θ` showed as `θ → θ`, and editing it wrote θ back into the rule)
- Fixed: ad-hoc classes with hyphens such as `[a-z]` in rule environments had the hyphen taken as an exclusion
- Fixed: “missing definitions” in the lexicon bottom bar, “stem” in paradigm pipelines and the counts of phrase categories were not clear enough in dark mode
- Example projects: Aelith gains the rule set “书面语 → 口语” (written → spoken), showing features, stress rules and σ; the last line of the romanization → IPA rules is a stress rule, pronouns and particles are ticked “Affects stress” and unstressed, telikaso is marked with special stress and read teliˈkaso, the clitic =mU is unstressed and the prefix be- counts as an adjective; the sister language Merun uses custom stress rules, with special stress marked on hara; vesa deliberately lacks a definition and can be reached from the lexicon bottom bar. Tsahun’s phonemes have romanized spellings, and the intensive reduplication of tsing55 gives tsitsing55
- Test fixture (Theusrin): the orthography → IPA rules gained stress rules from the grammar (syllables with half-long vowels, disyllabic words, the length of the penultimate syllable, compound words counted per word), fixing ch not separated from the digraph x, a in diphthongs replaced twice, and capital letters at the start of proper names not converted; syllables & prosody now use custom stress rules

## 0.8.4 · 2026-09-14

- **An English user guide**: the guide has a complete English version (kinnuch.github.io/cerf/qonlang/en/, with chapters and anchors matching the Chinese version and a switch at the top of every page); with the interface in English, “User guide” next to each page title, the dialog at the end of guided tours, the start-page button, the Help menu and the right-click menu all open the English version
- **Clicking a language on the Languages page makes it the current language**: clicking a language in the tree (or in the inspector’s family tree) switches “Current language” at the top right to it; switching the current language in the top bar selects it in the tree
- **A softer dark mode**: the accent is darker and less saturated, so primary buttons, selection outlines, tabs, badges and hint bars are no longer a glaring bright cyan-green, and the white text on primary buttons is clearer; faint text is a little brighter; badges filled with the language colour next to the titles of the Phonology and Script pages are dimmed; the start-page gallery gradients mix in less colour; the replacement part in rule highlighting and class names in class chips use gentler colours
- **The window defaults to 1700 × 900**: the row of buttons at the bottom of the start page fits on one line in English even with the side panel open, and no scrolling is needed with both the “recover unsaved work” bar and the new-project form open; smaller windows remembered by older versions are enlarged once (filling the work area when the screen is smaller)
- Ethan Delanche added to testing in the credits
- Fixed: the bottom of the “Changelog” panel on the start page was cut off (the panel had another fixed-height scroll box inside it)
- Fixed: in English, or with the recovery bar shown, the start-page gallery was squashed
- Fixed: in English, one button of the row at the bottom of the start page was pushed onto a second line however wide the window
- Fixed: in dark mode, the alternating row background of the sound-change test bench covered only half a row (the first column didn’t change), and text on white buttons in guided-tour bubbles was unreadable

## 0.8.3 · 2026-09-14

- **The relation graph can be dragged, expanded and collapsed** (Lexicon → Relation graph): drag the empty space to move the canvas, Ctrl + wheel to zoom, with zoom in, zoom out and re-centre at the top left; right-click a node and “Expand around this node” draws another ring of its sources, derivations, cognates… (words already in the graph are not drawn again, only linked), and “Collapse around this node” takes it back, the centre word included; right-click the empty space for “Re-centre” and “Collapse all”. Expanding a morpheme node shows the words using it (including words whose custom source mentions it), and expanding a source component that matches no entry shows the words that mention it
- **Comparison in the relation graph**: when two or more words share a root source with the centre word, “Compare” appears at the top right of the canvas. Pick the roots (several groups) and the words to compare (up to six) above, and the table lines them up: pronunciation; meaning (shared parts of the meanings shaded); the source chain from root to word; components added along the way (prefixes, suffixes, the other half of compounds, highlighting those only some words have); sound changes, re-derived through the rule sets (each step’s form and the rules applied, flagging results that differ from the lexicon); differences in part of speech, register, tags and dialect. Words derived by the same rule set get an extra “sound-change differences” view of changes only some went through; cognates in different languages get “sound correspondences”, showing what each sound of the root became in each word. Roots are traced up through etymologies; prefixes and suffixes don’t count as roots, while components split at morpheme boundaries in custom sources do
- **“Fix” in hover cards**: when a word was recognised as something else, click “Fix” at the bottom of its card, which turns into a search box for picking the right entry or morpheme, written into the word’s analysis and confirmed; when the card shows one piece of a segmentation, only that piece changes; when none of the candidates is right, click “None of these — search”. In the start-page gallery, “Fix” first opens the project, jumps to that sentence in the corpus and opens the search box right on that word
- **Refresh the current page**: the button right of Redo in the top bar (or F5) reloads the whole page when something didn’t catch up after an import or addition; filters, selections and the like are kept
- **An entry-card preview on the skin page**: the preview on the right includes a real entry card (using the most complete word in the project), so adjusting block font sizes and dragging the order shows at once; hovering a row on the left outlines the matching block in the preview
- **Automatic updates on macOS too**: “Download and install” downloads the zip for your chip, checks it against the sha256 GitHub provides, unpacks it, replaces the old Qonlang and reopens it (running the Intel version on Apple silicon switches to the native one on the way); when Qonlang sits somewhere it can’t replace itself (opened directly from the dmg or the Downloads folder), it falls back to opening the dmg, with the notice explaining to drag it into Applications. Takes effect from the first update after installing 0.8.3
- Example project Aelith: a sister language Merun (rule set “Proto → Merun”: word-initial k weakens to h and word-final i after a consonant is lost; kasu means “tent” here); “Compare” in the relation graphs of kaso and teli shows both sides’ sound changes, sound correspondences and meanings
- Fixed: jumping to the corpus, morphemes, phrasebook or lexicon from an example in the lexicon inspector (or the command palette or another page) didn’t scroll to the target or flash it — when the target wasn’t in the first batch it hadn’t been drawn yet, and restoring the last scroll position on entry pulled the scroll bar back; the list is now drawn up to the target first, then scrolled, then flashed
- Fixed: script lines in hover cards from the start-page gallery sometimes showed boxes (the project wasn’t open, so the script’s embedded font wasn’t registered)
- Fixed: on Mac, “Download and install” only opened the dmg and the notice stayed on “Installing”; when a new version was announced before this computer’s installer finished uploading, a later check now switches to one that can be installed directly; update checks send an ETag, so unchanged results don’t spend GitHub API allowance, and when rate-limited the last result is reused

## 0.8.2 · 2026-09-14

- **A gallery on the start page**: below the banner a gallery picks corpus sentences, phrases and words with pictures from your recently opened projects (up to 3) and shows them one at a time. Sentences and phrases sit on a gradient; a word with a picture uses that picture, cropped to fill the strip and blurred, as its background; translucent arrows appear left and right only on hover, and clicking slides to the next card; the order is shuffled by the date (the first card stays the same within a day), and identical texts from one project appear once. Words in sentences and phrases can be hovered for their entry cards, and “View in lexicon” on the card opens that project first and then jumps there; when nothing can be picked from the recent projects, the strip is hidden
- **Drag phrases and corpus sentences to reorder**: hold a card on the phrasebook or corpus page and drop it on another to move it there
- **Phrase pronunciations can be regenerated by rule**: in the inspector, each orthography’s pronunciation has a “!” (irregular) checkbox, ticked automatically when you edit the pronunciation by hand; unticking it recalculates by rule at once. “Transcribe by rule” (and automatic transcription after editing the text) still leaves ticked ones alone, but the hint bar says how many were skipped, and “Recalculate these too” on the hint bar recalculates them as well
- Fixed: hover cards showed only the first half of a circumfix; both halves are now shown (`first…second`), likewise in the card’s candidate list, the breakdown line and morpheme etymologies

## 0.8.1 · 2026-09-13

- **A font size for each block of the entry card** (Skin → Entry card): the overall multiplier is gone; each block (headword and pronunciation, senses, tags, etymology, stems and inflected forms, relations, derived words, notes) has its own font-size slider, in pixels; multipliers set in 0.8.0 are converted to sizes on opening
- **Parts of speech and dimensions collapse one by one**: each part of speech, dimension and inspector module starts with a triangle; collapsed, it is one line (name and abbreviation, with small print on the bound paradigms, stem slots, values and the parts of speech it applies to); each block title has “Collapse all / Expand all”, and collapsed states are remembered on this computer
- **Several paradigms for one part of speech** (Paradigms → inspector → Bound parts of speech): “verb” can be bound to both Conjugation I and Conjugation II, for example; the first bound is the default and others can be “Set as default”; when entering a word, the paradigm dropdown lists this part of speech’s paradigms as a group of their own, and the word is derived by whichever you pick; the paradigm test bench lists the words using this paradigm first
- **Letters by condition**: write `{阴:g|k}` in prefixes, suffixes, infixes, circumfixes and adjustments — g when the entry (or this cell) is “阴”, k otherwise, the rest unchanged; conditions use dimension value names or abbreviations, `性=阴` names the dimension, a comma means any of them and `+` means all of them; the small print beside affixes in a pipeline lists each choice, and the derivation trace says which branch was taken; affix inference from the corpus and morpheme references in the statistics count every choice
- **Word generation learns from the lexicon** (Phonology → Phonotactics → Generate): it learns from the words already in this language’s lexicon — which sounds are common word-initially and word-finally, how many syllables words tend to have, how sounds combine — first scattering a large pool of candidates, ranking them by how much they resemble the language, then picking a set that don’t resemble each other too much, avoiding words that differ from existing ones by just one sound; phonotactic settings are still hard rules, and every result is re-syllabified and checked against them; hover to see “Resembles: …”; with fewer than 8 words in the lexicon, or with “Learn from lexicon” off, generation follows only the phonotactics
- **Incremental updates** (Windows installer): when a new version is announced, “Download and install” downloads only the blocks of the installer that differ from the previous version (one small change, measured: 95.7 MB for the full package, 1.6 MB downloaded), assembles it and verifies the whole against the sha512 in latest.yml on the Release; if it doesn’t match, the Release lacks the update information, or anything goes wrong on the way, it falls back to downloading the full package (verified as well) — what gets installed is always identical to the installer on the Release. Installation stays silent, reuses the previous folder and reopens automatically.
  Takes effect from the next update after the 0.8.1 release is installed (earlier versions, the portable version, locally built packages and macOS still download the full package); how each download went is logged in update.log in the data folder. The Release carries two more files, latest.yml and the installer’s .blockmap
- **Table and tree views of paradigms** (Paradigms → beside the slots title): like the sound-change page, you can switch views — “Visual” is the old cell-by-cell editor; “Table” puts the first dimension in rows and the second in columns, one table per value of any further dimension; “Tree” branches dimension by dimension, and branch points can collapse. Cells hold the form derived for the test-bench word, with small print on how the cell is built (each step’s affixes, which sound changes run), and derivations that don’t match the entered form are marked red; click any cell to go back to the visual view, scrolled to that cell
- **Drag to reorder**: paradigm dimensions, each step in a pipeline, the components and applicable parts of speech of a part of speech, the applicable languages of an inspector module, phonemes in the phoneme table, orthographies, classes and digraphs in sound-change rules, tags (entries, senses, corpus, phrases…) — these little pills can be held and dropped on another to move them there; the tabs you create for paradigms, sound changes and scripts can be dragged too. While dragging, the dragged one fades and the drop target gets a dashed outline; pressing inside an input box selects text as usual instead of dragging
- **A warning when there are too many slots**: when the dimensions multiply to more than 500 slots, adding a dimension first asks for confirmation (you can still add it), and the slot note turns into a warning colour
- **“Fill from phoneme table” in phonotactics**: empty fields are filled at once; fields that already have content ask first (and can be undone); afterwards a hint bar says how many were filled in each, and also says when they already matched the table; consonants and vowels are recognised by the IPA chart as well as by classes named C / V, multi-letter spellings not in the table (ng, aa) by their letters, and a keyboard g counts as the IPA ɡ; anything that can’t be told apart as consonant or vowel is listed separately
- **“Auto categorise” for scripts uses transliteration values**: transliterations are read as sounds with the main orthography — all vowels go to “Vowel signs”, all consonants to “Consonants”, a mix to “Syllables”, and punctuation and digits as such; only glyphs without a transliteration are sorted by the character itself (letters, diacritics, private-use glyphs…); categories you named yourself are left alone; afterwards it says how many went where. New glyphs imported from a font or pasted are sorted the same way
- **CSV import can ignore round brackets**: a new option “Also read round brackets as register and other markers” (ticked by default, as before); unticked, brackets after a sense number or a part-of-speech marker stay in the definition as they are and don’t go into the marker table; presets remember this option
- **Renames carry through**: renaming a stem slot or dimension value in “Parts of speech & dimensions” (when you leave the input box) moves stems and inflected forms stored under the old name to the new one, together with lexicon columns, a script’s “Transcribe from” and stem names written in paradigm pipelines, and a hint bar says how many entries moved; names that already have content are left alone. Inflected forms move too when a paradigm’s dimensions are reordered
- **Double-click to edit**: double-clicking a row in the lexicon or morpheme table opens the inspector on the right in edit mode
- **Import / export icons**: import is now an inward arrow and export an outward arrow (menus of the lexicon, morphemes, corpus, phrasebook and sound changes, export buttons of documents and dictionaries, importing fonts for scripts, choosing a file for table import)
- **“Environment met / not met” in rules**: a `?` in the target or replacement splits one rule into two branches — `x > a?b / env` turns x into a where the environment is met and into b elsewhere; `x1?x2 > a?b / env` changes x1 where it is met and x2 to b where it isn’t; `x1?x2 > a / env` shares a in both branches. a and b can be class correspondences, `\` metathesis (`\?2` for metathesis when met), `2` gemination, or empty for deletion; both branches judge the word before this rule and apply at once. The rule syntax at the top right gains a section on “Environment met / not met”; such rules are drawn as two edges in the chain graph, and `?` is highlighted in the source
- **Several exceptions**: `- exception , exception` leaves anything inside any of them unchanged; the rule form can “Add exception” several times
- **Backslash escapes in rules**: `\?`, `\.`, `\#`, `\C` mean that character literally, not a wildcard, class or separator; a lone `\` is still metathesis. The rule syntax document covers escapes and letters by condition
- Example projects: Aelith’s “Proto → Aelith” now really derives the modern forms in the lexicon (*kasu → kaso, *nol → nöl, *sor → sör-, which used to come out as kavo, nol), using the two-branch rule `θ > t?s / #_` and the two-exception `u > o / _# - k_ , g_`; Tsahun’s romanization → IPA gains sandhi tone `35 > ˧?˧˥ / _C , _V` (the reduplicated lun35lun35 is read lun˧lun˧˥)
- Example project Aelith: nouns gain “gender” (sila and vene are feminine, dative silaga / venege, the rest kasoka), and “verb” is bound to three paradigms — Conjugation I, Conjugation II (used by tur- and sal-, past turtim) and irregular
- Fixed: after a glyph was assigned to the question mark `?` in a script’s glyph table, every word was transcribed as that glyph; symbols like `.` `#` `*` and capital letters named like classes were likewise taken as rule symbols when used as transliteration values
- Fixed: script transcription swallowed full stops as dots separating letters
- Fixed: with many paradigm slots (say 6 × 6 × 3 = 108), scrolling down still showed only the first 60 — “load another batch” never triggered inside the page’s own scroll area
- Fixed: script lines of corpus sentences in the skin-page preview showed boxes (the script’s own font wasn’t used)
- Fixed: class correspondences failed when the target had other characters around the class — `kV > kU`, `[ptk]a > [bdg]a`, `C1V > C1W` deleted the sound; the first class in the target now corresponds by position as it should
- Fixed: automatic transcription ran rules on a whole text as one word, so in `A B` the end of A didn’t count as a word end and rules with `_#` affected only the last word; it now transcribes word by word at whitespace, and commas and quotes around words don’t block word-final rules. Evolving the whole lexicon goes word by word too (consistent with the sound-change test bench and script transcription)
- Fixed: after reordering a paradigm’s dimensions (with the arrows or by dragging), its cell setups, variants and disabled slots no longer matched and showed “None” (slot keys are built from the dimension order); they are now rearranged in the new order
- Fixed: the skin-page preview took the text and translation of a corpus sentence but kept the segmentation and gloss of the built-in sample; segmentation, gloss, translation and script line now all come from the same sentence, aligned word by word
- Fixed: in entry cards and hover cards, long names of stems and inflected forms overlapped the forms on the right; the name column is now sized by the longest name, up to a little over half, and longer names wrap
- Fixed: pointing at one piece of a split word in a hover card made the breakdown line disappear and the card jump; the line now stays, with the pointed piece highlighted
- Fixed: the “Add step” menu of a paradigm pipeline didn’t close when the mouse left; it now closes shortly after, and on Esc
- Fixed: after naming a newly added stem (or inflected form) in lexicon editing and pressing Tab, focus didn’t reach the next box until Tab was pressed again; a new row sometimes appeared above the existing one; and renaming to an existing name overwrote that item (a duplicate-name hint now appears and the name goes back)

## 0.8.0 · 2026-09-13

- **Long lists render in batches**: long lists such as the lexicon, morphemes, corpus, paradigm slots and glyph table draw one screen first and the next batch when you scroll near the bottom; switching pages, changing filters and relayouts no longer stall
- **Renaming tabs and variants**: for the tabs of scripts, sound changes and paradigms, and paradigm variants, a pencil appears on the right only on hover — variants are renamed in place, and clicking a tab’s pencil focuses “Name” in the inspector for editing
- **Blocks can collapse**: parts of speech & dimensions, the phoneme and vowel tables in phonology, syllable combining and auto map in scripts, and the entry card and font library on the skin page have a triangle right of the title that shows on hover; clicking it collapses the whole block (remembered in your preferences, so it stays collapsed next time)
- **The entry card can be adjusted** (Skin → Entry card): font size of the whole card from 80% to 160%, and a separate multiplier for each block (headword and pronunciation, senses, tags, etymology, stems and inflected forms, relations, derived words, notes); blocks other than the headword can be dragged to reorder, with a dashed outline on hover
- **Brackets around pronunciations** (Settings → App): broad `/…/`, narrow `[…]`, or none
- **Grammar dimensions limited by part of speech** (Parts of speech & dimensions): each dimension can name the parts of speech it applies to; entering a word lists only the dimensions that match
- **Clear content** (Settings → Clear content): pick a module — lexicon, morphemes, corpus, phrasebook, documents, rule sets, paradigms, parts of speech, dimensions, inspector modules, abbreviation table, scripts, images — and clear it entirely, handy for importing again; it asks once first, and Ctrl+Z undoes it
- **A tour on first launch**: the start page runs a picture tour automatically (new / open, starter templates, recently opened, the bottom row), ending with the “Rule syntax” at the top right and the “User guide” of each page; all picture tours have new pixel-art bubbles — in the app’s own green, with a pixel cat lying on the top edge, and buttons inside recoloured to be legible
- **Affricates**: the phoneme table gains a row of affricates (t͡s d͡z t͡ʃ d͡ʒ t͡ɕ d͡ʑ k͡x…); spellings with a tie bar and spellings like `ts` count as the same sound, and features are still derived
- **A script’s transcription source** (script inspector): which field of the entry this script transcribes — the word (default), a stem, the pronunciation in some orthography, or an inspector module; when that field is empty it falls back to the word
- **Sound-change rules can be dragged**: drag a rule card to another stage or in front of another rule; orthography rule lists can be dragged too, and the orthography test bench shows its columns by stage
- Rename pencils take up no space when hidden and make room only on hover
- Hover cards: the segmentation bar and “View in lexicon” follow the word — at the top of the card when the word is above, at the bottom when the word is below
- When dragging rules in sound changes and orthographies, a dashed empty row opens at the drop point and the rule goes there on release; the drop point follows the pointer’s height, so the opened row no longer pushes the decision back and forth
- The grammar dimensions of the example projects and the Theusrin fixture are also limited by part of speech (nouns only number / case / noun class, verbs only mood / aspect / tense / focus…)
- Fixed: the filter panel of the lexicon header is on the top layer and no longer has its right side cut off next to the inspector
- Fixed: without a virama set for syllable combining, word-final consonants got a borrowed vowel out of nowhere (the preview was longer than the word)
- Fixed: words split with `=` in the corpus were shown with `-` again; what you write is now what’s shown (unwritten ones still follow the morpheme type)
- Fixed: two identical words in the phonology test or script test crashed the page
- Fixed: class names in rule environments were treated as digraphs (ng in `{Vlong}` became N), likewise `@morpheme` references; class names and references are now kept as they are
- Fixed: the “custom source” line of etymologies was squeezed into a narrow column; class buttons in the rule editor and colour swatches in the skin preview wrap when there is no room instead of overflowing out of sight
- Fixed: corpus hover cards near the bottom of the page were drawn against the top edge, far from the word; they now flip to just above the word
- Fixed: the filter panel in table headers was covered by the inspector
- Fixed: tables with `\|` in the rule syntax document ran together
- Fixed: after “Add rule” on the script page, “Syllable combining” and “Auto map” below didn’t move down
- Credits updated

### Changes accumulated since 0.7.3

- **Inspector modules** (Lexicon → Parts of speech & dimensions → at the bottom): add a block of your own to entries, such as variant characters of a logographic script, cultural notes or regional distribution — give it a title, choose “A text” or “Items”, choose where on the entry card it goes (by default between definitions and etymology; or above the definitions, below the etymology or at the very bottom), optionally limit it to some languages, and display it in a script’s font.
  In edit mode the input box appears at the same place; top-bar search accepts `title=content`, and the lexicon’s “Columns” can add it as a column; deleting a module deletes what entries filled in, and can be undone.
  In CSV import, columns named like a module’s title or one of its “Also accept these column names when importing” are matched automatically, or choose “Inspector module” by hand and type a new title to create one on import (the “?” beside “Column mapping” explains); exported entry CSVs have one column per module and can be imported back as is
- **CSV import: brackets after part-of-speech abbreviations**: round brackets right after a part-of-speech abbreviation, as in `n. (archaic) …` or `adj. (slang, vulgar) …`, go into the “Markers in words, definitions and notes” table and can be set as registers (comma-separated ones count as several) or tags;
  brackets that read like an explanation (`(placed before the noun)`, `(+ abs.)`) stay as they are by default. Brackets at the start of later senses governed by the same abbreviation count too
- **The base variant of a paradigm can be renamed**: “Rename” in the variant bar was always there, and with no variant selected it now renames the base set (called “通用” by default — rename it “written”, say); the variant dropdown of entries and the paradigm variant of CSV import recognise the new name
- **A wider default window**: the default width is now 1580 (filling the work area when the screen is narrower), so the bottom row of buttons no longer wraps onto several lines when the start page’s side panel is open; windows remembered narrower than this are widened once on this launch, after which dragged sizes are remembered as usual
- **Richer example projects**: Aelith and Tsahun gain inspector modules (inscription variants, variant characters in the script’s font), compound parts of speech and senses with their own part of speech, several registers per sense, stem slots, custom etymology types and relation kinds, a renamed base variant,
  voicing sandhi applied to all words (recognising dovar by inference in the corpus), `@entry` references and inflected forms with spaces (`ngo21 tui55`), homograph candidates that can’t be told apart, a personal name deliberately left out of the lexicon (“Not found” on hover), hand-entered script forms of examples, the script’s bracket settings, and `[[word]]` links in documents; the start page’s example descriptions are updated accordingly
- Fixed: in the source view of sound changes and other rules, line numbers beyond the first screen (about 25 lines) disappeared after scrolling down
- Fixed: when an etymology type was free text (an imported `bor. from CS`, for example), entry cards, morpheme cards and the relation graph showed key names like `lexicon.etyTypes.…`; it is now shown as written. Import also recognises abbreviations like `bor.`, `inh.`, `der.` and `comp.`

## 0.7.2 · 2026-09-11

- **Several registers per sense**: in edit mode the register is a tag input (Enter adds one, several allowed), and entry cards show several boxed tags side by side; in CSV import, consecutive markers and registers separated by commas or 、 in the register column all become registers, exported as `【古语】【文学】` written together.
  Registers in old projects are converted on opening; on saving, each sense also carries the old joined field, so 0.7.1 and earlier still show the registers
- **Checking for new versions**: while the app is open it checks automatically every few minutes (5 by default) and shows a notice at the bottom right as soon as there is a new version; the interval is in “Settings → Check for new versions every … minutes”.
  After “Later”, the same version doesn’t pop up again this time, while newer versions are still announced
- **Part-of-speech markers**: when importing entries from CSV, markers at the start of senses written as “Latin letters + a few characters + a dot”, like `n.` `v.` `adj.` `v因.`, are listed in a “Part-of-speech markers” table to decide one by one: set as part of speech / set as a sense tag / just remove / keep as is.
  Common abbreviations are pre-matched (n. noun, v. verb, adj. adjective…); writing the name or abbreviation of an existing part of speech uses it, slash-joined forms like `名词/动词` are compound parts of speech, and missing ones are created;
  a marker governs up to the next marker in the same cell, and `n.` or `n./v.` in the part-of-speech column also follow the table
- **Compound parts of speech**: each part of speech in “Parts of speech & dimensions” can have “Components” — “noun/verb” is made of noun and verb, say (the name and abbreviation are joined from the components automatically until you change them);
  a compound part of speech without its own paradigm or stem slots uses those of its components; filtering by part of speech, `pos=` search and the part-of-speech filter of whole-lexicon evolution all count the components
- **Part of speech per sense**: in edit mode each sense can have its own part of speech (for a compound part of speech its components are listed first); when it differs from the entry’s, entry cards, hover cards and dictionary exports show it faintly before the definition.
  In CSV import, entries whose senses belong to several parts of speech get the compound part of speech made of them; CSV export writes a sense’s part of speech as `n.` before the definition, so it imports back as is.
  Merging homographic entries works this way too: each sense remembers its original part of speech and the entry gets the compound part of speech, instead of adding text before the definition
- **Import previews**: every import first shows what it will look like (the first few items) in the inspector on the right — the CSV wizard for lexicon / morphemes, tables and JSON for the corpus and phrasebook, pasting glyphs and reading them from a font, Lexicanter lexicons, sound-change rule files;
  changing any setting updates the preview at once, with changed parts highlighted and then fading.
  Table import for the corpus and phrasebook moved from a dialog to a panel in the main area (so the inspector shows), JSON import uses this panel too; reading glyphs from a font, importing Lexicanter and importing rule files all show a preview before you click “Import”, and rule files can have their format and rule-set name changed in the panel
- **Import can fill every field of the entry page**: CSV import of entries gains language and dialect (created when missing), etymology type, etymology sources (with a source language; when it is a language in the project the source links straight to the word or morpheme with the same form, and `a + b ‘meaning’` splits into several sources), intermediate etymology forms, relations (choose the kind; targets found by word, other rows of the same import included), pronunciations in each orthography, script forms, paradigm and variant, and prefixed notes;
  morpheme import gains second forms, allomorphs (`lar / _V；ler / Front_`) and every etymology field; field dropdowns list only what “Import as” can fill.
  Table import of the corpus gains spellings in other orthographies, script forms and free lines (column names as labels), and phrases gain pronunciations in each orthography and variants with notes (`saying (note)`)
- **Codes at the start of definitions are recognised automatically**: numbers right before definitions, as in “1离开；2前往”, are shown in a table only when found, to set one by one as a sense tag / just remove / keep as is (filling in a tag means setting it as a tag), so “code=tag” no longer needs typing, and old presets are converted automatically; long numbers like “2020年” don’t count
- **Exporting the whole project as one CSV**: in “Settings → Export”, one table per section (project information, languages and phonemes, scripts and glyphs, rule sets, parts of speech, morphemes, entries and senses, paradigms, examples, phrases, documents…), nested content split into sub-tables and very long content such as embedded fonts and images stored in pieces;
  after editing in a spreadsheet, choose this .csv with “Open project” to read it back as is (it comes back as an unsaved project)
- **Leaner hints**: optional explanations like the one above import previews were removed, long explanations moved into a “?” beside the title, and the hint bar at the top of each page is down to one sentence
- **Statistics panels**: two blocks side by side align to the shorter one, and the longer one scrolls inside; each block has a faint rounded border and lights up slightly on hover
- Fixed: in CSV import, square-bracket markers right after a part-of-speech abbreviation (`n.[中古][文学]金石`) split off a sense containing only `n.`
- Fixed: long text such as “Part of speech follows the entry” in a sense’s part-of-speech dropdown covered the dropdown arrow
- Fixed: in the segmentation at the top of corpus hover cards, a piece that had a gloss but couldn’t be linked to an entry (`wéñgaus` in `Iádhon·wéñgaus`) did nothing when clicked.
  When the form doesn’t match, it now looks by meaning — it counts when a definition matches the piece’s gloss and one of that entry’s forms appears in the piece (`wéñgaus` contains `eñgaus`, the weak focus form of `eñgos`);
  pieces that still can’t be linked are all marked “Not found”, to be assigned by hand when clicked; for the entry of the whole word on hover, pieces already linked to morphemes are skipped and the stem piece is used
  (`Iádhon·wéñgaus` shows “降临” rather than “完成”, which an aspect marker happened to match)

## 0.7.1 · 2026-09-11

- **Page states are remembered**: header filters and sorting of the lexicon and morphemes, each page’s sub-page, selection, text typed into test benches and previews… are all still there when you leave a page and come back (through the navigation or “Back”); selection and scroll position aren’t restored after the current language changes
- Clicking a module button on the left again stays in the current module instead of jumping back to the previous page; Skin and Settings still go back to the previous page on a second click
- **Grammar lookup moved to the top bar**: an open-book icon between the inspector button and close project; on the sound-change, paradigm, script, phonology and morpheme pages it scrolls straight to the relevant section
- The search box’s “?” sits right after the search box
- **Entry cards**: registers of senses are shown as boxed tags (one character in Chinese, abbreviations like `lit.` in English; “Settings → Register display in entry cards” switches to full names); examples are separated from the card by a divider, with looser spacing overall
- **Hover cards for words the corpus can’t split**: when a whole word, or one piece of it, isn’t found, the card says “Not found”, and you can pick an entry or morpheme by spelling, definition or gloss in the search box to assign it; once every piece is recognised the word counts as confirmed
- **CSV format notes**: the user guide gains the column names, conventions and examples for tables of entries, morphemes, corpus and phrases, and the import wizard and table import dialog link straight to them with “Format notes”;
  exported entry CSVs separate senses with semicolons and write registers as 【register】 before the sense, and column names like `meaning_zh` in morpheme CSVs are recognised on import — exported tables can be imported straight back
- Fixed: when an `@reference` in a paradigm wasn’t found among morphemes, a space written after it was swallowed; it is now kept, and an entry with the same name is looked up (`@mo` refers to mo in the lexicon)
- Fixed: environments of morpheme allomorphs failed when classes were written in IPA and the stem was a spelling (`C` holds `k`, the spelling is `c`, so `_CC` didn’t recognise `cl-`); the spelling and the pronunciation converted with the main orthography are now both compared

## 0.7.0 · 2026-09-11

- **Custom scripts in their own fonts**: once a font is imported or assigned, the glyph table, inspector titles and “Character” input boxes use the script’s font instead of boxes;
  below the font slots on the skin page each script in the current project is listed and can be given its own font (installed from the font library or imported locally), overriding the script’s own setting
- **Picture tours**: clicking “User guide” beside a module title first circles the key points on the interface step by step — highlights, arrows with explanations, (1/N) to page through;
  at the end a dialog asks whether to read the full tutorial on the website. Each module plays this automatically once by default; the checkbox in the dialog (off by default) or “Settings → Show the picture tour every time I click User guide” plays it every time
- **Picking candidates on hover in the corpus**: when a word matches several homographic entries, the sentence’s own translation is checked first, then other examples — which entry the same word was confirmed as elsewhere,
  which entry the translations of sentences containing it mention — to pick one automatically; when it still can’t be decided, a warning-coloured wavy underline is drawn under the word, and on hover the candidates are listed side by side (up to four),
  with “This one” to fix the choice (counted as confirmed)
- **Bookmark tabs**: the sets you create for scripts, sound changes and paradigms are bookmark-style tabs, with the selected tab joined to the page below by curved edges;
  the head of the script page lines up with other modules — tabs on the left, “New script” at the far right
- **Bracket settings for scripts** (script inspector): how brackets in the text are written in the script — keep the brackets and transcribe inside and outside separately (default) / drop the brackets and merge the content into the word / write neither the brackets nor their content.
  Fixed: brackets used to be taken as part of the word, so word-initial and word-final rules next to a bracket failed and script lines came out wrong
- **Stem slots can be configured** (Lexicon → Parts of speech & dimensions): each part of speech declares which stems it has (strong / middle / weak, say) with a note;
  edit mode lists them one by one, and the “Stem” dropdown of paradigm pipelines takes its candidates from here, with a hint beside it saying where the stem comes from
- **Characters ignored in fuzzy matching** (language inspector): when the relation graph looks for words across languages or the etymology source search runs, these characters are removed before comparing —
  laryngeals H1 / H2 / H3 all counting as H, say, or dots between syllables of a root; diacritics and case were always ignored
- **CSV import: sense prefix mapping**: codes at the start of definitions (verb valency “1离开；2前往”, say) are taken out of the definition and become sense tags (“monovalent”, “divalent”),
  one “code=tag” per line, and codes can be written together; saved with the column mapping preset
- The verb heads of the test fixture (Theusrin) are derived by paradigms: the morpheme table keeps only irreducible evidential, mood, aspect, tense, negation and similar morphemes,
  the verb heads in the corpus are split into these morphemes and can be inspected piece by piece on hover; all 9 examples of the grammar’s breakdown table match. The general settings above were distilled from this data

- **Credits on the start page**: a new “Credits” at the bottom of the start page lists the friends behind the pixel art, sponsorship, testing, feedback and other support
- Fixed: after “Confirm all” in the corpus, the editor reappeared after fading out; it now collapses and stays collapsed, with the inspector staying on this sentence, and expands when the card is clicked again
- **Advanced search in the top bar**: `field=content` searches only one field (`gloss=PL`, `word=kam`, and Chinese field names like “释义=”),
  `field==content` requires an exact match, and `/regex/` searches by regular expression; separate several conditions with spaces and quote content with spaces. The “?” beside the search box lists this page’s fields
- **“Back” returns to where you were**: the history remembers the current language, the selected object and the sub-page at that time — after clicking a word of another language in the relation graph, a word in an entry card,
  or a word in the corpus that jumps to the lexicon, Back returns to that entry of the original language; the consistency check also selects the script when it jumps to the script page
- **Paradigms applied to all words** (a switch in the paradigm inspector): things like initial mutations and sandhi need no part of speech and write no inflected forms into entries;
  corpus segmentation uses them in reverse — feeding words from the lexicon to the paradigm to induce a table of “initial X becomes Y”, turning surface words back to their base forms before looking them up
  (na-wener → mener “天穹.LEN”); the remainder after a prefix is stripped is inferred backwards too (e-wenallan → menallan)
- **More general segmentation**: apostrophe contractions are looked up with the omitted vowel restored (t'am, m'nem — write ' into the morpheme boundary symbols first); words with accents or diacritics are looked up without them, and when nothing is found a split into two words is tried (both count as guesses and stay yellow until confirmed);
  each piece split at a boundary also has one layer of affixes stripped and initial mutations inferred; on hover the entry is taken from the longest piece (the noun in preposition contraction + noun)
- Fixed: spaces and middle dots written after `@morpheme` references in paradigms were swallowed — `@定指·` now gives `sa·derg`, and those written before are kept too
- “Glyph table / Mapping rules / Preview” on the script page moved left of the title, consistent with other modules
- Glyphs in “Project characters” of the character panel and script lines in the corpus export preview use the script’s font (Latin parts of the export preview still align in monospace)
- **Imports and exports completed**: the morpheme page imports and exports CSV; the sound-change page exports the current rule set or all rule sets (one .txt each);
  the corpus and phrasebook import tables (CSV / TSV / one item per line of text, choosing a field per column, skipping duplicate texts) and import and export JSON (the corpus with its analyses),
  and the corpus can export the current list as Leipzig / Markdown / HTML / LaTeX
- The test fixture (Theusrin) gains an initial-mutation paradigm: soft and liquid mutation follow the grammar’s examples, with nasal, stop and mixed mutation still to come

- **One rule syntax**: sound changes, orthographies, script mapping, paradigm adjustments and the environments of morpheme allomorphs all use the same rule syntax. New **numbered classes**:
  the same number within a rule means the same sound — `_CC` is any two consonants, `_C1C1` the same consonant doubled, and `C1C1 > C1` degeminates; ad-hoc classes in the replacement (`[ptk] > [bdg]`) correspond by position too. The start page gains “Rule syntax”, and “Grammar” beside the titles of the sound-change, paradigm, script, phonology and morpheme pages opens the full reference in the inspector on the right
- **“Back” remembers what you did**: it steps back through the places you visited — the page, the current language at the time, the selected item, the open sub-page or window (statistics, relation graph, edit mode, glyph table…),
  how far the list was scrolled and what was typed in the search box; changing entries or sub-pages within one page counts as a step too, and steps pointing to deleted objects are skipped
- **Inflected forms with spaces**: forms written as two words in the dictionary (`ar mae`, a determiner + noun) join the adjacent words of the text into one word for analysis; confirmed words aren’t joined
- Words split at boundary symbols (`la-hethí`, `na-wefer`) keep candidates from several different entries per piece, combined into several analyses in the candidate dropdown, so a wrong first pick can be changed;
  inferred initial mutations are checked by deriving them forward again, so a table that lost context (`t > d` meeting `th`) no longer gives a wrong base form; initial-mutation tables first normalise spellings by the orthography’s digraphs before comparing
- Paradigms “applied to all words”, such as initial mutations, can be limited to one language
- Table import for the corpus and phrasebook gains “Columns”: detected automatically by default, and when not every line has the same separator each line is one item (commas in sentences no longer split them); new sentences are checked for duplicates automatically after import
- **CSV import: bracket markers as registers**: when the word, definition or notes contain markers like 【专】【神】〔古〕[arch.], or the first bracket group right after a number (`1、` `2.` `3)`; round brackets count),
  the wizard lists how often each marker occurs, in which columns and with examples, to set one by one as a register (default; the name can be changed or picked from common registers), a sense tag, just remove, or keep as is;
  a marker in a definition governs up to the next marker or semicolon, splitting into different senses, a stretch of notes starting with a marker becomes a new sense, and a marker before the word governs the whole entry; saved with the column mapping preset.
  Lexicon search gains `register=`
- The vocabulary of the test fixture (Theusrin) has registers set from the markers in the word lists: personal names, proper nouns, place names, star names, deities, literary, figurative, archaic; personal names in notes become separate senses, and phrases become tags
- Fixed (code review): a mistyped or missing `@morpheme` no longer silently matches a shorter reference and still warns “Morpheme not found”; a script’s “merge / omit” brackets next to a word no longer split the word,
  brackets inside `[placeholder]` aren’t transcribed, and punctuation at either end of a word is transcribed separately (word-final rules are no longer blocked by commas); CSV sense prefixes: a letter code followed by another letter isn’t a code, and `1、离开` recognises the code before removing the number;
  JSON import cleans each item, so a malformed file can’t break the corpus page; the stem-slot input no longer loses focus after the first character, and duplicate names no longer crash; clicking a word with several candidates picks a candidate first;
  `script=` searches the transcribed text shown in the column; changing pages during a tour ends it; line breaks in help bubbles are kept; fuzzy matching no longer treats kʷ as kw; exporting all rule sets no longer overwrites files whose names differ only in case

## 0.6.8 · 2026-09-10

- Fixed: **when a circumfix was an etymology source, display mode showed only its first half** (`e…ce` became `e`); entry cards, the lexicon’s “Source” column and the relation graph now write “first…second”
- **Spaces and middle dots written into paradigm affixes are no longer swallowed**: the prefix “ė ” gives `ė derg`, and “an·” gives `an·derg` (a cell of nothing but whitespace still counts as empty)
- Fixed: the “Derived words” heading of entry cards lacked its text key, and the interface printed `lexicon.derivedWordsWords` as is
- A new **self-check test for text keys**: every `t('…')` key used in the interface must exist in both the Chinese and English sets with the same structure,
  and the prefixes of template keys (`t(\`x.${y}\`)`) must be objects on both sides — similar problems are now caught by running the tests

## 0.6.7 · 2026-09-10

- **Top-bar search covers every module**: languages, phonology, scripts, sound changes, morphemes, lexicon, paradigms, corpus, phrasebook, documents, skin and settings each have their own placeholder and filter scope
  (phonemes and classes, glyphs, rule lines, slots, document text, fonts, settings…)
- The **custom-order button of the lexicon and morphemes moved to the far left of the header**, in the same column as the up / down buttons, so it can be found however narrow the columns are
- The documents page opens on **Preview** by default (new pages still go straight to editing)
- A new **segmentation** setting (Settings → Project): by whitespace (default) / character by character (for writing systems without spaces, Chinese- or Japanese-style) / a custom separator regex
- Font library: the bundled **gilatod unicode** (the standard font of the 【荏苒之境】 encyclopedia; click “Install”, no internet needed),
  plus 14 Latin fonts free for commercial use — Andika, Cardo, Inter, Noto Sans, Fira Sans, IBM Plex Sans, EB Garamond,
  Libre Baskerville, Lora, Source Serif 4, Merriweather, Fira Code, Noto Sans Mono, Noto Sans Old Turkic
- The inscription of example project Aelith drops the separating dot between letters and gains a rune for z

## 0.6.6 · 2026-09-10

- Fixed a regression in 0.6.5: the lexicon showed an extra “Language” column before a word was selected; it now appears only when the top bar is switched to “All languages”

## 0.6.5 · 2026-09-10

- The **component bar of hover cards moved to the top of the card**; after jumping with “View in morphemes” from a card, that item is located and highlighted, then fades
- After “Confirm all” in the corpus, the inspector stays on the sentence instead of clearing
- Lists of the lexicon and morphemes are **operated from the header**: clicking a column name cycles ▼ descending → ▲ ascending → off; the funnel at the right of a column name opens a filter panel
  (select all / none / one; the first column by initial letter); the part-of-speech / tag / sort dropdowns at the top left are gone, and custom order became a small button at the far right of the header;
  when filtering leaves nothing, the header stays so you can always undo it
- **Search boxes of all modules moved to the top bar**, right of the project name and save status, with a placeholder following the current module (lexicon, morphemes, corpus, phrasebook); it clears on changing pages, and no longer takes up space in each module
- Relation graph: forms joined in custom sources and intermediate forms (`gēs-sal`, `a + b`, `x·y`) are split into several nodes,
  each component looked up as an entry or morpheme of the same form in the source language, and the ones found can be clicked (jumping across languages)
- **Duplicate checking and merging in the corpus**: identical texts differing only in source are merged directly, with the source written “A & B”; texts at least 80% similar but not identical are listed in a dialog to tick.
  A run on the Theusrin sample merged 19 pairs; the remaining two pairs really are different sentences
- Paradigm test bench: with a part of speech ticked, only words of that part of speech are listed; clicking into the input box lists candidates alphabetically
- Scripts gain a **vertical display** switch (off by default): when ticked, this script is laid out vertically in the corpus, phrasebook, lexicon and entry cards, with columns running in the writing direction
- Checking for updates: “Download and install” **downloads the installer inside the app** (with progress), saves the project once it’s downloaded, and on Windows installs silently with the previous installation options and reopens automatically;
  macOS opens the downloaded dmg
- Fixed transcriptions with brackets like `e·(ñ)galan`: brackets are no longer taken as consonants and joined into syllables
- **Statistics panels**: one each for the lexicon, morphemes and corpus (number cards + distribution bars + rankings; clicking a distribution item filters the list);
  below the paradigms’ consistency check a new **project consistency** check finds broken references, missing fields, duplicate items, unconnected settings, abbreviations missing from the abbreviation table,
  and characters outside the alphabet, grouped by severity, with each item clickable to jump there
- Skin preview: each of the fifteen colours and seven font slots has its own sample in the preview; changing an item on the left flashes its place on the right, and hovering outlines it
- **Example projects rebuilt**: two fictional projects, Aelith (agglutinative) and Tsahun (isolating and tonal), now show off the features of every module —
  a language family with proto-roots, vowel harmony, the eight step types of pipeline paradigms, variants and inheritance, masked slots and hand-filled tables, etymology chains and the relation graph, images and dialects,
  glossed and confirmed corpus sentences, phrase placeholders, documents, the abbreviation table and export templates; Tsahun also has tones, two orthographies, syllabic script combining and vertical layout.
  A new “Example projects” button on the start page opens them in one click (your changes never overwrite the example files themselves)
- Relations created automatically from etymology sources (compound, derivation, sound change…) are shown with the etymology type’s name too, instead of exposing English key names
- Fixed: when the window was covered or minimised, batch jobs such as whole-lexicon evolution, batch derivation and the consistency check were throttled by the system’s timers almost to a halt;
  background throttling is now off, so they finish even when you switch away

## 0.6.4 · 2026-09-10

- Lexicon column widths fixed: the fixed layout combined with `width:max-content` made the browser fall back to sizing by content,
  so dragging the left columns did nothing and the tag column jumped around; the table width is now the sum of the columns, and dragging any column takes effect exactly
- The changelog / developer / friends / tip jar at the bottom of the start page are shown in the side panel on the right, styled like the inspector
- The changelog is complete from 0.5.0 on
- Corpus segmentation: example sentences are scanned once to register verb heads before tokens are built; glosses compressed into one word by the grammar are split at middle dots;
  when a person isn’t in the table (“三双”, say) it falls back to other prefixes of the same series; the index and queries each get a spelling without diacritics;
  when nothing is found it strips one morpheme prefix or suffix and tries piece by piece, still requiring the definition and the gloss to match

## 0.6.3 · 2026-09-09

- The wording of paradigm “pipelines” is simplified to pipeline / sound changes / add step; the adjustment step can expand into a multi-line box
- Hover cards **stay pinned** after a component is clicked, instead of vanishing because the card got shorter; they have a close button and close on a click elsewhere or Esc
- The buttons at the bottom of hover cards change their text and target depending on whether an entry or a morpheme is shown
- Inflected forms in entry cards became a full-width table with looser rows and alternating backgrounds; empty stems and inflected forms no longer take up space
- Etymology sources became a **searchable dropdown**: circumfixes are shown as “first…second”, and forms, glosses, meanings and type names can all be searched
- `{@morpheme}` in sound-change environments no longer reports “undefined class”, and sample words can be generated
- Lexicon column widths: dragging a column first fixes the current widths of all columns, and the table follows the content width
- The changelog / developer / friends links at the bottom of the start page are shown in the side panel on the right, styled like the inspector
- Theusrin sample: inflected forms of nouns and adjectives are written “head·stem” as in the grammar (có·ubs); determiners are morphemes

## 0.6.2 · 2026-09-09

- **Paradigm generators became pipelines**: the starting point is just the stem, and prefixes, suffixes, infixes, **circumfixes**, templates, reduplication, sound changes and adjustments are all steps that can be reordered,
  used several times and in any order; the four generator types of old projects are converted to equivalent pipelines on loading, with the same derivations
- Hover matching requires “the meaning to match”: homographic candidates are picked by overlapping fragments of gloss and definition, and when none matches, no card is shown
- Square-bracket placeholders like `[noun]` in phrases no longer take part in script transcription
- Sample words of rules recognise `{@morpheme}` classes; entry cards no longer list empty inflected forms
- New **check for new versions at startup**: an update is announced at the bottom right, and a version can be skipped or the check turned off in settings; it only notifies and opens the download page, never touching project files

## 0.6.1 · 2026-09-09

- The style of segmented buttons (display / edit, variant switching, list / source…) moved into the global styles, consistent across pages
- The corpus confirmation panel moved from the top of the list to **just above the selected sentence**
- Hover analysis prefers **analyses the user has confirmed**: a confirmed word is used directly, and the same spelling confirmed elsewhere is reused;
  the bottom of the card lists each piece of the confirmed segmentation, and pieces matching a morpheme or entry can be opened
- Fixed a crash in “View all examples” when the same source matched repeatedly

## 0.6.0 · 2026-09-09

- The script module gains **syllable combining** (CV / VC syllabaries): the combination grid is derived from the glyphs’ readings, and with a few settings for the virama, voicing marks and vowel counts
  it can express spellings like “short vowels written twice, voiceless sounds spanning two cells, word-initial voiceless sounds with a virama”
- “?” hint bubbles became viewport overlays and are no longer clipped by the inspector
- Long operations (batch derivation, consistency check) show a progress bar
- The morpheme page gains display / edit modes, and the tag column no longer breaks the table alignment
- Jumping to the corpus or phrasebook locates that item and briefly highlights it; the examples dialog can be searched
- Lexicon search covers all text, including stems, inflected forms, pronunciations, scripts and etymologies
- The paradigm test bench fuzzy-searches the whole lexicon; clicking a node in the relation graph re-centres it in place, switching the current language when crossing languages
- Window size and position are remembered

## 0.5.1 · 2026-09-09

- Lexicon column widths can be dragged and are remembered; columns with the same name get a warning
- Examples are attached below entries (corpus / phrasebook / documents), 3 by default, expandable to all with loading on scroll
- Duplicate entries can be highlighted (can be turned off in settings) and merged, with senses joined in order and parts of speech shown together
- Ctrl / Shift multi-select to tag or delete in bulk; glyphs on the script page too
- Common presets for registers; CSV import splits senses at Chinese and English semicolons

## 0.5.0 · 2026-09-09

- **Etymology rebuilt**: the proto-form field is gone, replaced by a chain “source > intermediate forms… > entry” with customisable types;
  sources offer a morpheme / entry / custom picker by type, and entry sources go into the relation graph automatically; morphemes have etymologies too
- Chinese terminology adjusted: 范式 → 构形 (paradigm), 短语簿 → 短语 (phrasebook), 对账 → 一致性检查 (consistency check), 词头 → 单词 (word)
- The consistency check button moved next to the paradigm module title
- A small “?” beside each module panel gives a one-line usage note on hover
- Read-only mode: export a project with a read-only mark, which opens without saving or editing

## 0.4.0 · 2026-09-09

### The Theusrin sample project

- A new script `npm run examples:theusrin` rebuilds the whole project from the grammar in the website repository (`laim/Theusṛin.md`), the sound-change rules (`SCA/*.txt`),
  the Kessar script font (`assets/fonts/kessar.woff2`) and the author’s word lists
- 5 languages (Proto-Hikrin → Proto / Old / Classical Theusrin → the standard language), 36 phonemes with two-way orthography rules,
  syllables and stress, and phonotactic tables
- Kessar script: 130 glyphs (inherent / binary / feature sounds / digits / punctuation / function marks), with the font embedded in the project file,
  and one glyph can have several readings
- Sound changes: 231 rules in six stages, every stage bound to its language
- The noun declension paradigm = true stem + case suffix + the whole sound-change chain, checkable cell by cell against forms recorded in the dictionary
- Corpus: the grammar’s 98 interlinear examples, with Kessar text, spelling breakdowns and word-by-word glosses
- 79 phrases, 13 document pages (the full grammar), 42 interlinear abbreviations, 1345 morphemes and 1467 entries

### Other

- Examples can have a hand-entered form in a custom script (“Script form” in the inspector), used in exports and lists
- A glyph’s transliteration can have several readings, separated by /

## 0.3.1 · 2026-09-09 · trial feedback

- Multilingual text such as translations, definitions and dimension names is shown **in the interface language first** (with the interface in English, phrasebook and corpus translations show in English)
- Dropdown menus all **open on click and close on a click outside or Esc**, and avoid sticking out of the window (lexicon “Columns / Import / Export”, sound-change “Import”); hover no longer opens them
- **Undo / redo**: any project change can be undone with Ctrl+Z / Ctrl+Y (inside an input box, the box undoes first), with undo / redo buttons in the top bar; a **back** button and Alt+←
- **Right-click menu**: cut / copy / paste / select all, undo / redo / back, command palette Ctrl+K, character panel Ctrl+I, save, user guide
- **Sorting**: morphemes by alphabet / type / custom order (move up and down); the lexicon gains sorting by part of speech and custom order; parts of speech, dimensions and dimension values can be moved up and down or sorted alphabetically in one click
- **Entry images**: add pictures in edit mode, all sized by “Settings → Entry image size” (320×240 by default); a matching size is kept as is, the same ratio is scaled proportionally, and anything else opens a crop box; PNG / GIF are lossless and JPEG / WebP keep their format; entry cards show the first image right of the headword and the rest as thumbnails
- Automatic corpus analysis: matching ignores differences in case and Unicode normalisation, and falls back to the morpheme tables up the proto-language chain when nothing is found (so roots in a proto-language are recognised)
- Words in the phrasebook have hover cards and jump to the lexicon too
- Sound-change rules can refer to a morpheme’s allomorphs with `@morpheme` (its gloss or its form without hyphens), for consonant alternations and the like
- The paradigm “adjustment” column lines up with the parameter column; tables and chain graphs that overflow only horizontally scroll with the plain mouse wheel; the chain graph’s scroll bar stays at the bottom of the visible area
- Sidebar labels of the English interface no longer touch the edge; “User guide” buttons sit beside each page title, and in the left column of the start page; the sound-change page drops “Grammar notes”

## 0.3.0 · 2026-09-08 · M6 polish

### Phrasebook (new section)

- Categories → phrases; translations, automatic pronunciation by orthography rules, variants (spelling + register note), tags; script lines; double-click a category to rename it

### Documents (new section, replacing the placeholder page)

- Markdown pages inside the project: edit / split / preview, with a toolbar inserting syntax; headings, lists, quotes, code blocks, tables, bold and italic, links
- `[[headword]]` links to lexicon entries and jumps on click in the preview; pages can belong to a language; export to Markdown / PDF

### Whole-lexicon evolution (“Evolve lexicon” on the sound-change page)

- Choose source / target language, start and end stage, input field (headword / stem slot / source-language morpheme table) and a part-of-speech filter
- Preview every derived result first (new / updated / unchanged / skipped), then write into the target language; new words get an “inherited” etymology link automatically, and rerunning after changing rules updates headwords without creating duplicates

### Dictionary export (the lexicon “Export” menu)

- HTML (two-column print style), Markdown, PDF (the desktop app writes a file directly, the web version prints); optional stems and inflected forms, etymology, script, notes, grouping by initial letter, and the language of senses
- Per-entry templates: `{{lemma}} {{ipa}} {{pos}} {{script}} {{definition}} …` with `{{#senses}}` `{{#forms}}` blocks; templates can be saved to the project

### Ctrl+K command palette

- Searches entries, morphemes, examples, phrases, documents, rule sets, paradigms and languages across pages; Enter jumps to the page and selects the item; you can also type a page name to navigate or run commands such as save

### macOS and the release process

- macOS build configuration (dmg + zip, Intel and Apple silicon, unsigned), an application menu (Cmd+C/V/Z, File, View, Help → User guide), `sh dev.sh`
- GitHub Actions: pushing a `v*` tag builds on Windows and macOS and publishes a Release automatically; `npm run release` tags in one step; every push runs lint / typecheck / tests

### User guide

- Each page has a “User guide” link at the bottom right, and the start page has one at the bottom; the sound-change page’s “Grammar notes” point to the rule-language chapter of the guide. The guide is hosted on the author’s website https://kinnuch.github.io/cerf/qonlang/ , in 14 pages by module

### Fixes after code review

- Electron doesn’t support `window.prompt`: “Save as my preset / Rename” on the skin page, custom script categories and renaming phrasebook categories use in-app input boxes instead
- The type check of `npm run build` failed in the whole-lexicon evolution module (a union type of input fields); fixed
- A missing import broke the whole page when closing a project and returning to the start page; fixed, and every page got an error boundary
- ESLint can parse `.svelte.ts` now and `npm run lint` has zero errors; the whole codebase is formatted with prettier

### Other

- A new app icon (a teal rounded square + the regular-script character 「千」 in LXGW WenKai, OFL); `build/icon.ico` for the installer
- A Bilibili link in the developer information on the start page; the etymology type “Inherited (sound change)”

## 0.2.0 · 2026-09-08

### Scripts (new section, between phonology and sound changes)

- Each language can define several writing systems: type (alphabet / abjad / abugida / syllabary / logography / featural / mixed), writing direction, font
- Read the glyph table from a TTF / OTF font file (cmap + post glyph names), with the font embeddable in the project file; or paste a character table
- Automatic glyph categories, transliteration values and notes; `@glyphs` auto map + custom rules (the same rule language as sound changes)
- The lexicon gains a “Script” column with manual overrides, and entry cards, the corpus editor / list / exports (Leipzig, Markdown, HTML, LaTeX, template `{{script}}`) all carry a script line
- The “Project characters” tab of the character panel lists the current language’s glyphs

### Skin (the T-shirt icon at the bottom left of the navigation)

- Presets: Default, Ancient China, Bamboo Grove, Western Fantasy, Ocean Blue, Ink Night; separate light / dark palettes, each colour adjustable with a picker
- Font slots: interface, language data, monospace, corpus text, translation, gloss, custom scripts
- Font library: a built-in catalogue of OFL fonts free for commercial use (LXGW WenKai, Source Han Serif / Sans, Charis SIL, Gentium Plus, Cinzel, Noto Sans Runic and more), downloaded to the app data folder in one click, or added locally; a mirror prefix can be set

### Corpus and links between modules

- After “Confirm all” the editor fades out, the example card grows a gloss line and flashes green
- Hovering a word in an example shows its entry card, which can jump to the word in the lexicon
- Each page has a dismissible hint about how it links to other modules; derivation, import and similar actions have completion animations
- The start-page banner links to the Gilatod Wiki; at the bottom: buy me a coffee, changelog, developer, friends
- The English name became Qonlang, with the executable `Qonlang.exe`

## 0.1.0 · 2026-09-08

### M5 Corpus and automatic glossing

- Entering examples, an interlinear editor (segmentation / gloss / candidates / confirmation / creating words in place)
- Automatic analysis: confirmed analyses first, then headwords / stems / inflected forms / morphemes, stripping several layers of affixes
- Export: Leipzig plain text, Markdown, HTML, LaTeX, custom templates
- Corpus statistics and the abbreviation table (filling in the standard Leipzig abbreviations in one click)

### M4 Morphological paradigms

- Slots generated from the Cartesian product of dimensions; five generators: concatenation, concatenation followed by sound changes, template alternation, reduplication and table lookup
- `@morpheme` references pick allomorphs by environment; paradigm inheritance; an “adjustment” per slot
- A test bench, writing derivations into entries, and checking them against recorded forms

### M3 Phonology

- Build the phoneme table by clicking the IPA chart, with features inferred automatically; classes generated from members or features
- Two-way orthography rules and automatic transcription; syllabification, stress and tone tables; phonotactic checks and random word generation

### M2 Morphemes and lexicon

- Morpheme table, lexicon (display / edit modes, custom columns, relation graph), parts of speech and dimensions
- CSV wizard (with pasting and presets), Lexicanter import

### M1 Sound changes

- A rule engine compatible with the Yinbianji rule syntax, stage snapshots and rule-by-rule traces
- Three views — rule list, chain graph and source — and a test bench

### M0 Scaffolding

- Electron + Svelte 5, single-file projects, automatic backups, Chinese and English interfaces, light / dark themes
- A global IPA character panel (Ctrl+I)
