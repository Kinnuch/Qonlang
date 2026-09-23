# Rule syntax

Everywhere Qonlang takes "rules" — sound-change rule sets, orthographies, script mappings, adjustments in paradigm pipelines and allomorph environments — the same notation applies (it follows the 音变姬 / Yinbianji rule format). This page starts with a single rule and ends with how each place uses it.

## One rule {#rule}

```
target > replacement / environment , environment … - exclusion , exclusion …
```

- **Target**: what to change. Leave it empty to **insert** at the environment (`> e / #_CC`).
- **Replacement**: what it becomes. Leave it empty to **delete** (`h > / V_V`).
- **Environment**: `_` marks where the target sits; write what must come before it on the left and after it on the right. Either side may be empty, but `_` may not be omitted. Without `/` the rule applies everywhere. Separate several environments with `,`; they apply one after another.
- **Exclusion**: after `-`, an environment where nothing changes (`p > pp / V_V - _#`); separate several with `,` — a match inside any of them is left alone (`p > b / V_V - a_a , o_o`).

Rules apply top to bottom, and each rule matches repeatedly from left to right across the word. `;` starts a comment.

## Classes {#classes}

| Notation | Meaning |
|---|---|
| `V=aeiou` | single capital-letter class, members split by character |
| `{Vlong}=ā ē ī ō ū` | long-named class, members separated by spaces or commas |
| `[ptk]` | ad-hoc class written inside a rule |
| `th\|θ` | multigraph: th is matched as one unit |
| `[+asp] = ph th kh` | feature: from this line on, rules can write `[+asp]` and `[-asp]` (see "Features" below) |
| `ˈ = -2 , -3` | stress rule: words reaching this line get stress marks (see "Stress rules" below) |
| `-* name` | stage snapshot: record the form at this point |
| `-@ set name : stage .. stage` | run a stretch of another sound-change set here (see “Using another set” below) |

Classes and multigraphs defined on the Phonology page are available everywhere; declarations with the same name in a rule text override them.

## Position symbols {#symbols}

| Notation | Meaning | Example |
|---|---|---|
| `#` | word start (on the left) or word end (on the right); with spaces in the input each word has its own (a paradigm pipeline treats the whole form as one word) | `V > / _#` drops a final vowel |
| `C`, `V`, `{name}`, `[ptk]` | **any one** member of the class; each occurrence is independent | `_CC`: followed by **any two** consonants |
| `C1`, `C2`, `V1`… | numbered class: **within one rule, the same number is the same sound** | `_C1C1`: followed by **the same consonant twice** |
| `σ` | syllable boundary: between two syllables, and also at the word edges and around separators such as `·` and `-` (see "Syllable boundaries" below) | `d > t / _σ` devoices a syllable-final d |
| `ˈ`, `ˌ` | the start of the stressed / secondary-stressed syllable (a stress rule has to mark it first) | `a > aː / ˈ(C)(C)_` lengthens a in the stressed syllable |
| `[+asp]`, `[-asp +stop]` | feature: a sound that has / lacks it; several in one bracket intersect | `a > e / [+asp]_` |
| `(x)` | optional | `#(C)V_` |
| `x\|y` | either | `#\|C_` word-initially or after a consonant |
| `?` | (in environments; for `?` in the target or replacement see "Inside / outside the environment" below) any number of sounds in between | `A > e / Front?_` |
| `@name` | a morpheme (by gloss or form); members are all its allomorphs | `@PL > @PL.weak / V_` |
| `t.h` | a dot keeps two letters from being read as a multigraph | |
| `¢` | compound-internal boundary (an ordinary symbol; delete it at the end: `¢ > / _`) | |
| `\?`, `\.`, `\#`, `\C`, `\σ`… | backslash + symbol: that character itself, not a rule symbol or a class (the Greek letter σ itself is `\σ`) | `\? > ⸮` turns a question mark into the script's question mark |

