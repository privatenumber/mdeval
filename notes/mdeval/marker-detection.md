# Marker detection

Verified 2026-11-16 on Node.js 26.13.0, Apple M2 Max, with gfm-comments from its `npm/gfm-comments` branch on this repository (gfm-comments commit `6c37c80`).

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

[Rendering validation](../../src/validate-rendering/index.ts) still uses micromark and mdast, because it reports leak kinds and footnotes that gfm-comments does not model.

## Unclosed openings

gfm-comments returns only comments closed by `-->`, so an unclosed `<!--mdeval` is missing from its result, like one in code. `parseMarkdown` tells them apart by scanning again with `\n-->` appended: an unclosed comment then renders, and an opening in code does not. The second scan runs only when some `<!--mdeval` opening did not render.

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

Revisit when GitHub's renderer changes, or when a marker needs a context that gfm-comments does not model, such as footnotes.
