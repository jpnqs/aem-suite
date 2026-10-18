import { startServer, users } from './helpers'

// The demo data of test/data (loaded by cds watch, and by every test server until a test resets the database):
// every demo test case resolves for the demo broker, so a change to the template rules cannot break it unnoticed.

const { GET, POST } = startServer()
const { tester } = users

describe('demo data (test/data)', () => {
  it('every demo test case resolves for the demo broker local-docker', async () => {
    const { data: brokers } = await GET(`/odata/v4/test/Brokers?$filter=${encodeURIComponent("name eq 'local-docker'")}&$select=ID`, tester)
    const brokerId = brokers.value[0].ID
    const { data: nodes } = await GET("/odata/v4/test/TestCases?$filter=kind eq 'TEST' and IsActiveEntity eq true&$select=ID,name", tester)
    expect(nodes.value.length).toBeGreaterThan(10)
    const problems: string[] = []
    for (const { ID, name } of nodes.value as { ID: string; name: string }[]) {
      const { data } = await POST(`/odata/v4/test/TestCases(ID=${ID},IsActiveEntity=true)/TestService.preview`, { brokerId }, tester)
      if (!data.valid) problems.push(`${name}: ${data.message}`)
    }
    expect(problems).toEqual([])
  })
})
