import cds from '@sap/cds'
import { currentJwt } from './lib/credentials/resolve'
import { detectContentType } from './lib/defaults'
import { truncate } from './lib/errors'
import { columnLength } from './lib/model'
import { createNode } from './lib/nodes'
import type { NodeData } from './lib/node-validation'
import { inferPropertyType } from './lib/property-types'
import { idOf } from './lib/request'
import { nameTaken } from './lib/unique-name'
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
    const { ReceivedMessages, SubscriberPresets } = this.entities

    this.before(['CREATE', 'UPDATE'], SubscriberPresets, async (req) => validatePreset(req))

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

    this.on('heartbeat', (req) => {
      const { subscriptionId } = req.data as { subscriptionId: string }
      return { active: touch(subscriptionId, req.user.id) }
    })

    this.on('activeSubscriptions', (req) => listSubscriptions(req.user.id))

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
      const m = (await SELECT.one.from('aem.suite.ReceivedMessages', idOf(req))) as ReceivedMessage | null
      if (!m) return req.reject(404, 'Message not found')
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
    name: truncate(`From ${m.topic}`, columnLength('TestCases', 'name')),
    description: truncate(`Created from message received on ${m.source} (${m.brokerName ?? 'unknown broker'}) at ${m.receivedAt}`, columnLength('TestCases', 'description')),
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

const SOURCE_TYPES = ['TOPIC', 'QUEUE_BROWSE', 'QUEUE_CONSUME']
const MAX_PRESET_TOPICS = 50

/** Name (unique per user), source type and topics of a saved setup. Column lengths are checked by CAP (OData input). */
async function validatePreset(req: cds.Request): Promise<void> {
  const d = req.data as { name?: string; sourceType?: string; topics?: string | null; queue?: string | null; username?: string | null; ID?: string }
  const creating = req.event === 'CREATE'
  if (creating || d.name !== undefined) {
    const name = (d.name ?? '').trim()
    if (!name) return req.reject(400, 'Give the setup a name', 'in/name')
    d.name = name
    if (await nameTaken('SubscriberPresets', name, d.ID, { createdBy: req.user.id })) return req.reject(400, `A setup named "${name}" exists already`, 'in/name')
  }
  if (d.sourceType !== undefined && !SOURCE_TYPES.includes(d.sourceType)) return req.reject(400, `sourceType must be ${SOURCE_TYPES.join(', ')}`, 'in/sourceType')
  if (d.topics) {
    let list: unknown
    try {
      list = JSON.parse(d.topics)
    } catch {
      list = null
    }
    if (!Array.isArray(list) || list.length > MAX_PRESET_TOPICS || list.some((t) => typeof t !== 'string' || !t.trim() || t.length > 500))
      return req.reject(400, `topics must be a list of at most ${MAX_PRESET_TOPICS} topic names`, 'in/topics')
  }
}
