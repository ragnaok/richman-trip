import type { ComponentType } from 'react'
import { CalendarDots, Coins, MapTrifold, SuitcaseRolling, type IconProps } from '@phosphor-icons/react'
import type { TabId } from '../App'

const TABS: { id: TabId; label: string; Icon: ComponentType<IconProps> }[] = [
  { id: 'itinerary', label: '行程', Icon: CalendarDots },
  { id: 'spots', label: '景點', Icon: MapTrifold },
  { id: 'pack', label: '行李', Icon: SuitcaseRolling },
  { id: 'money', label: '記帳', Icon: Coins },
]

export default function TabBar({
  active,
  onChange,
}: {
  active: TabId
  onChange: (id: TabId) => void
}) {
  return (
    <nav className="tab-bar">
      {TABS.map(({ id, label, Icon }) => {
        const selected = id === active
        return (
          <button
            key={id}
            type="button"
            className={`tab-bar-item${selected ? ' is-active' : ''}`}
            onClick={() => onChange(id)}
            aria-current={selected ? 'page' : undefined}
          >
            <Icon size={21} weight="duotone" />
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
