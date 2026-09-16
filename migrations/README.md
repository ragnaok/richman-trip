# D1 schema migrations

改 `schema.sql` 的表結構時（`ALTER TABLE ... ADD COLUMN`／`CREATE TABLE IF NOT EXISTS`），同時在這裡加一個新檔案：

```
migrations/000N_簡短描述.sql
```

編號往後接，檔名一旦進版控就不要再改（`deploy-trip.sh` 靠檔名判斷「這個有沒有套用過」，改檔名等於變成一個新的、還沒套用的 migration）。內容只能用不破壞既有資料的寫法——不要 `DROP`、不要改欄位型別，理由跟 `schema.sql` 本身的限制一樣（見 [CLAUDE.md](../CLAUDE.md)）。

`scripts/trip-cli/deploy-trip.sh` 每次部署既有行程時，會先無條件備份一次正式環境 D1（不管這次有沒有新 migration），再依檔名順序套用還沒套用過的檔案，套用結果記在該 D1 自己的 `_migrations` 表裡（`name`/`applied_at`），下次部署會跳過已經套用過的。`scripts/trip-cli/new-trip.sh` 建新行程時直接整份灌 `schema.sql`（已經包含所有 migration 的最終結果），灌完會把當下 `migrations/` 底下所有檔案都標記成「已套用」，避免新行程還要重跑一次已經在 `schema.sql` 裡的異動。

改完 `schema.sql` 之後別忘了：這裡的 migration 檔案是「怎麼從舊 schema 追上新 schema」，`schema.sql` 本身要保持是「從零開始建表」的完整終態，兩份要互相對得上。
