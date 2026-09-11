const express = require("express");
const axios = require("axios");
const path = require("path");
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

let currentTicket = 1;
let currentNumber = 0;
let ticketLog = [];
// 所要時間の計測記録（計測完了順）
let measurementRecords = [];
let isTicketingClosed = false;
let resetFlag = false;
let preparing = true;

// 整理券の発行時間設定
// start / end は HH:MM。
// slots は任意で、capacity が空ならその時間帯は無制限。
let ticketSettings = {
  start: "09:30",
  end: "13:00",
  slots: []
};

// 1枚あたりの標準所要時間
const DEFAULT_TICKET_MINUTES = 6;

// 時刻判定は日本時間
const TIME_ZONE = "Asia/Tokyo";

const LINE_ACCESS_TOKEN = process.env.CHANNEL_ACCESS_TOKEN;
const LINE_PUSH_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";


// =========================================
// 時刻関連
// =========================================

function normalizeTime(value) {
  if (typeof value !== "string") return null;

  const m = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);

  if (h < 0 || h > 23 || min < 0 || min > 59) {
    return null;
  }

  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}


function timeToMinutes(value) {
  const normalized = normalizeTime(value);

  if (!normalized) return null;

  const [h, m] = normalized.split(":").map(Number);

  return h * 60 + m;
}


function formatTime(minutes) {
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}


// =========================================
// 日本時間取得
// =========================================

function getJstDateAndMinutes(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);

  const get = type =>
    Number(parts.find(p => p.type === type)?.value || 0);

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");

  return {
    dateKey:
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,

    minutes: hour * 60 + minute
  };
}


function ticketDateKey(ticket) {
  return getJstDateAndMinutes(
    new Date(ticket.timestamp)
  ).dateKey;
}


// =========================================
// 時間帯ごとの発行枚数
// =========================================

function getIssuedCountForSlot(slot, dateKey) {

  const start =
    timeToMinutes(slot.start);

  const end =
    timeToMinutes(slot.end);


  if (
    start === null ||
    end === null
  ) {
    return 0;
  }


  return ticketLog.filter(ticket => {

    if (
      ticketDateKey(ticket) !== dateKey
    ) {
      return false;
    }


    const minutes =
      getJstDateAndMinutes(
        new Date(ticket.timestamp)
      ).minutes;


    return (
      minutes >= start &&
      minutes < end
    );

  }).length;
}


// =========================================
// 次に発行可能になる時間
// =========================================

function getNextAvailableTime(
  nowMinutes,
  dateKey
) {

  const start =
    timeToMinutes(ticketSettings.start);

  const end =
    timeToMinutes(ticketSettings.end);


  if (
    start === null ||
    end === null ||
    start >= end
  ) {
    return null;
  }


  // 全体の開始前
  if (
    nowMinutes < start
  ) {
    return formatTime(start);
  }


  // 全体の終了後
  if (
    nowMinutes >= end
  ) {
    return null;
  }


  const slots =
    Array.isArray(ticketSettings.slots)
      ? ticketSettings.slots
          .map(slot => ({
            start:
              normalizeTime(slot.start),

            end:
              normalizeTime(slot.end),

            capacity:
              slot.capacity === null ||
              slot.capacity === "" ||
              typeof slot.capacity === "undefined"
                ? null
                : Number(slot.capacity)
          }))
          .filter(
            slot =>
              slot.start &&
              slot.end
          )
          .sort(
            (a, b) =>
              timeToMinutes(a.start) -
              timeToMinutes(b.start)
          )
      : [];


  // 設定された時間帯を確認
  for (
    const slot of slots
  ) {

    const slotStart =
      timeToMinutes(slot.start);

    const slotEnd =
      timeToMinutes(slot.end);


    if (
      slotStart === null ||
      slotEnd === null ||
      slotStart >= slotEnd
    ) {
      continue;
    }


    if (
      slotEnd <= start ||
      slotStart >= end
    ) {
      continue;
    }


    const actualStart =
      Math.max(
        slotStart,
        start
      );

    const actualEnd =
      Math.min(
        slotEnd,
        end
      );


    if (
      actualStart >= actualEnd
    ) {
      continue;
    }


    // 次の時間帯がまだ始まっていない
    if (
      nowMinutes < actualStart
    ) {
      return formatTime(actualStart);
    }


    // 現在の時間帯
    if (
      nowMinutes >= actualStart &&
      nowMinutes < actualEnd
    ) {

      // 上限なし
      if (
        slot.capacity === null ||
        getIssuedCountForSlot(
          slot,
          dateKey
        ) < slot.capacity
      ) {
        return formatTime(nowMinutes);
      }


      // 上限に達しているので次へ
      continue;
    }

  }


  // 現在時刻以降の空き時間帯を探す
  for (
    const slot of slots
  ) {

    const slotStart =
      timeToMinutes(slot.start);

    const slotEnd =
      timeToMinutes(slot.end);


    if (
      slotStart === null ||
      slotEnd === null ||
      slotStart >= slotEnd
    ) {
      continue;
    }


    const actualStart =
      Math.max(
        slotStart,
        start
      );

    const actualEnd =
      Math.min(
        slotEnd,
        end
      );


    if (
      actualStart < nowMinutes ||
      actualStart >= actualEnd
    ) {
      continue;
    }


    if (
      slot.capacity === null ||
      getIssuedCountForSlot(
        slot,
        dateKey
      ) < slot.capacity
    ) {
      return formatTime(actualStart);
    }

  }


  return null;
}


