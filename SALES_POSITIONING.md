# SALES_POSITIONING.md

## ¿Por qué un residencial compraría GateFlow?

Porque el costo real de no tener esto no es abstracto: son las llamadas de residentes molestos, el tiempo del guardia buscando en una libreta, y la exposición de la administración cuando no hay forma de probar que un paquete sí se entregó. GateFlow no vende "tecnología" — vende que esa conversación incómoda deje de pasar.

## ¿Por qué no seguir usando papel o Excel?

- **Papel se pierde, se moja, no se busca.** Encontrar un paquete de hace tres días en una bitácora física es lento incluso cuando el guardia recuerda que existe.
- **Excel no tiene evidencia.** Una celda con "entregado" no es prueba de nada frente a un reclamo — no dice quién lo recibió, ni cuándo exactamente, ni con qué firma.
- **Ni papel ni Excel notifican a nadie.** El residente se entera por suerte, no por diseño.
- **Ninguno de los dos aísla datos entre residenciales** si la misma administradora gestiona varios — un Excel compartido es un incidente de privacidad esperando a pasar.

## Beneficios por rol

**Administración:**
- Visibilidad en tiempo real de cuántos paquetes hay pendientes y desde cuándo, sin llamar a portería.
- Evidencia real ante cualquier reclamo — quién recibió, quién entregó, cuándo, con qué código.
- Migración de datos existentes (unidades, residentes) en minutos, no recapturando a mano.
- Cero curva de aprendizaje real — la interfaz se entiende en la primera sesión.

**Recepción / guardia:**
- Registrar un paquete toma segundos, no minutos — no compite con las demás tareas de portería.
- Nunca tiene que "recordar" dónde dejó algo — la ubicación física queda registrada.
- Menos confrontación: la evidencia respalda al guardia tanto como al residente.

**Residente:**
- Sabe cuándo llegó su paquete sin tener que preguntar.
- Certeza de que existe un registro verificable de la entrega.

## Objeciones frecuentes y cómo responderlas

**"Ya tenemos un sistema de administración de condominios."**
La mayoría de esos sistemas tratan paquetería como una función secundaria dentro de un módulo pensado para cuotas y áreas comunes. GateFlow está diseñado exclusivamente para portería — no compite por reemplazar ese sistema, resuelve lo que ese sistema resuelve mal.

**"¿Y si el guardia no sabe usar tecnología?"**
La interfaz de portería tiene tres pasos, botones grandes, y ningún menú que aprender — se diseñó asumiendo exactamente ese escenario, no una persona con experiencia en software.

**"¿Qué pasa si no hay internet en la caseta?"**
Es una limitación real hoy (la sincronización offline completa está en el roadmap, no construida todavía) — se responde con honestidad, no se oculta. Lo que sí existe: la app funciona como PWA instalable, preparada arquitectónicamente para operar sin conexión en una fase posterior.

**"¿Cómo sé que mis datos están seguros, sobre todo si administro varios residenciales?"**
El aislamiento entre residenciales se garantiza a nivel de motor de base de datos (Row Level Security), no solo en el código de la aplicación — es una garantía estructural, verificable, no una promesa de que "el código no tiene bugs".

**"¿Cuánto cuesta migrar nuestros datos actuales?"**
La importación masiva desde una plantilla descargable resuelve esto en una sesión, no en semanas de captura manual.

**"¿Qué pasa si dejamos de usar GateFlow?"**
La exportación de los propios datos del residencial está contemplada como parte de la arquitectura (`SECURITY_ARCHITECTURE.md §8`) — los datos de un cliente le pertenecen a ese cliente, no quedan cautivos.
