import cds from '@sap/cds'
import { currentJwt } from './lib/credentials/resolve'
import { detectContentType } from './lib/defaults'
import { truncate } from './lib/errors'
import { createNode } from './lib/nodes'
import type { NodeData } from './lib/node-validation'
import { inferPropertyType } from './lib/property-types'
import { keyOf } from './lib/request'
import { listSubscriptions, SourceType, startSubscription, stopSubscription, touch } from './lib/solace/subscription-hub'

interface ReceivedMessage {
  topic: string
  payload?: string | null
  contentType?: string | null
  userProperties?: string | null
  correlationId?: string | null
  deliveryMode?: string | null
  source?: string | null
  brokerName?: string | null
  receivedAt?: string | null
}

export default class SubscribeService extends cds.ApplicationService {
  async init() {
    const { ReceivedMessages } = this.entities

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

    // same rules and placement as a test case created in the UI or by an agent
    this.on('createTestCase', ReceivedMessages, async (req) => {
      const m = (await SELECT.one.from('aem.suite.ReceivedMessages', keyOf(req).ID)) as ReceivedMessage | null
      if (!m) return req.error(404, 'Message not found')
      const { ID } = await createNode(testCaseFrom(m))
      req.info(200, 'Test case created')
      return { ID }
    })

    return super.init()
  }
}

function testCaseFrom(m: ReceivedMessage): NodeData {
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
  return {
    ID: cds.utils.uuid(),
    kind: 'TEST',
    parent_ID: null,
    name: truncate(`From ${m.topic}`, 200),
    description: truncate(`Created from message received on ${m.source} (${m.brokerName ?? 'unknown broker'}) at ${m.receivedAt}`, 1000),
    topic: m.topic,
    payload,
    contentType: m.contentType || detectContentType(payload),
    deliveryMode: m.deliveryMode === 'DIRECT' ? 'DIRECT' : 'PERSISTENT',
    correlationId: m.correlationId,
    userProperties: Object.entries(props).map(([name, value]) => ({
      name,
      type: typeof value === 'boolean' ? 'BOOL' : inferPropertyType(String(value)),
      value: String(value)
    }))
  }
}
