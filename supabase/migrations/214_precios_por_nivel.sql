-- ================================================================
-- MIGRACIÓN 214: cada módulo tiene un precio en cada nivel
--
-- Plan: docs/planes/niveles-comerciales.md § 3.1 y § 4.2
--
-- POR QUÉ RENOMBRAR Y NO AÑADIR TRES COLUMNAS NUEVAS. El renombrado rompe la
-- compilación en los 21 ficheros que hoy dicen «fundador», y eso es lo que se
-- busca: obliga al compilador a encontrar cada sitio. Si solo se cambiaran los
-- valores dejando los nombres viejos, una rama `=== 'fundador'` podría
-- sobrevivir para siempre sin que nada falle. **El renombrado es el mecanismo
-- de seguridad, no un efecto colateral.**
--
--   precio_fundador_usd  →  precio_inicial_usd
--   precio_estandar_usd  →  precio_empresa_usd
--   (nueva)                 precio_pro_usd
--
-- OJO: el renombrado conserva los valores viejos, pero los de Empresa NO son los
-- de «estándar». Por eso las tres columnas se reescriben enteras más abajo, con
-- los importes explícitos: nada se deduce del valor anterior.
--
-- LA REGLA DE PRECIO (decisión del dueño, plana y sin excepciones):
--     Empresa = Inicial × 2
--     Pro     = Inicial × 2,5, redondeado hacia arriba al múltiplo de 5
-- El multiplicador SIEMBRA la columna; después cada celda se edita a mano desde
-- /admin/modulos. No es una fórmula que el código recalcule: es una semilla.
--
-- LOS DOS AJUSTES SOBRE LA COLUMNA INICIAL (que es la de «fundador»):
--   · dossier      10 → 12  — absorbe el addon Multidossier, que desaparece
--   · asistente_ia 15 → 25  — único addon que sobrevive, ahora con cupo declarado
--     por nivel (500/1.500/5.000). Es la única dimensión con coste marginal real.
--
-- RESTRICCIÓN DURA VERIFICADA (los dos únicos clientes reales no se mueven):
--   · CLI-0013 Silvia  base+inventario+caja   = 20+15+15 = $50  (hoy $50)
--   · CLI-0008 Auge    base+dossier+ia        = 20+12+25 = $57  (hoy $57,
--     donde pierde multiempresa −$12 y lo compensan dossier +$2 e ia +$10)
--
-- `multiempresa` y `multidossier` reciben precio por coherencia de la tabla, pero
-- se retiran del catálogo en la mig. 216: su función pasa a ser un límite de nivel.
-- ================================================================

alter table public.modulos_catalogo rename column precio_fundador_usd to precio_inicial_usd;
alter table public.modulos_catalogo rename column precio_estandar_usd to precio_empresa_usd;

alter table public.modulos_catalogo
  add column if not exists precio_pro_usd numeric not null default 0;

comment on column public.modulos_catalogo.precio_inicial_usd is 'Precio mensual en el nivel Inicial (USD).';
comment on column public.modulos_catalogo.precio_empresa_usd is 'Precio mensual en el nivel Empresa (USD).';
comment on column public.modulos_catalogo.precio_pro_usd     is 'Precio mensual en el nivel Pro (USD).';

-- Las tres columnas, explícitas. Nada se deriva del valor anterior.
update public.modulos_catalogo m set
  precio_inicial_usd = v.ini,
  precio_empresa_usd = v.emp,
  precio_pro_usd     = v.pro,
  updated_at         = now()
from (values
  ('base',                20, 40, 50),
  ('inventario',          15, 30, 40),
  ('servicios',           15, 30, 40),
  ('caja',                15, 30, 40),
  ('rrhh',                10, 20, 25),
  ('catalogo_qr',         10, 20, 25),
  ('agenda',              10, 20, 25),
  ('reservas_citas',      10, 20, 25),
  ('dossier',             12, 24, 30),
  ('asistente_ia',        25, 50, 65),
  ('documentos_imprenta',  4,  8, 10),
  -- se retiran en la 216
  ('multiempresa',        12, 24, 30),
  ('multidossier',         5, 10, 15)
) as v(clave, ini, emp, pro)
where m.clave = v.clave;

notify pgrst, 'reload schema';
