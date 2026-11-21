// Fast drop-in for csv-reader 1.0.0 (make.fun): run(input) returns exactly the
// same {columns, rows, errors} for every {text, header}, but parsed with
// bulk native scans (indexOf / slice / split) instead of one character at a
// time. Written from scratch against the reference semantics; it does not
// import, wrap or copy the reference program.
//
// How it stays fast:
//   - A record whose line holds no quote and no stray CR is split(',') in one
//     native call; CRLF lines end in a single trailing CR that is stripped
//     from the last field.
//   - Every other field is read as one slice between delimiters found with
//     indexOf: the next comma, and the next LF (cached per physical line, so
//     an unquoted field costs one indexOf). CRs inside a slice are found with
//     a bounded indexOf on the slice itself, never a scan of the whole text.
//   - A quoted field is read by jumping from quote to quote with indexOf;
//     the text between quotes is one slice, and only a segment that actually
//     holds a CR or LF pays for line counting / CR-to-LF conversion.
//   - Fields are never built character by character and no regex runs per
//     field on the common path.

/** Field end: 0 comma, 1 line break, 2 end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0;
  let line = 1;
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // Next LF at or after pos: -2 unknown, -1 known none, otherwise its index.
  let nextLF = -2;

  let recordLine = 1;
  let recordRow = null;

  // Scratch result of the last field read: avoids one object allocation
  // per field (hundreds of thousands per set).
  let fValue = '';
  let fEnded = 0;
  let fAdded = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Convert one slice taken from inside a quoted field: CRLF and lone CR
  // each become one LF, and `line` advances once per LF, CRLF and lone CR.
  // Segments without CR or LF (the common case) come back untouched.
  function processSegment(seg) {
    const ri = seg.indexOf('\r');
    if (ri === -1) {
      const ni = seg.indexOf('\n');
      if (ni === -1) return seg;
      line += seg.split('\n').length - 1;
      return seg;
    }
    let delta = 0;
    for (let i = 0; i < seg.length; i++) {
      const cc = seg.charCodeAt(i);
      if (cc === 10) delta++;
      else if (cc === 13) {
        delta++;
        if (seg.charCodeAt(i + 1) === 10) i++;
      }
    }
    line += delta;
    return seg.replace(/\r\n?/g, '\n');
  }

  // Read unquoted characters onto `initial` up to the next comma or line
  // break. A CR not followed by LF is dropped (stray_cr). The result is
  // left in fValue / fEnded / fAdded; fAdded counts characters kept here.
  function readUnquoted(initial) {
    if (nextLF === -2 || (nextLF !== -1 && nextLF < pos)) {
      nextLF = text.indexOf('\n', pos);
    }
    const ci = text.indexOf(',', pos);
    let segEnd;
    let ended;
    if (ci !== -1 && (nextLF === -1 || ci < nextLF)) {
      segEnd = ci;
      ended = COMMA;
    } else if (nextLF !== -1) {
      segEnd = nextLF;
      ended = LINE_BREAK;
    } else {
      segEnd = n;
      ended = END;
    }
    const seg = text.slice(pos, segEnd);
    let value;
    let added;
    const ri = seg.indexOf('\r');
    if (ri === -1) {
      value = seg;
      added = seg.length;
    } else if (ended === LINE_BREAK && ri === seg.length - 1) {
      // The one CR is the CRLF terminator: strip it, no error, no line yet.
      value = seg.slice(0, -1);
      added = seg.length - 1;
    } else {
      const totalCr = seg.split('\r').length - 1;
      let stray = totalCr;
      if (ended === LINE_BREAK && seg.charCodeAt(seg.length - 1) === 13) stray -= 1;
      for (let k = 0; k < stray; k++) error('stray_cr');
      value = seg.replace(/\r/g, '');
      added = seg.length - totalCr;
    }
    if (ended === COMMA) pos = ci + 1;
    else if (ended === LINE_BREAK) {
      pos = nextLF + 1;
      line += 1;
      nextLF = -2;
    } else {
      pos = n;
    }
    if (initial !== '') value = initial + value;
    fValue = value;
    fEnded = ended;
    fAdded = added;
  }

  // Read a quoted field whose opening quote is at pos. The result is left
  // in fValue / fEnded / fAdded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let p = pos + 1;
    let segStart = p;
    let value = null;
    let q;
    for (;;) {
      q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        line = openLine;
        if (nextLF >= 0 && nextLF < open + 1) nextLF = -2;
        pos = open + 1;
        error('unterminated_quote');
        readUnquoted('"');
        return;
      }
      const seg = processSegment(text.slice(segStart, q));
      if (text.charCodeAt(q + 1) === 34) {
        value = value === null ? seg + '"' : value + seg + '"';
        p = q + 2;
        segStart = p;
        continue;
      }
      value = value === null ? seg : value + seg;
      pos = q + 1;
      break;
    }
    fValue = value;
    fAdded = 0;
    // The cached next LF stays valid unless this field consumed it: the
    // first LF after the earlier search position is still the first LF
    // after pos whenever it lies at or after pos.
    if (nextLF >= 0 && nextLF < pos) nextLF = -2;
    if (pos >= n) {
      fEnded = END;
      return;
    }
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      fEnded = COMMA;
      return;
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      fEnded = LINE_BREAK;
      return;
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    readUnquoted(value);
    if (fAdded > 0) error('quote_junk');
  }

  // Finish one record: header, padding/cutting to the first record's width.
  // A line that held only stray CRs is left with no characters: no record.
  function finishRecord(fields, quotedLast) {
    if (fields.length === 1 && fields[0] === '' && !quotedLast) return;
    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      return;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: the record's first line holds no quote. If it also holds
    // no stray CR (at most the CRLF terminator), one split(',') reads it.
    const eol = text.indexOf('\n', pos);
    const segEnd = eol === -1 ? n : eol;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1) {
      const ri = seg.indexOf('\r');
      if (ri === -1 || (eol !== -1 && ri === seg.length - 1)) {
        const fields = seg.split(',');
        if (ri !== -1) {
          const last = fields.length - 1;
          fields[last] = fields[last].slice(0, -1);
        }
        if (eol !== -1) {
          pos = eol + 1;
          line += 1;
        } else {
          pos = n;
        }
        nextLF = -2;
        finishRecord(fields, false);
        continue;
      }
    }
    nextLF = eol;

    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fValue);
    } while (fEnded === COMMA);
    finishRecord(fields, quoted);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
