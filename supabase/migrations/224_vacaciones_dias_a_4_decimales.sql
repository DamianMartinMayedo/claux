-- ══════════════════════════════════════════════════════════════════════════════
-- 224 · Vacaciones (Cuba): los días acumulados vuelven a sus 4 decimales
-- ══════════════════════════════════════════════════════════════════════════════
--
-- El derecho se acumula a razón de `días trabajados ÷ 11`, que casi nunca cae en dos
-- decimales: un mes de 26 días da 2,363636… y se guardaba como 2,36, comiéndose 0,0036
-- días del trabajador. El motor ya calcula y guarda a 4 (`r2dias`, `redondear4dias`);
-- esto arregla lo que quedó escrito con el redondeo viejo.
--
-- NO HACE FALTA DDL: las tres columnas de días son `numeric` SIN escala (mig. 194/195),
-- así que siempre pudieron guardar cuatro decimales. Lo que faltaba era el cálculo.
--
-- ── Por qué esto NO es «recalcular el pasado» ────────────────────────────────────
-- Ninguna nómina CONFIRMADA tiene acumulación de vacaciones (comprobado: 17 líneas
-- cerradas, todas a 0 en días y en importe), así que no hay período cerrado que tocar.
-- Las líneas afectadas viven todas en BORRADOR y hoy no cuentan para ningún saldo —el
-- saldo solo suma nóminas confirmadas—. Pero `confirmarNomina` NO recalcula: lee lo que
-- hay guardado. Sin este arreglo, el primer borrador que se confirme congelaría el
-- redondeo viejo para siempre. El `estado = 'BORRADOR'` del WHERE es la promesa
-- literal: esta migración no puede reescribir una nómina cerrada.
--
-- ── Cómo se recupera el valor bueno ──────────────────────────────────────────────
-- No se recalcula desde el origen: `dias_trabajados` (incidencia) y `dias_laborables`
-- (ficha) se pueden editar después, que es justo por lo que la mig. 194 congeló los
-- días en la línea. Se invierte el redondeo sobre el propio valor guardado:
--   d = round(valor × 11), y se acepta solo si |valor×11 − d| ≤ 0,055
-- 0,055 es la distorsión máxima que pudo meter el redondeo a 2 decimales (0,005 × 11).
-- Dentro de esa tolerancia solo caben los días enteros, que es como se cargan: 2,36 →
-- 25,96 → 26 días → 2,3636. Un medio día NO entra (2,32 → 25,52, a 0,48 de 26) y se
-- queda como está: preferimos no tocarlo a inventarlo.
--
-- `vacaciones_dias_pagados_periodo` NO se toca: son días que tecleó el dueño, y una
-- liquidación se pagó contra el saldo del día en que se pagó. Reescribirlos rompería
-- la correspondencia con el dinero que salió, que aquí no se altera.
-- ══════════════════════════════════════════════════════════════════════════════

update nomina_lineas nl
set vacaciones_dias_acumulados_periodo =
      round(round(nl.vacaciones_dias_acumulados_periodo * 11) / 11, 4)
from nominas n
where n.nomina_id = nl.nomina_id
  and n.estado = 'BORRADOR'
  and nl.vacaciones_dias_acumulados_periodo > 0
  and abs(nl.vacaciones_dias_acumulados_periodo * 11
          - round(nl.vacaciones_dias_acumulados_periodo * 11)) <= 0.055
  and round(round(nl.vacaciones_dias_acumulados_periodo * 11) / 11, 4)
      <> nl.vacaciones_dias_acumulados_periodo;
