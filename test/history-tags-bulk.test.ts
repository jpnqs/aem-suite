import { invalidTags, normalizeTags, tagsOf } from '../srv/lib/testcases/tags'
import { createActive, draft, resetDatabase, startServer, users } from './helpers'

const { GET, POST, PATCH } = startServer()
const { tester } = users

const node = async (id: string) => (await GET(`/odata/v4/test/TestCases(ID=${id},IsActiveEntity=true)?$expand=userProperties,versions($orderby=version desc)`, tester)).data

describe('tags (lib/testcases/tags.ts)', () => {
  it('lower case, without duplicates, sorted', () => {
    expect(tagsOf(' Smoke,regression  smoke;EU ')).toEqual(['eu', 'regression', 'smoke'])
    expect(normalizeTags('B, a')).toBe('a, b')
    expect(normalizeTags('  ')).toBeNull()
    expect(invalidTags('ok, no/slash, release-2.1')).toEqual(['no/slash'])
  })
})

describe('versions, tags and bulk edit', () => {
  beforeAll(() => resetDatabase())

  it('keeps a version for every save and restores one', async () => {
    const tc = await createActive(POST, 'test', 'TestCases', { name: 'v', topic: 'hist/a', payload: '{}', tags: 'Smoke, smoke', userProperties: [{ name: 'p', value: '1' }] })
    expect((await node(tc.ID)).tags).toBe('smoke')

    // edit: topic and a user property
    expect((await draft.edit(POST, 'test', 'TestCases', tc.ID)).status).toBeLessThan(300)
    await PATCH(`/odata/v4/test/TestCases(ID=${tc.ID},IsActiveEntity=false)`, { topic: 'hist/b' }, tester)
    expect((await draft.activate(POST, 'test', 'TestCases', tc.ID)).status).toBeLessThan(300)

    let saved = await node(tc.ID)
    expect(saved.versions.map((v: { version: number; changes: string }) => [v.version, v.changes])).toEqual([
      [2, 'topic'],
      [1, 'created']
    ])
    expect(saved.versions[0].savedBy).toBe('tester')

    const first = saved.versions[1].ID
    const restored = await POST(`/odata/v4/test/TestCaseVersions(${first})/TestService.restore`, {}, tester)
    expect(restored.status).toBe(200)
    saved = await node(tc.ID)
    expect(saved.topic).toBe('hist/a')
    expect(saved.userProperties).toEqual([expect.objectContaining({ name: 'p', value: '1' })])
    expect(saved.versions[0]).toMatchObject({ version: 3, changes: 'restored version 1, topic' })

    // not while someone edits it
    await draft.edit(POST, 'test', 'TestCases', tc.ID)
    const refused = await POST(`/odata/v4/test/TestCaseVersions(${first})/TestService.restore`, {}, tester)
    expect(refused.status).toBe(409)
  })

  it('refuses tags that are not one word', async () => {
    const res = await draft.save(POST, 'test', 'TestCases', { topic: 'hist/tag', tags: 'ok, no/slash' })
    expect(res.status).toBe(400)
    expect(JSON.stringify(res.data)).toMatch(/Invalid tag\(s\) no\/slash/)
  })

  it('edits many test cases at once - tags on the selection, the rest on the test cases below a folder', async () => {
    const folder = await createActive(POST, 'test', 'TestCases', { kind: 'FOLDER', name: 'bulk' })
    const a = await createActive(POST, 'test', 'TestCases', { name: 'a', topic: 'shop/v1/a', payload: '{}', tags: 'old', parent_ID: folder.ID })
    const b = await createActive(POST, 'test', 'TestCases', { name: 'b', topic: 'shop/v1/b', payload: '{}', parent_ID: folder.ID })
    const res = await POST(
      '/odata/v4/test/bulkUpdate',
      { ids: [folder.ID, a.ID], changes: { deliveryMode: 'DIRECT', topicFind: '/v1/', topicReplace: '/v2/', addTags: 'Regression', removeTags: 'old' } },
      tester
    )
    expect(res.status).toBe(200)
    expect(res.data).toEqual(expect.objectContaining({ updated: 3, skipped: [] }))
    expect(await node(a.ID)).toMatchObject({ topic: 'shop/v2/a', deliveryMode: 'DIRECT', tags: 'regression' })
    // b was not selected itself: no tags, but the changes of its folder's test cases
    expect(await node(b.ID)).toMatchObject({ topic: 'shop/v2/b', deliveryMode: 'DIRECT', tags: null })
    expect((await node(folder.ID)).tags).toBe('regression')
    expect((await node(b.ID)).versions[0].changes).toBe('topic, deliveryMode')

    // all or nothing: a broken result changes nothing
    const bad = await POST('/odata/v4/test/bulkUpdate', { ids: [a.ID], changes: { ackTimeoutMs: 1 } }, tester)
    expect(bad.status).toBe(400)
    expect(bad.data.error.message).toMatch(/^a: ACK timeout must be between 100 and 120000 ms/)

    // a test case being edited is left alone
    await draft.edit(POST, 'test', 'TestCases', b.ID)
    const partly = await POST('/odata/v4/test/bulkUpdate', { ids: [a.ID, b.ID], changes: { addTags: 'x' } }, tester)
    expect(partly.data).toEqual(expect.objectContaining({ updated: 1, skipped: ['b'] }))
    expect((await POST('/odata/v4/test/bulkUpdate', { ids: [a.ID], changes: {} }, tester)).status).toBe(400)
  })
})
