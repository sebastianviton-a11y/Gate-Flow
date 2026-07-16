import type { Config } from "tailwindcss";

// Mismos tokens de marca que apps/admin (paleta "checkpoint") — la
// aplicación del guardia no es una marca distinta, es la misma marca con
// una densidad de interfaz distinta: controles más grandes, menos
// jerarquía visual simultánea, cero elementos decorativos.
const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-sans)", "sans-serif"],
        mono: ["var(--font-mono)", "monospace"],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        ink: { 950: "#0D1B2A", 900: "#152A3F", 800: "#1E3A54" }, // Azul Profundo — marca GateFlow
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        info: { DEFAULT: "hsl(var(--info))", foreground: "hsl(var(--info-foreground))" },
        "accent-brand": { DEFAULT: "hsl(var(--accent-brand))", foreground: "hsl(var(--accent-brand-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        warn: { DEFAULT: "hsl(var(--warn))", foreground: "hsl(var(--warn-foreground))" },
        success: { DEFAULT: "hsl(var(--success))", foreground: "hsl(var(--success-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      minHeight: {
        touch: "3.5rem", // 56px — mínimo táctil operativo, mayor que el estándar de 44px
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
