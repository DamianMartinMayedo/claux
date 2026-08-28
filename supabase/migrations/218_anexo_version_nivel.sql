-- ================================================================
-- MIGRACIÓN 218: la versión del Anexo I firmado también pasa de «tarifa» a «nivel»
--
-- Plan: docs/planes/niveles-comerciales.md § 4.3
--
-- La versión del Anexo sella su CONTENIDO (mig. 204): ciclo, tarifa, módulos y
-- los dos importes van dentro de la cadena, de modo que cualquier cambio la mueve
-- y obliga a re-firmar. El renombrado `tarifa` → `nivel` de la 215 y la 216 mueve
-- justo uno de esos trozos —«fundador» pasa a leerse «inicial», «estandar» a
-- «empresa»— sin que haya cambiado NADA de lo pactado.
--
-- Sin este UPDATE, el cliente que firmó su Anexo ayer lo vería mañana como
-- «pendiente de firma» y tendría que volver a firmar exactamente lo mismo, con la
-- versión vieja caducando en histórico como si el acuerdo hubiera cambiado. Es el
-- mismo arreglo que ya hizo la 204 por el mismo motivo, y por eso la cadena de
-- aquí tiene que coincidir carácter a carácter con la que construye
-- `construirAnexoInput` en src/app/actions/portal/documentos.ts.
--
-- Solo aplica a las versiones `presupuesto-…`: la de respaldo (`modulos-…`, la del
-- cliente sin presupuesto enlazado) nunca llevó la tarifa dentro, así que no se
-- mueve sola y no hay nada que reescribir.
--
-- Se tocan solo las firmas VIGENTES (`caducada_at is null`). Una firma caducada es
-- prueba histórica de lo que se firmó: no se reescribe jamás. El hash y el
-- snapshot tampoco se tocan — lo firmado sigue siendo lo firmado.
--
-- El reemplazo va ANCLADO al ciclo (`-mensual-fundador-`, `-anual-estandar-`) y no
-- al valor suelto, porque la cadena lleva después las claves de los módulos: sin
-- el ancla, un módulo que algún día se llamara «fundador» reescribiría el trozo
-- que no toca y caducaría la firma de alguien.
-- ================================================================

update firmas_documentos f
set    version = case
         when f.version like '%-' || coalesce(c.ciclo_facturacion, 'mensual') || '-fundador-%'
           then replace(f.version,
                  '-' || coalesce(c.ciclo_facturacion, 'mensual') || '-fundador-',
                  '-' || coalesce(c.ciclo_facturacion, 'mensual') || '-inicial-')
         else replace(f.version,
                  '-' || coalesce(c.ciclo_facturacion, 'mensual') || '-estandar-',
                  '-' || coalesce(c.ciclo_facturacion, 'mensual') || '-empresa-')
       end
from   clients c
where  c.client_id   = f.client_id
  and  f.tipo        = 'presupuesto'
  and  f.caducada_at is null
  and  f.version like 'presupuesto-%'
  and  (f.version like '%-' || coalesce(c.ciclo_facturacion, 'mensual') || '-fundador-%'
     or f.version like '%-' || coalesce(c.ciclo_facturacion, 'mensual') || '-estandar-%');

notify pgrst, 'reload schema';
