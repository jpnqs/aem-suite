import { createActive, draft, resetDatabase, startServer, users } from './helpers'

const { GET, POST, PATCH } = startServer()
const { tester } = users

describe('a draft and a move of the same node', () => {
  beforeAll(() => resetDatabase())

  it('saving a draft keeps the folder and position the node has been moved to meanwhile', async () => {
    const f1 = await createActive(POST, 'test', 'TestCases', { kind: 'FOLDER', name: 'from' })
    const f2 = await createActive(POST, 'test', 'TestCases', { kind: 'FOLDER', name: 'to' })
    const a = await createActive(POST, 'test', 'TestCases', { name: 'a', topic: 'move/a', payload: '{}', parent_ID: f1.ID })

    // open for editing ...
    expect((await draft.edit(POST, 'test', 'TestCases', a.ID)).status).toBeLessThan(300)
    await PATCH(`/odata/v4/test/TestCases(ID=${a.ID},IsActiveEntity=false)`, { topic: 'move/a2' }, tester)
    // ... moved by someone else (cut and paste / drag and drop write the saved row) ...
    await UPDATE('aem.suite.TestCases', a.ID).with({ parent_ID: f2.ID, sortOrder: 777 })
    // ... then saved: the edit is saved, the move stays
    expect((await draft.activate(POST, 'test', 'TestCases', a.ID)).status).toBeLessThan(300)
    const { data } = await GET(`/odata/v4/test/TestCases(ID=${a.ID},IsActiveEntity=true)?$select=topic,parent_ID,sortOrder`, tester)
    expect(data).toMatchObject({ topic: 'move/a2', parent_ID: f2.ID, sortOrder: 777 })
  })
})