Numbers only count within one rule: `C1C2` is two consonants (same or different), `C1VC1` is consonant–vowel–the same consonant.

## In the replacement {#replacement}

| Notation | Meaning | Example |
|---|---|---|
| class to class | the target's first class maps position by position onto the replacement's class | `[ptk] > [bdg] / V_V` |
| two sounds merging | write the shared member twice on the replacement side so the positions still line up (members are never de-duplicated) | `{A}=m b d`, `{B}=w w dh`, `{A} > {B} / #_` |
| feature to feature | also position by position, when both sides list members: `[+asp] = ph th kh`, `[-asp] = p t k` | `[+asp] > [-asp] / _#` |
| `C1`… | outputs the sound matched by the same-numbered class in the target or environment | `C1C1 > C1` degeminates |
| `\` | metathesis (longer matches are reversed) | `bm > \ / _` |
| `2` | write the target twice | `p > 2 / V_V` |
| empty | delete | `h > / V_V` |

## Inside / outside the environment {#ifelse}

One `?` in the target or the replacement splits a rule in two: before the `?` is what happens **inside** the environment, after it what happens **outside**.

| Notation | Meaning | Example |
|---|---|---|
| `x > a?b / env` | x inside the environment becomes a, every other x becomes b | `p > b?f / V_V`: p between vowels becomes b, p elsewhere becomes f |
| `x1?x2 > a?b / env` | x1 inside the environment becomes a; wherever the environment does not hold, x2 becomes b | `t?d > s?z / _i`: t before i becomes s, d not before i becomes z |
| `x1?x2 > a / env` | x1 inside becomes a, x2 outside becomes a | `p?b > f / V_V` |

- a and b can be any replacement: class correspondence (`[ptk] > [bdg]?[fθx] / V_V`), `\` metathesis, `2` doubling, empty for deletion. Metathesis inside and doubling outside is `\?2`.
- "Inside" means one of the environments matches and no exclusion does; every other position is "outside".
- Both halves look at the word as it was before the rule and change it in one go, so what one half writes is never changed again by the other; where both could apply, the inside half wins.
- The target and the replacement may each hold one `?`; in environments `?` still means "any number of sounds in between". Write `\?` for a literal question mark.
- Without an environment every position counts as inside, so the half after `?` never applies (you get a warning).

## Syllable boundaries σ {#syllables}

`σ` in a rule means "a syllable boundary is here". The word is split into syllables before matching, and σ matches between two syllables; the start and end of the word and both sides of separators such as `·` `-` `‿` `=` count too. Parts of the rule without σ match as usual, regardless of syllables.

How syllables are found: from the language's settings on the Phonology page (Syllables & prosody, Phonotactics) — nuclei are vowel phonemes, a class named V or the phonotactic nuclei (a V defined in the rule text counts as well); consonants go to the next syllable's onset as far as the legal-onset list and the syllable template allow. Multigraphs (`th|θ`) and multi-letter phonemes (`ts`, `aɪ̯`) count as one sound; letters the inventory does not know are judged vowel or not by the IPA chart, so syllables work even halfway through orthography rules while the word is still spelled.

| Notation | Meaning |
|---|---|
| `d > t / _σ` | devoice a syllable-final d (the word end is syllable-final too): ad.ma → at.ma, ad → at |
| `k > g / σ_` | voice a syllable-initial k |
| `V > Vː / _σ` | lengthen vowels in open syllables (a boundary right after the vowel) |
| `> ə / Cσ_C` | insert ə between consonants of two syllables: ak.ta → akəta |
| `s > h / _σC` | a syllable-final s before a consonant becomes h |
| `h > / σ_` | drop a syllable-initial h |

- One rule may use several σ: `a > e / σC_Cσ` is "a in a closed CVC syllable".
- Syllables follow the word as it is at that rule: when earlier rules change the word, later σ rules split it again.
- For the Greek letter σ itself write `\σ`.

## Stress rules {#stress}

A line `ˈ = entry , entry , …` is a stress rule: when a word reaches it, one syllable is picked by the entries and marked with `ˈ` in front. The mark travels with the word; later rules match as usual (a ˈ between two sounds does not get in the way), and a ˈ inside a replaced stretch is put back where it was. The next stress rule marks the word again by its own entries. Every stage and column of the test bench shows the stress marks.

| Notation | Meaning |
|---|---|
| `ˈ = …` | primary stress; existing stress marks are removed first (`'` works if you cannot type ˈ) |
| `ˌ = …` | secondary stress; primary stress stays, and a syllable that already has it is skipped |
| `ˈ =` | nothing after `=`: remove stress; later rules see no marks |

