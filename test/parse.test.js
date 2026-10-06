import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMessage, parseCommand, toTodoistText, MAX_ITEMS } from "../lib/parse.js";

test("without bullets: first line is the task, the rest is a comment", () => {
  assert.deepEqual(parseMessage("今週の旅行をどこにするか決める\nエリアとかも考える"), [
    { title: "今週の旅行をどこにするか決める", note: "エリアとかも考える", memo: false },
  ]);
});

test("bullet lines become separate items, plain lines attach to the previous item", () => {
  const items = parseMessage("・明日 見積もり送る\n  金額は先月と同じ\n・金曜 ジムの予約\n・牛乳買う");
  assert.deepEqual(items, [
    { title: "明日 見積もり送る", note: "金額は先月と同じ", memo: false },
    { title: "金曜 ジムの予約", note: "", memo: false },
    { title: "牛乳買う", note: "", memo: false },
  ]);
});

test("lines before the first bullet become a heading comment on every item", () => {
  const items = parseMessage("週末の買い物\n・牛乳\n・卵");
  assert.equal(items.length, 2);
  assert.equal(items[0].note, "見出し：週末の買い物");
  assert.equal(items[1].note, "見出し：週末の買い物");
});

test("numbered and other bullet styles are recognised", () => {
  const titles = parseMessage("1. 見積もり\n2)請求書\n① 電話\n- メール\n• 掃除").map((i) => i.title);
  assert.deepEqual(titles, ["見積もり", "請求書", "電話", "メール", "掃除"]);
});

test("a date like 10.15 is not mistaken for a numbered bullet", () => {
  assert.deepEqual(parseMessage("10.15 歯医者"), [{ title: "10.15 歯医者", note: "", memo: false }]);
});

test("メモ prefix marks an item as a memo and is stripped from the title", () => {
  const items = parseMessage("・メモ：新サービスは月額制がよさそう\n・見積もり送る");
  assert.deepEqual(items[0], { title: "新サービスは月額制がよさそう", note: "", memo: true });
  assert.equal(items[1].memo, false);
  assert.equal(toTodoistText(items[0]), "* 新サービスは月額制がよさそう");
  assert.equal(toTodoistText(items[1]), "見積もり送る");
});

test("分解 and 分解しない prefixes leave a marker comment for whoever organises the Inbox", () => {
  assert.deepEqual(parseMessage("分解：提案書を作る\n先方は来週月曜締切"), [
    { title: "提案書を作る", note: "先方は来週月曜締切\n分解指定：する（LINEで指定）", memo: false, split: "force" },
  ]);
  assert.deepEqual(parseMessage("分解しない：引越し準備"), [
    { title: "引越し準備", note: "分解指定：しない（LINEで指定）", memo: false, split: "never" },
  ]);
  const [memo] = parseMessage("メモ：分解：アイデア");
  assert.equal(memo.memo, true);
  assert.equal(memo.split, "force");
  assert.equal(memo.title, "アイデア");
});

test("a task merely mentioning 分解 is left alone", () => {
  assert.deepEqual(parseMessage("エンジンを分解して掃除する"), [
    { title: "エンジンを分解して掃除する", note: "", memo: false },
  ]);
});

test("caps the number of items per message", () => {
  const text = Array.from({ length: 20 }, (_, i) => `・タスク${i}`).join("\n");
  assert.equal(parseMessage(text).length, MAX_ITEMS);
});

test("recognises commands only as whole messages", () => {
  assert.equal(parseCommand("取消"), "undo");
  assert.equal(parseCommand(" 取り消し "), "undo");
  assert.equal(parseCommand("キャンセル"), "undo");
  assert.equal(parseCommand("一覧"), "list");
  assert.equal(parseCommand("今日"), "list");
  assert.equal(parseCommand("使い方"), "help");
  assert.equal(parseCommand("取消の書類を出す"), null);
  assert.equal(parseCommand("ホテルをキャンセルする"), null);
  assert.equal(parseCommand("今日 見積もり送る"), null);
});
