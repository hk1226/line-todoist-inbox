const API = "https://api.todoist.com/api/v1";
const UNDO_WINDOW_MS = 15 * 60 * 1000;
const BATCH_GAP_MS = 60 * 1000;
export const PAIR_WINDOW_MS = 2 * 60 * 1000;
export const PHOTO_PREFIX = "📷 写真";

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

function jsonHeaders(token) {
  return { ...authHeader(token), "Content-Type": "application/json" };
}

async function request(url, token, init = {}) {
  const res = await fetch(url, { ...init, headers: { ...jsonHeaders(token), ...init.headers } });
  if (!res.ok) throw new Error(`Todoist ${init.method ?? "GET"} ${url}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

export async function addTask({ text, note }, token) {
  const quick = await fetch(`${API}/tasks/quick`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(note ? { text, note } : { text }),
  });
  if (quick.ok) return quick.json();

  const plain = await fetch(`${API}/tasks`, {
    method: "POST",
    headers: jsonHeaders(token),
    body: JSON.stringify(note ? { content: text, description: note } : { content: text }),
  });
  if (plain.ok) return plain.json();

  throw new Error(`Todoist ${quick.status}/${plain.status}: ${await plain.text()}`);
}

// Plain creation on purpose: Quick Add would read the timestamp in the photo title as a due date.
export function createPlainTask(content, token) {
  return request(`${API}/tasks`, token, { method: "POST", body: JSON.stringify({ content }) });
}

export function deleteTask(id, token) {
  return request(`${API}/tasks/${id}`, token, { method: "DELETE" });
}

export async function uploadFile(bytes, fileName, mimeType, token) {
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), fileName);
  form.append("file_name", fileName);
  const res = await fetch(`${API}/uploads`, { method: "POST", headers: authHeader(token), body: form });
  if (!res.ok) throw new Error(`Todoist upload: ${res.status} ${await res.text()}`);
  const file = await res.json();
  return {
    file_name: file.file_name,
    file_type: file.file_type,
    file_url: file.file_url,
    resource_type: file.resource_type ?? "image",
  };
}

export function addComment(taskId, content, attachment, token) {
  return request(`${API}/comments`, token, {
    method: "POST",
    body: JSON.stringify(attachment ? { task_id: taskId, content, attachment } : { task_id: taskId, content }),
  });
}

export async function attachmentsOf(taskId, token) {
  const { results } = await request(`${API}/comments?task_id=${taskId}&limit=200`, token);
  return results.map((c) => c.file_attachment).filter(Boolean);
}

// Newest first, with added_at parsed so callers can reason about time windows.
export async function inboxTasks(token) {
  const { results: projects } = await request(`${API}/projects?limit=200`, token);
  const inbox = projects.find((p) => p.inbox_project);
  if (!inbox) throw new Error("Inbox project not found");
  const { results } = await request(`${API}/tasks?project_id=${inbox.id}&limit=200`, token);
  return results
    .map((t) => ({ ...t, addedMs: Date.parse(t.added_at) }))
    .sort((a, b) => b.addedMs - a.addedMs);
}

// Returns null instead of throwing when the task is gone, so callers can say "already handled".
export async function getTask(id, token) {
  const res = await fetch(`${API}/tasks/${id}`, { headers: jsonHeaders(token) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Todoist GET task ${id}: ${res.status} ${await res.text()}`);
  return res.json();
}

export function closeTask(id, token) {
  return request(`${API}/tasks/${id}/close`, token, { method: "POST" });
}

export function updateTask(id, fields, token) {
  return request(`${API}/tasks/${id}`, token, { method: "POST", body: JSON.stringify(fields) });
}

export async function todayAndOverdueTasks(token) {
  const query = encodeURIComponent("today | overdue");
  const { results } = await request(`${API}/tasks/filter?query=${query}&limit=200`, token);
  return results;
}

export function isPhotoTask(task) {
  return task.content.startsWith(PHOTO_PREFIX);
}

// Tasks added within a minute of each other came from the same LINE message.
export function burstOf(tasks, anchor) {
  return tasks.filter((t) => Math.abs(anchor.addedMs - t.addedMs) <= BATCH_GAP_MS);
}

// Undo has no stored state: it removes the newest burst of Inbox tasks, which is what the last LINE message created.
export async function undoLastBatch(token, now = Date.now()) {
  const tasks = await inboxTasks(token);
  const newest = tasks[0];
  if (!newest || now - newest.addedMs > UNDO_WINDOW_MS) return [];

  const batch = burstOf(tasks, newest);
  for (const task of batch) await deleteTask(task.id, token);
  return batch;
}
