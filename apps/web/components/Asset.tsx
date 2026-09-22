import type { CSSProperties } from "react";

// Los binarios reales (capturas de producto, fotos, QR, video) viven en el
// canvas de Claude Design aprobado y no son descargables desde este
// entorno de código — ver el reporte de implementación. Estos componentes
// renderizan exactamente las dimensiones/posiciones del diseño aprobado;
// en cuanto los archivos reales se agreguen en apps/web/public/img y
// apps/web/public/video con estos mismos nombres, se muestran solos, sin
// tocar ningún componente.

type AssetImageProps = {
  src: string;
  alt: string;
  width: number;
  height: number;
  style?: CSSProperties;
  className?: string;
};

export function AssetImage({ src, alt, width, height, style, className }: AssetImageProps) {
  return (
    // width/height quedan como atributos HTML (dan la relación de aspecto
    // real vía UA stylesheet e info a AVIF/priorización); el tamaño
    // RENDERIZADO es siempre fluido (100% del contenedor, alto automático
    // según esa relación) salvo que `style` lo sobreescriba explícitamente
    // — así cada imagen se adapta al ancho real de su contenedor en
    // cualquier viewport sin tocar este componente.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={width}
      height={height}
      className={className}
      style={{ display: "block", width: "100%", height: "auto", objectFit: "cover", background: "#E8EDF1", ...style }}
      data-pending-asset={src}
    />
  );
}

type AssetVideoProps = {
  src: string;
  poster: string;
  ariaLabel: string;
  width: number;
  height: number;
  style?: CSSProperties;
};

export function AssetVideo({ src, poster, ariaLabel, width, height, style }: AssetVideoProps) {
  return (
    <video
      src={src}
      poster={poster}
      controls
      playsInline
      preload="metadata"
      aria-label={ariaLabel}
      width={width}
      height={height}
      style={{ display: "block", width: "100%", height: "auto", objectFit: "cover", background: "#0D1B2A", ...style }}
      data-pending-asset={src}
    />
  );
}
