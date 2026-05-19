import type { Client } from '../client.js';
import type {
  PaymentsCheckoutRequest,
  PaymentsCheckoutResponse,
  PaymentsDashboardLinkResponse,
  PaymentsOnboardRequest,
  PaymentsOnboardResponse,
  PaymentsStatusOptions,
  PaymentsStatusResponse,
  Result,
} from '../types.js';

/**
 * Stripe-Connect-style payments. The platform is the Stripe platform
 * account; each project gets its own connected account. somewhere.tech
 * takes zero platform fee — every charge settles 100% to the developer's
 * connected account. The developer never holds a Stripe key — they call:
 *
 *     await sw.payments.onboard({ return_url, refresh_url })
 *     // → redirect end-user to result.onboarding_url
 *
 *     const status = await sw.payments.status()
 *     if (!status.data?.charges_enabled) ...
 *
 *     await sw.payments.checkout({
 *       line_items: [{ amount: 4999, currency: 'usd', name: 'Pro' }],
 *       success_url, cancel_url,
 *     })
 *     // → redirect end-user to result.url
 */
export class PaymentsClient {
  constructor(private readonly client: Client) {}

  async onboard(input: PaymentsOnboardRequest = {}): Promise<Result<PaymentsOnboardResponse>> {
    const project_id = this.client.requireProjectId(input.projectId, 'payments.onboard');
    return this.client.safeCall<PaymentsOnboardResponse>('POST', '/payments/onboard', {
      auth: 'developer',
      body: {
        project_id,
        return_url: input.return_url,
        refresh_url: input.refresh_url,
      },
    });
  }

  async status(opts: PaymentsStatusOptions = {}): Promise<Result<PaymentsStatusResponse>> {
    const project_id = this.client.requireProjectId(opts.projectId, 'payments.status');
    return this.client.safeCall<PaymentsStatusResponse>('GET', '/payments/status', {
      auth: 'developer',
      query: { project_id, refresh: opts.refresh ? '1' : undefined },
    });
  }

  async checkout(input: PaymentsCheckoutRequest): Promise<Result<PaymentsCheckoutResponse>> {
    const project_id = this.client.requireProjectId(input.projectId, 'payments.checkout');
    return this.client.safeCall<PaymentsCheckoutResponse>('POST', '/payments/checkout', {
      auth: 'developer',
      body: {
        project_id,
        line_items: input.line_items,
        mode: input.mode,
        success_url: input.success_url,
        cancel_url: input.cancel_url,
        customer_email: input.customer_email,
        metadata: input.metadata,
      },
    });
  }

  async dashboardLink(opts: { projectId?: string } = {}): Promise<Result<PaymentsDashboardLinkResponse>> {
    const project_id = this.client.requireProjectId(opts.projectId, 'payments.dashboardLink');
    return this.client.safeCall<PaymentsDashboardLinkResponse>('GET', '/payments/dashboard-link', {
      auth: 'developer',
      query: { project_id },
    });
  }
}
