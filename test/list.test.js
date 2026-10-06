import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTodayList } from "../lib/list.js";

process.env.REPLY_STYLE = "hakata";

// 2026-10-05 19:00 JST
const NOW = new Date("2026-10-05T10:00:00Z");
const task = (content, due, priority = 1) => ({ content, due: due && { date: due }, priority });

test("lists today's tasks by priority then time, with times shown in JST", () => {
  const text = formatTodayList(
    [
      task("牛乳買う", "2026-10-05"),
      task("amexの支払い", "2026-10-05T13:00:00Z", 1),
      task("見積もり送る", "2026-10-05", 4),
      task("電話する", "2026-10-05T09:30:00", 3),
    ],
    NOW,
  );
  assert.equal(
    text,
    ["📋 今日のタスク（4件）", "・🔴 見積もり送る", "・🟠 電話する（09:30）", "・amexの支払い（22:00）", "・牛乳買う"].join("\n"),
  );
});

test("overdue tasks are listed separately with their date, oldest first", () => {
  const text = formatTodayList(
    [task("今日の分", "2026-10-05"), task("先週の分", "2026-09-28"), task("昨日の分", "2026-10-04", 3)],
    NOW,
  );
  assert.equal(
    text,
    ["📋 今日のタスク（1件）", "・今日の分", "", "⚠️ 期限切れ（2件）", "・先週の分（9/28）", "・🟠 昨日の分（10/4）"].join("\n"),
  );
});

test("a UTC time that falls on the next JST day is not counted as overdue", () => {
  assert.match(formatTodayList([task("深夜作業", "2026-10-04T16:00:00Z")], NOW), /今日のタスク（1件）\n・深夜作業（01:00）/);
});

test("memos are left out", () => {
  assert.equal(formatTodayList([task("* メモ", "2026-10-05")], NOW), "📋 今日のタスクは無かばい。よか一日を！");
});

test("only overdue tasks still shows an empty today section", () => {
  assert.match(formatTodayList([task("昨日の分", "2026-10-04")], NOW), /^📋 今日のタスク（0件）\n・なし\n\n⚠️ 期限切れ（1件）/);
});

test("long lists are cut off with a count of the rest", () => {
  const many = Array.from({ length: 25 }, (_, i) => task(`タスク${i}`, "2026-10-05"));
  const text = formatTodayList(many, NOW);
  assert.equal(text.split("\n").filter((l) => l.startsWith("・")).length, 20);
  assert.match(text, /…ほか5件はTodoistで見てね$/);
});

test("TIMEZONE changes which day counts as today and how times are shown", () => {
  process.env.TIMEZONE = "UTC";
  try {
    // 2026-10-05 10:00 UTC; a task at 2026-10-05T13:00:00Z is 13:00 the same day in UTC.
    assert.match(formatTodayList([task("会議", "2026-10-05T13:00:00Z")], NOW), /・会議（13:00）/);
  } finally {
    delete process.env.TIMEZONE;
  }
});

test("standard style uses neutral wording", () => {
  process.env.REPLY_STYLE = "standard";
  try {
    assert.equal(formatTodayList([], NOW), "📋 今日のタスクはありません。");
  } finally {
    process.env.REPLY_STYLE = "hakata";
  }
});
