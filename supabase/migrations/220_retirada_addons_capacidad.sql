-- ================================================================
-- MIGRACIÓN 220: se retiran los addons de capacidad y nacen los dos correos
--                del modelo de niveles
--
-- Plan: docs/planes/niveles-comerciales.md §4.4 (Fase 9). El plan la llama «219»
-- porque cuando se escribió ese número estaba libre; lo ocupó `diagnostico_nivel`
-- (Fase 8), así que esta es la 220.
--
-- POR QUÉ SE RETIRAN `multiempresa` Y `multidossier`
--
-- Los dos vendían capacidad: «puedes tener más de una empresa», «puedes llevar
-- más de un dossier». Desde la migración 213 la capacidad la vende el NIVEL:
-- `empresas` y `dossiers` son dimensiones de `nivel_limites`, con su tope por
-- nivel y su `limites_override` por cliente. Dejar además el addon deja dos sitios
-- decidiendo lo mismo, y cuando dos candados discrepan gana el que dice que no:
-- un cliente de nivel Empresa —con tope de 3 empresas pagado— se quedaría con una
-- sola por no tener contratada una casilla que ya no significa nada.
--
-- SE DESACTIVAN, NO SE BORRAN. La fila del catálogo es la que da nombre y precio
-- a lo que ya se facturó: anexos firmados, presupuestos y facturas viejas citan la
-- clave. Borrarla dejaría documentos históricos hablando de un módulo fantasma.
-- `activo = false` los saca de la venta y de la suma de cuotas (toda la app suma
-- con `.eq('activo', true)`) sin tocar el pasado.
-- ================================================================

-- ── 1. Fuera de la venta ─────────────────────────────────────────
update public.modulos_catalogo
set    activo = false
where  clave in ('multiempresa', 'multidossier');

-- ── 2. Fuera de la cesta de cada cliente ─────────────────────────
-- La casilla ya no la pinta nadie (el código que la leía se retira en esta misma
-- fase). Dejarla en el array la convertiría en una clave huérfana: invisible en
-- /admin/clientes pero viva en la fila, esperando a confundir al siguiente que
-- lea `modulos_activos` a mano.
update public.clients
set    modulos_activos = array_remove(array_remove(modulos_activos, 'multiempresa'), 'multidossier')
where  modulos_activos && array['multiempresa', 'multidossier'];

-- ── 3. Rehacer la caché de cuotas ────────────────────────────────
-- `clients.precio_mensual_usd` es una CACHÉ de la suma del catálogo por la columna
-- del nivel (`src/lib/catalogo-precios.ts`), y arrastra dos deudas: la retirada de
-- arriba y el estreno de las tres columnas de precio (mig. 214), que solo se
-- aplicaba a quien pasara por el formulario de módulos. Se rehace la cartera
-- entera, no solo a los que tenían addon: un cliente mapeado a Empresa cuya caché
-- venía de la tarifa fundador enseña un número y se le cobra otro.
--
-- La regla se copia de `sumarModulos`, no se inventa: solo módulos `activo = true`,
-- y el nivel desconocido cae a Inicial como hace `normalizarNivel`.
--
-- Resultado esperado (verificado contra los datos vivos el 2026-08-28; es la tabla
-- de impacto del plan §14):
--   CLI-0003 Negocio Test    inicial  147 → 142
--   CLI-0004 Restaurante     empresa   30 →  30
--   CLI-0005 MadWoman        inicial   47 →  35
--   CLI-0006 Mandao          inicial   37 →  35
--   CLI-0007 Dossier test    empresa   18 →  24
--   CLI-0008 Auge            inicial   57 →  57   ← la restricción dura D4 se
--       cumple JUSTO por esta retirada: su caché ya no contaba el addon.
--   CLI-0013 Silvia Padrón   inicial   50 →  50
--   CLI-0014 DEUS            empresa  143 → 164   ← pasa a Socio CLAUX y no se le
--       cobra; la bandera la pone el dueño desde la ficha, no esta migración.
update public.clients c
set    precio_mensual_usd = coalesce((
         select sum(case
                      when c.nivel = 'empresa' then m.precio_empresa_usd
                      when c.nivel = 'pro'     then m.precio_pro_usd
                      else                          m.precio_inicial_usd
                    end)
         from   public.modulos_catalogo m
         where  m.activo and m.clave = any(c.modulos_activos)
       ), 0)
