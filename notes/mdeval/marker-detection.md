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

Revisit when GitHub's renderer changes, or when a marker needs a context that gfm-comments does not model, such as footnotes.
