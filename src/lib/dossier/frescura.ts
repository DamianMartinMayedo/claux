export const DIAS_DOSSIER_RANCIO = 45

export type MotivoFrescura = 'PARAMETROS' | 'ANTIGUEDAD' | null

export interface FrescuraDossier {
  necesitaActualizacion: boolean
  motivo: MotivoFrescura
  diasDesdeSnapshot: number | null
}

export function frescuraDossier({
  estado,
  snapshotAt,
  snapshotStale,
}: {
  estado: 'BORRADOR' | 'PUBLICADO' | string
  snapshotAt: string | null
  snapshotStale: boolean
}): FrescuraDossier {
  const diasDesdeSnapshot = snapshotAt
    ? Math.round((Date.now() - new Date(snapshotAt).getTime()) / 86_400_000)
    : null
  if (snapshotStale) return { necesitaActualizacion: true, motivo: 'PARAMETROS', diasDesdeSnapshot }
  if (estado === 'PUBLICADO' && diasDesdeSnapshot !== null && diasDesdeSnapshot > DIAS_DOSSIER_RANCIO) {
    return { necesitaActualizacion: true, motivo: 'ANTIGUEDAD', diasDesdeSnapshot }
  }
  return { necesitaActualizacion: false, motivo: null, diasDesdeSnapshot }
}
