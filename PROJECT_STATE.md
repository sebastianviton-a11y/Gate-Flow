# PROJECT_STATE.md

Vista de conjunto de GateFlow. Para el detalle táctico del sprint activo, ver `CURRENT_STATE.md`. Para la lectura comercial del producto, ver `PRODUCT_STRATEGY.md` y `SALES_POSITIONING.md`.

## Documentación

| Documento | Estado |
|---|---|
| `00-PRD.md`, `MISION.md`, `01-BUSINESS_RULES.md`, `02-ARCHITECTURE.md`, `03-DATABASE.md`, `04-API.md`, `CLAUDE.md` (v1.2) | Aprobados |
| `docs/adr/0011-separacion-admin-guard.md` | Aprobado |
| `SECURITY_ARCHITECTURE.md` | Aprobado |
| `PRODUCT_STRATEGY.md`, `SALES_POSITIONING.md`, `MVP_CHECKLIST.md`, `DECISIONS.md` | Nuevos este sprint |
| `05-UX.md`, `06-ROADMAP.md` formales, ADR-001 a ADR-010 | Pendientes (heredado) |

## Código — por sprint

| Sprint | Alcance | Estado |
|---|---|---|
| Sprint 01 | Auth, layout admin, dashboard mock, navegación | `PENDING LOCAL VALIDATION` |
| Sprint 1.5 | Separación `apps/admin`/`apps/guard` | `PENDING LOCAL VALIDATION` |
| Sprint 02 | Módulo Paquetes end-to-end | `PENDING LOCAL VALIDATION` |
| **Sprint 03** | MVP comercial: dashboard ejecutivo, configuración, importación masiva | **`PENDING LOCAL VALIDATION`** |
| Sprint 04 (propuesto) | Firma/evidencia fotográfica en entrega — mayor bloqueador comercial identificado | No iniciado |

## Estructura actual del monorepo

Sin cambios estructurales respecto a Sprint 02 — mismo monorepo (2 apps, 5 paquetes compartidos), 9 migraciones SQL (2 nuevas: promedio de entrega en dashboard, contacto informal en unidades).

## Módulos del producto — estado de implementación

| Módulo | Documentado | Código |
|---|---|---|
| Núcleo de plataforma | Sí | Esquema listo; sesión con fallback demo |
| Paquetes (recepción/entrega/búsqueda) | Sí | Conectado end-to-end; firma/evidencia pendiente |
| Dashboard | Sí | Rediseñado, datos reales |
| Configuración del residencial | Sí (nuevo) | Conectado — logo por URL, no subida de archivo |
| Importación masiva de unidades | Sí (nuevo) | Conectado — CSV, sin estructura calle/manzana/edificio |
| Incidencias / Notificaciones / Offline real | Sí | No — explícitamente fuera de alcance |
| Visitantes / Accesos / Correspondencia / Reservas / Comunicados / Proveedores / Vehículos | Solo visión | No |

## Riesgos abiertos (acumulados + nuevos de este sprint)

- Ningún sprint tiene evidencia de ejecución real — persiste desde Sprint 01.
- Firma/evidencia fotográfica en entrega: ahora identificado explícitamente como el bloqueador de mayor impacto comercial, no solo técnico (`MVP_CHECKLIST.md`).
- Importación masiva no crea estructura de calle/manzana/edificio — decisión de alcance documentada (D0xx, `DECISIONS.md`), no un olvido.
- Resto de riesgos heredados sin cambios: nombres de constraint FK sin verificar, backup de Storage sin definir, acceso de soporte sin mecanismo de sesión acotada (`SECURITY_ARCHITECTURE.md`).

## Regla de avance

Ningún sprint nuevo se declara iniciado formalmente mientras el anterior no tenga su estado resuelto explícitamente. Los cuatro sprints de código están en `PENDING LOCAL VALIDATION`.
