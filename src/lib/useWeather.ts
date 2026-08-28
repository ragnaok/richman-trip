// 天氣 hook：訂閱 lib/weather.ts 的模組層級狀態（/api/weather + IDB 快取 + fallback 鏈），
// 對外只回 WeatherInfo。
import { useEffect, useState } from 'react'
import { getWeatherSnapshot, subscribeWeather, refreshWeather, type WeatherInfo } from './weather'

export type { WeatherInfo }

// 模組層級旗標：只在第一次掛載時自動抓一次，tab 切換的 remount 與 StrictMode 雙重
// 呼叫都不會重複打 API。下拉更新走 refreshWeather()，不受此旗標影響。
let started = false

export function useWeather(day: string): WeatherInfo {
  const [info, setInfo] = useState(() => getWeatherSnapshot(day))

  useEffect(() => {
    setInfo(getWeatherSnapshot(day))
    const unsubscribe = subscribeWeather(() => setInfo(getWeatherSnapshot(day)))
    if (!started) {
      started = true
      void refreshWeather()
    }
    return unsubscribe
  }, [day])

  return info
}
