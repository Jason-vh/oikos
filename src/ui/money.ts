export const COIN = '<span class="coin"></span>';

export function money(amount: number): string {
  return `${Math.round(amount)} ${COIN}`;
}
