-- ================================================================
-- MIGRACIÓN 148: Nómina cubana · valores fiscales REALES (cierra la mig. 142)
--
-- Claudia mandó las fórmulas y tramos verificados de CESS, IUFT e IRPF
-- (`formulas-calculo-nomina-cuba.md`, 2026-07-28). Sustituye en el sitio los
-- tres valores PROVISIONALES sembrados en la mig. 142 — mismo `parametro_id`,
-- misma `vigente_desde` (2020-01-01): ningún cliente tiene MIPYME_CUBA activo
-- todavía, así que no hay ninguna nómina histórica que proteger bajo la escala
-- provisional (a diferencia de un cambio de ONAT futuro, que sí cerraría
-- vigencia e insertaría una fila nueva, dejando lo ya confirmado intacto).
--
-- Prueba de aceptación (verificada contra los 4 ejemplos de Claudia con un
-- script suelto antes de aplicar esta migración): con salario 27.500 CUP, mes
-- completo, no socia → CESS 2.000,00 + IRPF 1.712,00 = 3.712,00 de total
-- retenciones — el dato real de CLI-0014 es la SUMA de los dos, no el IRPF
-- solo (una nota anterior del plan lo decía mal).
--
-- De paso (fuera de esta migración, en el motor `nomina-cuba.ts`): se corrigió
-- un bug real — la base de IUFT y de la Contribución SS de empresa usaba
-- `total_devengado` (que ya incluye el pago de vacaciones disfrutadas) en vez
-- de `salario_devengado + acumulación de vacaciones` (sin ese pago), que es lo
-- que especifica Claudia. No es cosa de esta migración, es código.
-- ================================================================

update parametros_fiscales_cuba set
  tabla_tramos = '[{"desde":0,"hasta":15000,"tasa":5,"acumulado_base":0},
                   {"desde":15000,"hasta":null,"tasa":10,"acumulado_base":750}]'::jsonb,
  provisional = false,
  notas = 'CESS: 5% hasta 15.000 CUP, 10% sobre el exceso (750 de arrastre). '
          'Base: devengado. Verificado por Claudia, 2026-07-28.'
where parametro_id = 'PFC-CESS0001';

update parametros_fiscales_cuba set
  tabla_tramos = '[{"desde":0,"hasta":null,"tasa":5,"acumulado_base":0}]'::jsonb,
  provisional = false,
  notas = 'IUFT: 5% plano sobre devengado + acumulación de vacaciones del mes. '
          'El valor de relleno de la mig. 142 YA coincidía con el real; ahora '
          'queda verificado, no por casualidad. Claudia, 2026-07-28.'
where parametro_id = 'PFC-IUFT0001';

update parametros_fiscales_cuba set
  tabla_tramos = '[{"desde":0,"hasta":3260,"tasa":0,"acumulado_base":0},
                   {"desde":3260,"hasta":9510,"tasa":3,"acumulado_base":0},
                   {"desde":9510,"hasta":15000,"tasa":5,"acumulado_base":187.50},
                   {"desde":15000,"hasta":20000,"tasa":7.5,"acumulado_base":462.00},
                   {"desde":20000,"hasta":25000,"tasa":10,"acumulado_base":837.00},
                   {"desde":25000,"hasta":30000,"tasa":15,"acumulado_base":1337.00},
                   {"desde":30000,"hasta":null,"tasa":20,"acumulado_base":2087.00}]'::jsonb,
  provisional = false,
  notas = 'IRPF: escala progresiva de 6 tramos verificada por Claudia, '
          '2026-07-28. Base: devengado. Prueba de aceptación: salario 27.500 '
          'CUP, mes completo, no socia → IRPF 1.712,00 (junto con CESS '
          '2.000,00 suman los 3.712,00 observados en CLI-0014).'
where parametro_id = 'PFC-IRPF0001';

-- SS_EMPRESA_125, SS_EMPRESA_15 y VACACIONES ya estaban confirmados y
-- correctos desde la mig. 142: no se tocan.

notify pgrst, 'reload schema';
