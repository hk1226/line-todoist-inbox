// A digit bullet must not be followed by another digit, so "10.15 歯医者" stays a date, not item "15 歯医者".
const BULLET = /^\s*(?:[・･•●○◦▪■□◆◇▶▷►\-−–—ー]|\d{1,2}[.)．）、](?!\d)|[①-⑳])\s*/;
const MEMO_MARKER = /^(?:メモ|📝|memo)[:：\s　]+/i;
const SPLIT_MARKER = /^(分解しない|分解)[:：\s　]+/;

// Left as a comment on the task so whatever organises the Inbox later (e.g. an AI routine) can honour it.
export const SPLIT_NOTES = { force: "分解指定：する（LINEで指定）", never: "分解指定：しない（LINEで指定）" };
const UNDO = /^(?:取消|取り消し|取り消して|とりけし|キャンセル|きゃんせる|undo|cancel)$/i;
const LIST = /^(?:一覧|いちらん|今日|きょう|今日のタスク|今日の一覧|list)$/i;
const HELP = /^(?:使い方|ヘルプ|help)$/i;
export const MAX_ITEMS = 15;

export function parseCommand(text) {
  const t = text.trim();
  if (UNDO.test(t)) return "undo";
  if (LIST.test(t)) return "list";
  if (HELP.test(t)) return "help";
  return null;
}

function toItem(rawTitle, noteLines) {
  let title = rawTitle;
  let memo = false;
  let split;
  // Prefixes may come in either order, e.g. "メモ：分解：…" or "分解：メモ：…".
  for (let i = 0; i < 2; i += 1) {
    const splitPrefix = title.match(SPLIT_MARKER);
    if (splitPrefix) {
      split = splitPrefix[1] === "分解しない" ? "never" : "force";
      title = title.slice(splitPrefix[0].length);
    } else if (MEMO_MARKER.test(title)) {
      memo = true;
      title = title.replace(MEMO_MARKER, "");
    }
  }
  return {
    title: title.trim(),
    note: [...noteLines, split && SPLIT_NOTES[split]].filter(Boolean).join("\n").trim(),
    memo,
    ...(split && { split }),
  };
}

export function parseMessage(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());

  if (!lines.some((l) => BULLET.test(l))) {
    const [first = "", ...rest] = lines.filter((l) => l.trim());
    const item = toItem(first.trim(), rest.map((l) => l.trim()));
    return item.title ? [item] : [];
  }

  const heading = [];
  const drafts = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const bullet = line.match(BULLET);
    if (bullet) {
      drafts.push({ title: line.slice(bullet[0].length).trim(), notes: [] });
    } else if (drafts.length) {
      drafts.at(-1).notes.push(line.trim());
    } else {
      heading.push(line.trim());
    }
  }

  const headingNote = heading.length ? `見出し：${heading.join(" ")}` : "";
  return drafts
    .map((d) => toItem(d.title, [...d.notes, headingNote]))
    .filter((item) => item.title)
    .slice(0, MAX_ITEMS);
}

// Todoist treats content starting with "* " as an uncompletable item (no checkbox), which is how memos are stored.
export function toTodoistText(item) {
  return item.memo ? `* ${item.title}` : item.title;
}
