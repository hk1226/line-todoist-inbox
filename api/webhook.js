import crypto from "node:crypto";
import { parseCommand, parseMessage, toTodoistText, MAX_ITEMS } from "../lib/parse.js";
import { addTask, undoLastBatch, todayAndOverdueTasks } from "../lib/todoist.js";
import { formatTodayList, buildTodayFlex } from "../lib/list.js";
import { savePhoto, absorbRecentPhotos } from "../lib/photo.js";
import { runPostback, quickReplyForNewTask, CANCEL_ONLY_QUICK_REPLY } from "../lib/actions.js";
import { withPageTitle } from "../lib/url.js";
import { isDateOnly, applyDateToRecentTask } from "../lib/dateonly.js";
import { messages } from "../lib/messages.js";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const NUMBERS = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";

export function isValidSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replyMessages(replyToken, messages, accessToken) {
  const res = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) console.error(`LINE reply ${res.status}: ${await res.text()}`);
  return res.ok;
}

function reply(replyToken, text, accessToken, quickReply) {
  return replyMessages(replyToken, [{ type: "text", text, ...(quickReply && { quickReply }) }], accessToken);
}

function formatDue(task) {
  const date = task?.due?.date;
  if (!date) return "";
  const [, m, d] = date.slice(0, 10).split("-");
  return `（${Number(m)}/${Number(d)}）`;
}

async function addItems(items, token) {
  const lines = [];
  const created = [];
  let failed = 0;
  // Sequential on purpose: keeps the Inbox order the same as the message order.
  for (const [i, raw] of items.entries()) {
    const item = await withPageTitle(raw);
    try {
      const task = await addTask({ text: toTodoistText(item), note: item.note }, token);
      created.push(task);
      lines.push(`${NUMBERS[i]} ${item.memo ? "📝 " : ""}${item.title}${formatDue(task)}`);
    } catch (err) {
      console.error(err);
      failed += 1;
      lines.push(`${NUMBERS[i]} ${messages().failedItem(item.title)}`);
    }
  }

  // Photos only pair with single-item messages; with several items there is no telling which one they belong to.
  if (items.length === 1 && created[0]?.id) {
    try {
      const photos = await absorbRecentPhotos(created[0].id, token);
      if (photos) lines[0] += `\n${messages().photosAttached(photos)}`;
    } catch (err) {
      console.error(err);
    }
  }

  const head = failed ? messages().partlyFailed(items.length - failed, failed) : messages().added(items.length);
  return { text: `${head}\n${lines.join("\n")}`, created };
}

async function handlePhoto(event, env) {
  const set = event.message.imageSet;
  // A multi-photo send arrives as one event per photo; answer only once, on the last one.
  const shouldReply = !set || set.index === set.total;
  let message;
  try {
    const { task, attachedToExisting } = await savePhoto(event.message.id, env);
    message = attachedToExisting ? messages().photoAttachedTo(task.content) : messages().photoSaved;
  } catch (err) {
    console.error(err);
    message = messages().photoFailed;
  }
  if (shouldReply) await reply(event.replyToken, message, env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function handlePostback(event, env) {
  let message;
  try {
    message = await runPostback(event.postback?.data ?? "", env.TODOIST_API_TOKEN);
  } catch (err) {
    console.error(err);
    message = messages().todoistErrorButton;
  }
  if (message) await reply(event.replyToken, message, env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function handleList(event, env) {
  const tasks = await todayAndOverdueTasks(env.TODOIST_API_TOKEN);
  const flex = buildTodayFlex(tasks);
  const sent = flex && (await replyMessages(event.replyToken, [flex], env.LINE_CHANNEL_ACCESS_TOKEN));
  // A rejected card leaves the reply token unused, so the plain list still gets through.
  if (!sent) await reply(event.replyToken, formatTodayList(tasks), env.LINE_CHANNEL_ACCESS_TOKEN);
}

async function handleText(event, env) {
  const text = event.message.text;
  const command = parseCommand(text);
  let message;
  let quickReply;

  try {
    if (command === "help") {
      message = messages().help;
    } else if (command === "list") {
      return await handleList(event, env);
    } else if (command === "undo") {
      const removed = await undoLastBatch(env.TODOIST_API_TOKEN);
      message = removed.length ? messages().undone(removed.map((t) => t.content)) : messages().nothingToUndo;
    } else if (isDateOnly(text)) {
      message = await applyDateToRecentTask(text, env.TODOIST_API_TOKEN);
    } else {
      const items = parseMessage(text);
      if (!items.length) return;
      const result = await addItems(items, env.TODOIST_API_TOKEN);
      message = result.text;
      if (items.length === MAX_ITEMS) message += `\n${messages().tooMany(MAX_ITEMS)}`;
      if (result.created.length === 1 && items.length === 1) quickReply = quickReplyForNewTask(result.created[0].id);
      else if (result.created.length) quickReply = CANCEL_ONLY_QUICK_REPLY;
    }
  } catch (err) {
    console.error(err);
    message = messages().todoistError;
  }

  await reply(event.replyToken, message, env.LINE_CHANNEL_ACCESS_TOKEN, quickReply);
}

async function handleEvent(event, env) {
  if (event.type !== "message" && event.type !== "postback") return;
  const messageType = event.message?.type;

  const userId = event.source?.userId;
  if (!env.ALLOWED_LINE_USER_ID) {
    if (messageType !== "text") return;
    await reply(event.replyToken, messages().setupMode(userId), env.LINE_CHANNEL_ACCESS_TOKEN);
    return;
  }
  if (userId !== env.ALLOWED_LINE_USER_ID) return;

  if (event.type === "postback") return handlePostback(event, env);
  if (messageType === "image") return handlePhoto(event, env);
  if (messageType === "text") return handleText(event, env);

  const unsupported = messages().unsupported[messageType];
  if (unsupported) await reply(event.replyToken, unsupported, env.LINE_CHANNEL_ACCESS_TOKEN);
}

export async function POST(request) {
  const env = process.env;
  const rawBody = await request.text();

  if (!isValidSignature(rawBody, request.headers.get("x-line-signature"), env.LINE_CHANNEL_SECRET)) {
    return new Response("invalid signature", { status: 401 });
  }

  const { events = [] } = JSON.parse(rawBody);
  // Sequential so that photos and text in one delivery see each other's tasks in the Inbox.
  for (const event of events) await handleEvent(event, env);

  // LINE retries on non-200, so always acknowledge once the signature is valid.
  return new Response("ok", { status: 200 });
}
