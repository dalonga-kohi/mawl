import './styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { createApi } from './api/create-api.ts'
import { createAppRouter } from './router.tsx'

const container = document.getElementById('root')
if (!container) throw new Error('index.html is missing #root')

createRoot(container).render(
  <StrictMode>
    <App router={createAppRouter()} api={createApi()} />
  </StrictMode>,
)
