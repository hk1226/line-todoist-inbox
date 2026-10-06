import { test } from "node:test";
import assert from "node:assert/strict";
import { isDateOnly } from "../lib/dateonly.js";

test("date and time phrases on their own are recognised", () => {
  for (const text of [
    "明日7:00",
    "明日 7:00",
    "明日の朝",
    "今日中",
    "金曜",
    "来週月曜の14時",
    "10/15",
    "10月15日 15時半",
    "明後日の夜まで",
    "毎週月曜",
    "７：３０", // full-width
  ]) {
    assert.equal(isDateOnly(text), true, text);
  }
});

test("anything with other words stays a normal task", () => {
  for (const text of ["明日 歯医者", "金曜に見積もり送る", "ブロックブラスター", "10/15 締切の書類", "夜まで", "の", ""]) {
    assert.equal(isDateOnly(text), false, text);
  }
});

test("multi-line or long messages are never treated as a date", () => {
  assert.equal(isDateOnly("明日\n金曜"), false);
  assert.equal(isDateOnly("明日 ".repeat(12)), false);
});
