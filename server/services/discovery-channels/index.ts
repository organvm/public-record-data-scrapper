/**
 * Discovery-channel registry.
 *
 * Re-exports the channel contract and the three concrete key-less channels,
 * plus a factory returning the default channel set. {@link LeadDiscoveryService}
 * consumes `createDefaultChannels()`; tests inject their own array.
 *
 * @module server/services/discovery-channels
 */

export * from './types'
export { SECEdgarRegistrantsChannel } from './SECEdgarRegistrantsChannel'
export { SocrataBuildingPermitsChannel } from './SocrataBuildingPermitsChannel'
export { SBALoansChannel } from './SBALoansChannel'

import { DiscoveryChannel } from './types'
import { SECEdgarRegistrantsChannel } from './SECEdgarRegistrantsChannel'
import { SocrataBuildingPermitsChannel } from './SocrataBuildingPermitsChannel'
import { SBALoansChannel } from './SBALoansChannel'

/** The default, key-less channel fleet used in production. */
export function createDefaultChannels(): DiscoveryChannel[] {
  return [
    new SECEdgarRegistrantsChannel(),
    new SocrataBuildingPermitsChannel(),
    new SBALoansChannel()
  ]
}
