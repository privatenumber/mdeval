# Marker detection

Verified 2026-11-16 on Node.js 26.13.0, Apple M2 Max, with gfm-comments from its current `develop` branch (gfm-comments commit `c28cc01`).

An `<!--mdeval` comment is active only when GitHub renders it as an HTML comment. [`parseMarkdown`](../../src/parse-markdown.ts) gets the rendered comments from [gfm-comments](https://github.com/privatenumber/gfm-comments), which follows GitHub's renderer, cmark-gfm 0.29.0.gfm.13, and GitHub's HTML parsing. A marker is a rendered `<!--mdeval expr-->` paired with the next rendered `<!--/mdeval-->`.

## Decision: use gfm-comments, not micromark code ranges

**Decision:** find markers among the comments that gfm-comments returns.

Before, `parseMarkdown` searched the text for `<!--mdeval` and dropped candidates inside code ranges from a micromark parse with GFM tables. That parse cost most of `parseMarkdown`. It also missed contexts where GitHub shows `<!--` as text, such as a raw HTML attribute value, and a `<!--/mdeval-->` in a code span inside a value closed the marker. gfm-comments covers code, escapes, link destinations, and attribute values in one scan.

`pnpm bench --step parse --shape markers --shape gfm --shape prose --shape readme --size 1m`, avg ms before and after:

| Shape | micromark code ranges | gfm-comments |
| --- | ---: | ---: |
| markers, 1 MB | 125.8 | 1.5 |
| gfm, 1 MB | 255.3 | 3.1 |
| prose, 1 MB | 0.024 | 0.023 |
| readme, 8 kB | 2.25 | 0.07 |

## Warnings use the same comments

**Decision:** [`findRenderedLeaks`](../../src/find-rendered-leaks.ts) warns about each `<!--mdeval` opening and each `<!--/mdeval-->` that is not the start of a comment gfm-comments returns, and is not inside one. A whole marker that does not render is one warning, at its opening. It replaced a check that parsed the document with micromark, mdast, hast, and parse5 and reported the kind of construct that showed the marker, such as a code block or an image alt.

Why:

- **One model of GitHub.** The micromark check followed CommonMark, so it disagreed with `parseMarkdown` where GitHub differs. For example, GitHub's tagfilter escapes `<textarea>`, so a marker inside it renders as a comment and runs, but micromark reported it as text. Each disagreement needed its own patch.
- **The rest of its cases are now errors.** A value that hides or breaks a marker fails the round-trip check below, and a value with mdeval syntax was already rejected. What is left to warn about is mdeval syntax in the source that GitHub does not render as a comment.
- **Cost.** It removed nine runtime dependencies. `pnpm bench --step leaks --size 1m`, Node.js 26.13.0, Apple M2 Max, 2026-11-17, avg ms against `develop` at `8cf528f`:

| Shape | micromark check | gfm-comments |
| --- | ---: | ---: |
| markers, 1 MB | 142.3 | 5.7 |
| gfm, 1 MB | 297.8 | 9.1 |
| prose, 1 MB | 0.023 | 0.046 |
| readme, 8 kB | 3.26 | 0.18 |

Peak RSS fell from 327 to 150 MiB on markers and from 599 to 156 MiB on gfm.

Accepted differences, from running both checks on every input in the old test suite:

- **Warnings lost the construct kind.** They name the delimiter and its position.
- **Entity-encoded openings, such as `&lt;!--mdeval`, are not reported.** They are not mdeval syntax in the source, and writing one is how a document shows the syntax as text. A backslash-escaped `\<!--mdeval` is still reported, because its `<!--mdeval` is in the source.
- **Markers that never run are reported even where GitHub hides them,** such as in a fence info string, an unused reference definition, or an unreferenced footnote. The old check reported only text that readers see.
- **Warnings point at the delimiter,** not at the start of the construct, such as the `[` of a reference definition.
- **A marker in `<![CDATA[` that GitHub turns into a bogus comment is reported** ([privatenumber/gfm-comments#1](https://github.com/privatenumber/gfm-comments/issues/1), which is about the closing comment after it that gfm-comments misses). mdeval does not run that marker either way.

## Unclosed openings

gfm-comments returns every comment GitHub renders, including one that is never closed and runs to the end of the document or of a footnote definition (`contentEnd === end`). `parseMarkdown` reports that comment as an unclosed opening, because it hides the rest of the page or footnote. An opening in code, or an inline `x <!--mdeval y` with no `-->`, renders as text, so it is not a comment and mdeval ignores it, like any other literal example. An opening closed by `--!>` is skipped, because only `-->` closes an opening.

This replaced a second scan with `\n-->` appended. That scan reported the inline `x <!--mdeval y` as an error, which GitHub shows as text. It also missed an unclosed opening in a blockquote, such as `> <!--mdeval\n> code\n\nrest`, because the appended `-->` landed outside the blockquote. GitHub hides the rest of the page after that opening.

A script block whose rendered comment contains another `<!--mdeval` opening reports that opening, because a forgotten `-->` usually lets the comment run into the next marker.

## Closing tags that do not render

A value marker whose `<!--/mdeval-->` GitHub shows as text or code reports an error that gives the closing tag's offset. Examples:

- In a GFM table, a closing tag in another cell or in a code span. Before, these markers were ignored, so their values stayed stale without a warning.
- A closing tag after a fence on the same line, as in `<!--mdeval x-->```text\na\n```<!--/mdeval-->`. The last line opens a fence and `<!--/mdeval-->` becomes its info string. The old text search accepted this marker, although GitHub renders the rest of the file as code.

## Values must keep the markers they were written into

**Decision:** before returning the updated document, [`processSource`](../../src/process-source.ts) parses it again. It requires the same script blocks, and the same markers holding exactly the written values. Otherwise it throws, and the CLI leaves the file unchanged. When the check fails, it applies the values one marker at a time to name the first expression that breaks it. A value changes only how the text after it parses, so that expression is the cause.

Without this check, mdeval wrote values that its next run rejected. On Node.js 26.13.0, with synthetic files run twice through the CLI:

- A code block value without `block()`, such as `<!--mdeval v-->` with `v` set to `` ```text\nVALUE\n``` ``, wrote `` ```<!--/mdeval--> `` on one line, with exit 0 and no rendering warning. GitHub `/markdown` on 2026-11-16 rendered the closing tag as the new fence's `lang` and the rest of the file as code. The second run reported the marker as unclosed.
- A value with an unclosed fence, under `block()`, wrote the file with two "marker leaks into rendered code block" warnings, and the second run failed the same way.
- A value `<!--mdeval\rabc` in a marker that starts its line opens a comment that runs across the CR into the next line and swallows `<!--/mdeval-->`. GitHub `/markdown` showed only the text after the closing tag. In a paragraph, the same value closes before the closing tag.

The micromark-based parser accepted all three outputs, because it found `<!--/mdeval-->` by text, so the files stayed broken on GitHub without an error.

The check costs one more `parseMarkdown` call per updated file, about 1.5 ms per MB of markers in the benchmark above. The one-marker-at-a-time search runs only when the check fails.

Revisit when GitHub's renderer changes, or when a marker needs a context that gfm-comments does not model.
