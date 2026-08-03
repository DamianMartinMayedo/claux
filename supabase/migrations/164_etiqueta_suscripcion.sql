-- ================================================================
-- MIGRACIÓN 164: la etiqueta la nombra el negocio («Membresías», «Bonos»…)
--
-- La decisión 14 del plan del módulo lleva escrita desde el principio y nunca se
-- implementó: `plantillas_sector.etiquetas` no tenía la clave `suscripcion`, así
-- que un gimnasio ve «Suscripciones» donde dice «Membresías» y una peluquería
-- donde dice «Bonos». El código ya usa claves de módulo estables y deja la
-- palabra visible al sector (CONTEXTO §1); esto solo le faltaba a esta pieza.
--
-- CASCADA, la del repo: override del cliente → etiqueta del sector → genérico.
--
--   · `clients.etiquetas` es GENÉRICA a propósito (jsonb, default '{}'): sirve
--     para esta y para las que vengan. Un negocio puede llamar a las cosas como
--     quiera aunque comparta sector.
--   · El seed de `plantillas_sector` no pisa nada: hace merge (`||`) sobre el
--     jsonb existente, así que las etiquetas ya configuradas se conservan.
--
-- **Nunca «Contratos»**: `/portal/contratos` ya existe y es de RRHH. Dos entradas
-- «Contratos» en el mismo sidebar, una con personas y otra con clientes, es
-- confusión garantizada.
-- ================================================================

alter table clients
  add column if not exists etiquetas jsonb not null default '{}'::jsonb;

comment on column clients.etiquetas is
  'Override de etiquetas visibles de ESTE negocio (jsonb). Manda sobre plantillas_sector. Ej: {"suscripcion":"Membresías"}.';

-- Gimnasio → Membresías · estética/peluquería/barbería/clínica → Bonos ·
-- servicios → Servicios contratados · alquiler → Cuotas · resto → Suscripciones.
update plantillas_sector set etiquetas = etiquetas || jsonb_build_object('suscripcion',
  case sector
    when 'gimnasio'   then 'Membresías'
    when 'peluqueria' then 'Bonos'
    when 'barberia'   then 'Bonos'
    when 'estetica'   then 'Bonos'
    when 'clinica'    then 'Bonos'
    when 'servicios'  then 'Servicios contratados'
    when 'alquiler'   then 'Cuotas'
    else 'Suscripciones'
  end)
where not (etiquetas ? 'suscripcion');