**Entries** are tried from left to right; the first that fits wins. An entry is `<part of speech> (syllables) position nucleus / environment - exclusion`, where everything but the position may be left out:

| Part | Notation | Meaning |
|---|---|---|
| part of speech | `<noun>`, `<noun\|adjective>`, `<!verb>` | only for words of these parts of speech (a leading `!` means "not these"); only entries and morphemes with "Affects stress → Pass part of speech" ticked carry a part of speech, and the entry is skipped for words without one |
| syllables | `(2)`, `(3+)` | only for words of exactly 2 / at least 3 syllables |
| position | `1`, `2`, `-1`, `-2`, `-3` | the 1st, 2nd syllable; the last, second-to-last, third-to-last |
| | `0` | unstressed |
| | `*`, `-*` | the first syllable from the start / from the end that fits the conditions |
| nucleus | `{diph}`, `[áéí]`, `Vː` | the syllable's nucleus contains it (the nucleus is the run of adjacent vowels: ái contains á) |
| environment | `/ _CC`, `/ σC_` | `_` is the nucleus; `_CC` is a nucleus followed by two consonants (across the syllable boundary too) |
| exclusion | `- #_` | not when the exclusion matches |

- An entry without conditions falls back to the nearest end in short words: the "third-to-last syllable" of a monosyllable is that syllable. An entry with conditions is skipped when the word has no such position.
- A lone `@` entry (usually first): for words whose entry or morpheme has "Affects stress → Pass special stress" ticked, the whole word is stressed on the syllable set there (or left unstressed), and the other entries are skipped; words without it go on to the next entries.
- An entry's part of speech and special stress go along in automatic pronunciation, lexicon evolution and the sound-change step of paradigms (when an affix is added, the special stress moves with it, and a stressed affix takes the stress); a word typed into the Sound changes test bench carries them too when it matches an entry or morpheme of this language with "Affects stress" ticked (compared without hyphens).
- End the rule with `| separators part` to split the word at those separators, stress each part on its own, and put the primary stress on the given part (`1` the first, `-1` the last); the other parts get secondary stress. `| · -1` means "each word of a compound on its own, main stress on the last word".

| Stress wanted | Rule |
|---|---|
| always the first syllable | `ˈ = 1` |
| the penult | `ˈ = -2` |
| Latin-style: the penult if it is heavy (long nucleus, or two consonants after it), otherwise the antepenult | `ˈ = -2 {long} , -2 / _CC , -3` |
| the leftmost long vowel, otherwise the first syllable | `ˈ = * {long} , 1` |
| the rightmost closed syllable, otherwise the last syllable | `ˈ = -* / _Cσ , -1` |
| syllables with an acute first; in two-syllable words, the second one if it has a diphthong | `ˈ = * [áéíóú] , (2) -1 {diph} , (2) 1 , -3` |
| each word of a compound on its own, main stress on the last word | `ˈ = -2 , -1 \| · -1` |
| secondary stress on the first syllable of long words | after the primary rule, a separate line `ˌ = (4+) 1` |
| verbs stressed on the last syllable, everything else on the penult | `ˈ = <verb> -1 , -2` |
| pronouns and particles unstressed | `ˈ = <pronoun\|particle> 0 , 1` |
| a few words with irregular stress | tick "Affects stress → Pass special stress" on the entry and set the syllable, then write `ˈ = @ , -2` |

