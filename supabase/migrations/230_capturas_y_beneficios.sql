-- ================================================================
-- MIGRACIÓN 230: la biblioteca de capturas y el texto de venta de cada módulo
--
-- Ocho de las dieciséis diapositivas de la propuesta son pantallazos, y hoy no
-- hay ni una imagen de producto en el repo (`public/` solo tiene logos). Esto es
-- lo que las sostiene, más el «por qué le sirve» de cada módulo, que hasta ahora
-- vivía en tres diapositivas de guía interna del PowerPoint marcadas «NO MOSTRAR
-- AL CLIENTE», de donde se copiaba y pegaba a mano.
-- ================================================================

-- `descripcion` dice QUÉ es el módulo y se usa en la landing y en la factura.
-- `beneficio` dice POR QUÉ le sirve al negocio, que es lo que se enseña en la
-- diapositiva 5. Son dos textos distintos a propósito: mezclarlos deja la
-- landing vendiendo o la propuesta describiendo.
alter table modulos_catalogo add column if not exists beneficio text;

-- Semilla defensiva. El catálogo comercial es VIVO: su texto y su precio se
-- editan desde /admin y ya han derivado de las migraciones que los sembraron.
-- `where beneficio is null` es lo que impide que una reejecución pise lo que el
-- dueño haya escrito después.
update modulos_catalogo set beneficio = v.txt from (values
  ('base',
   'Dejas de perseguir cifras entre libretas y hojas de cálculo. En cualquier momento sabes qué has vendido, qué debes y qué te deben, con el cambio de moneda ya aplicado.'),
  ('inventario',
   'Sabes qué te queda sin bajar al almacén y qué reponer antes de quedarte sin ello. Cada entrada y cada salida deja rastro, así que las mermas se ven.'),
  ('servicios',
   'Cobras lo mismo cada mes sin acordarte de emitir la factura. Cada servicio lleva su precio en cada moneda, y lo que se le factura a un cliente no depende de quién lo atienda.'),
  ('rrhh',
   'La nómina sale del sistema con las retenciones ya calculadas, no de una hoja que se rehace cada mes. Turnos, vacaciones y ausencias están donde se consultan.'),
  ('caja',
   'Se cobra igual cuando se cae internet: la venta queda registrada y se sincroniza al volver. El cierre del turno cuadra solo y el stock baja con cada venta.'),
  ('asistente_ia',
   'Atiende a tus clientes a cualquier hora y te resume el negocio cuando se lo pides. Se lleva el rato que hoy se va en responder veinte veces lo mismo.'),
  ('multiempresa',
   'Cada local lleva sus cuentas por separado y tú ves el total sumado. Un panel para todo lo que llevas, sin cambiar de sesión ni de archivo.'),
  ('multidossier',
   'Un dossier por empresa o uno por inversor, cada uno con su enlace. Enseñas a cada uno lo suyo sin rehacer la presentación.'),
  ('catalogo_qr',
   'Tus clientes ven la carta con fotos y precios al día desde su móvil. Cambiar un precio deja de costar una reimpresión.'),
  ('agenda',
   'La agenda se llena sola, sin llamadas que atender. Cada profesional ve su día y no se solapan dos citas.'),
  ('reservas_citas',
   'Las mesas se reservan de día y de noche. Ves el salón completo antes de abrir y dejas de perder reservas por no coger el teléfono.'),
  ('documentos_imprenta',
   'El cliente manda lo que quiere imprimir antes de venir. Cuando llega, el trabajo está hecho y el mostrador no se atasca.'),
  ('dossier',
   'Tus números salen presentables sin que nadie monte una presentación. Un enlace para enseñarlo en la reunión y un PDF para dejarlo.')
) as v(clave, txt)
where modulos_catalogo.clave = v.clave
  and modulos_catalogo.beneficio is null;

-- Una sola biblioteca común a todos los leads: la captura se sube una vez y se
-- reutiliza en cada propuesta. Siempre del tenant de demostración, jamás de un
-- cliente real — la diapositiva 15 promete que los datos no se comparten, y
-- enseñar las cifras de otro negocio la desmiente en la misma presentación.
create table if not exists capturas_producto (
  id           bigserial primary key,
  modulo       text not null references modulos_catalogo(clave) on delete cascade,
  vista        text not null,                     -- qué pantalla es («Reportes financieros», «Caja»)
  url          text not null,                     -- bucket público `capturas`
  alt          text not null,
  -- Las medidas reales del fichero, que las pone la subida. Se pintan como
  -- `width`/`height` en el <img> para que el hueco esté reservado antes de que
  -- la imagen llegue: sin ellas, en una conexión lenta el texto salta cuando
  -- cada captura aterriza, y son ocho por presentación.
  ancho        int,
  alto         int,
  -- Vacío = vale para todos. Con valor, la variante: un restaurante ve la caja de
  -- un restaurante y una consultora ve la pantalla de servicios.
  sector       text[] not null default '{}',
  orden        int not null default 0,
  -- La UI se mueve cada semana y una propuesta que enseña una pantalla que ya no
  -- existe es peor que no enseñar ninguna. Esta fecha es lo que permite avisar a
  -- los 90 días en la pestaña donde se trabaja, en vez de confiar en la memoria.
  capturada_at date not null default current_date,
  activa       boolean not null default true
);

create index if not exists idx_capturas_modulo on capturas_producto (modulo, orden);

alter table public.capturas_producto enable row level security;
grant select, insert, update, delete on public.capturas_producto to service_role;
drop policy if exists "admin_full_access" on public.capturas_producto;
create policy "admin_full_access" on public.capturas_producto
  for all to authenticated using (true) with check (true);

-- Bucket PÚBLICO, como `contratos` (mig. 099) y a diferencia de los documentos
-- firmados (mig. 200): la propuesta se abre sin sesión desde un móvil en Cuba,
-- y una URL firmada que caduca deja el documento lleno de huecos al reabrirlo.
-- No hay nada confidencial dentro: son pantallas de un tenant de demostración.
insert into storage.buckets (id, name, public)
values ('capturas', 'capturas', true)
on conflict (id) do nothing;

notify pgrst, 'reload schema';
