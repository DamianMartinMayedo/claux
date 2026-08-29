# CLAUX Academia — fuente del manual

Esta carpeta es **la fuente única** del conocimiento de CLAUX: un solo contenido del que
salen todas las salidas (web pública, manual de quien vende, manual interno y, al final, la
ayuda del cliente). No se duplica: se **proyecta** filtrando por etiquetas.

- El **plan y las decisiones** viven en `docs/planes/CLAUX-academia.md`.
- Aquí vive el **contenido** en Markdown. Cada archivo es una pieza del manual completo
  («el nuestro», la raíz). Las vistas de vendedor y de cliente son filtros de esto mismo.

## Cómo se etiqueta cada pieza

Cada sección lleva dos etiquetas que deciden en qué vista aparece:

- **Para quién:** `vender` · `usar` · `operar` · `confidencial`
- **Profundidad:** `básico` · `avanzado`

En el Markdown van como una línea al empezar la sección:
`> etiquetas: vender · básico`. La herramienta (fase 1) las leerá para armar cada vista;
por ahora sirven para escribir pensando en la proyección (el vendedor ve lo comercial y lo
técnico plegado en «modo avanzado»; el cliente ve solo lo de usar).

## Estructura (las 6 partes del manual)

1. **CLAUX de un vistazo** — `1-claux-de-un-vistazo.md`
2. **Los módulos** — `2-modulos/` (una ficha por cosa que se vende del catálogo)
3. Vender · 4. Poner en marcha y sostener · 5. Especializado · 6. Referencia *(pendientes)*

## Las cinco reglas de redacción (innegociables)

1. **Vocabulario de pantalla, nunca de código.** Se escribe «Citas», no `agenda`;
   «Contabilidad», no `base`; «Clientes y proveedores», no `terceros`.
2. **Se describe lo que pasa, no cómo está hecho.** Comportamiento que el usuario ve.
3. **Cercano y directo.** Tuteo, frases cortas, voz activa.
4. **Todo verificable contra el producto.** Si el manual lo dice, el sistema lo hace. Por
   eso el «qué hace» se saca del código.
5. **Cubano donde toca.** Pesos, MLC, USD; el dolor local (la luz, la conexión, el contador).

## Estado

Fase 0 (documento maestro). Piloto: Parte I + la ficha de **Citas**, para validar tono y
plantilla antes de replicar a las 12 fichas del catálogo.
