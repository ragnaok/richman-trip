// 種子資料把圖示存成 Phosphor 的 kebab-case class 名（'ph-cloud-sun'），但
// @phosphor-icons/react 是 PascalCase 具名匯出（CloudSun），這裡做字串 → 元件的對照。
//
// 刻意不用 `import * as PhosphorIcons` 整包查表：barrel 檔會靜態 import 全部 1000+ 個
// 圖示且無法 tree-shake（實測主 chunk 膨脹到 5MB+）。所以只 import 實際用得到的。
//
// 這份列表是 seed.json（kind/catIcon）+ lib/weather.ts 用到的圖示的窮舉。之後新增
// 圖示要一併補 import 與對照項，否則 phosphorIcon() 會回 undefined（開發模式有 warn）。
import {
  AirplaneTilt,
  Bed,
  BowlFood,
  CarProfile,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Handbag,
  MapPinArea,
  Receipt,
  ShoppingBag,
  Sun,
  Ticket,
  TrainRegional,
} from '@phosphor-icons/react'
import type { ComponentType } from 'react'
import type { IconProps } from '@phosphor-icons/react'

const ICON_MAP: Record<string, ComponentType<IconProps>> = {
  AirplaneTilt,
  Bed,
  BowlFood,
  CarProfile,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Handbag,
  MapPinArea,
  Receipt,
  ShoppingBag,
  Sun,
  Ticket,
  TrainRegional,
}

function kebabToPascal(name: string): string {
  const key = name.replace(/^ph-/, '')
  return key
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** 'ph-cloud-sun' → CloudSun 元件；查不到回傳 undefined，呼叫端自行決定 fallback。 */
export function phosphorIcon(name: string): ComponentType<IconProps> | undefined {
  const pascalName = kebabToPascal(name)
  const icon = ICON_MAP[pascalName]
  if (!icon && import.meta.env.DEV) {
    console.warn(`phosphorIcon: 找不到「${name}」對應的圖示，記得在 lib/icons.ts 補上 import`)
  }
  return icon
}
