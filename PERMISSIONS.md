# PERMISSIONS.md — Matriz de permisos de GateFlow

**Última auditoría:** julio 2026, contra el código real del repositorio (migraciones SQL, RLS, middleware, Server Actions, componentes de navegación). Cada estado de esta tabla fue verificado leyendo el archivo correspondiente — ninguno se asumió.

## ⚠️ Nota sobre nombres de rol

Este documento fue solicitado usando `super_admin`, `tenant_admin`, `guard`. **Los nombres reales en el código y la base de datos son distintos** — no existe ningún renombramiento pendiente, es simplemente la nomenclatura real:

| Nombre usado en la solicitud | Nombre real en el código (`roles.clave`) |
|---|---|
| `super_admin` | `super_admin` (coincide) |
| `tenant_admin` | `admin_residencial` |
| `guard` | `guardia` |

Además, el catálogo real de roles tiene **4 roles más**, agregados en un sprint reciente de arquitectura multi-empresa: `admin_empresa`, `supervisor`, `recepcion`, `residente`. Estos son valores válidos en la base de datos, pero **no tienen ninguna pantalla, permiso ni comportamiento propio implementado todavía** — se documentan como "No aplica (rol preparado, sin implementar)" en toda la matriz.

Este documento usa los nombres reales (`admin_residencial`, `guardia`) en la matriz, con el mapeo de arriba como referencia.

## 1. Introducción

GateFlow es un sistema multi-tenant de gestión de paquetería para residenciales. Cada residencial (`tenant`) es una unidad de aislamiento independiente. Desde un sprint reciente, existe además una capa de **Empresa** por encima de los residenciales (una empresa puede administrar varios residenciales), pero esa capa todavía no tiene un rol con acceso real (`admin_empresa` está preparado, no implementado).

Cada usuario pertenece a uno o más residenciales a través de la tabla `user_tenants`, con un rol asignado por esa pertenencia — el rol no es una propiedad global del usuario, es específica de cada vínculo tenant-usuario.

## 2. Definición de roles (estado real)

### `super_admin`
Propietario y operador de la plataforma GateFlow. Acceso completo a todos los residenciales vía bypass explícito en RLS (`is_super_admin()`). **Implementado.**

### `admin_residencial` (equivalente a "tenant_admin")
Administrador de un residencial específico. Acceso limitado a su propio tenant vía `current_tenant_ids()`. **Implementado.**

### `guardia` (equivalente a "guard")
Personal operativo de recepción/seguridad de un residencial. Mismo aislamiento por tenant que `admin_residencial`, pero sin acceso a configuración, unidades ni usuarios. **Implementado.**

### `admin_empresa`, `supervisor`, `recepcion`, `residente`
Roles preparados en el catálogo (`roles.clave`), sin pantallas, sin RLS específica más allá del aislamiento general por tenant, sin uso real hoy. `residente` es el más antiguo de los cuatro (existe desde el primer sprint) pero tampoco tiene ninguna pantalla propia construida. **No implementado.**

## 3. Matriz de permisos por módulo

Leyenda de estado: 🟢 Implementado · 🟡 Parcial · 🔴 Pendiente · ⚪ No aplica

