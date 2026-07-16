-- Registra que el lead pidió que le contactaran desde el informe.
--
-- Antes no se guardaba en ninguna parte: el botón «Quiero que me contacten
-- gratis» solo cambiaba la pantalla a «¡Gracias!» y no enviaba ni registraba
-- nada, mientras que el correo de agendar cita salía al pulsar «Ver mi informe»
-- —o sea, a todo el que llegaba al informe, sin haberlo pedido—. Con esto el
-- correo pasa a colgar del botón que lo pide, y queda constancia de quién lo pidió.
--
-- Doble función: además de dato de negocio (NULL = solo miró el informe), es el
-- candado de idempotencia del envío. La acción que manda el correo es pública y
-- sin sesión, así que solo envía si esto está a NULL: ni un doble clic ni una
-- llamada repetida pueden provocar reenvíos.
alter table public.diagnosticos
  add column if not exists contacto_solicitado_at timestamptz;

comment on column public.diagnosticos.contacto_solicitado_at is
  'Cuándo el lead pulsó «Quiero que me contacten gratis» en el informe. NULL = solo vio el informe.';
