/**
 * Re-exporting from provider-independent marketDataProvider service
 * for backward compatibility across existing imports.
 */

export * from './marketDataProvider';
export { marketDataProvider as derivWsService } from './marketDataProvider';
