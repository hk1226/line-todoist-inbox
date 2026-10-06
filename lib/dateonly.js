import { burstOf, inboxTasks, updateTask } from "./todoist.js";
import { dueParts, shortDay } from "./list.js";
import { messages } from "./messages.js";

const FOLLOW_UP_WINDOW_MS = 15 * 60 * 1000;
const MAX_LENGTH = 30;

// Words that pin down a date or time on their own. At least one must be present.
const ANCHORS = [
  "今日中", "今日", "きょう", "明後日", "あさって", "明日", "あした", "あす",
  "再来週", "今週末", "今週", "来週", "週末", "今月末", "今月", "来月", "月末",
  "毎日", "毎週", "毎月", "毎年", "平日", "隔週",
  "\\d{1,4}/\\d{1,2}(?:/\\d{1,2})?",
  "\\d{1,2}月\\d{1,2}日?",
  "\\d{1,2}日",
  "\\d{1,2}:\\d{2}",
  "\\d{1,2}時(?:\\d{1,2}分|半)?",
  "[月火水木金土日]曜日?",
];

// Words that only refine an anchor ("明日の朝まで").
const MODIFIERS = ["午前", "午後", "朝", "昼", "夕方", "夜", "深夜", "正午", "am", "pm", "までに", "まで", "ごろ", "頃", "から", "中", "の", "に", "、", ",", "\\s"];

const ANCHOR_PATTERN = new RegExp(ANCHORS.join("|"), "i");
const ANY_TOKEN = new RegExp(`(?:${[...ANCHORS, ...MODIFIERS].join("|")})`, "gi");

export function isDateOnly(text) {
  const t = text.normalize("NFKC").trim();
  if (!t || t.length > MAX_LENGTH || t.includes("\n")) return false;
  if (!ANCHOR_PATTERN.test(t)) return false;
  return t.replace(ANY_TOKEN, "") === "";
}

function dueLabel(task) {
  const due = dueParts(task?.due);
  if (!due) return "";
  return `${shortDay(due.day)}${due.time ? ` ${due.time}` : ""}${task.due?.is_recurring ? "（繰り返し）" : ""}`;
}

// Applies a date-only follow-up message to the task the previous LINE message created.
export async function applyDateToRecentTask(text, token, now = Date.now()) {
  const tasks = await inboxTasks(token);
  const newest = tasks[0];
  if (!newest || now - newest.addedMs > FOLLOW_UP_WINDOW_MS) {
    return messages().dateNoRecentTask;
  }
  if (burstOf(tasks, newest).length > 1) {
    return messages().dateAmbiguous;
  }

  try {
    const updated = await updateTask(newest.id, { due_string: text.normalize("NFKC").trim(), due_lang: "ja" }, token);
    return messages().dateApplied(newest.content, dueLabel(updated) || text);
  } catch (err) {
    console.error(err);
    return messages().dateUnreadable(text.trim());
  }
}
