/** "⌘B" on Apple platforms, "Ctrl B" elsewhere; both shortcuts work everywhere. */
export const sidebarShortcutLabel = () =>
  /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘B' : 'Ctrl B'
