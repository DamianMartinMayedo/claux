-- ── Addon "Multidossier" ─────────────────────────────────────────────────────
--
-- Varios dossiers a la vez para un mismo cliente: uno por empresa, o uno por
-- inversor con su propio relato. Cada uno con su enlace independiente, que se
-- revoca y se despublica por separado.
--
-- SIN CAMBIOS DE ESQUEMA, y no es un descuido: el modelo ya era multi-dossier
-- desde la 098. `dossiers.dossier_id` es la PK, las tablas hijas cuelgan de
-- (dossier_id, client_id), y `dossier_costo_ventas` se dejó a nivel client_id a
-- propósito —"la harina es coste de ventas" es un hecho del negocio, no de un
-- dossier— justo para que el 2º lo heredara. El límite de uno vivía en dos
-- queries de src/app/actions/portal/dossier.ts, no en la base.
--
-- Por eso esta migración solo siembra la pieza vendible. El gating es de
-- aplicación: `tieneModulo(modulos, 'multidossier')` en crearDossier,
-- duplicarDossier y publicarDossier.

-- tipo 'addon' → no genera navegación propia: la ruta /portal/dossier ya la
-- aporta la funcionalidad `dossier`, y este addon solo desbloquea capacidad
-- dentro de ella (MODELO-MODULOS §3.1). De ahí `paginas` vacío.
--
-- Precio PLACEHOLDER (5/9): el propietario lo ajusta en /admin/modulos.
-- Los precios viven en datos, nunca en código (CONTEXTO §5).
--
-- El admin no necesita ni una línea: ModulosCard agrupa por `tipo` y esta fila
-- aparece sola bajo «Addons».
insert into modulos_catalogo
  (clave, nombre, descripcion, precio_fundador_usd, precio_estandar_usd, es_base, tipo, orden, paginas) values
  ('multidossier', 'Multidossier',
   'Varios dossiers a la vez: uno por empresa o uno por inversor, cada uno con su propio enlace.',
   5, 9, false, 'addon', 81, '[]'::jsonb)
on conflict (clave) do nothing;
