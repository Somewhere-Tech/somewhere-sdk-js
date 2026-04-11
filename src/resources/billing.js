export class BillingResource {
    constructor(client) {
        this.client = client;
    }
    status() {
        return this.client.call('GET', '/billing/status');
    }
    checkout(plan) {
        return this.client.call('POST', '/billing/checkout', { body: { plan } });
    }
    portal() {
        return this.client.call('POST', '/billing/portal');
    }
}
