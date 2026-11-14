import { useNavDrawer } from '../layout/useNavDrawer.ts'
import { cn } from '../lib/cn.ts'
import { Icon } from './Icon.tsx'
import { Button } from './ui/button.tsx'

/** Opens the navigation drawer. Hidden once the sidebar is permanent (`large`). */
export function MenuButton({ className }: { className?: string }) {
  const { setOpen } = useNavDrawer()
  return (
    <Button
      variant="text"
      size="icon"
      aria-label="Open menu"
      className={cn('large:hidden', className)}
      onClick={() => setOpen(true)}
    >
      <Icon name="menu" />
    </Button>
  )
}
