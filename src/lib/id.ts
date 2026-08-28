// 產生客戶端 UUID 當 id，避免多裝置撞號。種子資料沿用它自己原本的 id。
export function genId(): string {
  return crypto.randomUUID()
}
