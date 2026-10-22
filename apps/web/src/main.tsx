import './styles.css'
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { createApi } from './api/create-api.ts'
import { applyAppearance, loadAppearance } from './appearance/prefs.ts'
import { OwnerTokenGate } from './auth/OwnerTokenGate.tsx'
import { launchToken, sessionStore, verifyToken } from './auth/token.ts'
import { createAppRouter } from './router.tsx'

const container = document.getElementById('root')
if (!container) throw new Error('index.html is missing #root')

// The token gate renders before AppearanceProvider: give it the saved theme and accent too.
try {
  applyAppearance(document.documentElement, loadAppearance(window.localStorage))
} catch {
  // No storage: the stylesheet's defaults apply.
}

/** The app for one accepted token; its api (and socket) and router are made once. */
function AuthedApp({ token }: { token: string }) {
  const [api] = useState(() => createApi(token))
  const [router] = useState(() => createAppRouter())
  return <App router={router} api={api} />
}

const origin = window.location.origin
const launch = launchToken(window)

createRoot(container).render(
  <StrictMode>
    <OwnerTokenGate
      {...(launch ? { launch } : {})}
      storage={sessionStore()}
      verify={(token) => verifyToken(token, { origin })}
    >
      {(token) => <AuthedApp token={token} />}
    </OwnerTokenGate>
  </StrictMode>,
)
