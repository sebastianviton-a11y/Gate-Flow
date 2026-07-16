import { redirect } from "next/navigation";

// El middleware ya garantiza que solo se llega aquí con sesión activa
// (usuarios sin sesión son redirigidos a /login antes de renderizar esto).
export default function RootPage() {
  redirect("/dashboard");
}
