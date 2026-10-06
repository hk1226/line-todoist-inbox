import { test, beforeEach, afterEach, mock } from "node:test";
import dns from "node:dns/promises";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { POST } from "../api/webhook.js";

const SECRET = "test-secret";
const USER = "U123";
const originalFetch = globalThis.fetch;
let calls;
let todoist;

function sign(body) {
  return crypto.createHmac("sha256", SECRET).update(body).digest("base64");
}

function lineRequest(text, { userId = USER, signature, message = { type: "text", text } } = {}) {
  const body = JSON.stringify({
    events: [{ type: "message", replyToken: "reply-token", source: { userId }, message }],
  });
  return new Request("https://example.com/api/webhook", {
    method: "POST",
    headers: { "x-line-signature": signature ?? sign(body) },
    body,
  });
}

const photo = (id, imageSet) => lineRequest(null, { message: { type: "image", id, ...(imageSet && { imageSet }) } });

function ago(ms) {
  return new Date(Date.now() - ms).toISOString();
}

// A small in-memory stand-in for the Todoist and LINE APIs.
function postback(data, { userId = USER } = {}) {
  const body = JSON.stringify({
    events: [{ type: "postback", replyToken: "reply-token", source: { userId }, postback: { data } }],
  });
  return new Request("https://example.com/api/webhook", {
    method: "POST",
    headers: { "x-line-signature": sign(body) },
    body,
  });
}

function fakeApis({ quickStatus = 200, flexStatus = 200 } = {}) {
  calls = [];
  todoist = { tasks: [], comments: [], updates: [], seq: 0 };
  const newTask = (content) => {
    const task = { id: `t${++todoist.seq}`, content, added_at: new Date().toISOString(), due: null };
    if (content.startsWith("明日")) task.due = { date: "2026-10-06" };
    todoist.tasks.push(task);
    return task;
  };

  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? "GET";
    const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    const path = url.replace(/^https:\/\/api\.todoist\.com\/api\/v1/, "");

    if (url.startsWith("https://api-data.line.me/")) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    }
    if (url.startsWith("https://api.line.me/")) {
      const isFlex = body.messages[0].type === "flex";
      return isFlex && flexStatus !== 200 ? new Response("bad flex", { status: flexStatus }) : new Response("{}");
    }
    if (url.startsWith("https://news.example/")) {
      return new Response("<html><head><title>AI時代の仕事術 &amp; 習慣</title></head></html>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    if (path === "/tasks/quick") {
      if (quickStatus !== 200) return new Response("nope", { status: quickStatus });
      const task = newTask(body.text);
      if (body.note) todoist.comments.push({ task_id: task.id, content: body.note, file_attachment: null });
      return Response.json(task);
    }
    if (path === "/tasks" && method === "POST") return Response.json(newTask(body.content));
    if (path.startsWith("/projects")) return Response.json({ results: [{ id: "INBOX", inbox_project: true }] });
    if (path.startsWith("/tasks/filter")) {
      todoist.lastFilter = new URL(url).searchParams.get("query");
      return Response.json({ results: todoist.tasks });
    }
    if (path.startsWith("/tasks?project_id=INBOX")) return Response.json({ results: todoist.tasks });
    const single = path.match(/^\/tasks\/([^/?]+)(\/close)?$/);
    if (single) {
      const [, id, close] = single;
      const task = todoist.tasks.find((t) => t.id === id);
      if (method === "DELETE") {
        todoist.tasks = todoist.tasks.filter((t) => t.id !== id);
        return new Response(null, { status: 204 });
      }
      if (!task) return new Response("not found", { status: 404 });
      if (close) {
        task.checked = true;
        return new Response(null, { status: 204 });
      }
      if (method === "POST") {
        if (body.due_string === "99月99日") return new Response("invalid date", { status: 400 });
        todoist.updates.push({ id, ...body });
        if (body.due_lang === "ja") {
          task.due = { date: "2099-01-03T07:00:00" };
          return Response.json(task);
        }
        if (body.priority) task.priority = body.priority;
        if (body.due_string) task.due = { date: body.due_string.startsWith("tomorrow") ? "2099-01-02" : "2099-01-01" };
        return Response.json(task);
      }
      return Response.json(task);
    }
    if (path === "/uploads") {
      const n = todoist.comments.length + 1;
      return Response.json({
        file_url: `https://files.example/${n}.jpg`,
        file_name: `${n}.jpg`,
        file_type: "image/jpeg",
        resource_type: "image",
      });
    }
    if (path === "/comments" && method === "POST") {
      todoist.comments.push({ task_id: body.task_id, content: body.content, file_attachment: body.attachment ?? null });
      return Response.json({ id: "c" });
    }
    if (path.startsWith("/comments?task_id=")) {
      const id = new URL(url).searchParams.get("task_id");
      return Response.json({ results: todoist.comments.filter((c) => c.task_id === id) });
    }
    return new Response("unexpected", { status: 500 });
  };
}