// =========================================
// 現在の発行可否
// =========================================

function getTicketAvailability() {

  const {
    dateKey,
    minutes: nowMinutes
  } = getJstDateAndMinutes();


  const start =
    timeToMinutes(ticketSettings.start);

  const end =
    timeToMinutes(ticketSettings.end);


  // 設定がおかしい
  if (
    start === null ||
    end === null ||
    start >= end
  ) {

    return {
      available: false,

      reason:
        "設定された発行時間が正しくありません。",

      nextTime: null,

      start:
        ticketSettings.start,

      end:
        ticketSettings.end
    };

  }


  // 開始前
  if (
    nowMinutes < start
  ) {

    return {
      available: false,

      reason:
        "発行開始前です。",

      nextTime:
        formatTime(start),

      start:
        ticketSettings.start,

      end:
        ticketSettings.end
    };

  }


  // 終了後
  if (
    nowMinutes >= end
  ) {

    return {
      available: false,

      reason:
        "本日の発行時間は終了しました。",

      nextTime: null,

      start:
        ticketSettings.start,

      end:
        ticketSettings.end
    };

  }


  const slots =
    Array.isArray(ticketSettings.slots)
      ? ticketSettings.slots
          .map(slot => ({
            start:
              normalizeTime(slot.start),

            end:
              normalizeTime(slot.end),

            capacity:
              slot.capacity === null ||
              slot.capacity === "" ||
              typeof slot.capacity === "undefined"
                ? null
                : Number(slot.capacity)
          }))
          .filter(
            slot =>
              slot.start &&
              slot.end
          )
          .sort(
            (a, b) =>
              timeToMinutes(a.start) -
              timeToMinutes(b.start)
          )
      : [];


  // 時間帯設定がない場合
  // 全体の開始～終了だけで発行
  if (
    slots.length === 0
  ) {

    return {
      available: true,

      reason: "",

      nextTime: null,

      start:
        ticketSettings.start,

      end:
        ticketSettings.end
    };

  }


  // 現在の時間帯を確認
  for (
    const slot of slots
  ) {

    const slotStart =
      timeToMinutes(slot.start);

    const slotEnd =
      timeToMinutes(slot.end);


    if (
      slotStart === null ||
      slotEnd === null ||
      slotStart >= slotEnd
    ) {
      continue;
    }


    const actualStart =
      Math.max(
        slotStart,
        start
      );

    const actualEnd =
      Math.min(
        slotEnd,
        end
      );


    if (
      actualStart >= actualEnd
    ) {
      continue;
    }


    if (
      nowMinutes >= actualStart &&
      nowMinutes < actualEnd
    ) {

      // 発行可能
      if (
        slot.capacity === null ||
        getIssuedCountForSlot(
          slot,
          dateKey
        ) < slot.capacity
      ) {

        return {
          available: true,

          reason: "",

          nextTime: null,

          start:
            ticketSettings.start,

          end:
            ticketSettings.end,

          slot
        };

      }


      // この時間帯の上限到達
      const nextTime =
        getNextAvailableTime(
          nowMinutes + 1,
          dateKey
        );


      return {
        available: false,

        reason:
          "この回の発行上限に達しました。",

        nextTime,

        start:
          ticketSettings.start,

        end:
          ticketSettings.end,

        slot
      };

    }

  }


  // 区切りの間
  const nextTime =
    getNextAvailableTime(
      nowMinutes,
      dateKey
    );


  if (nextTime) {

    return {
      available: false,

      reason:
        "次の発行時間までお待ちください。",

      nextTime,

      start:
        ticketSettings.start,

      end:
        ticketSettings.end
    };

  }


  return {
    available: false,

    reason:
      "現在は発行できません。",

    nextTime: null,

    start:
      ticketSettings.start,

    end:
      ticketSettings.end
  };

}


