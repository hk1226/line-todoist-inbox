// Every reply the bot sends, in each supported style. REPLY_STYLE picks one; "standard" is the default.

const help = (dateFollowUp) => `【使い方】
・1件だけ：そのまま送る（2行目以降はコメント）
・複数：行頭に「・」や「1.」を付ける
　記号の無い行は直前の項目のコメントになる
・メモ：先頭に「メモ」と書くとチェック欄の無いメモになる
・分解：先頭に「分解：」と書くと、後で細かいタスクに分けてもらう目印が付く（「分解しない：」で分けない指定）
・日付：「明日」「金曜」「10/15」などが予定日になる
　${dateFollowUp}
・URL：リンクを送ると、ページのタイトルで「読む：〇〇」になる
・写真：文章の前後2分以内に送ると、その文章のタスクに添付される
・一覧：今日のタスクを表示。「完了」「明日へ」ボタンで操作できる
・キャンセル（または取消）：直前に送った分をまとめて取り消す
・登録直後の返事の下のボタンで、今日・明日・p1・p2に変えられる`;

const STANDARD = {
  help: help("登録した後に「明日7:00」のように日時だけ送ると、直前のタスクの日時になります"),
  setupMode: (userId) =>
    `初期設定モードです。タスクはまだ追加していません。\n\nあなたのLINEユーザーID：\n${userId}\n\nこれをVercelの環境変数 ALLOWED_LINE_USER_ID に設定して再デプロイしてください。`,
  unsupported: {
    audio: "🎙 音声には対応していません。\nキーボードの音声入力で文字にして送るか、Todoistアプリの音声入力を使ってください。",
    video: "🎬 動画には対応していません。\n内容を文字で送ってください。",
    file: "📎 ファイルには対応していません。\n内容を文字で送ってください。",
  },
  added: (n) => `✅ ${n}件追加しました`,
  splitMarks: { force: "（🔧分解指定）", never: "（分解しない）" },
  partlyFailed: (ok, failed) => `⚠️ ${ok}件追加し、${failed}件は失敗しました。失敗した分をもう一度送ってください。`,
  failedItem: (title) => `⚠️ 失敗：${title}`,
  photosAttached: (n) => `（📷 写真${n}枚を添付）`,
  tooMany: (max) => `（一度に追加できるのは${max}件までです。残りは分けて送ってください）`,
  photoAttachedTo: (title) => `📷 写真を「${title}」に添付しました`,
  photoSaved:
    "📷 写真をInboxに追加しました\n2分以内に文章を送ると、その文章のタスクにまとめます。",
  photoFailed: "⚠️ 写真の保存に失敗しました。もう一度送ってください。",
  undone: (titles) => `↩️ ${titles.length}件取り消しました\n${titles.map((t) => `・${t}`).join("\n")}`,
  nothingToUndo: "取り消せるものはありませんでした（15分以内にInboxへ追加した分だけ取り消せます）",
  todoistError: "⚠️ Todoistとの通信に失敗しました。時間をおいてもう一度試してください。",
  todoistErrorButton: "⚠️ Todoistとの通信に失敗しました。時間をおいてもう一度押してください。",
  taskGone: "そのタスクは見つかりませんでした（完了または削除済みかもしれません）",
  alreadyDone: (title) => `すでに完了しています：${title}`,
  staleButton: (title) => `期日がすでに変わっているため、何もしませんでした：${title}\n最新の状態は「一覧」で確認してください`,
  completed: (title) => `✅ 完了にしました：${title}`,
  recurringNotMoved: "🔁 繰り返しタスクは、ここから期日を動かすと繰り返し設定が消えるため、Todoistアプリで変更してください",
  moved: (emoji, day, label, title) => `${emoji} ${day}${label}に移動しました：${title}`,
  prioritySet: (mark, title) => `${mark}にしました：${title}`,
  dateNoRecentTask:
    "日付だけが届きましたが、どのタスクのことか分かりませんでした（直前15分以内に追加したタスクがありません）。\nタスク名と一緒に「明日7:00 〇〇」のように送ってください",
  dateAmbiguous:
    "直前に複数件まとめて追加しているため、どのタスクの日付か分かりませんでした。\nTodoistアプリで変更するか、タスク名と一緒に送り直してください",
  dateApplied: (title, when) => `📅「${title}」を ${when} にしました`,
  dateUnreadable: (text) => `「${text}」を日付として読み取れませんでした。\n「明日 7:00」「10/15」「金曜 14時」のような書き方で送ってください`,
  listEmpty: "📋 今日のタスクはありません。",
  listMore: (n) => `…ほか${n}件はTodoistで確認してください`,
};

