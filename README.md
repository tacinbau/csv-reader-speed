# csv-reader-speed — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tacinbau/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tacinbau/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A dependency-free, from-scratch reimplementation of make.fun's own
csv-reader 1.0.0 that returns exactly the same `{columns, rows, errors}`
for every `{text, header}` — but parsed with bulk native scans instead of
one character at a time. It does not import, wrap or copy the reference
program.

## How the parser works

- **Quote-free records** are read with a single native `split(',')` per
  line; a CRLF line ends in one trailing CR that is stripped from the last
  field.
- **Every other field** is read as one slice between delimiters found with
  `indexOf`: the next comma, and the next LF (cached per physical line, so
  an unquoted field costs one `indexOf`). CRs inside a slice are found with
  a bounded `indexOf` on the slice itself, never a scan of the whole text.
- **Quoted fields** are read by jumping from quote to quote with `indexOf`;
  the text between quotes is one slice, and only a segment that actually
  holds a CR or LF pays for line counting / CR-to-LF conversion.
- Fields are never built character by character, no regex runs per field on
  the common path, and no object is allocated per field (the last field
  read is returned through scratch variables).

The broken-row policy is the reference's own: BOM dropped, empty lines are
no record, stray CRs dropped with `stray_cr`, quoted fields with doubled
quotes and CR/LF normalised to LF, junk after a closing quote appended with
`quote_junk`, unclosed quotes re-read as unquoted with
`unterminated_quote`, rows padded (`short_row`) or cut (`long_row`) to the
first record's width, and errors in the order met with the record's start
line and row index.

## How to run locally

```sh
MAKEFUN_INPUT_DIR=/path/to/input MAKEFUN_OUTPUT_DIR=/path/to/output node main.ts
```

`main.ts` is the harness driver (Node 22 runs `node /bot/main.ts`): it reads
`/input/cases.json`, answers each case alone with `run()` from `solve.js`,
and writes `/output/answers.json`. It turns V8's incremental marking off
before importing `solve.js`, as the house baseline does.

## Practice-set result

Verified against the kit's practice set (6 cases, ~10.3 MB of CSV) and the
kit's own scorer: **passed 1, 6/6 cases identical** to csv-reader 1.0.0.
Also checked against the reference on 1,786 hand-picked edge cases
(BOM, empty text, CRLF, stray CR, quoted multiline, doubled quotes, quote
junk, unterminated quotes, short/long rows, empty lines, line numbers after
quoted newlines), an exhaustive sweep of every string up to 5 characters
over `a , " \n \r` for both header values, and 4,000 randomised broken-CSV
inputs — all identical, 12,036/12,036 in total. Two runs produce
byte-identical `answers.json`.

Timing on this machine (Node 24, 9 runs each, whole program including
JSON parse/stringify):

| entry | CPU median | CPU trimmed mean* | wall median |
| --- | --- | --- | --- |
| this entry | 0.96 s | 0.95 s | 0.76 s |
| csv-reader 1.0.0 (house baseline) | 2.19 s | 2.12 s | 1.64 s |

\*Trimmed mean as in the final heat: 9 runs, 2 fastest and 2 slowest dropped.
**Speedup over the baseline: ~2.2× on CPU time (~2.3× on the parse alone:
~0.27 s vs ~0.7–0.9 s cold).**

## Files

- `solve.js` — the fast parser, `export function run(input)`
- `main.ts` — the harness driver
- `package.json` — `{"type":"module"}`
- `LICENSE` — MIT
- `prompt.txt` — the user's approval for this build
