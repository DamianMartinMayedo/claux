-- 233 · El contacto de trabajo de cada comercial (el que ve el cliente)
--
-- La propuesta la firma una persona, y hasta ahora esa firma salía de la cuenta
-- de acceso: gmails personales los tres. Un correo personal en un documento
-- comercial es peor que no poner ninguno.
--
-- Estos dos campos son el contacto que SÍ se enseña. Nulo es lo normal y no es
-- un hueco: quien no tenga el suyo firma con el de la empresa
-- (`proveedor_email` / `proveedor_telefono` de `settings`). El día que venda
-- alguien de fuera, es aquí donde pone los suyos.
--
-- El correo de acceso (`email`, la clave de la tabla) no se toca: sigue siendo
-- con lo que se entra, y no se enseña a nadie.

alter table public.admin_users
  add column if not exists email_publico    text,
  add column if not exists telefono_publico text;

comment on column public.admin_users.email_publico is
  'Correo de trabajo que sale en la propuesta. Nulo ⇒ el de la empresa (settings.proveedor_email).';
comment on column public.admin_users.telefono_publico is
  'WhatsApp que sale en la propuesta. Nulo ⇒ el de la empresa (settings.proveedor_telefono).';
