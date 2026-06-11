import { notFound }              from 'next/navigation'
import { obtenerFacturaDetalle } from '@/app/actions/portal/ventas'
import { DocumentoPdf }          from '@/app/portal/(app)/ventas/_DocumentoPdf'

export const dynamic = 'force-dynamic'

interface PageProps {
  params:       Promise<{ factura_id: string }>
  searchParams: Promise<{ download?: string }>
}

export default async function FacturaPdfPage({ params, searchParams }: PageProps) {
  const { factura_id } = await params
  const { download }   = await searchParams
  const data = await obtenerFacturaDetalle(factura_id)
  if (!data) notFound()

  return (
    <DocumentoPdf
      titulo="FACTURA"
      numero={data.factura.numero}
      fechaEmision={data.factura.fecha_emision}
      fechaSecundaria={data.factura.fecha_vencimiento ? { label: 'Vencimiento', valor: data.factura.fecha_vencimiento } : undefined}
      condicionPago={data.factura.condicion_pago}
      empresa={data.empresa}
      cliente={data.cliente}
      moneda={data.factura.moneda}
      lineas={data.lineas}
      ajustes={data.ajustes}
      subtotal={Number(data.factura.subtotal)}
      total={Number(data.factura.total)}
      notas={data.factura.notas}
      autoDownload={download === '1'}
      downloadFilename={`${data.factura.numero}.pdf`}
    />
  )
}
