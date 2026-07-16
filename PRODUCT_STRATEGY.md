# PRODUCT_STRATEGY.md

## Qué problema resuelve GateFlow

La recepción de paquetes en residenciales mexicanos se gestiona hoy con bitácoras en papel, hojas de Excel sueltas, o mensajes de WhatsApp entre guardia y administración — sin registro consistente, sin evidencia de entrega, y sin forma de resolver un "nunca me entregaron mi paquete" más allá de la palabra de alguien contra la de otro. El volumen de comercio electrónico hace que este problema, antes menor, hoy genere fricción diaria real entre residentes, guardias y administración.

## Propuesta de valor

GateFlow convierte la recepción de paquetería en un proceso de segundos, con evidencia verificable en cada entrega, y visibilidad total para la administración — sin exigirle al guardia nada más complicado que buscar una unidad y tocar una pantalla.

## Público objetivo

**Comprador (quien decide y paga):** administración de residenciales, condominios y fraccionamientos privados en México, típicamente gestionados por una empresa administradora o un comité de residentes, con entre 30 y 300 unidades.

**Usuario operativo primario:** el guardia de seguridad en portería — no tiene por qué ser una persona técnica, y su tolerancia a fricción es cero durante un turno activo.

**Usuario final beneficiado:** el residente, que recibe notificación y tiene certeza de cuándo y con quién llegó su paquete.

## Diferenciadores

- **Diseñado desde la portería, no adaptado a ella.** La mayoría de software de administración de condominios trata paquetería como un módulo secundario dentro de un sistema pensado para cuotas y áreas comunes. GateFlow nace exactamente al revés: la portería es el centro, no un anexo.
- **Evidencia real, no solo un registro.** Firma y evidencia fotográfica en la entrega (en construcción — ver `MVP_CHECKLIST.md`), código único por paquete, historial inmutable.
- **Aislamiento de datos verificado a nivel de base de datos**, no solo de aplicación — relevante para cualquier administradora que gestiona varios residenciales y no puede permitirse que los datos de uno se mezclen con los de otro.
- **Import masivo real desde el primer día** — migrar de Excel a GateFlow no exige capturar manualmente cada unidad.

## Casos de uso

1. Un guardia registra un paquete en menos de 20 segundos y el residente recibe notificación sin que nadie tenga que llamarlo.
2. Un residente llega a recoger un paquete y el guardia lo encuentra por nombre, unidad o escaneando el código, sin buscar en una bitácora física.
3. Un administrador revisa, sin estar presente físicamente, cuántos paquetes hay pendientes y desde hace cuánto tiempo.
4. Una administradora que gestiona varios residenciales usa la misma cuenta para navegar entre todos, con la certeza de que ver los datos de uno nunca implica ver los del otro.
5. Un residencial que migra de una hoja de Excel de 200 filas a GateFlow lo hace en minutos, no recapturando unidad por unidad.

## Roadmap de producto (alto nivel, no comprometido en fechas)

- **MVP piloto (Sprint 03, este):** recepción, entrega, dashboard ejecutivo, configuración del residencial, importación masiva. Sin visitantes, proveedores, amenidades, incidencias ni reservaciones.
- **Post-piloto inmediato:** firma digital y evidencia fotográfica completa en la entrega; subida real de logo; notificaciones WhatsApp activas (hoy diseñadas, no conectadas a un proveedor real).
- **Expansión de módulo de portería:** Incidencias (paquetes dañados/extraviados) como su propio flujo, no solo una nota en el paquete.
- **Plataforma de portería completa** (visión de largo plazo, `MISION.md`): visitantes, control de accesos, correspondencia, reservas de áreas comunes — cada uno como módulo independiente sobre el mismo núcleo de tenant/usuarios/roles ya construido.
