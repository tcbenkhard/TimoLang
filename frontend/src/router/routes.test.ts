import { describe, expect, it } from 'vitest'
import { workflowId } from '../test/fixtures'
import { parseRoute, paths } from './routes'

describe('parseRoute', () => {
  it.each([
    ['/', { name: 'dashboard' }],
    ['/settings', { name: 'settings' }],
    ['/settings/', { name: 'settings' }],
    [paths.workflow(workflowId), { name: 'workflow', id: workflowId }],
    ['/workflows/not-a-uuid', { name: 'not-found' }],
    ['/workflows/../settings', { name: 'not-found' }],
    ['/unknown', { name: 'not-found' }],
  ])('maps %s', (path, route) => {
    expect(parseRoute(path)).toEqual(route)
  })
})
