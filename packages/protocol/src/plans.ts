/**
 * The plans. Product policy lives beside the tool registry so the pricing page,
 * the meter and the docs all read the same numbers.
 */
export type Plan = 'free' | 'pro' | 'power';

export interface PlanLimits {
  per_day: number;
  /** Rolling seven-day pool. Only the free plan has one. */
  per_week: number | null;
  price_usd_month: number;
  projects: number | null;
}

export const PLANS: Record<Plan, PlanLimits> = {
  free: { per_day: 100, per_week: 400, price_usd_month: 0, projects: 3 },
  pro: { per_day: 1000, per_week: null, price_usd_month: 25, projects: null },
  power: { per_day: 5000, per_week: null, price_usd_month: 100, projects: null },
};