| Módulo | Acción | super_admin | admin_residencial | guardia | Estado |
|---|---|---|---|---|---|
| **Dashboard global** | Ver | ✅ | ❌ | ❌ | 🟢 (`/superadmin`, métricas reales) |
| **Residenciales / Tenants** | Ver | ✅ (todos) | ✅ (solo el suyo) | ❌ | 🟢 |
| | Crear | ✅ | ❌ | ❌ | 🟢 (vía invitación real, Server Action + service role) |
| | Editar | ✅ | ✅ (solo el suyo, vía Configuración) | ❌ | 🟢 |
| | Eliminar | ✅ | ❌ | ❌ | 🟢 (con confirmación por nombre en UI) |
| | Suspender/Activar | ✅ | ❌ | ❌ | 🟢 |
| **Dashboard del residencial** | Ver | ✅ (vía soporte) | ✅ | ✅ (vista "Hoy") | 🟢 |
| **Residentes** | Ver | ✅ | ✅ | ✅ (búsqueda) | 🔴 **Pantalla es un placeholder vacío — no hay consulta real ni RLS ejercida todavía** |
| | Crear/Editar/Eliminar | — | — | — | 🔴 No implementado |
| **Carga masiva de residentes** | Ejecutar | — | ✅ (importa como unidades, no como tabla `residentes_unidades` separada) | ❌ | 🟡 Implementado como importación de **unidades** con datos de contacto informal, no como alta formal en `residentes_unidades` |
| **Paquetes** | Ver | ✅ (vía soporte) | ✅ | ✅ | 🟢 |
| **Registro de paquetes** | Crear | ✅ (vía soporte) | ✅ | ✅ | 🟢 |
| **Entrega de paquetes** | Ejecutar | ✅ (vía soporte) | ✅ | ✅ | 🟢 |
| | Corregir/cancelar una entrega | — | — | — | 🔴 No existe flujo de corrección — ver sección 6 |
| **Historial de paquetes** | Ver | ✅ | ✅ | ✅ | 🟢 |
| | Exportar | — | ❌ | ❌ | 🔴 No implementado en ningún rol |
| **Evidencias y fotografías** | Ver/Subir | ✅ | ✅ | ✅ | 🟢 |
| **Códigos QR y de barras** | Generar/Escanear | ✅ | ✅ | ✅ | 🟢 |
| **Bodega y ubicaciones** | Ver | ✅ | ✅ | ✅ (para registrar/entregar) | 🟢 |
| | Crear/Editar/Eliminar | ✅ | ✅ | ❌ | 🟡 **RLS no distingue rol — cualquier miembro del tenant puede escribir en `ubicaciones`; la restricción a guardia solo existe porque la UI no le muestra el botón** |
| **Guardias y usuarios** | Ver | ✅ | ✅ (solo su tenant) | ❌ | 🟢 |
| | Crear (invitar) | ✅ (crea admin de un residencial) | ✅ (invita a su equipo) | ❌ | 🟢 |
| | Eliminar / desactivar | — | ❌ | ❌ | 🔴 No implementado para ningún rol |
| **Reportes** | Ver/Exportar | ❌ | ❌ | ❌ | 🔴 No implementado — no existe el módulo |
| **Exportaciones** | Ejecutar | — | — | — | 🔴 No implementado en ningún módulo |
| **Notificaciones** | Configurar/Enviar | — (WhatsApp automático, sin pantalla de gestión) | — | — | 🟡 Envío automático de WhatsApp implementado; no hay pantalla de configuración de plantillas para ningún rol |
| **Configuración del residencial** | Ver/Editar | ✅ | ✅ | ❌ | 🟢 |
| **Configuración global (GateFlow)** | Ver/Editar | ✅ (implícito, vía Super Admin) | ❌ | ❌ | 🟡 No existe una pantalla de "configuración global" separada — se administra creando/editando residenciales y empresas directamente |
| **Logs y auditoría** | Ver | 🟡 (solo vía SQL directo, no hay pantalla) | ❌ | ❌ | 🟡 `audit_log` existe y se escribe correctamente (impersonación, invitaciones), pero no tiene ninguna pantalla de consulta en la interfaz |
| **Planes y suscripciones** | Ver/Editar | ✅ | ❌ (solo lectura de su propio plan) | ❌ | 🟢 Estructura de datos lista (precio, fechas, estado); sin cobro real — explícitamente fuera de alcance por diseño |
| **Empresas** | Ver/Crear/Editar/Eliminar | ✅ | ❌ | ❌ | 🟢 |
| **Entrar como soporte (impersonación)** | Ejecutar | ✅ (auditado) | ❌ | ❌ | 🟢 |

## 4. Reglas obligatorias de aislamiento — verificadas contra el código

