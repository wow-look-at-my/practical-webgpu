export const alignTo = (n: number, alignment: number): number =>
  (n + alignment - 1) & ~(alignment - 1);
