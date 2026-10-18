import {
  Activity,
  BookOpen,
  CircleCheck,
  type LucideIcon,
  MessageCircle,
  Plug,
  Repeat,
  SlidersHorizontal,
} from 'lucide-react'

export interface NavItem {
  to: '/t' | '/activity' | '/approvals' | '/memory' | '/routines' | '/connections' | '/settings'
  label: string
  icon: LucideIcon
  /** Extra words the command palette matches on. */
  keywords: string[]
}

/** Rail order from DESIGN.md §5; Settings sits apart at the bottom of the rail. */
export const MAIN_NAV: NavItem[] = [
  {
    to: '/t',
    label: 'Teammates',
    icon: MessageCircle,
    keywords: ['chat', 'conversations', 'home'],
  },
  { to: '/activity', label: 'Activity', icon: Activity, keywords: ['feed', 'history', 'log'] },
  { to: '/approvals', label: 'Approvals', icon: CircleCheck, keywords: ['inbox', 'decisions'] },
  { to: '/memory', label: 'Memory', icon: BookOpen, keywords: ['facts', 'remember'] },
  { to: '/routines', label: 'Routines', icon: Repeat, keywords: ['schedule', 'recurring'] },
]

export const SETTINGS_NAV: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: SlidersHorizontal,
  keywords: ['preferences', 'appearance', 'models', 'keys'],
}

/** Reached from Settings and the palette; not a rail item. */
export const CONNECTIONS_NAV: NavItem = {
  to: '/connections',
  label: 'Connections',
  icon: Plug,
  keywords: ['apps', 'integrations', 'mcp'],
}

export const ALL_NAV: NavItem[] = [...MAIN_NAV, CONNECTIONS_NAV, SETTINGS_NAV]
