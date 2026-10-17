import Image from "next/image";

export function BrandLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/kaobase-logo.svg"
      alt="Kaobase"
      width={1320}
      height={440}
      unoptimized
      loading="eager"
      className={`h-auto w-36 max-w-full shrink-0 sm:w-44 ${className}`}
    />
  );
}