where  c.precio_mensual_usd is distinct from coalesce((
         select sum(case
                      when c.nivel = 'empresa' then m.precio_empresa_usd
                      when c.nivel = 'pro'     then m.precio_pro_usd
                      else                          m.precio_inicial_usd
                    end)
         from   public.modulos_catalogo m
         where  m.activo and m.clave = any(c.modulos_activos)
       ), 0);

-- ── 4. Los dos correos del modelo de niveles ─────────────────────
-- `limite_alcanzado`: lo manda el escáner de límites cuando una dimensión llega al
-- 100 % (`src/lib/notificaciones/escaneres.ts`). El cambio de nivel es MANUAL
-- (D15), así que este correo ABRE LA CONVERSACIÓN; por eso no lleva ningún enlace
-- de «amplía aquí» que no existiría.
-- `socio_ampliado`: la prórroga de la condición de socio, hermana de `periodo_gracia`.
--
-- La fila es obligatoria, no un adorno: `listarPlantillas()` descarta los tipos que
-- no existen en esta tabla, así que sin ella la plantilla no aparecería en
-- /admin/notificaciones y nadie podría editarla (lección de la mig. 206).
alter table public.email_plantillas drop constraint if exists email_plantillas_tipo_check;
alter table public.email_plantillas add constraint email_plantillas_tipo_check check (tipo in (
  'diagnostico_cita', 'bienvenida', 'password_reset', 'password_reset_link',
  'respuesta_soporte', 'confirmacion_pago', 'reactivacion', 'recordatorio_pago',
  'fin_prueba', 'suspension', 'periodo_gracia',
  'limite_alcanzado', 'socio_ampliado'
));

-- El texto es EL MISMO que la plantilla por defecto de `src/lib/email/render.ts`:
-- si difirieran, el correo que se manda sin fila y el que se manda con ella dirían
-- cosas distintas. `do nothing`: si alguien ya la editó desde el admin, no se pisa.
insert into email_plantillas (tipo, asunto, cuerpo) values
(
  'limite_alcanzado',
  'Llegaste al tope de {{concepto}} de tu nivel {{nivel}}',
  'Hola,

{{empresa}} llegó a {{limite}} {{concepto}}, que es lo que incluye el nivel {{nivel}}.

No se ha cortado nada: sigues trabajando con todo lo que tienes. Lo único que no puedes es añadir más {{concepto}} hasta que archives algunos o pasemos a un nivel mayor.

Si te hace falta más sitio, respóndenos a este correo y lo vemos.

El equipo de CLAUX'
),
(
  'socio_ampliado',
  'Sigues como Socio CLAUX hasta el {{fecha_fin}}',
  'Hola,

Seguimos: {{empresa}} continúa como Socio CLAUX hasta el {{fecha_fin}}. Tu portal no cambia en nada y no se te genera ningún cobro.

El equipo de CLAUX'
)
on conflict (tipo) do nothing;

-- ── 5. Repaso de limpieza y RLS (§4.4) ───────────────────────────
-- Nada que hacer, y consta por qué:
--   · `eliminar_cliente()`: `niveles` y `nivel_limites` son tablas GLOBALES, sin
--     `client_id`; lo del cliente (`nivel`, `limites_override`, `es_socio`,
--     `socio_hasta`, `descuento_pct`) son columnas de `clients` y se van con la
--     fila. El centinela `tablas_tenant_sin_purgar()` sale vacío.
--   · RLS: las dos tablas la traen puesta desde la mig. 213 con el patrón de
--     `modulos_catalogo` — lectura para `public` (el portal y la landing enseñan
--     los topes) y todo para `authenticated` (el admin). Sin política, el admin
--     en producción no vería la tabla; local lo enmascara con el service_role.

notify pgrst, 'reload schema';
