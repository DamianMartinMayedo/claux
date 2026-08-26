-- 209 · Caja — el pago y el vuelto, con su moneda
--
-- El caso que reporta la clienta: venta de 15 USD, el cliente paga con un billete de 20 USD
-- y se le devuelven 1.900 CUP. Hoy el arqueo del cierre es estrictamente por moneda y solo
-- conoce «ventas en efectivo», así que esa venta produce DOS descuadres a la vez —sobran 5
-- USD y faltan 1.900 CUP— y el turno no puede cuadrar. No es que cuadre mal: no puede.
--
-- El pago pasa a ser DATO del ticket: qué se recibió y qué se devolvió, cada uno con su
-- moneda. Cuatro columnas en una tabla que ya existe, sin tabla nueva, sin RLS, sin entrada
-- en `eliminar_cliente()` y sin store nuevo en IndexedDB.
--
-- **La propiedad que hay que conservar**: con `cobrado = total` y `cambio = 0` la fórmula
-- nueva del arqueo
--     esperado(m) = fondo + Σ cobrado en efectivo en m − Σ cambio dado en m + entradas − salidas
-- se reduce EXACTAMENTE a la de hoy. Quien no dé vuelto en otra moneda no nota nada.
--
-- **No hay tasa** (decisión del dueño, 2026-08-25): el cajero teclea lo que recibe y lo que
-- devuelve, y el sistema no hace aritmética entre monedas — en un mostrador cubano esa
-- aritmética es una negociación, no una fórmula. Por eso no hay `cambio_tasa` ni
-- `tasas_turno`: la tasa implícita, si algún día se quiere, se deriva de estas columnas.
--
-- El pago PARTIDO (paga 10 USD + 2.000 CUP) queda fuera a sabiendas: ficha F11 del backlog.
-- Si algún día entra, estas cuatro columnas son un backfill de una o dos filas por ticket a
-- una `caja_ticket_pagos`. Se acepta con el peaje escrito, que es distinto de no haberlo visto.

alter table public.caja_tickets
  -- Lo que el cliente PUSO en el mostrador. `null` = pagó justo, en la moneda de la venta:
  -- es el caso de siempre y no hay por qué escribirlo en cada ticket.
  add column if not exists cobrado_moneda  text,
  add column if not exists cobrado_importe numeric(18,2),
  -- Lo que se le DEVOLVIÓ, que puede ser en otra moneda. `null` = no hubo vuelto.
  add column if not exists cambio_moneda   text,
  add column if not exists cambio_importe  numeric(18,2);

-- El vuelto en OTRA moneda es la razón de ser de la migración, y es lo que hay que poder
-- encontrar cuando un turno no cuadra. Índice parcial: son la excepción, así que no pesa.
create index if not exists idx_caja_tickets_cambio_cruzado
  on public.caja_tickets (client_id, empresa_id, fecha)
  where cambio_moneda is not null and cambio_moneda <> moneda;