| Regla | Estado real |
|---|---|
| `admin_residencial` solo consulta/modifica registros de su `tenant_id` | 🟢 Verificado — toda política RLS de tablas operativas usa `tenant_id in (select current_tenant_ids())` |
| `guardia` solo consulta/modifica info operativa de su `tenant_id` | 🟢 Mismo mecanismo — pero ver fila de "Bodega" arriba: la restricción de **qué puede escribir** guardia dentro de su propio tenant es solo de interfaz en algunos casos, no de RLS |
| Ningún `admin_residencial`/`guardia` accede a otro residencial modificando URLs/IDs/requests | 🟢 RLS es la capa real — no depende de que el frontend oculte nada. Confirmado revisando que las políticas usan `current_tenant_ids()`, resuelto server-side vía `auth.uid()`, no vía ningún parámetro que el cliente pueda falsificar |
| Restricciones en frontend **y** backend | 🟡 Backend (RLS) es sólido y consistente. Frontend tiene *algunos* casos donde solo esconde el botón sin que exista la restricción equivalente en RLS (ver "Bodega") |
| RLS como capa principal de seguridad | 🟢 Confirmado como patrón consistente en las 5 migraciones de RLS revisadas |
| Ocultar opción de menú no es seguridad | 🟡 **Riesgo real identificado** — ver hallazgos críticos abajo |
| Toda tabla multi-tenant incluye `tenant_id` | 🟢 Verificado tabla por tabla (ver sección 8) — sin excepciones encontradas |
| Operaciones sensibles validan también el rol | 🟡 Sí para: crear/editar/eliminar tenants, crear/editar unidades, crear residencial, entrar como soporte. No para: escribir en `ubicaciones`, escribir/eliminar en `paquetes` |

## 5. Reglas específicas por rol — estado real

### super_admin
- Acceso completo a todos los módulos existentes. 🟢
- Crear/editar/suspender/eliminar tenants. 🟢
- Crear y administrar `admin_residencial`. 🟢 (vía invitación por correo real)
- Reportes globales y logs. 🔴 No implementado (no existe pantalla de reportes; logs solo por SQL directo)
- Entrar a cualquier tenant solo para soporte/supervisión, auditado. 🟢

### admin_residencial
- No puede crear otros tenants. 🟢 (RLS `tenants_insert_super_admin` restringe INSERT solo a super_admin)
- No puede ver métricas globales. 🟢 (no tiene acceso a `/superadmin`, bloqueado por `requireRole` en el layout)
- Administra residentes, guardias, bodega, paquetes, configuración de su residencial. 🟡 (residentes: placeholder vacío; el resto: 🟢)
- Ve y exporta reportes de su tenant. 🔴 No implementado (no hay exportación en ningún módulo)
- No modifica configuraciones globales de GateFlow. 🟢
- No puede asignar el rol `super_admin`. 🟢 (el selector de rol al invitar usuarios, en el asistente de onboarding, solo ofrece `admin_residencial`, `guardia`, `recepcion`, `supervisor` — nunca `super_admin`)

### guardia
- Buscar residentes. 🟡 (busca por unidad/identificador; no hay tabla de residentes real que consultar)
- Registrar paquetes. 🟢
- Consultar paquetes pendientes. 🟢
- Entregar paquetes. 🟢
- Escanear QR/códigos de barras. 🟢
- Tomar/consultar evidencia. 🟢
- No puede eliminar residentes. ⚪ No aplica — no existe el módulo de residentes todavía
- No puede administrar usuarios. 🟢 (no tiene acceso a `/usuarios`, bloqueado por `requireRole`)
- No puede modificar la bodega. 🔴 **Riesgo real** — RLS lo permitiría; solo la interfaz no le muestra el botón
- No puede cambiar configuraciones. 🟢 (bloqueado por `requireRole` en `/configuracion`)
- No puede acceder a reportes administrativos/globales. ⚪ No aplica — no existen esos reportes para ningún rol
- No puede modificar paquetes ya entregados sin flujo autorizado. 🔴 **Riesgo real** — no existe ningún flujo de corrección, y RLS no distingue "entregado" como estado protegido contra edición

## 6. Casos especiales — estado real

