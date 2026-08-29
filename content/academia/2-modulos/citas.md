# Citas

> Funcionalidad del catálogo (clave interna `agenda`) · en el portal: **Citas**
> (`/portal/citas`) · página pública `/tu-negocio/citas`

Ficha completa, ordenada **de lo comercial a lo técnico**: un vendedor lee A y B; C sirve para
cerrar la venta; lo interno queda al final. Las etiquetas de cada bloque deciden en qué vista
aparece.

---

## A — Qué es

### 1. En una frase
> etiquetas: usar · básico

**Citas es la agenda del negocio: el cliente solicita hora en línea con un profesional concreto y
un servicio concreto, y el sistema garantiza que dos citas no ocupen el mismo hueco.**

### 2. Para quién
> etiquetas: usar · básico

Para cualquier negocio que **asigne una hora a una persona con un profesional o un recurso**:
barberías, peluquerías, centros de estética, estudios de tatuaje, consultas —médico, dentista,
fisioterapeuta, psicólogo— y alquiler de canchas o pistas. Según el sector, «profesional» se
presenta como **Barbero**, **Cabina** o **Cancha**: cambia la palabra, no el mecanismo.

> **No confundir con Reservas.** *Citas* asigna **una cita por profesional y hueco** —una silla,
> un médico, una hora—. *Reservas* administra **aforo por franja** —una mesa de cuatro, cuarenta
> plazas en una clase—. Son dos funcionalidades distintas, se venden por separado y un mismo
> negocio puede tener ambas.

### 3. El problema que resuelve
> etiquetas: usar · básico

La agenda en papel impone tres límites simultáneos. Solo admite reservas mientras hay alguien
para atender el teléfono, de modo que la demanda fuera de horario —que existe, y es considerable—
se pierde íntegra. No verifica nada: dos anotaciones pueden ocupar el mismo hueco y el conflicto
se descubre con los dos clientes ya en el local. Y no distingue entre profesionales: la ausencia
de uno solo obliga a revisar la libreta entera a mano. Citas resuelve las tres al hacer que los
huecos se **calculen** a partir del horario real de cada profesional: el cliente pide a cualquier
hora y **solo puede elegir entre los que están efectivamente libres**.

---

## B — Cómo funciona

### 4. Qué hace
> etiquetas: usar · básico

Todo el módulo descansa sobre una idea: el hueco no se declara, se deriva. De ahí el recorrido de
configuración, que va del servicio al horario y del horario a la disponibilidad publicada.

```claux:flujo
```

El panel se organiza en cuatro pestañas. **Agenda** es el listado completo de citas, con filtros
por **estado**, por **profesional** y por **rango de fechas**, buscador, y el recuento de las
citas **de hoy** en cabecera; desde ella se da de alta una cita a mano con **Nueva cita**.
**Servicios** define los **tipos de cita con su duración** —«Corte 30 min», «Corte + barba
45 min», «Consulta 1 h»—, y esa duración es exactamente la que bloquea el hueco; con un solo
servicio se puede empezar a operar, y pueden **importarse los del catálogo digital** si ya está
montado. **Personal** —o «Barberos», «Cabinas», según el sector— reúne a quienes atienden: cada
uno con su **horario semanal**, que es lo que genera los huecos —un profesional sin horario no
produce ninguna hora disponible—, y con sus **días libres y ausencias**, que retiran sus huecos
sin afectar a los demás ni cerrar el negocio; se dan de alta a mano o se **importan de RRHH**.
**Configuración** cubre tres asuntos: la **confirmación automática**, que decide si las citas se
confirman solas al entrar o una a una; el **enlace de citas** con su botón de copiar y su
**código QR** para el local; y el **bot de Telegram**, un canal propio para recibir solicitudes.

### 5. Principios de funcionamiento
> etiquetas: usar · básico

Siete reglas gobiernan la agenda, y la primera es la que sostiene a las demás:

- **Tres puertas, una sola regla.** Una cita puede entrar por la **web pública**, por el **bot de
  Telegram** o **a mano** desde el panel, y las tres atraviesan el mismo control. La antelación
  mínima y la ventana de reserva rigen por igual en los tres canales: ninguna regla vale «solo si
  se entra por la web».
- **La vida de una cita son sus estados.** Nace **Pendiente** o **Confirmada** según el ajuste,
  pasa a **Atendida** cuando ya ocurrió y puede terminar **Cancelada**, **Rechazada** o
  **Caducada**. Cada estado tiene su color en la Agenda.
- **El pasado lo cierra el sistema.** Una cita Pendiente cuya fecha ya pasó se marca **Caducada**
  automáticamente; una Confirmada ya vencida se da por **Atendida** a los siete días. La pantalla
  indica que el cierre lo hizo el sistema, para que no se atribuya a una acción del usuario.
- **Deshacer es posible, con condiciones.** Una cita cancelada o rechazada puede **recuperarse**
  —vuelve a Pendiente— pero solo si la fecha es futura y el hueco continúa libre: entretanto puede
  haberse asignado a otro cliente.
- **Mover no equivale a cancelar.** Cambiar una cita de hora la **desplaza** conservando cliente
  e historial, en lugar de generar una baja y un alta sin relación entre sí.
