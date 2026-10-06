import { closeTask, getTask, updateTask } from "./todoist.js";
import { dueParts, shortDay } from "./list.js";
import { messages } from "./messages.js";

const PRIORITY_REPLY = { 4: "🔴 p1", 3: "🟠 p2" };
const DAY_WORD = { today: { en: "today", ja: "今日", emoji: "📅" }, tomorrow: { en: "tomorrow", ja: "明日", emoji: "➡️" } };

function newDueLabel(task) {
  const due = dueParts(task?.due);
  return due ? `（${shortDay(due.day)}${due.time ? ` ${due.time}` : ""}）` : "";
}

async function moveTo(task, word, token) {
  if (task.due?.is_recurring) return messages().recurringNotMoved;
  const time = dueParts(task.due)?.time;
  const dueString = time ? `${DAY_WORD[word].en} at ${time}` : DAY_WORD[word].en;
  const updated = await updateTask(task.id, { due_string: dueString, due_lang: "en" }, token);
  return messages().moved(DAY_WORD[word].emoji, DAY_WORD[word].ja, newDueLabel(updated), task.content);
}

// Buttons stay tappable after use, so every action re-reads the task and refuses to act on stale data.
export async function runPostback(data, token) {
  const params = new URLSearchParams(data);
  const action = params.get("a");
  const id = params.get("id");
  const expectedDay = params.get("d");
  if (!id) return null;

  const task = await getTask(id, token);
  if (!task) return messages().taskGone;
  if (task.checked) return messages().alreadyDone(task.content);
  if (expectedDay && dueParts(task.due)?.day !== expectedDay) {
    return messages().staleButton(task.content);
  }

  switch (action) {
    case "done":
      await closeTask(id, token);
      return messages().completed(task.content);
    case "today":
    case "tomorrow":
      return moveTo(task, action, token);
    case "pri": {
      const priority = Number(params.get("v"));
      if (!PRIORITY_REPLY[priority]) return null;
      await updateTask(id, { priority }, token);
      return messages().prioritySet(PRIORITY_REPLY[priority], task.content);
    }
    default:
      return null;
  }
}

export function quickReplyForNewTask(taskId) {
  const postback = (label, data, displayText) => ({ type: "action", action: { type: "postback", label, data, displayText } });
  return {
    items: [
      { type: "action", action: { type: "message", label: "↩️ キャンセル", text: "キャンセル" } },
      postback("📅 今日", `a=today&id=${taskId}`, "今日にして"),
      postback("📅 明日", `a=tomorrow&id=${taskId}`, "明日にして"),
      postback("🔴 p1", `a=pri&v=4&id=${taskId}`, "p1にして"),
      postback("🟠 p2", `a=pri&v=3&id=${taskId}`, "p2にして"),
    ],
  };
}

export const CANCEL_ONLY_QUICK_REPLY = {
  items: [{ type: "action", action: { type: "message", label: "↩️ キャンセル", text: "キャンセル" } }],
};