| Caso | Estado |
|---|---|
| Usuario sin `tenant_id` | 🟡 `getSessionContext()` cae a una sesión de demostración (`isDemo: true`) si no encuentra membresía — comportamiento deliberado del Sprint 01, visible en la interfaz (banner), pero no es un rechazo explícito |
| Usuario desactivado (`user_tenants.activo = false`) | 🟢 Las consultas de sesión y RLS filtran explícitamente por `activo = true` |
| Tenant suspendido | 🟡 El campo `estado_servicio = 'suspendido'` existe y Super Admin puede ponerlo, pero **no encontré ningún punto donde ese estado bloquee el acceso real de un `admin_residencial`/`guardia` de ese tenant** — hoy es solo informativo |
| Cambio de rol | 🟡 Técnicamente posible actualizando `user_tenants.rol_id`; no hay pantalla de UI para hacerlo, solo sería vía SQL |
| Cambio de tenant | 🟢 Un usuario puede pertenecer a varios tenants (`availableTenants` en `SessionContext`); existe selector en la interfaz |
| Intento de acceso directo por URL a otro tenant | 🟢 No hay ningún parámetro de tenant en la URL que el cliente controle para datos operativos — la resolución del tenant activo es siempre server-side vía sesión, no vía URL |
| Intento de consulta directa a Supabase (bypass de la app) | 🟢 RLS es la capa real; confirmado que ninguna política depende de lógica de aplicación |
| Usuario autenticado sin perfil válido en `public.users` | 🟡 El trigger `handle_new_auth_user()` crea la fila automáticamente al confirmar la cuenta — el caso de un usuario autenticado sin fila en `users` no debería poder ocurrir en el flujo normal, pero no hay una comprobación explícita de "perfil faltante" en `getSessionContext()` más allá del fallback de demo |
| Registros antiguos sin `tenant_id` | ⚪ No aplica — no se encontró ninguna tabla operativa sin `tenant_id` desde su creación |
| Corrección/cancelación de una entrega | 🔴 No existe ningún flujo — una vez marcado como entregado, no hay mecanismo de reversión en la interfaz ni restricción en RLS que lo distinga de cualquier otra edición |

## 7. Estado de implementación — resumen

| Estado | Cantidad aproximada de filas en la matriz |
|---|---|
| 🟢 Implementado | Mayoría — el núcleo operativo (paquetes, unidades, bodega, super admin, empresas, invitaciones) está sólido |
| 🟡 Parcial | Bodega (RLS sin rol), residentes (import como unidades), planes (sin cobro), logs (sin pantalla) |
| 🔴 Pendiente | Reportes, exportaciones, corrección de entregas, eliminar usuarios, pantalla de residentes real |
| ⚪ No aplica | Módulos explícitamente fuera de alcance por diseño actual (cobro real, residentes como tabla formal) |

## 8. Auditoría técnica realizada

