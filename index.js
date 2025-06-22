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
let ticketLog = []; // 発行ログ（{ number, timestamp, userId }）

// LINE連携設定
const LINE_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

// LINE webhook: ユーザーがリンクを開いた時の userId 登録用
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events || events.length === 0) return res.status(200).send("No events");

  const event = events[0];
  const replyToken = event.replyToken;
  const userId = event.source.userId;

  // userId を仮の最新チケットに紐付け（userIdがまだnullの最新チケット）
  const lastTicket = ticketLog.slice().reverse().find(t => !t.userId);
  if (lastTicket) {
    lastTicket.userId = userId;
  }

  try {
    await axios.post(
      LINE_REPLY_URL,
      {
        replyToken: replyToken,
        messages: [
          {
            type: "text",
            text: `整理券はこちらから発行できます：\nhttps://my-line-ticket.onrender.com/ticket.html`,
          },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
        },
      }
    );
    res.status(200).send("OK");
  } catch (error) {
    console.error("LINEメッセージ送信失敗:", error.response?.data || error.message);
    res.status(500).send("Error");
  }
});

// 🎫 整理券を発行する（userIdを受け取り保存）
app.post("/api/ticket", (req, res) => {
  const { userId } = req.body;

  const ticketNumber = currentTicket++;
  ticketLog.push({
    number: ticketNumber,
    timestamp: Date.now(),
    userId: userId || null
  });

  res.json({ number: ticketNumber });
});

// 現在の呼び出し番号を取得する
app.get("/api/number", (req, res) => {
  res.json({ number: currentNumber });
});

// 呼び出しを進める or 戻す
app.post("/api/call", (req, res) => {
  const diff = typeof req.body.diff === "number" ? req.body.diff : 1;
  currentNumber += diff;
  if (currentNumber < 0) currentNumber = 0;
  res.json({ message: `番号 ${currentNumber} を呼び出しました。` });
});

// 呼び出し番号を直接設定する
app.post("/api/set", (req, res) => {
  const { number } = req.body;
  if (typeof number !== "number" || number < 0) {
    return res.status(400).json({ message: "無効な番号です。" });
  }
  currentNumber = number;
  res.json({ message: `呼び出し番号を ${currentNumber} に設定しました。` });
});

// 最後に発行された整理券番号を取得
app.get("/api/ticket/last", (req, res) => {
  res.json({ last: currentTicket - 1 });
});

// 整理券発行ログを取得
app.get("/api/ticket/log", (req, res) => {
  res.json(ticketLog);
});

// 管理者が任意の整理券番号に通知を送る
app.post("/api/notify", async (req, res) => {
  const { number, message } = req.body;

  if (typeof number !== "number" || number <= 0) {
    return res.status(400).json({ message: "無効な整理券番号です。" });
  }

  const entry = ticketLog.find(t => t.number === number);
  if (!entry || !entry.userId) {
    return res.status(404).json({ message: `整理券番号 ${number} のユーザー情報が見つかりません。` });
  }

  try {
    await axios.post(
      LINE_PUSH_URL,
      {
        to: entry.userId,
        messages: [
          {
            type: "text",
            text: message || `【手動通知】整理券番号 ${number} の方、まもなく順番です。`
          }
        ]
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${LINE_ACCESS_TOKEN}`,
        }
      }
    );
    res.json({ message: `番号 ${number} に通知を送信しました。` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "通知送信に失敗しました。" });
  }
});

// トップページリダイレクト
app.get("/", (req, res) => {
  res.redirect("/ticket.html");
});

// サーバー起動
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`✅ Server running on port ${port}`);
});
