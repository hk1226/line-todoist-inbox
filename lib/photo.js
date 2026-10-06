import {
  PAIR_WINDOW_MS,
  PHOTO_PREFIX,
  addComment,
  attachmentsOf,
  burstOf,
  createPlainTask,
  deleteTask,
  inboxTasks,
  isPhotoTask,
  uploadFile,
} from "./todoist.js";
import { timezone } from "./list.js";

const LINE_CONTENT_URL = "https://api-data.line.me/v2/bot/message";
const ATTACHED_NOTE = "📷 LINEから添付";

const stampFormat = () =>
  new Intl.DateTimeFormat("ja-JP", {
    timeZone: timezone(),
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

async function downloadFromLine(messageId, lineToken) {
  const res = await fetch(`${LINE_CONTENT_URL}/${messageId}/content`, {
    headers: { Authorization: `Bearer ${lineToken}` },
  });
  if (!res.ok) throw new Error(`LINE content ${messageId}: ${res.status}`);
  const mimeType = res.headers.get("content-type") ?? "image/jpeg";
  return { bytes: Buffer.from(await res.arrayBuffer()), mimeType };
}

function extensionFor(mimeType) {
  return { "image/png": "png", "image/gif": "gif", "image/webp": "webp" }[mimeType] ?? "jpg";
}

// A photo joins the newest Inbox task from the last two minutes, unless that task came from a multi-item message.
function pickTarget(tasks, now) {
  const newest = tasks[0];
  if (!newest || now - newest.addedMs > PAIR_WINDOW_MS) return null;
  if (isPhotoTask(newest)) return newest;
  const textBurst = burstOf(tasks, newest).filter((t) => !isPhotoTask(t));
  return textBurst.length === 1 ? newest : null;
}

export async function savePhoto(messageId, env, now = Date.now()) {
  const { bytes, mimeType } = await downloadFromLine(messageId, env.LINE_CHANNEL_ACCESS_TOKEN);
  const fileName = `line-${messageId}.${extensionFor(mimeType)}`;
  const attachment = await uploadFile(bytes, fileName, mimeType, env.TODOIST_API_TOKEN);

  const target = pickTarget(await inboxTasks(env.TODOIST_API_TOKEN), now);
  const task = target ?? (await createPlainTask(`${PHOTO_PREFIX}（${stampFormat().format(now)}）`, env.TODOIST_API_TOKEN));
  await addComment(task.id, ATTACHED_NOTE, attachment, env.TODOIST_API_TOKEN);

  return { task, attachedToExisting: Boolean(target) && !isPhotoTask(task) };
}

// Photo tasks sent just before a text message are folded into the task that text created.
export async function absorbRecentPhotos(newTaskId, token, now = Date.now()) {
  const photos = (await inboxTasks(token)).filter(
    (t) => isPhotoTask(t) && t.id !== newTaskId && now - t.addedMs <= PAIR_WINDOW_MS,
  );

  let count = 0;
  for (const photo of photos) {
    for (const attachment of await attachmentsOf(photo.id, token)) {
      await addComment(newTaskId, ATTACHED_NOTE, attachment, token);
      count += 1;
    }
    await deleteTask(photo.id, token);
  }
  return count;
}