// =========================================
// 発行時間設定のバリデーション
// =========================================

function validateTicketSettings(input) {

  const start =
    normalizeTime(input?.start);

  const end =
    normalizeTime(input?.end);


  const startMinutes =
    timeToMinutes(start);

  const endMinutes =
    timeToMinutes(end);


  if (
    start === null ||
    end === null ||
    startMinutes >= endMinutes
  ) {

    return {
      ok: false,

      message:
        "開始時間と終了時間を正しく設定してください。"
    };

  }


  const rawSlots =
    Array.isArray(input?.slots)
      ? input.slots
      : [];


  const slots = [];


  for (
    const raw of rawSlots
  ) {

    // 完全に空の行は無視
    if (
      !raw ||
      (
        !raw.start &&
        !raw.end &&
        (
          raw.capacity === "" ||
          raw.capacity === null ||
          typeof raw.capacity === "undefined"
        )
      )
    ) {
      continue;
    }


    const slotStart =
      normalizeTime(raw.start);

    const slotEnd =
      normalizeTime(raw.end);


    const s =
      timeToMinutes(slotStart);

    const e =
      timeToMinutes(slotEnd);


    if (
      slotStart === null ||
      slotEnd === null ||
      s >= e
    ) {

      return {
        ok: false,

        message:
          "時間区切りの開始・終了時間を正しく設定してください。"
      };

    }


    // 全体の開始～終了の範囲内か確認
    if (
      s < startMinutes ||
      e > endMinutes
    ) {

      return {
        ok: false,

        message:
          "時間区切りは全体の開始～終了時間の範囲内にしてください。"
      };

    }


    let capacity = null;


    // 上限が入力されている場合
    if (
      !(
        raw.capacity === "" ||
        raw.capacity === null ||
        typeof raw.capacity === "undefined"
      )
    ) {

      capacity =
        Number(raw.capacity);


      if (
        !Number.isInteger(capacity) ||
        capacity < 1
      ) {

        return {
          ok: false,

          message:
            "発行枚数上限は1以上の整数、または空欄にしてください。"
        };

      }

    }


    slots.push({
      start: slotStart,
      end: slotEnd,
      capacity
    });

  }


  // 時間順に並べる
  slots.sort(
    (a, b) =>
      timeToMinutes(a.start) -
      timeToMinutes(b.start)
  );


  // 時間帯の重複チェック
  for (
    let i = 1;
    i < slots.length;
    i++
  ) {

    if (
      timeToMinutes(slots[i].start) <
      timeToMinutes(slots[i - 1].end)
    ) {

      return {
        ok: false,

        message:
          "時間区切りが重なっています。区切り同士が重ならないようにしてください。"
      };

    }

  }


  return {
    ok: true,

    settings: {
      start,
      end,
      slots
    }
  };

}


// =========================================
// LINE Webhook
// =========================================