const HAKATA = {
  ...STANDARD,
  help: help("登録した後に「明日7:00」のように日時だけ送ると、直前のタスクの日時になるばい"),
  unsupported: {
    audio:
      "🎙 音声はまだ対応しとらんよ。\nLINEのキーボードのマイクで話して文字で送るか、Todoistアプリの音声入力（赤い波形のボタン）を使ってね。",
    video: "🎬 動画はまだ対応しとらんよ。\n内容を文字で送ってね。",
    file: "📎 ファイルはまだ対応しとらんよ。\n内容を文字で送ってね。",
  },
  added: (n) => `✅ ${n}件入れたばい`,
  partlyFailed: (ok, failed) => `⚠️ ${ok}件入れて、${failed}件失敗したばい。失敗分はもう一回送ってみて。`,
  tooMany: (max) => `（1回に入れられるのは${max}件までやけん、残りは分けて送ってね）`,
  photoAttachedTo: (title) => `📷 写真を「${title}」に添付したばい`,
  photoSaved:
    "📷 写真をInboxに入れたばい\n2分以内に文章を送ると、その文章のタスクにまとめるよ。写真だけなら、自動整理が中身を見て名前を付けるけん。",
  photoFailed: "⚠️ 写真の保存に失敗したばい。もう一回送ってみて。",
  undone: (titles) => `↩️ ${titles.length}件取り消したばい\n${titles.map((t) => `・${t}`).join("\n")}`,
  nothingToUndo: "取り消せるものは無かったばい（15分以内にInboxへ入れた分だけ取り消せる）",
  todoistError: "⚠️ Todoistとのやり取りに失敗したばい。時間をおいてもう一回送ってみて。",
  todoistErrorButton: "⚠️ Todoistとのやり取りに失敗したばい。時間をおいてもう一回押してみて。",
  taskGone: "そのタスクはもう見つからんかった（完了か削除済みかも）",
  alreadyDone: (title) => `もう完了しとるよ：${title}`,
  staleButton: (title) => `そのボタンは古いけん何もせんかったよ（期日がもう変わっとる）：${title}\n最新の状態は「一覧」で確認してね`,
  completed: (title) => `✅ 完了にしたばい：${title}`,
  recurringNotMoved: "🔁 繰り返しタスクは、ここから期日を動かすと繰り返し設定が消えるけん、Todoistアプリで直してね",
  moved: (emoji, day, label, title) => `${emoji} ${day}${label}に回したばい：${title}`,
  prioritySet: (mark, title) => `${mark}にしたばい：${title}`,
  dateNoRecentTask:
    "日付だけ届いたけど、どのタスクのことか分からんかった（直前15分以内に登録したタスクが無か）。\nタスク名と一緒に「明日7:00 〇〇」のように送ってね",
  dateAmbiguous:
    "直前に複数件まとめて登録しとるけん、どれの日付か分からんかった。\nTodoistアプリで直すか、タスク名と一緒に送り直してね",
  dateApplied: (title, when) => `📅「${title}」を ${when} にしたばい`,
  dateUnreadable: (text) => `「${text}」を日付として読み取れんかった。\n「明日 7:00」「10/15」「金曜 14時」のような書き方で送ってみて`,
  listEmpty: "📋 今日のタスクは無かばい。よか一日を！",
  listMore: (n) => `…ほか${n}件はTodoistで見てね`,
};

const STYLES = { standard: STANDARD, hakata: HAKATA };

// Read on every call so a changed environment variable takes effect without a module reload.
export function messages() {
  return STYLES[process.env.REPLY_STYLE] ?? STANDARD;
}
