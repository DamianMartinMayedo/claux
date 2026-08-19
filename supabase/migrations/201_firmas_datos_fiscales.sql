-- ================================================================
-- MIGRACIÓN 201: Datos fiscales de firma + caducidad de firmas
--
-- Para que el contrato y el NDA tengan rigor legal, el cliente debe identificar
-- oficialmente a la empresa (razón social, NIF/CIF, domicilio fiscal) y al
-- representante que firma (nombre + documento de identidad). Esos datos no
-- estaban: solo teníamos `nombre_empresa` (nombre comercial, a veces genérico) y
-- el contacto. Ahora el cliente los rellena en su perfil ANTES de poder ver y
-- firmar; se guardan en `clients.datos_firma` (jsonb: razon_social, nif,
-- domicilio_fiscal, representante_nombre, representante_doc).
--
-- CADUCIDAD DE FIRMAS: una vez firmado un documento, los datos fiscales quedan
-- bloqueados (cambiarlos rompería la correspondencia con el hash firmado). Para
-- permitir una actualización legítima, el admin puede "reabrir": marca las firmas
-- vigentes como caducadas (`caducada_at`), lo que desbloquea la edición y obliga
-- a re-firmar — como un vencimiento. Las firmas caducadas quedan en histórico (su
-- PDF sigue siendo prueba de lo que se firmó entonces).
--
-- El único activo pasa a ser un índice PARCIAL: una firma VIGENTE por
-- (cliente, tipo, versión). Las caducadas no cuentan para el único, así que
-- re-firmar la misma versión tras una reapertura no choca.
-- ================================================================

-- Datos fiscales del cliente (bloque cohesionado, opcional hasta que se rellena).
alter table clients
  add column if not exists datos_firma jsonb not null default '{}'::jsonb;

-- Caducidad de una firma (null = vigente).
alter table firmas_documentos
  add column if not exists caducada_at timestamptz;

-- El único deja de ser total y pasa a ser parcial sobre las vigentes.
alter table firmas_documentos
  drop constraint if exists firmas_documentos_client_id_tipo_version_key;
create unique index if not exists firmas_documentos_vigente_uniq
  on firmas_documentos (client_id, tipo, version)
  where caducada_at is null;

notify pgrst, 'reload schema';
