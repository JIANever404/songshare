import type { StoredShareV1 } from "@/lib/share/types";

export type ShareSaveResult = {
  shareId: string;
  deduped: boolean;
};

export interface StorageBackend {
  readonly name: "d1";
  saveShare(record: StoredShareV1): Promise<ShareSaveResult>;
  getShare(shareId: string): Promise<StoredShareV1 | null>;
  touchShare(shareId: string, now?: number): Promise<boolean>;
  listAllShares(): Promise<StoredShareV1[]>;
  countAllShares(): Promise<number>;
}
