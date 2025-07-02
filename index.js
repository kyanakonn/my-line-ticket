const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

// 整理券管理
let currentTicket = 1;
let currentNumber = 0;
let ticketLog = []; // 発行ログ（{ number, timestamp, userId, completed, limitUnlocked }）
let isTicketingClosed = false;

// LINE連携設定
const LINE_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

// LINE webhook: userId 登録用
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.status(200).send("No events");
  const event = events[0];
  const replyToken = event.replyToken;
  const userId = event.source.userId;
  const lastTicket = ticketLog.slice().reverse().find(t => !t.userId);
  if (lastTicket) lastTicket.userId = userId;
  try {
    await axios.post(LINE_REPLY_URL, {
      replyToken,
      messages: [{ type: "text", text: `整理券はこちらから発行できます：\nhttps://.../ticket.html` }]
    }, { headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` } });
    res.status(200).send("OK");
  } catch (err) {
    console.error("LINE送信失敗:", err.response?.data || err.message);
    res.status(500).send("Error");
  }
});

// 整理券を発行する
app.post("/api/ticket", (req, res) => {
  if (isTicketingClosed) return res.status(403).json({ message: "本日の新規整理券の発行は終了しました。" });
  const { userId } = req.body;
  const ticketNumber = currentTicket++;
  ticketLog.push({
    number: ticketNumber,
    timestamp: Date.now(),
    userId: userId || null,
    completed: false,           
    limitUnlocked: false       
  });
  res.json({ number: ticketNumber });
});

// 呼び出し番号取得
app.get("/api/number", (req, res) => res.json({ number: currentNumber }));

// 呼び出し進める／戻す
app.post("/api/call", (req, res) => {
  const diff = typeof req.body.diff === "number" ? req.body.diff : 1;
  currentNumber = Math.max(0, currentNumber + diff);
  res.json({ message: `番号 ${currentNumber} を呼び出しました。` });
});

// 呼び出し番号直接設定
app.post("/api/set", (req, res) => {
  const { number } = req.body;
  if (typeof number !== "number" || number < 0) return res.status(400).json({ message: "無効な番号です。" });
  currentNumber = number;
  res.json({ message: `呼び出し番号を ${currentNumber} に設定しました。` });
});

// 最後に発行された整理券番号
app.get("/api/ticket/last", (req, res) => res.json({ last: currentTicket - 1 }));

// 整理券発行ログ取得（completed, limitUnlocked フィールド含む）
app.get("/api/ticket/log", (req, res) => res.json(ticketLog));

// 任意整理券への通知
app.post("/api/notify", async (req, res) => {
  const { number, message } = req.body;
  if (typeof number !== "number" || number <= 0) return res.status(400).json({ message: "無効な整理券番号です。" });
  const entry = ticketLog.find(t => t.number === number);
  if (!entry?.userId) return res.status(404).json({ message: `整理券番号 ${number} のユーザー情報が見つかりません。` });
  try {
    await axios.post(LINE_PUSH_URL, {
      to: entry.userId,
      messages: [{ type: "text", text: message || `【手動通知】整理券番号 ${number} の方、まもなく順番です。` }]
    }, { headers: { Authorization: `Bearer ${LINE_ACCESS_TOKEN}` } });
    res.json({ message: `番号 ${number} に通知を送信しました。` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "通知送信に失敗しました。" });
  }
});

// 受付完了 
app.post("/api/complete", (req, res) => {
  const { userId, ticketNumber } = req.body;
  const entry = ticketLog.find(t => t.number === ticketNumber && t.userId === userId);
  if (!entry) return res.status(404).json({ success: false, message: "該当整理券が見つかりません。" });
  entry.completed = true;
  res.json({ success: true });
});

// 制限時間解除 
app.post("/api/unlock-limit", (req, res) => {
  const { number } = req.body;
  const entry = ticketLog.find(t => t.number === number);
  if (!entry) return res.status(404).json({ success: false, message: "整理券が見つかりません。" });
  if (entry.limitUnlocked) return res.status(400).json({ success: false, message: "すでに解除済みです。" });
  entry.limitUnlocked = true;
  // 必要であれば timestamp を操作して再発行可能にできる
  res.json({ success: true });
});

// 管理者用リセット
app.post("/api/reset", (req, res) => {
  currentNumber = 0;
  currentTicket = 1;
  ticketLog = [];
  isTicketingClosed = false;
  res.json({ message: "呼び出し番号と整理券番号、発行ログをリセットしました。" });
});

// 受付状態取得
app.get("/api/ticketing-status", (req, res) => res.json({ closed: isTicketingClosed }));

// 発行停止／再開
app.post("/api/close-ticketing", (req, res) => {
  isTicketingClosed = true;
  res.json({ message: "本日の新規整理券発行を終了しました。" });
});
app.post("/api/open-ticketing", (req, res) => {
  isTicketingClosed = false;
  res.json({ message: "本日の新規整理券発行を再開しました。" });
});

// LINE発券ページへリダイレクト
app.get("/", (req, res) => res.redirect("/ticket.html"));

// サーバ起動
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`✅ Server running on port ${port}`));
