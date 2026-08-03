# Planes de trabajo

Carpeta para los **planes de implementación** (features grandes, migraciones, refactors, recuperaciones de contexto entre agentes).

## Reglas

- **Cuando un agente elabora un plan** de cierta envergadura, guarda una **copia en Markdown aquí** (`docs/planes/<nombre-en-kebab>.md`), para que **cualquier otro agente** (o tú) pueda leerlo y retomar el trabajo sin perder contexto.
- **No se versionan.** Todo `docs/planes/*` está en `.gitignore` (excepto este `README.md`): los planes son documentos de trabajo, no forman parte del repo. Así un plan de un intento no acaba commiteado por error.
- Son **legibles por los agentes que trabajan sobre esta copia local** del repo (varios agentes de Claude en la misma máquina). No viajan con un `git clone` limpio — son locales a propósito.
- Un plan **cumplido y obsoleto** se borra; no se conserva "por si acaso".

## Cómo se sabe en qué punto está cada plan

Hay más de veinte planes conviviendo y varios a medias. Tres reglas para que no haya que abrir todos para saberlo:

1. **`ESTADO.md` es el índice.** Lista todos los planes con su estado (en curso · por revisar · terminado · no es un plan), el siguiente paso de los vivos y la **reserva de números de migración**. Se lee antes de empezar cualquier trabajo de esta carpeta y **se actualiza al terminar cada fase**, no al final del plan.
2. **Cada plan lleva su registro de ejecución al final** — una tabla `Fase | Estado | Migración | Fecha`, con `hecha` / `pendiente` / `⏳`. El modelo a copiar es el de `servicios-correcciones.md`. Marcar la fase forma parte de terminarla, igual que actualizar `CONTEXTO §2`.
3. **Una cabecera de estado no basta y envejece mal.** Varias cabeceras de esta carpeta afirman cosas que dejaron de ser ciertas hace semanas. Ante una contradicción: manda el registro de ejecución sobre la cabecera, y `docs/CONTEXTO.md §2` sobre el plan entero.

**Antes de escribir una migración nueva**, mirar la tabla de reserva de `ESTADO.md`, coger el primer número libre y apuntarlo ahí en el mismo movimiento: hay planes en paralelo que reservan números y se pisan.

## Formato sugerido

Título claro + **Contexto** (qué problema resuelve, estado real verificado) + **Pasos** + decisiones abiertas + **registro de ejecución**. Cuanto más autocontenido, mejor: otro agente debe poder ejecutarlo sin esta conversación.
