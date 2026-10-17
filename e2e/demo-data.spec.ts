import { test, expect, type APIRequestContext } from '@playwright/test'
import { previewTestCase } from './launchpad'

// The demo test cases (test/data) with number ranges and faker test data resolve without errors against the demo broker.

async function preview(request: APIRequestContext, name: string) {
  const p = await previewTestCase(request, name)
  expect(p.valid, p.message).toBe(true)
  return { ...p, payload: JSON.parse(p.payload), properties: JSON.parse(p.userProperties) }
}

test.describe('demo test cases with faker and number ranges', () => {
  test('Order created and Order cancelled contain faker data', async ({ request }) => {
    const created = await preview(request, 'Order created')
    expect(created.payload.customer.email).toContain('@')
    expect(created.payload.customer.name).not.toContain('{{')
    const cancelled = await preview(request, 'Order cancelled')
    expect(cancelled.payload.cancelledBy.length).toBeGreaterThan(2)
    expect(cancelled.payload.comment.length).toBeGreaterThan(5)
  })

  test('Customer created: a customer number from the range, the person from faker', async ({ request }) => {
    const p = await preview(request, 'Customer created')
    const n = p.payload.customerNumber
    expect(n).toMatch(/^CU-[0-9]{8}$/)
    expect(p.topic.endsWith(`/${n}`)).toBe(true)
    expect(p.correlationId).toBe(n)
    expect(p.properties.customerNumber).toBe(n)
    // the names are temporary variables: the full name is made of the two parts
    expect(p.payload.person.fullName).toBe(`${p.payload.person.firstName} ${p.payload.person.lastName}`)
    expect(p.payload.person.email).toContain('@')
    expect(p.payload.address.city.length).toBeGreaterThan(1)
  })

  test('Customer address changed: old and new address differ, one customer number in topic and payload', async ({ request }) => {
    const p = await preview(request, 'Customer address changed')
    expect(p.topic.endsWith(p.payload.customerNumber.replace('CU-', ''))).toBe(true)
    expect(p.payload.oldAddress.street).not.toBe(p.payload.newAddress.street)
    expect(p.correlationId).toMatch(/^[0-9a-f-]{36}$/)
  })

  test('Employee hired: personnel number from the range, job and bank data from faker', async ({ request }) => {
    const p = await preview(request, 'Employee hired')
    expect(p.payload.employeeNumber).toMatch(/^E[0-9]{6}$/)
    expect(p.topic.endsWith(p.payload.employeeNumber)).toBe(true)
    expect(p.properties.employeeNumber).toBe(p.payload.employeeNumber)
    expect(p.payload.job.salary).toBeGreaterThanOrEqual(40000)
    expect(p.payload.job.salary).toBeLessThanOrEqual(90000)
    expect(p.payload.iban).toMatch(/^[A-Z]{2}[0-9A-Z]{10,}$/)
  })
})
