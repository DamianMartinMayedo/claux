'use client'

import { ToastProvider } from '@/app/contexts/ToastContext'

export default function PortalToastWrapper({ children }: { children: React.ReactNode }) {
  return <ToastProvider>{children}</ToastProvider>
}
