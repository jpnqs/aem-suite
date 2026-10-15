import cds from '@sap/cds'
import path from 'node:path'

const { GET, axios } = cds.test(path.join(__dirname, '..'))
const admin = { auth: { username: 'admin', password: 'admin' } }

describe('dev server (UI apps mounted at their HTML5 app names)', () => {
  beforeAll(() => {
    axios.defaults.validateStatus = () => true
  })

  it('serves odata/ relative to an app like the app\'s xs-app.json does in BTP', async () => {
    const res = await GET('/comaemsuitebrokers/odata/v4/admin/$metadata', admin)
    expect(res.status).toBe(200)
    expect(String(res.data)).toContain('AdminService')
  })

  it('leaves other paths alone', async () => {
    expect((await GET('/comaemsuitebrokers/other/odata/v4/admin/$metadata', admin)).status).toBe(404)
  })

  it('redirects the old launchpad URL', async () => {
    const res = await GET('/launchpad.html', { maxRedirects: 0 })
    expect(res.status).toBe(302)
    expect(res.headers.location).toBe('/comaemsuitelaunchpad/index.html')
  })
})
