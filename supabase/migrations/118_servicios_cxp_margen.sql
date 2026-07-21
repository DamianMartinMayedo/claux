-- ================================================================
-- MIGRACIÓN 118: Fase E del módulo Servicios — foto del coste, CxP automática
-- al proveedor y base del margen real.
--
-- Tres piezas, en orden de dependencia:
--
--  1. `documento_lineas.costo_unitario` — la FOTO del coste al vender. Sin ella,
--     subir la tarifa del proveedor en marzo reescribiría el margen de enero:
--     `products.costos` guarda el último coste, no el de aquel día.
--
--  2. `gastos_cobros.origen_tipo/origen_id` — el rastro que permite REVERTIR. Compras
--     resuelve esto con `compras.gasto_id` (un gasto por compra), pero una factura de
--     servicios genera N gastos (uno por proveedor), así que el vínculo va del lado
--     del gasto. Genérico a propósito: vale para cualquier documento que engendre uno.
--
--  3. `srv_cxp_generar` / `srv_cxp_revertir` — la CxP automática, atómica en Postgres
--     como `inv_confirmar_compra`, con la guardia `CXP_PAGADA` calcada de COMPRA_PAGADA:
--     si ya se le pagó al proveedor, la factura no se anula sin deshacer el pago antes.
--
-- REGLA DE NEGOCIO QUE ESTO CONSAGRA (decisión 7 del plan): la CxP se ata a
-- `products.proveedor_id`, NO a «tiene coste». Un servicio que presta la plantilla ya
-- está en el gasto «Salarios» de la nómina confirmada: generarle además un coste lo
-- contaría dos veces y descuadraría el resultado. Su coste se muestra como margen
-- informativo (decisión 11), y por eso `reportes` NO resta el coste directo del neto.
--
-- Y SOLO SERVICIOS: un producto físico con proveedor ya generó su gasto «Compras» al
-- ENTRAR en el almacén. Cobrarle otra vez al salir contaría la misma mercancía dos
-- veces. El filtro `p.tipo = 'SERVICIO'` no es decorativo, es la línea que lo impide.
--
-- Ver docs/planes/modulo-servicios.md (Fase E).
-- ================================================================

-- ── 1. Foto del coste en la línea del documento ──
ALTER TABLE documento_lineas
  ADD COLUMN IF NOT EXISTS costo_unitario numeric;

-- ── 2. Rastro del documento que engendró el gasto ──
ALTER TABLE gastos_cobros
  ADD COLUMN IF NOT EXISTS origen_tipo text,
  ADD COLUMN IF NOT EXISTS origen_id   text;

CREATE INDEX IF NOT EXISTS gastos_cobros_origen_idx
  ON gastos_cobros (client_id, origen_tipo, origen_id) WHERE origen_id IS NOT NULL;

-- ── 3. CxP automática al emitir ────────────────────────────────────────────────
-- Un GASTO por proveedor, por el coste de sus líneas en la moneda de la factura.
-- Idempotente: si la factura ya tiene su CxP, no duplica (emitir → anular → emitir).

CREATE OR REPLACE FUNCTION srv_cxp_generar(p_factura_id text, p_client_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_factura facturas%rowtype;
  v_prov    record;
  v_gasto   text;
  v_creados int := 0;
BEGIN
  SELECT * INTO v_factura FROM facturas
    WHERE factura_id = p_factura_id AND client_id = p_client_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACTURA_NO_ENCONTRADA'; END IF;

  -- Idempotencia: ya tiene CxP generada.
  IF EXISTS (SELECT 1 FROM gastos_cobros
             WHERE client_id = p_client_id AND origen_tipo = 'FACTURA' AND origen_id = p_factura_id) THEN
    RETURN jsonb_build_object('creados', 0, 'ya_existia', true);
  END IF;

  FOR v_prov IN
    SELECT p.proveedor_id,
           sum(dl.cantidad * coalesce(dl.costo_unitario,
                                      (p.costos ->> v_factura.moneda)::numeric,
                                      0)) AS total
      FROM documento_lineas dl
      JOIN products p ON p.producto_id = dl.producto_id AND p.client_id = p_client_id
     WHERE dl.documento_tipo = 'FACTURA'
       AND dl.documento_id   = p_factura_id
       AND p.tipo = 'SERVICIO'             -- un físico ya se gastó al COMPRARLO (gasto «Compras»)
       AND p.proveedor_id IS NOT NULL      -- decisión 7: sin proveedor NO se contabiliza
     GROUP BY p.proveedor_id
  LOOP
    CONTINUE WHEN coalesce(v_prov.total, 0) <= 0.005;   -- sin coste no hay deuda

    v_gasto := 'GAS-' || upper(substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 8));
    INSERT INTO gastos_cobros (registro_id, client_id, empresa_id, tipo, fecha, tercero_id,
                               categoria, descripcion, moneda, monto, notas,
                               origen_tipo, origen_id, updated_at)
    VALUES (v_gasto, p_client_id, v_factura.empresa_id, 'GASTO', v_factura.fecha_emision,
            v_prov.proveedor_id, 'Servicios de terceros',
            'Servicios de la factura ' || v_factura.numero, v_factura.moneda, v_prov.total,
            'Generado al emitir la factura ' || p_factura_id, 'FACTURA', p_factura_id, now());
    v_creados := v_creados + 1;
  END LOOP;

  RETURN jsonb_build_object('creados', v_creados, 'ya_existia', false);
END; $$;

-- ── 4. Revertir la CxP al anular ───────────────────────────────────────────────
-- Guardia calcada de COMPRA_PAGADA: si el gasto ya tiene un pago en Tesorería, no se
-- borra en silencio — se bloquea y el dueño anula primero el pago.

CREATE OR REPLACE FUNCTION srv_cxp_revertir(p_factura_id text, p_client_id text)
RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE
  v_borrados int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM gastos_cobros g
     WHERE g.client_id = p_client_id AND g.origen_tipo = 'FACTURA' AND g.origen_id = p_factura_id
       AND EXISTS (SELECT 1 FROM movimientos_tesoreria m
                    WHERE m.client_id = p_client_id AND m.referencia_id = g.registro_id
                      AND m.origen = 'PAGO')
  ) THEN
    RAISE EXCEPTION 'CXP_PAGADA';
  END IF;

  DELETE FROM gastos_cobros
   WHERE client_id = p_client_id AND origen_tipo = 'FACTURA' AND origen_id = p_factura_id;
  GET DIAGNOSTICS v_borrados = ROW_COUNT;

  RETURN jsonb_build_object('borrados', v_borrados);
END; $$;

NOTIFY pgrst, 'reload schema';
