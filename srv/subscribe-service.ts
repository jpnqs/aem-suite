import cds from '@sap/cds'
import { currentJwt } from './lib/credentials/resolve'
import {
  listSubscriptions,
  SourceType,
  startSubscription,
  stopAll,
  stopSubscription,
  touch
} from './lib/solace/subscription-hub'

export default class SubscribeService extends cds.ApplicationService {
  async init() {
    const { ReceivedMessages } = this.entities

    cds.on('shutdown', () => stopAll())

    this.on('start', async (req) => {
      const { brokerId, sourceType, topics, queue, password, username } = req.data as {
        brokerId: string
        sourceType: SourceType
        topics?: string[]
        queue?: string
        password?: string
        username?: string
      }
      const subscriptionId = await startSubscription({
        brokerId,
        sourceType,
        topics,
        queue,
        owner: req.user.id,
        jwt: currentJwt(),
        password: password || undefined,
        username: username || undefined
      })
      return { subscriptionId }
    })

    this.on('stop', async (req) => {
      const { subscriptionId } = req.data as { subscriptionId: string }
      await stopSubscription(subscriptionId, req.user.id)
    })

    // also serves as heartbeat of the subscriber UI (prevents idle timeout)
    this.on('activeSubscriptions', (req) => {
      const list = listSubscriptions(req.user.id)
      list.forEach((s) => touch(s.subscriptionId, req.user.id))
      return list
    })

    this.before('CREATE', ReceivedMessages, async (req) => {
      const d = req.data as { broker_ID?: string; brokerName?: string; receivedAt?: string }
      if (d.broker_ID && !d.brokerName) {
        const b = await SELECT.one.from('aem.suite.Brokers').columns('name').where({ ID: d.broker_ID })
        d.brokerName = (b as { name?: string } | undefined)?.name
      }
      d.receivedAt ??= new Date().toISOString()
    })

    this.on('createTestCase', ReceivedMessages, async (req) => {
      const p = req.params[0] as unknown
      const id = typeof p === 'string' ? p : (p as { ID: string }).ID
      const m = (await SELECT.one.from('aem.suite.ReceivedMessages', id)) as Record<string, string | null> | null
      if (!m) return req.error(404, 'Message not found')

      let payload = m.payload ?? ''
      try {
        payload = JSON.stringify(JSON.parse(payload), null, 2)
      } catch {
        /* keep raw */
      }
      let props: Record<string, unknown> = {}
      try {
        props = m.userProperties ? JSON.parse(m.userProperties) : {}
      } catch {
        /* ignore */
      }

      const ID = cds.utils.uuid()
      await INSERT.into('aem.suite.TestCases').entries({
        ID,
        name: `From ${m.topic}`.slice(0, 200),
        description: `Created from message received on ${m.source} (${m.brokerName ?? 'unknown broker'}) at ${m.receivedAt}`,
        topic: m.topic,
        payload,
        contentType: m.contentType || 'application/json',
        deliveryMode: m.deliveryMode === 'DIRECT' ? 'DIRECT' : 'PERSISTENT',
        correlationId: m.correlationId,
        userProperties: Object.entries(props).map(([name, value]) => ({
          name,
          type: typeof value === 'boolean' ? 'BOOL' : Number.isInteger(value) ? 'INT' : 'STRING',
          value: String(value)
        }))
      })
      req.info(200, 'Test case created')
      return { ID }
    })

    return super.init()
  }
}