Using stress in rules: `ˈ` matches the start of the stressed syllable (the mark sits before the syllable's first sound), `ˌ` the secondary one.

| Notation | Meaning |
|---|---|
| `a > aː / ˈ(C)(C)_` | lengthen a in the stressed syllable (onsets of up to two consonants) |
| `V > ə / σ(C)(C)_ - ˈ(C)(C)_` | reduce vowels of unstressed syllables to ə |
| `ˈ > ` | delete the stress marks (like `ˈ =`, but only at this step) |

When the Phonology page's stress position is set to "Custom stress rule", you write the part after `=` (`-2 {long} , -2 / _CC , -3`); the test and the lexicon samples are stressed by it, and IPA that already carries ˈ (marked by orthography rules or typed by hand) keeps its marks.

## Using another set {#include}

When two sets share a stretch of history (two sister languages coming down the same proto stage, say), there is no need to copy the rules. Write one line:

```
-@ set name : from stage .. to stage
```

When the run reaches that line, the rules of that set between the two stages run right there. The colon and the stages are optional (`-@ set name`), which runs the whole set.

- Change the other set and everything that uses it follows — the shared stretch is maintained in one place.
- Stages that come in this way count here too: the test bench, the **Sound change** step in paradigms and an entry's history row can all pick them; a stage with the same name as one of your own counts as the same stage.
- The set being used is parsed with **its own** language: its classes and digraphs are its own and are not affected by this side.
- A set may use another set in turn (up to four levels); using each other in a circle is an error, and renaming a set means fixing the line that refers to it.

## Features {#features}

A line `[+name] = member member …` defines a feature; members are separated by spaces (`ph` is one member). From that line on, `[+name]` in a rule means "any sound with this feature" and `[-name]` any sound without it.

| Notation | Meaning |
|---|---|
| `[+asp] = ph th kh` | define "aspirated" |
| `[-asp] = p t k` | you may list the members without it too; if you do not, `[-asp]` means any sound other than the aspirated ones |
| `a > e / [+asp]_#` | a final a after an aspirate becomes e |
| `[+asp] > [-asp] / _C` | aspirates before a consonant become the matching plain stops (both sides listed, mapped by position) |
| `i > / [+voice -nasal]_#` | several features in one bracket intersect: after a voiced sound that is not nasal |

- Features differ from classes in scope: a class holds for the whole rule text, while a feature **takes effect from its line** and can be redefined further down — say, after a change turns ph into f, add a line `[+asp] = th kh`.
- Referring to a feature that is not defined yet gives a warning, and that spot matches nothing.
- A bracket is a feature only when it holds `+name` / `-name`; `[ptk]`, `[^aeiou]`, `[a-z]` are still ad-hoc classes.

## Where it is used {#places}

### Sound changes, orthographies, script mappings

Everything above works. In a script mapping, a line containing only `@glyphs` expands into the correspondences generated from the glyph table; transliterations containing symbols such as `?` `.` `#` are escaped with a backslash automatically, so they match literally.

### Allomorph environments {#allomorph}

Write only the environment; `_` is the morpheme itself:

- **Suffixes** look at the end of the stem before them: `V_` after a vowel, `C1C1_` after a double consonant.
- **Prefixes** look at the start of the stem after them: `_d` before d, `_Vr` before "vowel + r", `_CC` before any two consonants, `_C1C1` before a double consonant.
- The first matching row wins; a row with an empty environment is the default form.

### Pipeline "adjust" steps {#adjust}

One rule per line, e.g. `at > / _#`, `> u / _#`. Four literal shorthands are also accepted (they do not read classes):

| Shorthand | Same as |
|---|---|
| `-at` | `at > / _#` remove final at |
| `+u` | `> u / _#` append u |
| `^-e` | `e > / #_` remove initial e |
| `^+a` | `> a / #_` prepend a |

Classes, multigraphs and features can also be declared inside the step; they apply to every rule in the step, wherever the line sits:

```
{Voiceless}=p t k
{Voiced}=b d g
{Voiceless} > {Voiced} / #_
```

### Letters that change by condition {#condition}

Prefixes, suffixes, infixes, circumfixes and adjust steps accept `{condition:form|condition:form|default}`: each entry and cell picks one branch while the rest stays the same. Conditions are value names or abbreviations; both the entry's own features (gender, noun class…) and the cell's dimension values count, and for the same dimension the cell wins.

| Notation | Meaning |
|---|---|
| `-{F:g\|k}A` | g when the entry is feminine, k otherwise |
| `{gender=F:a\|o}` | name the dimension when two dimensions share a value name |
| `{M,N:o\|a}` | comma: any of them |
| `{F+PL:ae\|F:a\|o}` | plus: all of them; the first matching branch from the left wins |
| `-{M:s}` | with no default branch and no match, the piece is empty |

### Paradigm templates {#pattern}

Fill the stem's consonants and vowels into a template (sounds are counted in the spelling: if the primary orthography writes a phoneme as th, th is one consonant): `C1`, `C2`… are the stem's 1st, 2nd… consonant, a bare `C` takes the next one, `V` likewise; everything else is copied. Examples: `C1aC2aC3`, `maCCuC`. Numbers mean the same as in rules: a specific sound.

### Infix positions {#infix}

Segments are counted in the spelling: when the phoneme table lists how each orthography writes a phoneme, or a multigraph is declared, spellings such as th and eu count as one sound (reduplication takes its first sounds the same way).

| Notation | Position |
|---|---|
| `V1`, `C1` | after the first vowel / consonant (`C2` the second…) |
| `C-1` | after the last consonant (negative counts from the end) |
| `<C-1` | before the last consonant (a leading `<` inserts before it) |
| `2` | after the 2nd segment |
| `-1` | before the last segment |

## Recipes {#recipes}

| Goal | Rule |
|---|---|
| drop final vowels | `V > / _#` |
| drop final consonants | `C > / _#` |
| voice intervocalic stops | `[ptk] > [bdg] / V_V` |
| devoice syllable-final voiced stops | `[bdg] > [ptk] / _σ` |
| lengthen vowels in open syllables | `V > Vː / _σ` |
| degeminate | `C1C1 > C1` |
| regressive assimilation: a consonant copies the next one | `C1C2 > C2C2 / V_V` |
| nasal place assimilation | `n > m / _[pbm]` |
| palatalize velars before front vowels | define `{velar}=k g`, `{palatal}=tʃ dʒ`, then `{velar} > {palatal} / _[ie]` (multi-letter members need a long-named class; square brackets split into single characters) |
| prothetic vowel before two consonants | `> e / #_CC` |
| insert a vowel into a cluster across syllables | `> ə / Cσ_C` |
| collapse a doubled vowel | `V1 > / V1_` |
| insert j between vowels | `> j / i_V` |
| final sk metathesizes to ks | `sk > \ / _#` |
| vowel harmony | define `Back=aou`, `Front=eöü`, then `A > a / Back?_`, `A > e / Front?_` |
| initial lenition | `m > w / #_` |
| p becomes b between vowels and f elsewhere | `p > b?f / V_V` |
| fixed penultimate stress | `ˈ = -2` |
| Latin-style stress | `ˈ = -2 {long} , -2 / _CC , -3` |
| lengthen the stressed vowel | `V > Vː / ˈ(C)(C)_` |
| reduce unstressed vowels | `V > ə / σ(C)(C)_ - ˈ(C)(C)_` |
| a after an aspirate becomes e | first `[+asp] = ph th kh`, then `a > e / [+asp]_` |
| aspirates lose aspiration before consonants | `[+asp] = ph th kh`, `[-asp] = p t k`, then `[+asp] > [-asp] / _C` |
| remove compound boundaries | `¢ > / _` (last in the rule set) |
