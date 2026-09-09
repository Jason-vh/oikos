export const COBBLED_APPEAL = 2;
export const PAVED_APPEAL = 12;

export function roadGradeAt(appeal: number): number {
  if (appeal >= PAVED_APPEAL) return 2;
  if (appeal >= COBBLED_APPEAL) return 1;
  return 0;
}
