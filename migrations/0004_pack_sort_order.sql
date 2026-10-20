ALTER TABLE pack_items ADD COLUMN sort_order REAL;
ALTER TABLE cats ADD COLUMN sort_order REAL;
-- 既有項目補值：rowid 是插入順序，是目前最接近「新增時間」的訊號（updated_at 會被打勾改掉）。
-- 數值遠小於往後新增項目用的 Date.now()，所以舊項目一律排在新項目前面。
-- 同時把 updated_at 設成套用當下：pull 只看 updated_at，不動的話已經同步過的裝置永遠
-- 拿不到補好的 sort_order，各自在本機算出不一致的舊順序。
UPDATE pack_items SET
  sort_order = rowid,
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000;
