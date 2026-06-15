'use client'

import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

interface Toast {
  id: number
  type: ToastType
  message: string
  exiting: boolean
}

interface LoadingToast {
  id: number
  dismiss: () => Promise<void>
}

interface ToastContextType {
  success: (message: string) => void
  error:   (message: string) => void
  warning: (message: string) => void
  info:    (message: string) => void
  loading: (message: string) => LoadingToast
}

const ToastContext = createContext<ToastContextType | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<number, NodeJS.Timeout>>(new Map())

  const removeToast = useCallback((id: number): Promise<void> => {
    return new Promise(resolve => {
      const t = timersRef.current.get(id)
      if (t) clearTimeout(t)
      setToasts(prev => prev.map(to => to.id === id ? { ...to, exiting: true } : to))
      setTimeout(() => {
        setToasts(prev => prev.filter(to => to.id !== id))
        resolve()
      }, 250) // 250ms = duración de toast-out
    })
  }, [])

  const addToast = useCallback((type: ToastType, message: string, autoHide = true) => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, type, message, exiting: false }])

    if (autoHide) {
      const duration = (type === 'error' || type === 'warning') ? 5000 : 2000
      setTimeout(() => removeToast(id), duration)
    }

    return id
  }, [removeToast])

  const toast: ToastContextType = {
    success: (msg: string) => addToast('success', msg),
    error:   (msg: string) => addToast('error', msg),
    warning: (msg: string) => addToast('warning', msg),
    info:    (msg: string) => addToast('info', msg),
    loading: (msg: string) => {
      const id = addToast('loading', msg, false)
      return { id, dismiss: () => removeToast(id) }
    },
  }

  function dismissToast(id: number) { removeToast(id) }

  const Spinner = () => (
    <svg className="toast-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <circle cx="12" cy="12" r="10" strokeOpacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round" />
    </svg>
  )

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {typeof window !== 'undefined' && toasts.length > 0 && createPortal(
        <div className="toast-container" aria-live="polite">
          {toasts.map(t => (
            <div
              key={t.id}
              className={`toast-alert toast-${t.type}${t.exiting ? ' toast-exit' : ''}`}
              onClick={() => dismissToast(t.id)}
              role="alert"
            >
              {t.type === 'loading' && <Spinner />}
              <span className="toast-message">{t.message}</span>
            </div>
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextType {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast debe usarse dentro de <ToastProvider>')
  return ctx
}
