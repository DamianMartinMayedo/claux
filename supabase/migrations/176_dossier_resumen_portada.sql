-- 176 · Resumen ejecutivo de la portada del dossier
--
-- Una línea de pitch bajo el nombre en la portada del deck («qué es este negocio
-- en una frase»). Es lo primero que lee el inversor tras el nombre y sube mucho la
-- primera impresión. Texto libre, corto; el dueño lo escribe (o lo genera la IA con
-- el addon). Opcional: si está vacío, la portada simplemente no lo pinta.

alter table public.dossiers
  add column if not exists resumen_portada text;

comment on column public.dossiers.resumen_portada is
  'Línea de pitch de la portada del deck, bajo el nombre. Opcional; vacío = no se pinta.';