app.post("/webhook", async (req, res) => {

  const events =
    req.body.events;


  if (
    !events ||
    events.length === 0
  ) {
    return res.status(200).send("No events");
  }


  const event =
    events[0];


  const replyToken =
    event.replyToken;


  const userId =
    event.source.userId;


  const lastTicket =
    ticketLog
      .slice()
      .reverse()
      .find(t => !t.userId);


  if (lastTicket) {
    lastTicket.userId =
      userId;
  }


  try {

    await axios.post(
      LINE_REPLY_URL,

      {
        replyToken,

        messages: [
          {
            type: "text",

            text:
              `整理券はこちらから発行できます：\n` +
              `https://.../ticket.html`
          }
        ]
      },

      {
        headers: {
          Authorization:
            `Bearer ${LINE_ACCESS_TOKEN}`
        }
      }
    );


    res.status(200).send("OK");

  } catch (err) {

    console.error(
      "LINE送信失敗:",
      err.response?.data ||
      err.message
    );

    res.status(500).send("Error");

  }

});


// =========================================
// 整理券発行
// =========================================

app.post("/api/ticket", (req, res) => {

  // 管理画面から手動で発行停止中
  if (isTicketingClosed) {

    return res.status(403).json({
      message:
        "本日の新規整理券の発行は終了しました。"
    });

  }


  // 準備中モードでは整理券を発行しない
  if (preparing) {

    return res.status(403).json({
      message:
        "現在は準備中です。9時30分に受付を開始します。",

      preparing: true
    });

  }


  // 時間・枚数上限チェック
  const availability =
    getTicketAvailability();


  if (
    !availability.available
  ) {

    let message =
      availability.reason ||
      "現在は整理券を発行できません。";


    if (
      availability.nextTime
    ) {

      message +=
        ` 次の発券は${availability.nextTime}からです。`;

    }


    return res.status(429).json({

      message,

      reason:
        availability.reason,

      nextTime:
        availability.nextTime,

      start:
        availability.start,

      end:
        availability.end

    });

  }


  const {
    userId
  } = req.body;


  // 再発行許可がある場合
  const unlockedEntry =
    ticketLog
      .slice()
      .reverse()
      .find(
        t =>
          t.userId === userId &&
          (t.limitUnlockCount || 0) > 0
      );


  if (unlockedEntry) {

    unlockedEntry.limitUnlockCount--;

    console.log(
      `再発行残り回数: ${unlockedEntry.limitUnlockCount}`
    );

  }


  // 整理券番号発行
  const ticketNumber =
    currentTicket++;


  ticketLog.push({

    number:
      ticketNumber,

    timestamp:
      Date.now(),

    userId:
      userId || null,

    completed:
      false,

    limitUnlockCount:
      0,

    actualMinutes:
      DEFAULT_TICKET_MINUTES

  });


  res.json({
    number:
      ticketNumber
  });

});


// =========================================
// 現在の呼び出し番号
// =========================================

app.get("/api/number", (req, res) => {

  res.json({
    number:
      currentNumber
  });

});


// =========================================
// 呼び出し番号を進める
// =========================================

app.post("/api/call", (req, res) => {

  const diff =
    typeof req.body.diff === "number"
      ? req.body.diff
      : 1;


  currentNumber =
    Math.max(
      0,
      currentNumber + diff
    );


  res.json({
    message:
      `番号 ${currentNumber} を呼び出しました。`
  });

});


// =========================================
// 呼び出し番号を直接設定
// =========================================

app.post("/api/set", (req, res) => {

  const {
    number
  } = req.body;


  if (
    typeof number !== "number" ||
    number < 0
  ) {

    return res.status(400).json({
      message:
        "無効な番号です。"
    });

  }


  currentNumber =
    number;


  res.json({
    message:
      `呼び出し番号を ${currentNumber} に設定しました。`
  });

});


// =========================================
// 最後に発行された整理券
// =========================================

app.get("/api/ticket/last", (req, res) => {

  res.json({
    last:
      currentTicket - 1
  });

});


// =========================================
// 整理券ログ
// =========================================

app.get("/api/ticket/log", (req, res) => {

  res.json(
    ticketLog
  );

});


// =========================================
// 所要時間データ取得
// =========================================

app.get("/api/time-data", (req, res) => {

  const timeData =
    ticketLog.map(t => ({

      number:
        t.number,

      actualMinutes:
        typeof t.actualMinutes === "number"
          ? t.actualMinutes
          : DEFAULT_TICKET_MINUTES

    }));


  res.json(
    timeData
  );

});


