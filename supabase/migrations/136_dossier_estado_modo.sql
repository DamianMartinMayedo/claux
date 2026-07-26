-- ================================================================
-- MIGRACIÓN 136: `dossiers.estado_modo` — qué versión del estado de resultados
-- se publica.
--
-- El dueño decide cuánto enseña, porque no todos los lectores quieren lo mismo:
--
--   RESUMEN     → las cinco cifras y los dos márgenes. Una página. Es lo que se
--                 manda en un primer contacto.
--   DESGLOSADO  → lo mismo MÁS el detalle por concepto de cada grupo, con su peso
--                 sobre los ingresos. Es lo que se manda cuando ya preguntan.
--
-- Por qué es una decisión del DUEÑO y no del dato: la regla del P&L progresivo
-- («el renglón sin fuente no se pinta») ya evita que salga una pantalla de ceros,
-- pero no responde a esto — un dossier CON desglose completo puede querer
-- enseñarse resumido igualmente. Ahí no hay nada que derivar: hay que preguntarlo.
--
-- DEFECTO `DESGLOSADO`: enseña todo lo que haya. Un dossier sin desglose se ve
-- exactamente igual que antes de esta migración (no hay líneas que pintar), así
-- que nadie ve cambiar su documento por una columna nueva.
-- ================================================================

alter table dossiers
  add column if not exists estado_modo text not null default 'DESGLOSADO';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'dossiers_estado_modo_check') then
    alter table dossiers
      add constraint dossiers_estado_modo_check
      check (estado_modo in ('RESUMEN', 'DESGLOSADO'));
  end if;
end $$;

comment on column dossiers.estado_modo is
  'Qué se publica del estado de resultados: RESUMEN (cifras y márgenes) o DESGLOSADO (además, el detalle por concepto). Afecta a la pestaña, al PDF y al enlace público por igual.';

notify pgrst, 'reload schema';
