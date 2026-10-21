import { describe, expect, it, vi } from 'vitest'

const loaded: string[] = []

vi.mock('testcontainers', () => {
  loaded.push('testcontainers')
  return { getContainerRuntimeClient: async () => ({}) }
})
vi.mock('@testcontainers/postgresql', () => {
  loaded.push('@testcontainers/postgresql')
  return { PostgreSqlContainer: class {} }
})

describe('@mawl/testkit startup cost', () => {
  it('does not load testcontainers when only the index is imported and fakeModel is used', async () => {
    const testkit = await import('./index')
    await testkit.fakeModel([{ text: 'x' }]).doGenerate({
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
    expect(loaded).toEqual([])
  })

  it('loads testcontainers only once Docker availability is actually probed', async () => {
    const { isDockerAvailable } = await import('./index')
    expect(await isDockerAvailable()).toBe(true)
    expect(loaded).toEqual(['testcontainers'])
  })
})
