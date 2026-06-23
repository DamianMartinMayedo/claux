-- Correo del cliente en reservas/citas (compartido por ambas funcionalidades).
-- Lo pide la mini-web pública (obligatorio de cara al cliente) para contacto/uso futuro.
alter table reservas add column if not exists email text;