- **Rutas protegidas:** revisadas todas las `page.tsx` bajo `apps/admin/app`. El grupo `(app)/` tiene guard de sesión centralizado en su `layout.tsx` (autenticación). La restricción por **rol** específico existe como `requireRole()` explícito solo en: Configuración, Bodega, Usuarios, Unidades, Onboarding, y el layout de Super Admin. Dashboard, Paquetes e Incidencias no restringen por rol a nivel de página — cualquier rol autenticado del tenant puede entrar (esto coincide con el diseño, ya que guardia también usa esas pantallas).
- **Middleware:** revisado completo (`apps/admin/middleware.ts`). Aplica autenticación (no autorización por rol) a todas las rutas no públicas, y el guard de onboarding obligatorio. La autorización por rol vive en los layouts/páginas, no en el middleware — patrón consistente, no un hueco.
- **Componentes de navegación:** `nav-items.ts` filtra por rol vía la propiedad `roles` de cada item — confirmado que es solo visual (`Sidebar`/`MobileNav` no hacen ninguna otra validación); la protección real depende de que la página/RLS detrás también restrinja, lo cual sí ocurre para Configuración/Usuarios/Unidades, pero no para Bodega en cuanto a escritura.
- **Validaciones de servidor:** Server Actions de invitación (`invitarAdministrador`, `invitarUsuarioResidencial`) validan explícitamente `session.role` antes de ejecutar. Las Server Actions de creación/edición de residenciales y empresas no fueron auditadas en este documento porque usan el cliente autenticado normal (protegidas por RLS, no por lógica de aplicación adicional) — coincide con el principio de "RLS como capa principal".
- **Funciones y llamadas a Supabase:** revisado el patrón general en `packages/paquetes/src/*.ts` — consistente uso de `tenant_id` en cada consulta, sin ningún caso encontrado de una consulta que omita el filtro (RLS lo garantizaría de todas formas, pero el código de aplicación también lo hace explícito, salvo en las consultas de Super Admin que son deliberadamente globales).
- **Políticas RLS:** revisadas las 5 migraciones que las definen. Patrón dominante: `tenant_id in (select current_tenant_ids()) or is_super_admin()`. Excepciones con distinción de rol explícita (`has_role(...)`): `unidades` (insert/update/delete), `tenants` (insert/delete). Todo lo demás usa `for all` sin distinguir rol dentro del mismo tenant.
- **Referencias antiguas al rol `admin`** (sin `_residencial`/`_empresa`): **ninguna encontrada** — búsqueda exhaustiva en migraciones y código, sin resultados.
- **Tablas multi-tenant sin `tenant_id`:** **ninguna encontrada**, verificado columna por columna en las ~25 tablas operativas. `tenants`, `empresas`, `roles`, `permisos` no tienen `tenant_id` correctamente, porque son las tablas que definen o están por encima del propio límite de tenant.
- **Consultas que no filtran correctamente por `tenant_id`:** no se encontró ninguna en el código de aplicación; el riesgo real está en RLS permitiendo escritura sin distinguir rol (bodega, paquetes), no en falta de aislamiento por tenant.

## 9. Entrega

### Inconsistencias encontradas
1. Los nombres de rol de la solicitud (`tenant_admin`, `guard`) no coinciden con los reales (`admin_residencial`, `guardia`) — sin impacto funcional, solo de nomenclatura.
2. "Residentes" tiene pantalla en el menú pero es un placeholder vacío sin datos reales.
3. La restricción de escritura en Bodega para `guardia` existe solo en la interfaz, no en RLS.
4. `audit_log` se escribe correctamente pero no tiene ninguna pantalla de consulta.

### Riesgos críticos
1. **Bodega/ubicaciones:** cualquier `guardia` con acceso directo a la API de Supabase podría crear, editar o eliminar ubicaciones de bodega — la interfaz no expone el botón, pero RLS no lo impide. Esto es exactamente el patrón que la instrucción original marca como inaceptable ("ocultar una opción en el menú no cuenta como medida de seguridad").
2. **Paquetes entregados:** no existe ninguna restricción, ni de interfaz ni de RLS, que impida a un `guardia` editar o eliminar un paquete ya marcado como entregado. No hay flujo de corrección auditado — cualquier corrección hoy sería una edición silenciosa indistinguible de una edición normal.
3. **Tenant suspendido:** el estado existe pero no bloquea acceso real — un residencial marcado como "suspendido" por Super Admin sigue operando con normalidad para su `admin_residencial`/`guardia`.

### Cambios recomendados, por prioridad
1. **Alta:** agregar políticas RLS con `has_role(['admin_residencial', 'super_admin'])` en INSERT/UPDATE/DELETE de `ubicaciones`, replicando el patrón ya usado en `unidades`.
2. **Alta:** definir y aplicar una restricción real (RLS o Server Action con validación explícita) para impedir que `guardia` modifique un paquete cuyo estado sea "entregado", salvo a través de un flujo de corrección con auditoría.
3. **Media:** hacer que `tenants.estado_servicio = 'suspendido'` bloquee efectivamente el acceso — ya sea en el middleware o en `getSessionContext()`.
4. **Media:** construir la pantalla real de "Residentes" (hoy es un placeholder) o retirarla del menú hasta que exista, para no comunicar una función que no funciona.
5. **Baja:** agregar una pantalla de consulta de `audit_log` para Super Admin, ya que los datos ya se están generando correctamente.

No se modificó código ni se corrieron migraciones como parte de esta entrega — solo documentación y auditoría, tal como se pidió.
