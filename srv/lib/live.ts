import cds from '@sap/cds'

const LOG = cds.log('aem-live')

/**
 * Pushes an event of LiveService (srv/live-service.cds) to the browsers that entered its websocket context
 * (run ID or subscription ID, the @ws.context element of the event). Live updates are best effort: a failure is
 * logged, never thrown - the run or subscription goes on, and the UIs also poll.
 */
export async function emitLive(event: string, data: Record<string, unknown>): Promise<void> {
  try {
    const live = await cds.connect.to('LiveService')
    await live.emit(event, data)
  } catch (e) {
    LOG.debug(`emit ${event} failed`, e)
  }
}
