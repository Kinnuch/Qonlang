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
| `-* name` | stage snapshot: record the form at this point |

Classes and multigraphs defined on the Phonology page are available everywhere; declarations with the same name in a rule text override them.

## Position symbols {#symbols}

| Notation | Meaning | Example |
|---|---|---|
| `#` | word start (on the left) or word end (on the right); with spaces in the input each word has its own (a paradigm pipeline treats the whole form as one word) | `V > / _#` drops a final vowel |
| `C`, `V`, `{name}`, `[ptk]` | **any one** member of the class; each occurrence is independent | `_CC`: followed by **any two** consonants |
| `C1`, `C2`, `V1`… | numbered class: **within one rule, the same number is the same sound** | `_C1C1`: followed by **the same consonant twice** |
| `(x)` | optional | `#(C)V_` |
| `x\|y` | either | `#\|C_` word-initially or after a consonant |
| `?` | (in environments; for `?` in the target or replacement see "Inside / outside the environment" below) any number of sounds in between | `A > e / Front?_` |
| `@name` | a morpheme (by gloss or form); members are all its allomorphs | `@PL > @PL.weak / V_` |
| `t.h` | a dot keeps two letters from being read as a multigraph | |
| `¢` | compound-internal boundary (an ordinary symbol; delete it at the end: `¢ > / _`) | |
| `\?`, `\.`, `\#`, `\C`… | backslash + symbol: that character itself, not a rule symbol or a class | `\? > ⸮` turns a question mark into the script's question mark |

Numbers only count within one rule: `C1C2` is two consonants (same or different), `C1VC1` is consonant–vowel–the same consonant.

## In the replacement {#replacement}

| Notation | Meaning | Example |
|---|---|---|
| class to class | the target's first class maps position by position onto the replacement's class | `[ptk] > [bdg] / V_V` |
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

Fill the stem's consonants and vowels into a template: `C1`, `C2`… are the stem's 1st, 2nd… consonant, a bare `C` takes the next one, `V` likewise; everything else is copied. Examples: `C1aC2aC3`, `maCCuC`. Numbers mean the same as in rules: a specific sound.

### Infix positions {#infix}

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
| voice intervocalic stops | `[ptk] > [bdg] / V_V` |
| degeminate | `C1C1 > C1` |
| prothetic vowel before two consonants | `> e / #_CC` |
| collapse a doubled vowel | `V1 > / V1_` |
| vowel harmony | define `Back=aou`, `Front=eöü`, then `A > a / Back?_`, `A > e / Front?_` |
| initial lenition | `m > w / #_` |
| remove compound boundaries | `¢ > / _` (last in the rule set) |
