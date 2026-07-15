export interface WikiGraphSerialEntry {
  readonly fragmentCount: number;
  readonly serialId: number;
  readonly title: string | null;
  readonly tocPath: readonly string[];
}