- **El dueño puede forzar; el cliente, nunca.** Desde el alta manual, el negocio puede saltarse
  una regla e insertar una cita donde el sistema no la admitiría: **se advierte, no se bloquea**,
  y la cita queda marcada como forzada, de modo que más adelante se entienda por qué ese día
  había un hueco de más. Desde la web o el bot esa posibilidad no existe.
- **Los avisos son deliberadamente asimétricos.** Al **dueño** le llegan por campana y por
  Telegram. Al **cliente final CLAUX no le escribe** —ver alcance honesto—: dispone de su
  **enlace de gestión** para cancelar o mover por sí mismo, y el dueño cuenta con un botón que
  abre el chat con el mensaje ya redactado. Si el cliente llegó por el bot, el bot le responde en
  su propia conversación.
- **Todo se calcula en la hora del negocio.** El «hoy» y los huecos los determina el servidor en
  la zona horaria del negocio, no el reloj del teléfono de quien reserva: una cita de última hora
  no se desplaza al día siguiente porque el cliente tenga el móvil en otro huso.

### 6. Cómo se conecta
> etiquetas: usar · avanzado

Citas comparte identidad pública con las demás piezas de cara al cliente y admite llenado desde
las internas, sin depender de ninguna.

```claux:conexiones
```

La funcionalidad **se vende y funciona sola**. Sin RRHH, los profesionales se dan de alta a mano;
sin catálogo, los servicios se escriben; sin el addon de IA, el bot opera con botones. Nada de
esto degrada la agenda: solo cambia el camino para llegar al mismo dato.

```claux:capas
```

### 7. Cómo se usa (paso a paso)
> etiquetas: usar · básico

1. **Fijar la dirección web**: Configuración › Enlace de citas → elegir `tu-negocio`.
2. **Crear los servicios** con su duración. Con uno basta para empezar.
3. **Dar de alta al personal** con su **horario semanal**, o importarlo de RRHH. Sin horario no
   hay huecos.
4. **Elegir el modo de confirmación**: automática o una a una.
5. *(Opcional)* **Conectar el bot de Telegram** para recibir citas por ese canal.
6. **Compartir el enlace o colocar el QR** en el local. Las citas entran en la **Agenda**.

*(Este paso a paso es también el borrador de la futura ayuda del cliente.)*

---

## C — Venderlo

### 8. Cómo se vende + guion de demo
> etiquetas: vender · básico

**El gancho:** «Que sus clientes pidan hora solos, a cualquier hora del día, sin llamar — y sin
que se crucen dos en la misma silla.»

**Demo de dos minutos:**
1. Abrir el **enlace público en el móvil**: elegir servicio, día y hora, haciendo notar que
   **solo aparecen huecos reales**.
2. Dejar un teléfono y **confirmar**. Pasar al panel: la cita ya figura en la **Agenda**.
3. Mostrar cómo se **mueve** una cita y cómo se **marca un día libre** de un profesional: sus
   huecos desaparecen sin afectar a los demás.
4. Si el cliente utiliza Telegram, enseñar el **bot**.

**Objeciones frecuentes:**
- *«Yo lo llevo en una libreta.»* → La libreta no atiende de madrugada ni evita solapes; y ante
  la ausencia de un profesional, aquí se marca y deja de dar horas sin cerrar el negocio.
- *«Mis clientes no van a saber usarlo.»* → Son tres toques, el mismo gesto que pedir un taxi por
  aplicación; y el teléfono sigue estando. El QR en la puerta hace el resto.
- *«¿Y si me piden algo que no puedo atender?»* → El negocio decide si las citas se confirman
  solas o pasan por revisión una a una.

### 9. Precio y activación
> etiquetas: vender · básico

- **El precio lo fija el nivel del cliente** (Inicial · Empresa · Pro): los tres importes están
  arriba, en la cabecera de esta ficha, leídos del catálogo en vivo. Aquí no se teclean — un
  número escrito a mano en el manual se queda viejo el día que el dueño cambie el precio.
- **Funciona sola:** no exige Contabilidad ni ningún otro módulo.
- Se activa desde la ficha del cliente y el negocio la ve al instante en su portal.

---

### Alcance honesto
> etiquetas: vender · básico

CLAUX **no escribe al cliente final**: no hay correo automático de recordatorio, y la WhatsApp
Business API no admite números +53. El canal de vuelta es **su enlace de gestión** y el propio
dueño con un botón. La **vista de día** y la **lista de espera** siguen en backlog. No deben
prometerse recordatorios automáticos por SMS o WhatsApp.

## Interno

### Soporte por síntoma
> etiquetas: operar · avanzado

- **«No aparecen huecos en el enlace.»** → El profesional carece de **horario semanal**
  (Personal › su horario). Sin horario no se generan horas.
- **«El bot no responde o no avisa.»** → Configuración › Bot › **Comprobar** y, si procede,
  **Reparar**; comprobar además que el **chat del dueño esté vinculado** mediante el `/start` con
  su código. Existe un botón de **Aviso de prueba**.
- **«Contraté solo Citas y no me deja guardar el enlace.»** → Ya resuelto: el enlace es **del
  negocio**, no de Reservas, y se guarda igual desde Citas.
- **«Un profesional se ausentó una semana y se desordenó todo.»** → Personal › **Días libres y
  ausencias**: se registra la ausencia y deja de ofrecer esos huecos, sin tocar a los demás.
