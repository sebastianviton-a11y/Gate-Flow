# Plantillas de correo de Supabase Auth (producción)

Se pegan en **Supabase → Authentication → Emails** del proyecto de
producción. No se cargan solas: el repositorio solo guarda el texto
revisado.

| Plantilla de Supabase | Archivo | Asunto |
|---|---|---|
| Confirm signup | `confirmar-registro.html` | Confirma tu correo para empezar tu prueba de Gate Flow |
| Invite user | (la de producción, en español) | Invitación a Gate Flow |
| Reset password | (la de producción, en español) | Restablece tu contraseña de Gate Flow |

Todas usan solo `{{ .ConfirmationURL }}`: el destino final lo decide el
panel (`/confirmar-cuenta`, `/aceptar-invitacion`, `/restablecer-password`)
y tiene que estar en *Redirect URLs*. En staging, las mismas plantillas
llevan `[STAGING]` al inicio del asunto.
