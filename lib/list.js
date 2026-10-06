const MAX_TASKS = 20;
const ROWS_PER_BUBBLE = 10;
const LABEL_MAX = 60;

// The API numbers priority in reverse of the app: 4 is the red p1 flag.
const PRIORITY_MARK = { 4: "🔴 ", 3: "🟠 ", 2: "🔵 " };

import { messages } from "./messages.js";

export function timezone() {
  return process.env.TIMEZONE || "Asia/Tokyo";
}

function dateFormat() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone() });
}

function timeFormat() {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: timezone(), hour: "2-digit", minute: "2-digit" });
}

export function localToday(now = new Date()) {
  return dateFormat().format(now);
}

// Due values are "YYYY-MM-DD", floating "YYYY-MM-DDTHH:MM:SS" (already local), or an absolute UTC/offset timestamp.
export function dueParts(due) {
  const raw = due?.datetime ?? due?.date;
  if (!raw) return null;
  if (!raw.includes("T")) return { day: raw, time: null };
  if (/(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const at = new Date(raw);
    return { day: dateFormat().format(at), time: timeFormat().format(at) };
  }
  return { day: raw.slice(0, 10), time: raw.slice(11, 16) };
}

export function shortDay(day) {
  const [, m, d] = day.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function organize(tasks, now) {
  const today = localToday(now);
  const rows = tasks
    .filter((t) => !t.content.startsWith("* "))
    .map((t) => ({ task: t, due: dueParts(t.due) }))
    .filter((r) => r.due);

  const byPriorityThenTime = (a, b) =>
    (b.task.priority ?? 1) - (a.task.priority ?? 1) || (a.due.time ?? "99").localeCompare(b.due.time ?? "99");

  const todays = rows.filter((r) => r.due.day >= today).sort(byPriorityThenTime);
  const overdue = rows
    .filter((r) => r.due.day < today)
    .sort((a, b) => a.due.day.localeCompare(b.due.day) || byPriorityThenTime(a, b));

  const shownToday = todays.slice(0, MAX_TASKS);
  const shownOverdue = overdue.slice(0, MAX_TASKS - shownToday.length);
  const hidden = todays.length + overdue.length - shownToday.length - shownOverdue.length;
  return { todays, overdue, shownToday, shownOverdue, hidden };
}

function label(row, withDay) {
  const when = [withDay ? shortDay(row.due.day) : null, row.due.time].filter(Boolean).join(" ");
  return `${PRIORITY_MARK[row.task.priority] ?? ""}${row.task.content}${when ? `（${when}）` : ""}`;
}

export function formatTodayList(tasks, now = new Date()) {
  const { todays, overdue, shownToday, shownOverdue, hidden } = organize(tasks, now);
  if (!todays.length && !overdue.length) return messages().listEmpty;

  const lines = [`📋 今日のタスク（${todays.length}件）`];
  lines.push(...(shownToday.length ? shownToday.map((r) => `・${label(r, false)}`) : ["・なし"]));
  if (overdue.length) {
    lines.push("", `⚠️ 期限切れ（${overdue.length}件）`, ...shownOverdue.map((r) => `・${label(r, true)}`));
  }
  if (hidden) lines.push(messages().listMore(hidden));
  return lines.join("\n");
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function chip(text, color, data, displayText) {
  return {
    type: "box",
    layout: "vertical",
    flex: 0,
    backgroundColor: color,
    cornerRadius: "md",
    paddingAll: "6px",
    action: { type: "postback", label: text, data, displayText },
    contents: [{ type: "text", text, size: "xs", color: "#ffffff", align: "center" }],
  };
}

function taskRow(row, withDay) {
  const { task, due } = row;
  const name = truncate(task.content, 30);
  const chips = [chip("完了", "#06C755", `a=done&id=${task.id}&d=${due.day}`, `完了：${name}`)];
  // Moving a recurring task's date from here would overwrite its repeat rule, so it only gets "完了".
  if (!task.due?.is_recurring) {
    chips.push(chip("明日へ", "#8C8C8C", `a=tomorrow&id=${task.id}&d=${due.day}`, `明日へ：${name}`));
  }
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: [
      { type: "text", text: truncate(label(row, withDay), LABEL_MAX), size: "sm", wrap: true, flex: 1, gravity: "center" },
      ...chips,
    ],
  };
}

function heading(text) {
  return { type: "text", text, weight: "bold", size: "md", margin: "md" };
}

export function buildTodayFlex(tasks, now = new Date()) {
  const { todays, overdue, shownToday, shownOverdue, hidden } = organize(tasks, now);
  if (!todays.length && !overdue.length) return null;

  const items = [heading(`📋 今日のタスク（${todays.length}件）`)];
  items.push(...(shownToday.length ? shownToday.map((r) => taskRow(r, false)) : [{ type: "text", text: "なし", size: "sm" }]));
  if (overdue.length) {
    items.push(heading(`⚠️ 期限切れ（${overdue.length}件）`), ...shownOverdue.map((r) => taskRow(r, true)));
  }
  if (hidden) items.push({ type: "text", text: messages().listMore(hidden), size: "xs", color: "#8C8C8C" });

  // Split into several cards so a long list stays within LINE's per-bubble size limit.
  const bubbles = [];
  let current = [];
  let rows = 0;
  for (const item of items) {
    const isRow = item.layout === "horizontal";
    if (isRow && rows === ROWS_PER_BUBBLE) {
      bubbles.push(current);
      current = [];
      rows = 0;
    }
    current.push(item);
    if (isRow) rows += 1;
  }
  bubbles.push(current);

  return {
    type: "flex",
    altText: truncate(formatTodayList(tasks, now), 400),
    contents: {
      type: "carousel",
      contents: bubbles.map((contents) => ({
        type: "bubble",
        size: "giga",
        body: { type: "box", layout: "vertical", spacing: "md", contents },
      })),
    },
  };
}
