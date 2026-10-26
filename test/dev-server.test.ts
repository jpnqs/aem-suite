import { startServer, users } from './helpers'

const { GET } = startServer()
const { admin } = users

describe('dev server (UI apps mounted at their HTML5 app names)', () => {
  it('serves odata/ relative to an app like the app\'s xs-app.json does in BTP', async () => {
    const res = await GET('/comaemsuitebrokers/odata/v4/admin/$metadata', admin)
    expect(res.status).toBe(200)
    expect(String(res.data)).toContain('AdminService')
  })

  it('does not route the launchpad path to the backend (its xs-app.json has no such routes in BTP)', async () => {
    expect((await GET('/comaemsuitelaunchpad/odata/v4/admin/$metadata', admin)).status).toBe(404)
    expect((await GET('/comaemsuitelaunchpad/docs-images/home.png', admin)).status).toBe(404)
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