const lineReplies = () => calls.filter((c) => c.url.startsWith("https://api.line.me/")).map((c) => c.body.messages[0]);
const replies = () => lineReplies().map((m) => m.text ?? m.altText);
const todoistCalls = () => calls.filter((c) => c.url.includes("api.todoist.com"));
const photosOn = (taskId) => todoist.comments.filter((c) => c.task_id === taskId && c.file_attachment);

beforeEach(() => {
  process.env.LINE_CHANNEL_SECRET = SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = "line-token";
  process.env.TODOIST_API_TOKEN = "todoist-token";
  process.env.ALLOWED_LINE_USER_ID = USER;
  process.env.REPLY_STYLE = "hakata";
  // Link titles are only fetched from public addresses; the test hosts do not resolve for real.
  mock.method(dns, "lookup", async () => [{ address: "93.184.216.34", family: 4 }]);
  fakeApis();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  mock.restoreAll();
  delete process.env.REPLY_STYLE;
  delete process.env.TIMEZONE;
});

test("replies in standard Japanese unless REPLY_STYLE is set", async () => {
  delete process.env.REPLY_STYLE;
  await POST(lineRequest("見積もり送る"));
  await POST(lineRequest("キャンセル"));
  assert.equal(replies()[0], "✅ 1件追加しました\n① 見積もり送る");
  assert.match(replies()[1], /^↩️ 1件取り消しました/);
});

test("an unknown REPLY_STYLE falls back to standard Japanese", async () => {
  process.env.REPLY_STYLE = "osaka";
  await POST(lineRequest("見積もり送る"));
  assert.match(replies()[0], /追加しました/);
});

