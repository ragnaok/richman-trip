-- 修正 0002 的 bug：未定項目全部補成同一個常數 1440，同一天有兩筆以上未定行程
-- 時會撞值。拖曳排序取前後鄰居中間值，兩個鄰居都是 1440、被拖的那筆自己也是
-- 1440，算出來的新值跟舊值完全相同，會被「沒有真的變動就不寫」的判斷擋下，
-- 存檔被跳過，使用者看到的現象是「同樣沒時間的行程之間完全拖不動」。
--
-- 只處理「現在還撞值」的那些列（同一天、sort_order 相同的一組），依既有列順序
-- （rowid）給遞增的極小偏移量打散；已經被使用者拖曳過、值已經不撞的列不會被動到，
-- 不會蓋掉使用者已經排好的順序。
--
-- 用 CTE 先把每一列的偏移量算好、存成獨立的 ranked 結果集，UPDATE 只查表不改表，
-- 不要在 UPDATE 裡直接用「跟自己同一張表比對現在的 sort_order」這種寫法——同一筆
-- UPDATE 陳述式裡，後面列的子查詢可能已經讀到前面列剛寫入的新值，導致算出來的
-- 偏移量互相撞在一起（實測過會這樣）。
--
-- 順便更新 updated_at：這是在修一個「完全拖不動」的功能性 bug，值得讓已經同步過
-- 的裝置重新 pull 到新值（單純改 sort_order、不動 updated_at 的話，pull.ts 用
-- updated_at > since 篩選，已經同步過的裝置永遠不會再拉到這批修正）。
WITH ranked AS (
  SELECT rowid AS rid,
    ROW_NUMBER() OVER (PARTITION BY day, sort_order ORDER BY rowid) - 1 AS rn,
    COUNT(*) OVER (PARTITION BY day, sort_order) AS grp_count
  FROM plans
)
UPDATE plans SET
  sort_order = sort_order + 0.001 * (SELECT rn FROM ranked WHERE ranked.rid = plans.rowid),
  updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE rowid IN (SELECT rid FROM ranked WHERE grp_count > 1);
