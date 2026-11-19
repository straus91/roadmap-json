import { Component, StrictMode } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

/** If something unexpected breaks, say so and keep the work, instead of a blank page. */
class Safety extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="page">
        <h1>ROADMAP Card Creator</h1>
        <p className="banner bad">
          Something went wrong on this page. Your card is still saved in this browser: reload, then choose “Continue”.
        </p>
        <button type="button" className="primary" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Safety>
      <App />
    </Safety>
  </StrictMode>,
)
