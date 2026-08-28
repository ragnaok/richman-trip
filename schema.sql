CREATE TABLE members (                                      -- 身分（可管理的動態清單）
  role TEXT PRIMARY KEY,                                    -- 自然鍵；改名＝墓碑舊列＋新增新列
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);  -- 墓碑刪除，跟 cats 表同一套做法
CREATE TABLE plans (                                        -- 每日行程
  id TEXT PRIMARY KEY, day TEXT NOT NULL,                   -- '9/3'
  t TEXT NOT NULL,                                          -- '09:00' 或 '—'
  title TEXT NOT NULL, sub TEXT DEFAULT '',                 -- sub 可含換行（多行備註）
  kind TEXT NOT NULL,                                       -- f/r/c/s/e/h/p
  q TEXT DEFAULT '', spot TEXT, cands TEXT,                 -- cands 存 JSON 陣列字串
  drive TEXT, park TEXT,
  notify INTEGER DEFAULT 0, lead INTEGER DEFAULT 30,        -- 逐筆提醒開關 + 提前分鐘數
  remind_at TEXT,                                           -- 指定提醒時間（'YYYY-MM-DDTHH:MM'，JST）；有值時取代 day+t-lead 的相對算法
  photo TEXT,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);
CREATE INDEX plans_upd ON plans(updated_at);
CREATE TABLE spots_meta (                                   -- 景點個人化資料
  id TEXT PRIMARY KEY,                                      -- = spot id
  visited INTEGER DEFAULT 0, note TEXT DEFAULT '', photo TEXT,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);
CREATE TABLE spots (                                        -- 使用者新增的景點（種子景點不在這張表）
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, jp TEXT DEFAULT '', area TEXT DEFAULT '',
  teaser TEXT DEFAULT '', intro TEXT DEFAULT '',
  hours TEXT DEFAULT '', fee TEXT DEFAULT '', access TEXT DEFAULT '',
  walk TEXT DEFAULT '[]', food TEXT DEFAULT '[]',           -- 皆存 JSON 陣列字串
  q TEXT DEFAULT '',                                        -- 導航關鍵字
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);
CREATE INDEX spots_upd ON spots(updated_at);
CREATE TABLE pack_items (
  id TEXT PRIMARY KEY, cat TEXT NOT NULL, name TEXT NOT NULL,
  owner TEXT NOT NULL,                                      -- '共同' 或 members.role
  done INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);
CREATE TABLE expenses (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, cat TEXT NOT NULL,
  cur TEXT NOT NULL CHECK (cur IN ('JPY','TWD')), amt REAL NOT NULL,
  payer TEXT NOT NULL, method TEXT,                         -- 'cash'/'card'，NULL 視同現金
  daigou INTEGER DEFAULT 0,                                 -- 代購：不計入「不含代購」統計
  spent_on TEXT,                                            -- 日期 '9/3'
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);
CREATE TABLE cats (kind TEXT, name TEXT, updated_at INTEGER, deleted INTEGER DEFAULT 0, PRIMARY KEY(kind,name));
                                                            -- kind='money'/'pack'（使用者自建分類）
                                                            -- deleted：分類管理面板刪除/改名用的墓碑列
CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT, updated_at INTEGER);   -- 匯率等共用設定
CREATE TABLE hotels (                                       -- 設定頁「住宿地點」
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL, q TEXT DEFAULT '',
  checkin TEXT DEFAULT '', checkout TEXT DEFAULT '',        -- 'YYYY-MM-DD'
  lat REAL, lon REAL,                                       -- 天氣用座標，見 lib/types.ts StoredHotel 註解
  updated_at INTEGER NOT NULL, deleted INTEGER DEFAULT 0);
CREATE TABLE push_subs (                                     -- Web Push 訂閱
  endpoint TEXT PRIMARY KEY, role TEXT NOT NULL,
  p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER);
CREATE TABLE reminders (                                     -- 已排定/已送出的提醒
  plan_id TEXT PRIMARY KEY, fire_at INTEGER NOT NULL,        -- UTC ms
  sent_at INTEGER);
CREATE INDEX reminders_fire ON reminders(fire_at, sent_at);
