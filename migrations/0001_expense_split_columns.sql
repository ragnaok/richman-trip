-- 對應 schema.sql 的 expenses 表新增 payers/split_among/split_amounts 三欄
-- （記帳支援多付款人與自訂分攤對象/金額，見 PR #20）。
-- 只能 ADD COLUMN，不能 DROP／改型別——正式環境的既有資料不能破壞。
ALTER TABLE expenses ADD COLUMN payers TEXT;
ALTER TABLE expenses ADD COLUMN split_among TEXT;
ALTER TABLE expenses ADD COLUMN split_amounts TEXT;
