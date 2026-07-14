# Planes de trabajo

Carpeta para los **planes de implementación** (features grandes, migraciones, refactors, recuperaciones de contexto entre agentes).

## Reglas

- **Cuando un agente elabora un plan** de cierta envergadura, guarda una **copia en Markdown aquí** (`docs/planes/<nombre-en-kebab>.md`), para que **cualquier otro agente** (o tú) pueda leerlo y retomar el trabajo sin perder contexto.
- **No se versionan.** Todo `docs/planes/*` está en `.gitignore` (excepto este `README.md`): los planes son documentos de trabajo, no forman parte del repo. Así un plan de un intento no acaba commiteado por error.
- Son **legibles por los agentes que trabajan sobre esta copia local** del repo (varios agentes de Claude en la misma máquina). No viajan con un `git clone` limpio — son locales a propósito.
- Un plan **cumplido y obsoleto** se borra; no se conserva "por si acaso".

## Formato sugerido

Título claro + **Contexto** (qué problema resuelve, estado real verificado) + **Pasos** + decisiones abiertas. Cuanto más autocontenido, mejor: otro agente debe poder ejecutarlo sin esta conversación.
