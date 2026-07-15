// ── Paleta del dossier — lógica pura, sin I/O ───────────────────────────────
//
// De UN color principal (el que elige el dueño) deriva la paleta entera del
// deck y GARANTIZA el contraste, no lo aproxima: si el texto no llega a 4.5:1
// sobre el principal, desplaza su luminosidad hasta que uno de los dos colores
// de texto (blanco / neutro oscuro) pase. El dueño elige un color; el sistema
// devuelve el más cercano que sea legible. Sin esto, un dueño de mal gusto
// publicaría un deck ilegible.
//
// La comparten portal, página pública y PDF: por eso vive aquí, pura y testeable.
// (El `CSSProperties` de `paletaVars` es import de TIPO: se borra al compilar y no
// arrastra React ni peso a quien solo use el cálculo de color.)

import type { CSSProperties } from 'react'

export interface PaletaDossier {
  /** El color del dueño, posiblemente ajustado en luminosidad para ser legible. */
  principal: string
  /** Color de texto legible SOBRE `principal` (blanco o neutro oscuro). ≥ 4.5:1. */
  principalTexto: string
  /** Análogo (rotación de tono +28°): acentos secundarios. */
  acento: string
  /** Superficie muy clara del mismo tono (fondos de sección). */
  superficie: string
  /** Borde suave del mismo tono. */
  borde: string
  /** Neutro oscuro para texto de cuerpo sobre superficie clara. */
  neutro: string
}

const TEAL_MARCA = '#00AFAA'          // fallback (= --color-primary)
const BLANCO = '#FFFFFF'
const NEUTRO_OSCURO = '#141719'       // carbón cálido para texto
const OBJETIVO_CONTRASTE = 4.5        // WCAG AA texto normal

interface Rgb { r: number; g: number; b: number }
interface Hsl { h: number; s: number; l: number }

// ── Conversión de color ──────────────────────────────────────────────────────

/** Normaliza cualquier entrada a `#RRGGBB` en mayúsculas. Entrada inválida → teal de marca. */
export function normalizarHex(raw: string): string {
  if (typeof raw !== 'string') return TEAL_MARCA
  let s = raw.trim().replace(/^#/, '')
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s.split('').map(c => c + c).join('')   // #abc → #aabbcc
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return TEAL_MARCA
  return '#' + s.toUpperCase()
}

function hexToRgb(hex: string): Rgb {
  const s = normalizarHex(hex).slice(1)
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  }
}

function rgbToHex({ r, g, b }: Rgb): string {
  const h = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0')
  return ('#' + h(r) + h(g) + h(b)).toUpperCase()
}

function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255, gn = g / 255, bn = b / 255
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  return { h, s, l }
}

function hslToRgb({ h, s, l }: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  let r = 0, g = 0, b = 0
  if (hp < 1) { r = c; g = x }
  else if (hp < 2) { r = x; g = c }
  else if (hp < 3) { g = c; b = x }
  else if (hp < 4) { g = x; b = c }
  else if (hp < 5) { r = x; b = c }
  else { r = c; b = x }
  const m = l - c / 2
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

// ── Contraste WCAG ─────────────────────────────────────────────────────────────

function luminanciaRelativa({ r, g, b }: Rgb): number {
  const canal = (v: number) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}

function contrasteRgb(a: Rgb, b: Rgb): number {
  const la = luminanciaRelativa(a), lb = luminanciaRelativa(b)
  const claro = Math.max(la, lb), oscuro = Math.min(la, lb)
  return (claro + 0.05) / (oscuro + 0.05)
}

/** Ratio de contraste WCAG (1..21) entre dos colores hex. */
export function contraste(a: string, b: string): number {
  return contrasteRgb(hexToRgb(a), hexToRgb(b))
}

// ── Ajuste del principal para legibilidad ──────────────────────────────────────

// Umbral de luminancia por encima del cual un color es "claro" (amarillo, ámbar,
// pasteles): esos llevan texto OSCURO — oscurecerlos para meter texto blanco los
// ensuciaría. Por debajo, preferimos texto BLANCO sobre el color (look de deck).
const LUM_CLARO = 0.4

/**
 * Elige el color final y su color de texto, GARANTIZANDO ≥ 4.5:1. Sesgo de deck:
 *  · Color claro con texto oscuro ya legible → déjalo, texto oscuro.
 *  · El resto → texto BLANCO, oscureciendo el tono lo justo hasta que el blanco
 *    pase (bajar L sube el contraste con blanco de forma monótona: basta buscar
 *    hacia abajo). Mantiene el tono y sube el contraste; nada de dark-on-teal.
 * Se mide siempre sobre el hex ya REDONDEADO —el color que se pinta de verdad—;
 * validar el float de `hslToRgb` dejaría colar un 4.49 real como si fuera 4.5.
 */
function ajustarPrincipal(hsl: Hsl): { principal: string; texto: string } {
  const wRgb = hexToRgb(BLANCO)
  const nRgb = hexToRgb(NEUTRO_OSCURO)
  const hexEn = (l: number) => rgbToHex(hslToRgb({ h: hsl.h, s: hsl.s, l: clamp(l, 0, 1) }))

  const baseHex = hexEn(hsl.l)
  const baseRgb = hexToRgb(baseHex)

  if (luminanciaRelativa(baseRgb) >= LUM_CLARO && contrasteRgb(baseRgb, nRgb) >= OBJETIVO_CONTRASTE) {
    return { principal: baseHex, texto: NEUTRO_OSCURO }
  }

  for (let paso = 0; paso <= 30; paso++) {
    const hex = hexEn(hsl.l - paso * 0.03)
    if (contrasteRgb(hexToRgb(hex), wRgb) >= OBJETIVO_CONTRASTE) {
      return { principal: hex, texto: BLANCO }
    }
  }
  // Inalcanzable: negro puro da 21:1 con blanco.
  return { principal: hexEn(0), texto: BLANCO }
}

// ── API pública ────────────────────────────────────────────────────────────────

/**
 * La paleta como custom properties, para aplicar a UN wrapper. Es la única
 * excepción al no-inline de la skill de UI (§1): un valor que solo se conoce en
 * runtime — aquí, el color que eligió el dueño. El CSS consume `var(--do-*)` y
 * define sus propios fallbacks; ninguna regla lleva el color escrito.
 * Mismo patrón que `empresaColorVar`. La comparten el preview del portal y el deck.
 */
export function paletaVars(p: PaletaDossier): CSSProperties {
  return {
    '--do-principal': p.principal,
    '--do-principal-texto': p.principalTexto,
    '--do-acento': p.acento,
    '--do-superficie': p.superficie,
    '--do-borde': p.borde,
    '--do-neutro': p.neutro,
  } as CSSProperties
}

/** Deriva la paleta completa del deck de un solo color principal, con contraste garantizado. */
export function derivarPaleta(hex: string): PaletaDossier {
  const base = rgbToHsl(hexToRgb(normalizarHex(hex)))
  const { principal, texto } = ajustarPrincipal(base)
  const h = base.h

  return {
    principal,
    principalTexto: texto,
    acento:     rgbToHex(hslToRgb({ h: h + 28, s: clamp(base.s, 0.35, 0.9), l: clamp(base.l, 0.35, 0.6) })),
    superficie: rgbToHex(hslToRgb({ h, s: 0.35, l: 0.96 })),
    borde:      rgbToHex(hslToRgb({ h, s: 0.30, l: 0.86 })),
    neutro:     NEUTRO_OSCURO,
  }
}
