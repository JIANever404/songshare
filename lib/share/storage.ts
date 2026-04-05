import type { StoredShareV1 } from "@/lib/share/types";
import d1StorageBackend from "@/lib/share/storage-d1";

export function saveShare(record: StoredShareV1) {
  return d1StorageBackend.saveShare(record);
}

export function getShare(shareId: string) {
  return d1StorageBackend.getShare(shareId);
}

export function touchShare(shareId: string, now = Date.now()) {
  return d1StorageBackend.touchShare(shareId, now);
}

export function listAllShares() {
  return d1StorageBackend.listAllShares();
}

export function countAllShares() {
  return d1StorageBackend.countAllShares();
}
