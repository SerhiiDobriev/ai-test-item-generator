// Чтение базы заданий заказчика и подсчёт сходства с ней.
import fs from 'node:fs';

export function parseDump(s) {
  const rows = [];
  const insert = /INSERT INTO `\w+` \(([^)]*)\) VALUES\s*/g;
  const ws = c => c === ' ' || c === '\r' || c === '\n' || c === '\t';
  let m;
  while ((m = insert.exec(s))) {
    const cols = m[1].split(',').map(c => c.trim().replaceAll('`', ''));
    let i = m.index + m[0].length;
    for (;;) {
      while (ws(s[i]) || s[i] === ',') i++;
      if (s[i] !== '(') break;
      i++;
      const vals = [];
      for (;;) {
        while (ws(s[i])) i++;
        if (s[i] === "'") {
          i++;
          let buf = '';
          for (;;) {
            const c = s[i];
            if (c === '\\') {
              const e = s[i + 1];
              buf += { n: '\n', r: '\r', t: '\t', 0: '\0' }[e] ?? e;
              i += 2;
            } else if (c === "'") {
              if (s[i + 1] === "'") { buf += "'"; i += 2; } else { i++; break; }
            } else { buf += c; i++; }
          }
          vals.push(buf);
        } else {
          let j = i;
          while (s[j] !== ',' && s[j] !== ')') j++;
          vals.push(s.slice(i, j).trim());
          i = j;
        }
        while (ws(s[i])) i++;
        if (s[i] === ',') { i++; continue; }
        if (s[i] === ')') { i++; break; }
        throw new Error('Не удалось разобрать базу около: ' + s.slice(i - 40, i + 40));
      }
      rows.push(Object.fromEntries(cols.map((c, k) => [c, vals[k]])));
      while (ws(s[i])) i++;
      if (s[i] === ';') break;
    }
    insert.lastIndex = i;
  }
  return rows;
}

const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', hellip: '…' };

export function plain(x) {
  return String(x ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (all, e) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return ENT[e.toLowerCase()] ?? all;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

// Основы слов: первые 6 букв. Слова короче 4 букв не считаем, числа считаем.
export function stems(x) {
  const t = plain(x).toLowerCase().replaceAll('’', "'");
  const out = new Set();
  for (const w of t.match(/[а-яіїєґ']+|\d+/g) ?? []) {
    if ([...w].length >= 4 || /^\d+$/.test(w)) out.add([...w].slice(0, 6).join(''));
  }
  return out;
}

function bigrams(t) {
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) {
    const b = t.slice(i, i + 2);
    m.set(b, (m.get(b) ?? 0) + 1);
  }
  return m;
}

function otpechatok(html) {
  const text = plain(html).toLowerCase();
  return { text, bi: bigrams(text), st: stems(html) };
}

function dice(a, b) {
  const total = Math.max(a.text.length - 1, 0) + Math.max(b.text.length - 1, 0);
  if (!total) return 0;
  let common = 0;
  for (const [k, v] of a.bi) common += Math.min(v, b.bi.get(k) ?? 0);
  return (2 * common) / total;
}

function jaccard(a, b) {
  if (!a.st.size && !b.st.size) return 0;
  let common = 0;
  for (const w of a.st) if (b.st.has(w)) common++;
  return common / (a.st.size + b.st.size - common);
}

// От 0 до 1. Берём большее из сходства по буквам и сходства по словам.
export function shodstvo(a, b) {
  return Math.max(dice(a, b), jaccard(a, b));
}

export { otpechatok };

export function samoePohozhee(html, spisok) {
  const t = otpechatok(html);
  let best = null;
  let score = -1;
  for (const r of spisok) {
    const s = shodstvo(t, r.fp);
    if (s > score) { score = s; best = r; }
  }
  return best ? { shodstvo: Math.round(score * 100) / 100, zapis: best } : { shodstvo: 0, zapis: null };
}

export function zagruzitBazu(put) {
  return parseDump(fs.readFileSync(put, 'utf8')).map(r => ({ id: r.id, vopros: plain(r.quest), fp: otpechatok(r.quest) }));
}
