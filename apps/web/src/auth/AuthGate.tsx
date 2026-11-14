import type { ReactNode } from 'react'
import { LoginPage } from './LoginPage.tsx'
import { useMe } from './useAuth.ts'

/** Shows the app only with a session; otherwise the login screen. */
export function AuthGate({ children }: { children: ReactNode }) {
  const me = useMe()
  if (me.isPending) return <div className="min-h-dvh bg-background" aria-busy="true" />
  if (me.isError) {
    return (
      <main className="grid min-h-dvh place-items-center p-6 text-center">
        <p role="alert">Couldn’t reach the server. Reload to try again.</p>
      </main>
    )
  }
  return me.data ? children : <LoginPage />
}
