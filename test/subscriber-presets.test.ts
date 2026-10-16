import { resetDatabase, startServer, users } from './helpers'

const { GET, POST, PATCH, DELETE } = startServer()
const { admin, tester } = users
const URL = '/odata/v4/subscribe/SubscriberPresets'
const BROKER = 'b1000000-0000-4000-8000-0000000000aa'

describe('saved setups of the live subscriber', () => {
  beforeAll(resetDatabase)

  it('saves a setup for the user and reads it back', async () => {
    const res = await POST(URL, { name: 'Orders', broker_ID: BROKER, sourceType: 'TOPIC', topics: JSON.stringify(['aem/orders/>', 'aem/events/*']), username: 'aem-suite' }, tester)
    expect(res.status).toBe(201)
    const list = await GET(`${URL}?$select=name,topics,username,sourceType,broker_ID`, tester)
    expect(list.data.value).toEqual([expect.objectContaining({ name: 'Orders', username: 'aem-suite', sourceType: 'TOPIC', broker_ID: BROKER })])
    expect(JSON.parse(list.data.value[0].topics)).toEqual(['aem/orders/>', 'aem/events/*'])
  })

  it('has no field for a password', async () => {
    const res = await GET(`${URL}?$select=password`, tester)
    expect(res.status).toBe(400)
  })

  it('shows a setup only to its owner', async () => {
    expect((await GET(URL, admin)).data.value).toEqual([])
    const id = (await GET(URL, tester)).data.value[0].ID
    expect((await GET(`${URL}(${id})`, admin)).status).toBe(404)
    expect((await PATCH(`${URL}(${id})`, { name: 'Taken over' }, admin)).status).toBeGreaterThanOrEqual(400)
    expect((await DELETE(`${URL}(${id})`, admin)).status).toBeGreaterThanOrEqual(400)
  })

  it('needs a name, which is unique per user', async () => {
    expect((await POST(URL, { name: '   ', sourceType: 'TOPIC' }, tester)).status).toBe(400)
    const same = await POST(URL, { name: ' Orders ', sourceType: 'TOPIC' }, tester)
    expect(same.status).toBe(400)
    expect(same.data.error.message).toMatch(/exists already/)
    // another user may use the same name
    expect((await POST(URL, { name: 'Orders', sourceType: 'TOPIC' }, admin)).status).toBe(201)
  })

  it('checks source type and topics', async () => {
    expect((await POST(URL, { name: 'x1', sourceType: 'NOPE' }, tester)).status).toBe(400)
    expect((await POST(URL, { name: 'x2', sourceType: 'TOPIC', topics: 'not json' }, tester)).status).toBe(400)
    expect((await POST(URL, { name: 'x3', sourceType: 'TOPIC', topics: JSON.stringify([1, 2]) }, tester)).status).toBe(400)
    expect((await POST(URL, { name: 'x4', sourceType: 'QUEUE_BROWSE', queue: 'q.aem.orders' }, tester)).status).toBe(201)
  })

  it('updates and deletes a setup of its own', async () => {
    const id = (await GET(`${URL}?$filter=name eq 'Orders'`, tester)).data.value[0].ID
    expect((await PATCH(`${URL}(${id})`, { queue: 'q1', topics: JSON.stringify(['a/b']) }, tester)).status).toBe(200)
    expect((await PATCH(`${URL}(${id})`, { name: 'x4' }, tester)).status).toBe(400)
    expect((await GET(`${URL}(${id})?$select=queue`, tester)).data.queue).toBe('q1')
    expect((await DELETE(`${URL}(${id})`, tester)).status).toBe(204)
    expect((await GET(`${URL}?$filter=name eq 'Orders'`, tester)).data.value).toEqual([])
  })

  it('needs the Tester role', async () => {
    expect((await GET(URL, users.noRole)).status).toBe(403)
  })
})
