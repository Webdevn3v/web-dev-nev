// A small quote/comment/BEGIN-END-aware statement splitter — replaces the naive `sql.split(';')`
// that broke on a semicolon inside a seeded string value, and later broke a second time on
// `CREATE TRIGGER ... BEGIN ... END;` bodies (whose internal statements end in ';' too, but
// aren't top-level statement boundaries). See docs/DECISIONS.md, "Migration approach."
//
// This is not a SQL parser; it tracks just enough lexical state to find real top-level statement
// boundaries: single-quoted strings ('...', with '' as an escaped quote), double-quoted
// identifiers ("...", with "" as an escaped quote), `--` line comments, `/* */` block comments,
// and BEGIN/END nesting depth (so a trigger body's internal semicolons don't split it apart). A
// semicolon only terminates a statement when depth is 0 and we're outside every quote/comment.
const isWordChar = (ch) => ch !== undefined && /[A-Za-z0-9_]/.test(ch);

export function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let depth = 0;
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const ch = sql[i];

    if (ch === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i);
      i = end === -1 ? n : end + 1;
      current += '\n';
      continue;
    }

    if (ch === '/' && sql[i + 1] === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      current += ' ';
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      while (j < n) {
        if (sql[j] === quote) {
          if (sql[j + 1] === quote) { j += 2; continue; } // escaped quote ('' or "")
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch) && !isWordChar(sql[i - 1])) {
      let j = i;
      while (isWordChar(sql[j])) j += 1;
      const word = sql.slice(i, j);
      const upper = word.toUpperCase();
      if (upper === 'BEGIN') depth += 1;
      else if (upper === 'END') depth = Math.max(0, depth - 1);
      current += word;
      i = j;
      continue;
    }

    if (ch === ';' && depth === 0) {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  const trimmedTail = current.trim();
  if (trimmedTail) statements.push(trimmedTail);
  return statements;
}
