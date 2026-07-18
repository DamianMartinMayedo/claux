-- Revierte 020_realtime_clients.sql: saca `clients` de la publicación de Realtime.
--
-- Motivo: su único suscriptor era PortalRealtimeSync, y NO funcionaba. Los
-- eventos de `postgres_changes` se entregan filtrados por las políticas RLS del
-- rol que se suscribe; el navegador del portal usa la clave anon (sus usuarios
-- son `client_users` con JWT HMAC propio, no Supabase Auth) y la única policy de
-- `clients` es para `authenticated`. El canal llegaba a SUBSCRIBED —parecía
-- sano— y no entregaba un solo evento. Comprobado A/B contra esta misma BD:
-- con anon 0 eventos, con service_role 1.
--
-- No se arregla con una policy de SELECT para `anon`: expondría la fila de
-- TODOS los tenants a una clave que viaja en el navegador.
--
-- El componente se sustituyó por `PortalSync`, que refresca al volver a la
-- pestaña. Sin suscriptores, replicar esta tabla es trabajo de WAL para nadie.
--
-- Si algún día el portal pasa a Supabase Auth, se revierte esto y se restaura
-- la suscripción (junto con la de `notificaciones`, ver 109).

ALTER PUBLICATION supabase_realtime DROP TABLE clients;
