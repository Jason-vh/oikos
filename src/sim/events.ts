import type { Good } from './types';

export interface Request {
  city: string;
  good: Good;
  cartloads: number;
  monthsLeft: number;
  reward: number;
}

export interface CityEvent {
  year: number;
  kind: 'request' | 'gift' | 'earthquake' | 'flood' | 'landslide' | 'lava' | 'monster';
  city: string;
  good?: Good;
  cartloads?: number;
  reward?: number;
  months?: number;
  monster?: string;
}

export const REQUEST_STANDING = 6;
export const BROKEN_PROMISE_STANDING = 10;

export function requestFrom(event: CityEvent): Request {
  return {
    city: event.city,
    good: event.good ?? 'food',
    cartloads: event.cartloads ?? 8,
    monthsLeft: event.months ?? 12,
    reward: event.reward ?? 400,
  };
}

export function describeRequest(request: Request): string {
  return `${request.city} asks for ${request.cartloads} ${request.good}, ${request.monthsLeft} months left`;
}

export function ageRequests(requests: Request[]): { live: Request[]; expired: Request[] } {
  const live: Request[] = [];
  const expired: Request[] = [];

  for (const request of requests) {
    const aged = { ...request, monthsLeft: request.monthsLeft - 1 };
    if (aged.monthsLeft > 0) live.push(aged);
    else expired.push(aged);
  }

  return { live, expired };
}
