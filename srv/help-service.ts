import cds from '@sap/cds'
import { loadGuide } from './lib/help-content'

export default class HelpService extends cds.ApplicationService {
  async init() {
    this.on('READ', 'Sections', (req) => {
      const sections = loadGuide().sections
      const key = (req.data as { id?: string } | undefined)?.id
      if (key) return sections.find((s) => s.id === key) ?? req.reject(404, `Help section "${key}" not found`)
      return Object.assign([...sections], { $count: sections.length })
    })
    return super.init()
  }
}
