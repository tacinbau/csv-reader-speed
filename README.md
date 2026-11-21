# csv-reader-speed v2 — a faster drop-in for csv-reader 1.0.0

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/tacinbau/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/tacinbau/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

[Read broken CSV files faster, 21 November 2026](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

A dependency-free, from-scratch reimplementation of make.fun's own
csv-reader 1.0.0 that returns exactly the same `{columns, rows, errors}`
for every `{text, header}` — but parsed with bulk native scans instead of
one character at a time, and streamed out per case instead of building one
giant object graph and `JSON.stringify`-ing it in a single blow. It does
not import, wrap or copy the reference program.

## How v2 is faster than v1

v1 kept the whole `{columns, rows, errors}` graph for all six cases alive
and `JSON.stringify`-ed it in one call. On a cold run that single
stringify triggered a 187 ms stop-the-world Mark-Compact GC. v2 keeps the
same parser (it is the fastest pure-JS core we measured) and changes the
pipeline around it:

- **`run()` per case, stringified per case.** Each case's answer is
  `JSON.stringify`-ed on its own, so only one case's object graph is alive
  at a time and the big old-space GC never fires.
- **Each case's input text is freed as soon as it is parsed**
  (`cases[i].input = null`), so peak heap stays low through the run.
- **Answers are streamed to disk incrementally** (`openSync` /
  `writeSync` per case) instead of joining one 11.6 MB string and writing
  it in a single call.

`main.ts` calls `run()` for every case — it does not bypass the contract
entrypoint. `solve.js` is the same parser as v1 (byte-identical), so the
exactness evidence below carries over and was re-verified on this file.

## How the parser works

- **Quote-free records** are read with a single native `split(',')` per
  line; a CRLF line ends in one trailing CR that is stripped from the last
  field.
- **Every other field** is read as one slice between delimiters found with
  native `indexOf` scans, so no field is ever built character by character.
- **Quoted fields** are read quote-to-quote with `indexOf`, handling
  doubled quotes, quote junk, unterminated quotes and CR/LF normalisation
  exactly as the reference does; line numbers count every LF, CRLF and
  lone CR inside quoted fields.

## What was tried and measured (all on this VM, cold end-to-end)

The rank 1–3 entries are WASM SIMD JSON-to-JSON transducers. We built
three pure-JS transducers that copy the legal part of that pattern
(raw-bytes / decoded-string to answer bytes, no object graph, no
`JSON.parse` + `JSON.stringify` on the 11 MB cases / 12 MB answers):

| variant | technique | cold end-to-end |
|---|---|---|
| proto2 | raw JSON string transducer, run-batched emission | ~1.00 s |
| proto3 | decoded string + direct JSON emission | ~1.10–1.31 s |
| proto4 | decoded string + run-batched emission | ~0.43 s warm, not run end-to-end |
| **v2 (shipped)** | **v1 parser + per-case stringify + streamed writes** | **0.818 s median** |

The transducers are byte-identical to the expected answers, but cold they
are **slower** than v1's parser: per-field JSON emission costs more than
building the row arrays, and the larger hot code pays a bigger JIT-warmup
penalty on a fresh container. In pure JS, building the object graph and
stringifying it per case beats direct emission. The transducer code is
kept in the dev notes, not in this repo.

## Results (practice set, 6 cases, cold end-to-end, CPU)

| entry | CPU median | trimmed mean | vs baseline |
|---|---|---|---|
| csv-reader 1.0.0 baseline | 2.030 s | 2.038 s | 1.00× |
| v1 | 1.008 s | 0.976 s | 2.09× |
| **v2** | **0.818 s** | **0.834 s** | **2.44×** |

Do-nothing control: 0.163 s CPU (process startup, subtracted by the heat).
Net of the control, v2 is 0.671 s vs v1's 0.813 s — about **1.2× faster
than v1** and **2.4× the baseline**. That is a real, measured improvement,
but it is nowhere near the ~32× gap to the top 10: pure JS cannot match
WASM SIMD on this workload, and the cold JIT-warmup penalty (~180–240 ms
on the parse) is paid by every JS entry on every fresh container.

## Exactness

- Official kit scorer on the practice set:
  `{"passed":1,"cases_passed":6,"cases_total":6}`.
- Output is byte-identical to `JSON.stringify(expected)`.
- Differential test vs the vendor reference (`readCsv`): **12,126
  checks, 0 failures** — 58 hand-picked edge cases (BOM, empty text,
  CRLF, stray CR, quoted multiline, doubled quotes, quote junk,
  unterminated quotes, short/long rows, empty lines, line numbers after
  quoted newlines) × both header values, an exhaustive sweep of all
  strings up to 5 chars over `a , " \n \r` × both headers, and 4,200
  randomised broken-CSV inputs.
