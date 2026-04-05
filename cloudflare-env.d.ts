declare global {
  interface CloudflareEnv {
    SONGSHARE_COLD_STORAGE?: {
      get(key: string): Promise<{
        arrayBuffer(): Promise<ArrayBuffer>;
      } | null>;
      put(
        key: string,
        value: Uint8Array | ArrayBuffer | string,
        options?: {
          httpMetadata?: {
            contentType?: string;
            contentEncoding?: string;
          };
        }
      ): Promise<unknown>;
    };
  }
}

export {};
