# MISIÓN — GateFlow

## Misión

Digitalizar la operación de portería de residenciales, condominios y urbanizaciones privadas, comenzando por la gestión de paquetes, para eliminar la pérdida de información, dar evidencia verificable de cada entrega, y devolverle tiempo al personal operativo que hoy resuelve esta tarea con papel, memoria y mensajes sueltos de WhatsApp.

## Visión

Ser la plataforma sobre la que corre la operación completa de la caseta de vigilancia en Latinoamérica: paquetes, visitantes, accesos, correspondencia, incidencias, reservas, comunicados, proveedores y vehículos, unificados en un mismo sistema, con el mismo estándar de simplicidad para el usuario que ejecuta la tarea en campo.

## A quién servimos primero

Al guardia de seguridad, no al administrador. Un sistema que resuelve la vida del administrador pero le exige más tiempo o atención al guardia fracasa en la práctica, sin importar cuántas funcionalidades tenga. Cada decisión de producto se evalúa primero por su costo para quien está de pie, bajo presión, con las manos ocupadas.

## Principios rectores

- **La velocidad de campo es innegociable.** Si una funcionalidad no puede ejecutarse en segundos por un guardia bajo presión, se rediseña o no se construye.
- **La evidencia reemplaza a la palabra.** Toda entrega, toda incidencia, todo cambio relevante queda respaldado con foto, firma o registro auditable — no con la confianza en que alguien "se acuerde".
- **La arquitectura crece por módulos, no por parches.** Cada nueva capacidad (visitantes, accesos, reservas) se incorpora como una pieza independiente sobre la misma base de tenant, unidades, usuarios y roles — nunca como una excepción al modelo existente.
- **El aislamiento entre residenciales es una garantía, no una intención.** La separación de datos entre tenants se sostiene en el motor de base de datos, no en la disciplina del código de la aplicación.
- **Simple hoy, escalable mañana, sin rediseñar.** Toda decisión técnica se toma pensando en miles de residenciales, incluso cuando el primer cliente es uno solo.
- **El costo operativo se gana, no se hereda.** La infraestructura se mantiene deliberadamente barata en las primeras etapas; la complejidad y el gasto se justifican con volumen real, no con anticipación especulativa.

## Qué NO somos

- No somos un sistema de paquetería con funciones extra — somos una plataforma de portería cuyo primer módulo es paquetería.
- No somos una app pensada para oficina que se adaptó a campo — el diseño nace desde las condiciones del guardia, no al revés.
- No somos un proyecto que sacrifica aislamiento de datos, auditabilidad o simplicidad de mantenimiento por velocidad de entrega de funcionalidades.

## Cómo se mide si esta misión se está cumpliendo

- Un guardia que nunca usó GateFlow puede registrar un paquete correctamente en su primer turno, sin capacitación extensa.
- Un residencial puede operar completamente sin internet durante un corte de servicio, sin perder un solo registro.
- Un residencial nuevo puede incorporarse a la plataforma sin que el equipo de GateFlow tenga que escribir código o tocar la base de datos manualmente.
- Cuando llegue el segundo módulo (Visitantes o el que corresponda), se construye reutilizando tenants, unidades, usuarios y roles ya existentes — no se rediseña la base.
