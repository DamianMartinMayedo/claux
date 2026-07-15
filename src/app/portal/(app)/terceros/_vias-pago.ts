// ── Catálogo de vías de pago de un tercero ────────────────────────────────────
//
// Una vía es (tipo × moneda), no un tipo con la moneda pegada al nombre: la
// moneda sale de las que el cliente tiene configuradas en Monedas y Tasas, así
// que la misma «Transferencia bancaria» vale en CUP, USD o lo que el negocio
// use. Los tipos con moneda en el nombre («Transferencia (VES)») eran del
// catálogo venezolano heredado y los reescribió la migración 099.
//
// Las vías son documentales: se muestran en la lista y el detalle del tercero
// para saber cómo se le paga. No las consume Tesorería ni las facturas.

export const VIAS_TIPOS = [
  'Transferencia bancaria',
  'Transfermóvil',
  'EnZona',
  'Efectivo',
  'Zelle',
  'TropiPay',
  'Transferencia internacional',
] as const

export type ViaTipo = typeof VIAS_TIPOS[number]

export const VIA_BADGE: Record<string, { label: string; cls: string }> = {
  'Transferencia bancaria':      { label: 'TB',     cls: 'via-badge-tb'       },
  'Transfermóvil':               { label: 'TMÓVIL', cls: 'via-badge-tmovil'   },
  'EnZona':                      { label: 'ENZONA', cls: 'via-badge-enzona'   },
  'Efectivo':                    { label: 'EF',     cls: 'via-badge-ef'       },
  'Zelle':                       { label: 'ZELLE',  cls: 'via-badge-zelle'    },
  'TropiPay':                    { label: 'TPPAY',  cls: 'via-badge-tropipay' },
  'Transferencia internacional': { label: 'TBI',    cls: 'via-badge-intl'     },
}
