import type { Client } from '../client.js';
import type { BillingStatus } from '../types.js';

export class BillingResource {
  constructor(private readonly client: Client) {}

  status(): Promise<BillingStatus> {
    return this.client.call<BillingStatus>('GET', '/billing/status');
  }

  checkout(plan: 'builder'): Promise<{ checkout_url: string; session_id: string }> {
    return this.client.call('POST', '/billing/checkout', { body: { plan } });
  }

  portal(): Promise<{ portal_url: string }> {
    return this.client.call('POST', '/billing/portal');
  }
}
