import { notFound }              from 'next/navigation'
import { obtenerOfertaDetalle } from '@/app/actions/portal/ventas'
import { DocumentoPdf }          from '@/app/portal/(app)/ventas/_DocumentoPdf'

export const dynamic = 'force-dynamic'

interface PageProps {
  params:      Promise<{ oferta_id: string }>
  searchParams: Promise<{ download?: string }>
}

export default async function OfertaPdfPage({ params, searchParams }: PageProps) {
  const { oferta_id } = await params
  const { download }  = await searchParams
  const data = await obtenerOfertaDetalle(oferta_id)
  if (!data) notFound()

  return (
    <DocumentoPdf
      titulo="OFERTA COMERCIAL"
      numero={data.oferta.numero}
      fechaEmision={data.oferta.fecha_emision}
      fechaSecundaria={data.oferta.fecha_validez ? { label: 'Válida hasta', valor: data.oferta.fecha_validez } : undefined}
      condicionPago={data.oferta.condicion_pago}
      empresa={data.empresa}
      cliente={data.cliente}
      moneda={data.oferta.moneda}
      lineas={data.lineas}
      ajustes={data.ajustes}
      subtotal={Number(data.oferta.subtotal)}
      total={Number(data.oferta.total)}
      notas={data.oferta.notas}
      autoDownload={download === '1'}
      downloadFilename={`${data.oferta.numero}.pdf`}
    />
  )
}
