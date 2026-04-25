import Image from "next/image";

export function ZeroGStorageIcon({
  className,
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}): React.ReactElement {
  return (
    <Image
      alt="0G"
      className={`rounded-full ${className ?? ""}`}
      height={48}
      src="/0g-logo.jpg"
      style={style}
      width={48}
    />
  );
}
