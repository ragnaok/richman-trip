ALTER TABLE plans ADD COLUMN sort_order REAL NOT NULL DEFAULT 0;
-- 既有列補值：有時間的算成分鐘數（跟往後 client 端存檔的算法一致），未定時間
-- 給一個大於任何分鐘數的值（1440），沿用「未定項目一律排最後」的舊行為當初始值，
-- 之後使用者拖曳過才會改成真正代表順序的浮點數。
UPDATE plans SET sort_order = CASE
  WHEN t GLOB '[0-9][0-9]:[0-9][0-9]' THEN CAST(substr(t,1,2) AS INTEGER) * 60 + CAST(substr(t,4,2) AS INTEGER)
  WHEN t GLOB '[0-9]:[0-9][0-9]' THEN CAST(substr(t,1,1) AS INTEGER) * 60 + CAST(substr(t,3,2) AS INTEGER)
  ELSE 1440
END;