test("a correctly signed but malformed body is rejected without retries piling up", async () => {
  const body = "{not json";
  const res = await POST(
    new Request("https://example.com/api/webhook", { method: "POST", headers: { "x-line-signature": sign(body) }, body }),
  );
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("rejects a request with a bad signature", async () => {
  const res = await POST(lineRequest("x", { signature: "bad" }));
  assert.equal(res.status, 401);
  assert.equal(calls.length, 0);
});

test("a single message becomes one task with its comment", async () => {
  await POST(lineRequest("明日 見積もり送る\n山田さん宛"));
  assert.deepEqual(todoistCalls()[0].body, { text: "明日 見積もり送る", note: "山田さん宛" });
  assert.equal(replies()[0], "✅ 1件入れたばい\n① 明日 見積もり送る（10/6）");
});

test("a bulleted message adds every item in order and lists them in the reply", async () => {
  await POST(lineRequest("・明日 見積もり送る\n・メモ：月額制がよさそう\n・牛乳買う"));
  assert.deepEqual(
    todoist.tasks.map((t) => t.content),
    ["明日 見積もり送る", "* 月額制がよさそう", "牛乳買う"],
  );
  assert.equal(replies()[0], "✅ 3件入れたばい\n① 明日 見積もり送る（10/6）\n② 📝 月額制がよさそう\n③ 牛乳買う");
});

test("falls back to plain task creation when Quick Add fails", async () => {
  fakeApis({ quickStatus: 404 });
  await POST(lineRequest("見積もり送る\n補足メモ"));
  const plain = todoistCalls().find((c) => c.url.endsWith("/tasks") && c.method === "POST");
  assert.deepEqual(plain.body, { content: "見積もり送る", description: "補足メモ" });
});

test("a photo on its own becomes a photo task with the image attached", async () => {
  await POST(photo("m1"));
  assert.equal(todoist.tasks.length, 1);
  assert.match(todoist.tasks[0].content, /^📷 写真（/);
  assert.equal(photosOn(todoist.tasks[0].id).length, 1);
  assert.match(replies()[0], /📷 写真をInboxに入れたばい/);
});

test("a photo right after a single-item text is attached to that task", async () => {
  await POST(lineRequest("保育園の書類を今週中に出す"));
  await POST(photo("m1"));
  assert.equal(todoist.tasks.length, 1);
  assert.equal(photosOn(todoist.tasks[0].id).length, 1);
  assert.equal(replies()[1], "📷 写真を「保育園の書類を今週中に出す」に添付したばい");
});

test("a photo after a multi-item text gets its own task", async () => {
  await POST(lineRequest("・牛乳\n・卵"));
  await POST(photo("m1"));
  assert.equal(todoist.tasks.length, 3);
  assert.match(todoist.tasks[2].content, /^📷 写真/);
});

test("a photo does not attach to a task older than two minutes", async () => {
  todoist.tasks.push({ id: "old", content: "前からある", added_at: ago(5 * 60 * 1000) });
  await POST(photo("m1"));
  assert.equal(photosOn("old").length, 0);
  assert.equal(todoist.tasks.length, 2);
});

test("text sent right after photos absorbs them and removes the photo task", async () => {
  await POST(photo("m1", { id: "s", index: 1, total: 2 }));
  await POST(photo("m2", { id: "s", index: 2, total: 2 }));
  assert.equal(todoist.tasks.length, 1, "multiple photos share one photo task");

  await POST(lineRequest("このチラシのイベントに申し込む"));
  assert.deepEqual(todoist.tasks.map((t) => t.content), ["このチラシのイベントに申し込む"]);
  assert.equal(photosOn(todoist.tasks[0].id).length, 2);
  assert.match(replies().at(-1), /（📷 写真2枚を添付）/);
});

test("only the last photo of a multi-photo send gets a reply", async () => {
  await POST(photo("m1", { id: "s", index: 1, total: 3 }));
  await POST(photo("m2", { id: "s", index: 2, total: 3 }));
  await POST(photo("m3", { id: "s", index: 3, total: 3 }));
  assert.equal(replies().length, 1);
});

test("a multi-item text leaves earlier photos alone", async () => {
  await POST(photo("m1"));
  await POST(lineRequest("・牛乳\n・卵"));
  assert.equal(todoist.tasks.filter((t) => t.content.startsWith("📷 写真")).length, 1);
});

test("undo deletes only the newest burst of Inbox tasks", async () => {
  todoist.tasks = [
    { id: "new1", content: "牛乳買う", added_at: ago(5_000) },
    { id: "new2", content: "見積もり送る", added_at: ago(7_000) },
    { id: "old", content: "前からある", added_at: ago(3 * 60 * 60 * 1000) },
  ];
  await POST(lineRequest("取消"));
  assert.deepEqual(todoist.tasks.map((t) => t.id), ["old"]);
  assert.match(replies()[0], /↩️ 2件取り消したばい/);
});

test("undo does nothing when the newest Inbox task is older than 15 minutes", async () => {
  todoist.tasks = [{ id: "old", content: "前からある", added_at: ago(20 * 60 * 1000) }];
  await POST(lineRequest("取消"));
  assert.equal(todoist.tasks.length, 1);
  assert.match(replies()[0], /取り消せるものは無かった/);
});

test("キャンセル removes what the previous message added instead of becoming a task", async () => {
  await POST(lineRequest("旅行先決める 今日の夜まで"));
  await POST(lineRequest("キャンセル"));
  assert.equal(todoist.tasks.length, 0);
  assert.match(replies()[1], /↩️ 1件取り消したばい\n・旅行先決める/);
});

test("一覧 replies with today's and overdue tasks without adding anything", async () => {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
  todoist.tasks = [
    { id: "a", content: "amexの支払い", due: { date: today }, priority: 4, added_at: ago(1000) },
    { id: "b", content: "古い宿題", due: { date: "2026-01-01" }, priority: 1, added_at: ago(1000) },
  ];
  await POST(lineRequest("一覧"));
  assert.equal(todoist.lastFilter, "today | overdue");
  assert.equal(todoist.tasks.length, 2);
  assert.match(replies()[0], /📋 今日のタスク（1件）\n・🔴 amexの支払い/);
  assert.match(replies()[0], /⚠️ 期限切れ（1件）\n・古い宿題（1\/1）/);
});

const todayJst = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date());
const postbacksIn = (flex) =>
  JSON.stringify(flex)
    .match(/"data":"[^"]+"/g)
    .map((m) => m.slice(8, -1));

test("一覧 sends a card with 完了 and 明日へ buttons, and no 明日へ for repeating tasks", async () => {
  const day = todayJst();
  todoist.tasks = [
    { id: "a", content: "amexの支払い", due: { date: day }, priority: 4, added_at: ago(1000) },
    { id: "r", content: "爪を切る", due: { date: day, is_recurring: true }, priority: 1, added_at: ago(1000) },
  ];
  await POST(lineRequest("一覧"));
  const [message] = lineReplies();
  assert.equal(message.type, "flex");
  assert.deepEqual(postbacksIn(message).sort(), [`a=done&id=a&d=${day}`, `a=done&id=r&d=${day}`, `a=tomorrow&id=a&d=${day}`].sort());
});

test("a rejected card falls back to the plain text list", async () => {
  fakeApis({ flexStatus: 400 });
  todoist.tasks = [{ id: "a", content: "amexの支払い", due: { date: todayJst() }, priority: 4, added_at: ago(1000) }];
  await POST(lineRequest("一覧"));
  assert.equal(lineReplies().length, 2);
  assert.equal(lineReplies()[1].type, "text");
  assert.match(lineReplies()[1].text, /🔴 amexの支払い/);
});

test("完了 closes the task once and a second tap does nothing", async () => {
  const day = todayJst();
  todoist.tasks = [{ id: "a", content: "amexの支払い", due: { date: day }, checked: false }];
  await POST(postback(`a=done&id=a&d=${day}`));
  await POST(postback(`a=done&id=a&d=${day}`));
  assert.equal(todoist.tasks[0].checked, true);
  assert.equal(calls.filter((c) => c.url.endsWith("/close")).length, 1);
  assert.match(replies()[0], /✅ 完了にしたばい：amexの支払い/);
  assert.match(replies()[1], /もう完了しとるよ/);
});

test("明日へ keeps the time of day and refuses a stale button", async () => {
  const day = todayJst();
  todoist.tasks = [{ id: "a", content: "電話する", due: { date: `${day}T15:30:00` } }];
  await POST(postback(`a=tomorrow&id=a&d=${day}`));
  assert.deepEqual(todoist.updates[0], { id: "a", due_string: "tomorrow at 15:30", due_lang: "en" });
  assert.match(replies()[0], /➡️ 明日（1\/2）に回したばい：電話する/);

  await POST(postback(`a=tomorrow&id=a&d=${day}`));
  assert.equal(todoist.updates.length, 1);
  assert.match(replies()[1], /そのボタンは古いけん何もせんかった/);
});

test("repeating tasks are never rescheduled from LINE", async () => {
  const day = todayJst();
  todoist.tasks = [{ id: "r", content: "爪を切る", due: { date: day, is_recurring: true } }];
  await POST(postback(`a=tomorrow&id=r&d=${day}`));
  assert.equal(todoist.updates.length, 0);
  assert.match(replies()[0], /繰り返しタスク/);
});

test("a single new task gets cancel, today, tomorrow, p1 and p2 quick replies that work", async () => {
  await POST(lineRequest("見積もり送る"));
  const quick = lineReplies()[0].quickReply.items.map((i) => i.action.label);
  assert.deepEqual(quick, ["↩️ キャンセル", "📅 今日", "📅 明日", "🔴 p1", "🟠 p2"]);

  const id = todoist.tasks[0].id;
  await POST(postback(`a=pri&v=4&id=${id}`));
  assert.equal(todoist.tasks[0].priority, 4);
  assert.match(replies()[1], /🔴 p1にしたばい：見積もり送る/);

  await POST(postback(`a=today&id=${id}`));
  assert.equal(todoist.updates.at(-1).due_string, "today");
});

test("a 分解 prefix is stripped, noted on the task and shown in the reply", async () => {
  await POST(lineRequest("分解：提案書を作る"));
  const quick = todoistCalls().find((c) => c.url.endsWith("/tasks/quick"));
  assert.deepEqual(quick.body, { text: "提案書を作る", note: "分解指定：する（LINEで指定）" });
  assert.match(replies()[0], /① 提案書を作る（🔧分解指定）/);
});

test("several new tasks only get a cancel quick reply", async () => {
  await POST(lineRequest("・牛乳\n・卵"));
  assert.deepEqual(lineReplies()[0].quickReply.items.map((i) => i.action.label), ["↩️ キャンセル"]);
});

test("a bare link becomes 読む：<page title> with the link kept as a comment", async () => {
  await POST(lineRequest("https://news.example/article/1"));
  const quick = todoistCalls().find((c) => c.url.endsWith("/tasks/quick"));
  assert.deepEqual(quick.body, { text: "読む：AI時代の仕事術 & 習慣", note: "https://news.example/article/1" });
});

test("a date-only follow-up sets the date of the task just added instead of creating one", async () => {
  await POST(lineRequest("ブロックブラスター"));
  await POST(lineRequest("明日7:00"));
  assert.deepEqual(todoist.tasks.map((t) => t.content), ["ブロックブラスター"]);
  assert.deepEqual(todoist.updates[0], { id: todoist.tasks[0].id, due_string: "明日7:00", due_lang: "ja" });
  assert.equal(replies()[1], "📅「ブロックブラスター」を 1/3 07:00 にしたばい");
});

test("a date-only message with nothing recent creates nothing and explains", async () => {
  todoist.tasks = [{ id: "old", content: "前からある", added_at: ago(60 * 60 * 1000) }];
  await POST(lineRequest("明日7:00"));
  assert.equal(todoist.tasks.length, 1);
  assert.equal(todoist.updates.length, 0);
  assert.match(replies()[0], /どのタスクのことか分からんかった/);
});

test("a date-only message after a multi-item message is not applied", async () => {
  await POST(lineRequest("・牛乳\n・卵"));
  await POST(lineRequest("明日"));
  assert.equal(todoist.updates.length, 0);
  assert.match(replies()[1], /複数件まとめて登録しとるけん/);
});

test("a date Todoist cannot read is reported and nothing changes", async () => {
  await POST(lineRequest("ブロックブラスター"));
  await POST(lineRequest("99月99日"));
  assert.equal(todoist.updates.length, 0);
  assert.equal(todoist.tasks.length, 1);
  assert.match(replies()[1], /日付として読み取れんかった/);
});

test("postbacks from other users are ignored", async () => {
  todoist.tasks = [{ id: "a", content: "x", due: { date: todayJst() } }];
  await POST(postback(`a=done&id=a&d=${todayJst()}`, { userId: "U-stranger" }));
  assert.equal(calls.length, 0);
});

test("help replies with usage and touches nothing in Todoist", async () => {
  await POST(lineRequest("使い方"));
  assert.equal(todoistCalls().length, 0);
  assert.match(replies()[0], /【使い方】/);
});

test("audio gets a reply pointing to voice input alternatives", async () => {
  await POST(lineRequest(null, { message: { type: "audio", id: "1" } }));
  assert.equal(todoistCalls().length, 0);
  assert.match(replies()[0], /音声はまだ対応しとらん/);
});

test("videos and files get an unsupported reply", async () => {
  for (const type of ["video", "file"]) {
    fakeApis();
    await POST(lineRequest(null, { message: { type, id: "1" } }));
    assert.equal(todoistCalls().length, 0);
    assert.match(replies()[0], /まだ対応しとらん/);
  }
});

test("stickers are ignored without a reply", async () => {
  await POST(lineRequest(null, { message: { type: "sticker", id: "1" } }));
  assert.equal(calls.length, 0);
});

test("messages of any kind from other users are ignored", async () => {
  await POST(lineRequest("いたずら", { userId: "U-stranger" }));
  await POST(lineRequest(null, { userId: "U-stranger", message: { type: "image", id: "1" } }));
  assert.equal(calls.length, 0);
});

test("setup mode replies with the user ID and adds nothing", async () => {
  delete process.env.ALLOWED_LINE_USER_ID;
  await POST(lineRequest("テスト"));
  assert.equal(todoistCalls().length, 0);
  assert.match(replies()[0], /U123/);
});
