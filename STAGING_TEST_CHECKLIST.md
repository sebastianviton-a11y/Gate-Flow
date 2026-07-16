# STAGING_TEST_CHECKLIST.md

No se declara esta etapa terminada hasta marcar todo lo de la sección "Obligatorio". Ejecutar en orden.

## Instalación y build (antes de tocar las URLs publicadas)

- [ ] `pnpm install` limpio, sin errores, en un checkout nuevo del repo.
- [ ] `pnpm lint` sin errores en ambas apps.
- [ ] `pnpm typecheck` sin errores en los 7 paquetes del workspace.
- [ ] `pnpm --filter @gateflow/admin build` completa sin errores.
- [ ] `pnpm --filter @gateflow/guard build` completa sin errores.

## Variables y configuración

- [ ] `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` configuradas en ambos sitios de Netlify.
- [ ] Ningún secreto (`SERVICE_ROLE`, tokens de WhatsApp) presente en Netlify ni en el bundle — verificar en el navegador (DevTools → Network → cualquier JS servido) que no aparece ninguna cadena que empiece con `service_role` o los prefijos típicos de tokens de proveedor.
- [ ] Supabase Auth → Site URL y Redirect URLs apuntan a las URLs reales de Netlify.

## Obligatorio — flujo funcional completo

- [ ] `https://gateflow-admin.netlify.app` carga y redirige a `/login` sin sesión activa.
- [ ] `https://gateflow-guard.netlify.app` carga y redirige a `/login` sin sesión activa.
- [ ] Login con el usuario admin demo funciona en `gateflow-admin`.
- [ ] Login con el usuario guardia demo funciona en `gateflow-guard`.
- [ ] El dashboard de admin muestra el paquete demo sembrado (§5 de `DEPLOY_STAGING.md`).
- [ ] Registrar un paquete nuevo desde `gateflow-guard` (buscar "Casa" o "Depto", completar, confirmar) funciona y genera un código GateFlow.
- [ ] Ese paquete nuevo aparece en el listado de `gateflow-admin` en segundos, sin recargar manualmente el caché del navegador.
- [ ] Entregarlo desde `gateflow-guard` (con firma) funciona y cambia su estado.
- [ ] Intentar entregarlo una segunda vez falla explícitamente (BR-14) — probar repitiendo el flujo de entrega sobre el mismo paquete.
- [ ] El dashboard de admin refleja el cambio (entregados hoy sube, pendientes baja).

## Aislamiento multi-tenant — la prueba más importante de todas

- [ ] Crear un **segundo tenant** de prueba (otro residencial demo) con su propio usuario admin, siguiendo el mismo procedimiento de `DEPLOY_STAGING.md §5`.
- [ ] Confirmar que ese segundo usuario, al iniciar sesión, **no ve ningún paquete, unidad ni dato del primer tenant demo** — ni en el dashboard, ni en el listado, ni escribiendo directamente el código GateFlow del paquete del otro tenant en la búsqueda.
- [ ] Confirmar en el SQL Editor de Supabase que RLS sigue habilitado en las 28 tablas (`select tablename from pg_tables where schemaname='public' and rowsecurity=false` debe devolver 0 filas).

## Rutas protegidas

- [ ] Acceder a una URL de `gateflow-admin` estando deslogueado (ej. `/dashboard` directo) redirige a `/login`, no muestra contenido.
- [ ] El usuario guardia demo, si intenta acceder a `/configuracion` en admin (si tuviera acceso al sitio), es redirigido — confirma que `requireRole` sigue aplicando en staging igual que en local.

## Responsive

- [ ] `gateflow-guard` se ve y usa correctamente en una ventana angosta (simular móvil en DevTools) — sidebar/drawer, botones grandes, sin scroll horizontal.
- [ ] `gateflow-admin` colapsa a menú móvil por debajo del breakpoint definido.

## WhatsApp (modo demo/mock)

- [ ] Al registrar un paquete, se crea una fila en `notificaciones` con `estado_envio = 'pendiente'` (verificar en el SQL Editor) — no se envía ningún mensaje real, no hay teléfonos reales involucrados.

## Al terminar

Si **cualquier** punto de "Obligatorio" o "Aislamiento multi-tenant" falla, esta etapa no está lista — corregir antes de compartir las URLs con nadie fuera del equipo.
