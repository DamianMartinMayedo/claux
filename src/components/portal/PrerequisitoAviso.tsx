import Link from 'next/link'

// Cartel de prerrequisito: se muestra cuando a un módulo le falta un dato base para
// poder operar (empresa, moneda, almacén, producto…). En un tenant nuevo NADA se
// pre-crea, así que cada acción bloqueada debe explicar en pantalla QUÉ falta y
// ofrecer el atajo para crearlo. Sustituye a los `title` de botones deshabilitados
// (invisibles en móvil, y CLAUX es 95% móvil). Responsive: en pantallas estrechas
// el texto y las acciones se apilan y los botones ocupan todo el ancho.
export interface PrerequisitoAccion { label: string; href: string }

export default function PrerequisitoAviso({
  children, acciones = [],
}: {
  children:  React.ReactNode
  acciones?: PrerequisitoAccion[]
}) {
  return (
    <div className="prereq-aviso" role="status">
      <p className="prereq-aviso-texto">{children}</p>
      {acciones.length > 0 && (
        <div className="prereq-aviso-acciones">
          {acciones.map(a => (
            <Link key={a.href} href={a.href} className="btn btn-primary btn-sm">{a.label}</Link>
          ))}
        </div>
      )}
    </div>
  )
}
