-- ================================================================
-- MIGRACIÓN 212: Nómina · el 1,5 % es una PROVISIÓN, y el subsidio tiene dos caras
--
-- CONTEXTO (Claudia, 2026-08-27). La «Contribución a la Seguridad Social (1,5 %)»
-- NO es un impuesto que se ingrese al Estado como el 12,5 % o el IUFT: es una
-- PROVISIÓN. La empresa la acumula cada mes y de ese fondo interno salen los
-- subsidios por CERTIFICADO MÉDICO (enfermedad) cuando se le pagan al trabajador.
-- El fondo puede quedar en negativo (la empresa asume el diferencial y lo compensa
-- con lo que acumule después) y NUNCA se liquida contra el Estado: se arrastra.
--
-- Hasta ahora el 1,5 % se posteaba igual que el 12,5 % —`naturaleza='AMBAS'`: coste
-- Y deuda—, así que creaba una cuenta por pagar FALSA al Estado por un dinero que no
-- se le paga a nadie. El arreglo NO toca el importe (los cálculos coinciden con la
-- contabilidad real): solo cambia el TRATO al confirmar, y eso vive en el código
-- (`confirmarNomina`), no en el esquema. El 1,5 % pasa a `naturaleza='COSTE'` (una
-- provisión, como la acumulación de vacaciones), sin contrapartida de deuda.
--
-- EL SUBSIDIO TIENE DOS CARAS, y hasta ahora solo se modelaba una:
--   · ENFERMEDAD (certificado médico) → sale del FONDO del 1,5 %. Es dinero que la
--     empresa paga y NO recupera de nadie; su coste ya se reconoció al acumular el
--     1,5 %. Es el caso NUEVO.
--   · MATERNIDAD → lo reembolsa el ESTADO. Es el mecanismo que YA existe (mig. 144):
--     cuenta por COBRAR contra la Seguridad Social, se liquida cuando llega el
--     reembolso.
--
-- Por eso hace falta distinguirlos. Un solo booleano en la incidencia (una incidencia
-- por trabajador y mes, mig. 143) enruta su `pago_subsidios`: marcado = maternidad
-- (Estado), sin marcar = enfermedad (fondo). La línea guarda la PORCIÓN de maternidad
-- como importe —no un booleano— para que `confirmarNomina` pueda repartir sumando, y
-- para dejar la puerta abierta a partirlo en el futuro sin otra migración.
--
-- NO se retro-corrigen las nóminas ya confirmadas: sus filas de 1,5 % siguen como
-- 'AMBAS'. Limpiarlas es una decisión contable de Claudia, no un efecto colateral de
-- esta migración. De aquí en adelante se postean bien.
-- ================================================================

-- El interruptor en la incidencia: ¿este subsidio es maternidad (lo cubre el Estado)?
alter table public.incidencias_nomina
  add column if not exists subsidio_maternidad boolean not null default false;

-- La foto congelada en la línea: cuánto del subsidio de esta línea es maternidad.
-- El resto (`subsidios - subsidios_maternidad`) es enfermedad, del fondo del 1,5 %.
alter table public.nomina_lineas
  add column if not exists subsidios_maternidad numeric not null default 0;

alter table public.nomina_lineas
  drop constraint if exists nl_subsidios_maternidad_ck;
alter table public.nomina_lineas
  add constraint nl_subsidios_maternidad_ck
  check (subsidios_maternidad >= 0 and subsidios_maternidad <= subsidios + 0.005);

notify pgrst, 'reload schema';