// =========================================
// 所要時間データ更新
// =========================================

app.post("/api/time-data", (req, res) => {

  const {
    number,
    actualMinutes
  } = req.body;


  const entry =
    ticketLog.find(
      t => t.number === number
    );


  if (!entry) {

    return res.status(404).json({
      message:
        "整理券が見つかりません。"
    });

  }


  if (
    typeof actualMinutes !== "number" ||
    actualMinutes < 0
  ) {

    return res.status(400).json({
      message:
        "無効な所要時間です。"
    });

  }


  entry.actualMinutes =
    actualMinutes;


  res.json({
    message:
      "所要時間を更新しました。"
  });

});


// =========================================
// 所要時間の計測記録取得
// =========================================

app.get("/api/time-records", (req, res) => {

  res.json(
    measurementRecords
  );

});


// =========================================
// 所要時間の計測記録保存
// =========================================

app.post("/api/time-records", (req, res) => {

  const {
    number,
    durationSeconds
  } = req.body;

  if (
    typeof number !== "number" ||
    number <= 0 ||
    typeof durationSeconds !== "number" ||
    durationSeconds < 0
  ) {
    return res.status(400).json({
      message:
        "無効な計測記録です。"
    });
  }

  measurementRecords.push({
    number,
    durationSeconds,
    timestamp: Date.now()
  });

  res.json({
    message:
      "計測記録を保存しました。"
  });

});


// =========================================
// 現在の整理券の所要時間
// =========================================

app.get("/api/current-ticket-time", (req, res) => {

  const current =
    ticketLog.find(
      t => t.number === currentNumber
    );


  res.json({

    number:
      currentNumber,

    actualMinutes:
      typeof current?.actualMinutes === "number"
        ? current.actualMinutes
        : DEFAULT_TICKET_MINUTES

  });

});


// =========================================
// 整理券発行設定取得
// =========================================

app.get("/api/ticket-settings", (req, res) => {

  const availability =
    getTicketAvailability();


  res.json({

    ...ticketSettings,

    defaultTicketMinutes:
      DEFAULT_TICKET_MINUTES,

    availability

  });

});


// =========================================
// 整理券発行設定保存
// =========================================

app.post("/api/ticket-settings", (req, res) => {

  const result =
    validateTicketSettings(
      req.body || {}
    );


  if (!result.ok) {

    return res.status(400).json({

      success:
        false,

      message:
        result.message

    });

  }


  ticketSettings =
    result.settings;


  res.json({

    success:
      true,

    message:
      "整理券の発行時間・上限を保存しました。",

    ...ticketSettings,

    defaultTicketMinutes:
      DEFAULT_TICKET_MINUTES

  });

});


// =========================================
// LINE通知
// =========================================

app.post("/api/notify", async (req, res) => {

  const {
    number,
    message
  } = req.body;


  if (
    typeof number !== "number" ||
    number <= 0
  ) {

    return res.status(400).json({
      message:
        "無効な整理券番号です。"
    });

  }


  const entry =
    ticketLog.find(
      t => t.number === number
    );


  if (!entry?.userId) {

    return res.status(404).json({
      message:
        `整理券番号 ${number} のユーザー情報が見つかりません。`
    });

  }


  try {

    await axios.post(

      LINE_PUSH_URL,

      {
        to:
          entry.userId,

        messages: [
          {
            type:
              "text",

            text:
              message ||
              `【手動通知】整理券番号 ${number} の方、まもなく順番です。`
          }
        ]
      },

      {
        headers: {
          Authorization:
            `Bearer ${LINE_ACCESS_TOKEN}`
        }
      }

    );


    res.json({
      message:
        `番号 ${number} に通知を送信しました。`
    });


  } catch (err) {

    console.error(err);

    res.status(500).json({
      message:
        "通知送信に失敗しました。"
    });

  }

});


// =========================================
// 整理券完了
// =========================================

app.post("/api/complete", (req, res) => {

  const {
    userId,
    ticketNumber
  } = req.body;


  const entry =
    ticketLog.find(
      t =>
        t.number === ticketNumber &&
        t.userId === userId
    );


  if (!entry) {

    return res.status(404).json({

      success:
        false,

      message:
        "該当整理券が見つかりません。"

    });

  }


  entry.completed =
    true;


  res.json({
    success:
      true
  });

});


