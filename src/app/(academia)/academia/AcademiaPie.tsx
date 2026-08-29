import { MARCA_LARGA } from '@/lib/academia/marca'

/**
 * El pie del manual, en un solo sitio.
 *
 * Es una línea corta, pero estaba copiada en las tres páginas y el aviso de
 * «borrador» tiene que caer o quedarse a la vez en todas: si en una se olvida,
 * esa es justo la que alguien enseña fuera.
 */
export default function AcademiaPie() {
  return (
    <footer className="acad-footer">
      <p>{MARCA_LARGA} · borrador de trabajo · el contenido se valida antes de publicar.</p>
    </footer>
  )
}
