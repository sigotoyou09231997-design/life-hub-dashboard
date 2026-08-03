import { useEffect, useState } from "react";

export function useObjectUrls(blobs: Blob[]): string[] {
  const [urls, setUrls] = useState<string[]>([]);

  useEffect(() => {
    const next = blobs.map((b) => URL.createObjectURL(b));
    setUrls(next);
    return () => {
      next.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [blobs]);

  return urls;
}
