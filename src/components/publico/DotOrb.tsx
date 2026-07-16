'use client'

// Fondo interactivo de canvas: cuadrícula de puntos que se ondulan bajo el
// cursor (desktop) o se animan solos (móvil), con halo radial que revela los
// puntos cerca del foco. Decorativo (aria-hidden), no bloquea clics ni scroll.
// Adaptado a CLAUX: tema por prefers-color-scheme y colores desde los tokens
// (--color-bg / --color-primary). No se monta con prefers-reduced-motion.
import { useEffect, useRef } from 'react'

const COLS = 80
const ROWS_DESKTOP = 60
const ROWS_MOBILE = 30
const DOT_RADIUS = 2
const LERP_SPEED = 0.1
const WAVE_FREQUENCY = 3.0
const PHASE_PER_ROW = 0.15
const FOCUS_RADIUS = 0.3
const MAX_AMPLITUDE = 0.04
const FADE_RADIUS_FACTOR = 0.75
const HALO_MIX = 0.5 // mezcla del ámbar de marca hacia el fondo (más alto = más sutil)
const OPACITY = 0.72 // opacidad global de los puntos (más bajo = más sutil)

type Rgb = [number, number, number]

function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full || '000000', 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function mix(a: Rgb, b: Rgb, t: number): string {
  const m = (i: number) => Math.round(a[i] + (b[i] - a[i]) * t)
  return `${m(0)}, ${m(1)}, ${m(2)}`
}

// El .trim() no es cosmético: los tokens se declaran con light-dark(), y el
// compilador lo baja a un truco de dos variables que deja un espacio pegado al
// valor computado. Sin trim, hexToRgb recibe " #f59e0b" y no parsea.
function getThemeColors() {
  const cs = getComputedStyle(document.documentElement)
  const bg = hexToRgb(cs.getPropertyValue('--color-bg').trim() || '#F5F4EF')
  const amber = hexToRgb(cs.getPropertyValue('--color-amber').trim() || '#F59E0B')
  return {
    bgRgb: `${bg[0]}, ${bg[1]}, ${bg[2]}`,
    haloRgb: mix(amber, bg, HALO_MIX),
  }
}

export function DotOrb() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: true })
    if (!ctx) return

    const isAmbient =
      window.matchMedia('(hover: none)').matches ||
      window.matchMedia('(pointer: coarse)').matches ||
      window.innerWidth < 768

    const ROWS = isAmbient ? ROWS_MOBILE : ROWS_DESKTOP
    let colors = getThemeColors()

    let tx = isAmbient ? 0.5 : 2
    let ty = isAmbient ? 0.5 : 2
    let mx = tx
    let my = ty
    let raf = 0
    let lastFrameTime = 0

    function resize() {
      const rect = canvas!.parentElement!.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      canvas!.width = rect.width * dpr
      canvas!.height = rect.height * dpr
      canvas!.style.width = `${rect.width}px`
      canvas!.style.height = `${rect.height}px`
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    function onMove(e: MouseEvent) {
      const rect = canvas!.parentElement!.getBoundingClientRect()
      tx = (e.clientX - rect.left) / rect.width
      ty = (e.clientY - rect.top) / rect.height
    }

    function onLeave() {
      tx = 2
      ty = 2
    }

    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onTheme = () => {
      colors = getThemeColors()
    }
    mql.addEventListener('change', onTheme)

    function draw(timestamp: number) {
      raf = requestAnimationFrame(draw)
      if (timestamp - lastFrameTime < 16) return
      lastFrameTime = timestamp

      const dpr = window.devicePixelRatio || 1
      const width = canvas!.width / dpr
      const height = canvas!.height / dpr

      if (isAmbient) {
        mx = 0.5 + 0.35 * Math.sin(timestamp * 0.0003)
        my = 0.5 + 0.35 * Math.cos(timestamp * 0.0005)
      } else {
        mx += (tx - mx) * LERP_SPEED
        my += (ty - my) * LERP_SPEED
      }

      const focusR2 = FOCUS_RADIUS * FOCUS_RADIUS

      ctx!.clearRect(0, 0, width, height)

      const cx = mx * width
      const cy = my * height
      const fadeRadius = FADE_RADIUS_FACTOR * Math.min(width, height)
      const gradient = ctx!.createRadialGradient(cx, cy, 0, cx, cy, fadeRadius)
      gradient.addColorStop(0, `rgba(${colors.haloRgb}, 1)`)
      gradient.addColorStop(0.45, `rgba(${colors.bgRgb}, 1)`)
      gradient.addColorStop(1, `rgba(${colors.bgRgb}, 0)`)

      for (let r = 0; r < ROWS; r++) {
        const yBase = (r + 0.5) / ROWS
        for (let c = 0; c < COLS; c++) {
          const xNorm = c / (COLS - 1)
          const dx = mx - xNorm
          const dy = my - yBase
          const dist2 = dx * dx + dy * dy

          let offsetY = 0
          let alpha = 0
          if (dist2 < focusR2) {
            const dist = Math.sqrt(dist2)
            const bell = 0.5 + 0.5 * Math.cos((dist / FOCUS_RADIUS) * Math.PI)
            const wave = Math.sin(xNorm * WAVE_FREQUENCY * Math.PI * 2 + r * PHASE_PER_ROW)
            offsetY = wave * bell * MAX_AMPLITUDE * height
            alpha = bell
          }

          const x = xNorm * width
          const y = yBase * height + offsetY

          ctx!.beginPath()
          ctx!.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
          ctx!.fillStyle = gradient
          ctx!.globalAlpha = (0.3 + alpha * 0.7) * OPACITY
          ctx!.fill()
          ctx!.globalAlpha = 1
        }
      }
    }

    resize()
    window.addEventListener('resize', resize)
    // iOS Safari: la barra dinámica cambia el viewport sin disparar siempre
    // window.resize → re-sincronizamos el canvas con visualViewport.
    window.visualViewport?.addEventListener('resize', resize)
    if (!isAmbient) {
      window.addEventListener('mousemove', onMove, { passive: true })
      document.addEventListener('mouseleave', onLeave)
    }
    raf = requestAnimationFrame(draw)

    return () => {
      window.removeEventListener('resize', resize)
      window.visualViewport?.removeEventListener('resize', resize)
      if (!isAmbient) {
        window.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseleave', onLeave)
      }
      mql.removeEventListener('change', onTheme)
      cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div className="dotorb-wrap" aria-hidden="true">
      <canvas ref={canvasRef} className="dotorb-canvas" />
    </div>
  )
}