// =========================================
// 再発行許可
// =========================================

app.post("/api/unlock-limit", (req, res) => {

  const {
    number
  } = req.body;


  const entry =
    ticketLog.find(
      t => t.number === number
    );


  if (!entry) {

    return res.status(404).json({

      success:
        false,

      message:
        "整理券が見つかりません。"

    });

  }


  entry.limitUnlockCount =
    1;


  res.json({

    success:
      true,

    message:
      `番号 ${number} を1回再発行可能にしました`

  });

});


// =========================================
// 再発行可能か確認
// =========================================

app.post("/api/check-unlock", (req, res) => {

  const {
    userId
  } = req.body;


  const entry =
    ticketLog
      .slice()
      .reverse()
      .find(
        t => t.userId === userId
      );


  res.json({

    unlocked:
      (entry?.limitUnlockCount || 0) > 0

  });

});


// =========================================
// 整理券番号から再発行可能か確認
// =========================================

app.post("/api/check-unlock-by-number", (req, res) => {

  const {
    number
  } = req.body;


  const entry =
    ticketLog.find(
      t => t.number === number
    );


  res.json({

    unlocked:
      (entry?.limitUnlockCount || 0) > 0

  });

});


// =========================================
// すべてリセット
// =========================================

app.post("/api/reset", (req, res) => {

  // 呼び出し番号を初期化
  currentNumber = 0;


  // 整理券番号を1番からに戻す
  currentTicket = 1;


  // 発行ログを削除
  ticketLog = [];

  // 所要時間の計測記録も削除
  measurementRecords = [];


  // 手動の発行停止状態を解除
  isTicketingClosed = false;


  // =====================================
  // 整理券の発行時間・時間帯ごとの
  // 発行枚数上限も初期状態へ戻す
  // =====================================

  ticketSettings = {

    start:
      "09:30",

    end:
      "13:00",

    slots:
      []

  };


  // リセット通知用フラグ
  resetFlag =
    true;


  res.json({

    message:
      "呼び出し番号と整理券番号、発行ログ、発行時間・上限設定をリセットしました。",

    ticketSettings

  });

});


// =========================================
// リセット状態確認
// =========================================

app.get("/api/reset-status", (req, res) => {

  res.json({

    reset:
      resetFlag

  });


  if (resetFlag) {

    resetFlag =
      false;

  }

});


// =========================================
// 整理券発行状態
// =========================================

app.get("/api/ticketing-status", (req, res) => {

  const availability =
    getTicketAvailability();


  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );


  res.json({

    closed:
      isTicketingClosed,

    preparing,

    ...availability

  });

});


// =========================================
// 整理券発行停止
// =========================================

app.post("/api/close-ticketing", (req, res) => {

  isTicketingClosed =
    true;


  res.json({

    message:
      "本日の新規整理券発行を終了しました。"

  });

});


// =========================================
// 整理券発行再開
// =========================================

app.post("/api/open-ticketing", (req, res) => {

  isTicketingClosed =
    false;


  res.json({

    message:
      "本日の新規整理券発行を再開しました。"

  });

});


// =========================================
// TOP
// =========================================

app.get("/", (req, res) => {

  res.redirect(
    "/ticket.html"
  );

});


// =========================================
// 準備中モード取得
// =========================================

app.get("/api/preparation-mode", (req, res) => {

  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );


  res.json({

    preparing

  });

});


// =========================================
// 準備中モード変更
// =========================================

app.post("/api/preparation-mode", (req, res) => {

  if (
    typeof req.body.preparing !== "boolean"
  ) {

    return res.status(400).json({

      success:
        false,

      message:
        "準備中モードの設定が正しくありません。"

    });

  }


  preparing =
    req.body.preparing;


  res.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );


  res.json({

    success:
      true,

    preparing,

    message:
      preparing
        ? "準備中モードにしました"
        : "受付を開始しました"

  });

});


// =========================================
// サーバー起動
// =========================================

const port =
  process.env.PORT || 3000;


app.listen(
  port,
  () =>
    console.log(
      `✅ Server running on port ${port}`
    )
);
