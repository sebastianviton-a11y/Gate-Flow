import { redirect } from "next/navigation";

// El middleware ya garantiza sesión activa antes de llegar aquí.
export default function RootPage() {
  redirect("/guard");
}
