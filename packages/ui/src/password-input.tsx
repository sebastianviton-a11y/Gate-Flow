import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "./input";
import { cn } from "./utils";

/**
 * Envuelve Input (no lo reemplaza) para que cualquier campo de
 * contraseña existente pueda cambiar `<Input type="password" />` por
 * `<PasswordInput />` sin perder ningún otro prop ya en uso (value,
 * onChange, id, required, autoComplete, className, etc.) — todos se
 * reenvían tal cual a Input.
 *
 * autoCorrect/autoCapitalize/spellCheck quedan forzados a apagado —
 * SIEMPRE, sin poder sobreescribirse desde afuera (no están en
 * PasswordInputProps) — porque iOS/Safari puede reactivar la
 * autocorrección justo cuando el campo cambia de type="password" a
 * type="text" al presionar el ícono del ojo (deja de reconocerse como
 * campo seguro). Sin esto, un carácter especial al final de la
 * contraseña (guion, punto) puede alterarse en silencio sin que la
 * persona lo note, y la contraseña que ve en pantalla ya no es la que
 * realmente se está enviando.
 */
interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Para inputs sobre fondo oscuro (los formularios de login) — por
   * defecto usa un tono neutro que funciona bien sobre fondo claro. */
  iconClassName?: string;
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, iconClassName, ...props }, ref) => {
    const [visible, setVisible] = React.useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? "text" : "password"}
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className={cn("pr-10", className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
          className={cn(
            "absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-r-md",
            iconClassName,
          )}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
