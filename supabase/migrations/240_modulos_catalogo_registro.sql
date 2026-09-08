-- Registro profesional: las descripciones del catálogo comercial
--
-- Cierra la fase 5 de `docs/planes/lenguaje-profesional.md`. Estas 13 filas no
-- son correo: se leen en el portal, en la propuesta comercial y en la FACTURA,
-- así que el «Tu carta o catálogo…» desentonaba con el resto de la plataforma,
-- ya en registro impersonal.
--
-- Como en `email_plantillas`, aquí manda la fila y no el defecto del código: el
-- texto se edita desde /admin y ya había derivado de las migraciones que lo
-- sembraron. Solo se toca `descripcion`; el nombre y el precio, no.
--
-- Diez de las trece tuteaban. `caja` no lo hacía con un pronombre sino con un
-- imperativo («Cobra y cierra… aunque estés»), que es como se escapa este tipo
-- de tuteo a un barrido por `\btu\b`.

UPDATE modulos_catalogo SET descripcion = 'Ventas, gastos, cobros y pagos, tesorería e informes. Con clientes y proveedores, y en varias monedas.' WHERE clave = 'base';
UPDATE modulos_catalogo SET descripcion = 'Qué hay, dónde está y cuánto queda. Compras, entradas y salidas.' WHERE clave = 'inventario';
UPDATE modulos_catalogo SET descripcion = 'Carta o catálogo con fotos y precios, que el cliente abre con un enlace o escaneando un código QR.' WHERE clave = 'catalogo_qr';
UPDATE modulos_catalogo SET descripcion = 'Catálogo de servicios con precio por moneda, más suscripciones y cobro recurrente. Para negocios que venden servicios y no mercancía física.' WHERE clave = 'servicios';
UPDATE modulos_catalogo SET descripcion = 'El equipo: contratos, turnos, ausencias y el pago de la nómina.' WHERE clave = 'rrhh';
UPDATE modulos_catalogo SET descripcion = 'Cobro y cierre de caja sin conexión; después se sincroniza solo. Ventas, cierres y stock.' WHERE clave = 'caja';
UPDATE modulos_catalogo SET descripcion = 'Atiende a los clientes, toma reservas y pedidos, y responde preguntas sobre el negocio.' WHERE clave = 'asistente_ia';
UPDATE modulos_catalogo SET descripcion = 'El cliente reserva mesa por su cuenta y todo queda en un panel.' WHERE clave = 'reservas_citas';
UPDATE modulos_catalogo SET descripcion = 'Citas por profesional, con la duración de cada servicio. El cliente pide hora por su cuenta.' WHERE clave = 'agenda';
UPDATE modulos_catalogo SET descripcion = 'Los números del negocio convertidos en una presentación para inversores: un enlace para enseñar y un PDF para enviar.' WHERE clave = 'dossier';

-- Las tres que ya estaban en registro correcto. A dos les faltaba el punto
-- final, y se leen seguidas en la misma lista.
UPDATE modulos_catalogo SET descripcion = 'Varias empresas o locales, con consolidación.' WHERE clave = 'multiempresa';
UPDATE modulos_catalogo SET descripcion = 'El cliente envía sus documentos por correo antes de recogerlos.' WHERE clave = 'documentos_imprenta';
