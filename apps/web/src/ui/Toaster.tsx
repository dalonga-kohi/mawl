import { Toaster as Sonner, type ToasterProps } from 'sonner'

/**
 * Sonner, unstyled and dressed in Mawl tokens: a quiet ink pill at the bottom center (DESIGN §9).
 * It sits above the composer and the phone tab bar, so a toast never covers what you type.
 */
export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={96}
      mobileOffset={136}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'flex items-center gap-2 rounded-pill bg-text px-4 py-2.5 text-small text-bg shadow-2',
        },
      }}
      {...props}
    />
  )
}
